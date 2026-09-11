/* Kereitsu — group state, overlap computation and shareable member links. */
(function (global) {
  'use strict';

  var T = global.KZTime;
  var STORAGE_KEY = 'kereitsu.group.v1';
  var ME_KEY = 'kereitsu.me.v1';

  /* ---------- members ---------- */

  function newId() {
    return 'm' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  }

  function makeMember(fields) {
    return {
      id: fields.id || newId(),
      name: (fields.name || '').trim(),
      email: (fields.email || '').trim(),
      tz: fields.tz || T.localTimezone(),
      focus: (fields.focus || '').trim(),
      ask: (fields.ask || '').trim(),
      slots: fields.slots || ''
    };
  }

  function memberBits(member) { return T.bitsFromBase64(member.slots); }

  /* ---------- persistence ---------- */

  function defaultGroup() {
    return {
      name: 'My Mastermind',
      cadence: 'weekly',
      duration: 60,           // minutes
      startDate: '',          // YYYY-MM-DD; blank = next occurrence
      chosenUtcSlot: null,    // index into the UTC week
      location: '',
      uid: '',                // stable calendar UID, set on first download
      sequence: 0,            // raised when a download changes the event
      icsSignature: '',       // what the last download described
      members: []
    };
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadGroup() {
    var g = readJSON(STORAGE_KEY, null);
    if (!g || !Array.isArray(g.members)) return defaultGroup();
    var base = defaultGroup();
    for (var k in base) if (!(k in g)) g[k] = base[k];
    g.members = g.members.map(makeMember);
    return g;
  }

  function saveGroup(group) { return writeJSON(STORAGE_KEY, group); }
  function loadMyId() { return readJSON(ME_KEY, null); }
  function saveMyId(id) { return writeJSON(ME_KEY, id); }

  /* ---------- share links ---------- */

  function encodeMember(member) {
    var payload = {
      v: 1,
      n: member.name,
      e: member.email,
      z: member.tz,
      f: member.focus,
      a: member.ask,
      s: member.slots
    };
    var json = JSON.stringify(payload);
    var b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeMember(token) {
    if (!token) return null;
    var cleaned = String(token).trim();
    // Tolerate someone pasting a whole URL of either kind.
    var selfAt = cleaned.indexOf('#me=');
    if (selfAt !== -1) cleaned = cleaned.slice(selfAt + 4);
    else {
      var hashAt = cleaned.indexOf('#m=');
      if (hashAt !== -1) cleaned = cleaned.slice(hashAt + 3);
    }
    cleaned = cleaned.replace(/[?&].*$/, '').replace(/\s+/g, '');
    var b64 = cleaned.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    try {
      var json = decodeURIComponent(escape(atob(b64)));
      var p = JSON.parse(json);
      if (!p || typeof p !== 'object') return null;
      return makeMember({ name: p.n, email: p.e, tz: p.z, focus: p.f, ask: p.a, slots: p.s });
    } catch (e) {
      return null;
    }
  }

  // Two kinds of link, because they mean opposite things on arrival.
  // #m=  — "add this person to your circle", what a member sends the organiser.
  // #me= — "this is your own profile", what the organiser sends back to a member.
  function shareUrl(member) {
    return baseUrl() + '#m=' + encodeMember(member);
  }

  function selfUrl(member) {
    return baseUrl() + '#me=' + encodeMember(member);
  }

  function baseUrl() {
    return location.origin + location.pathname;
  }

  /* ---------- overlap ---------- */

  // Counts, per UTC slot of the anchor week, how many members are free.
  function overlapCounts(members, anchor) {
    var counts = new Uint8Array(T.WEEK_SLOTS);
    for (var i = 0; i < members.length; i++) {
      var bits = memberBits(members[i]);
      var map = T.localToUtcMap(members[i].tz, anchor);
      for (var s = 0; s < T.WEEK_SLOTS; s++) {
        if (T.bitGet(bits, s)) counts[map[s]] += 1;
      }
    }
    return counts;
  }

  // Per-member availability projected onto UTC slots — used to say exactly who
  // can and cannot make a given window.
  function projectMember(member, anchor) {
    var bits = memberBits(member);
    var map = T.localToUtcMap(member.tz, anchor);
    var out = new Uint8Array(T.WEEK_SLOTS);
    for (var s = 0; s < T.WEEK_SLOTS; s++) if (T.bitGet(bits, s)) out[map[s]] = 1;
    return out;
  }

  // A local hour is "comfortable" between 08:00 and 20:00, tolerable to 21:00.
  function civilityScore(utcSlot, slotsNeeded, members, anchor) {
    var score = 0;
    for (var i = 0; i < members.length; i++) {
      var inv = T.utcToLocalMap(members[i].tz, anchor);
      var localSlot = inv[utcSlot];
      var startHour = T.slotMinuteOfDay(localSlot) / 60;
      var endHour = startHour + (slotsNeeded * T.SLOT_MINUTES) / 60;
      if (startHour >= 8 && endHour <= 20) score += 2;
      else if (startHour >= 7 && endHour <= 21.5) score += 1;
      else if (startHour < 6 || endHour > 23) score -= 2;
    }
    return score;
  }

  // Ranked meeting windows: whole-window availability first, then how humane
  // the local hour is for everyone, then earlier in the week.
  function rankWindows(members, anchor, durationMinutes, options) {
    options = options || {};
    var slotsNeeded = Math.max(1, Math.ceil(durationMinutes / T.SLOT_MINUTES));
    var projections = members.map(function (m) { return projectMember(m, anchor); });
    var windows = [];

    for (var start = 0; start < T.WEEK_SLOTS; start++) {
      var attendees = [];
      for (var i = 0; i < members.length; i++) {
        var ok = true;
        for (var k = 0; k < slotsNeeded; k++) {
          if (!projections[i][(start + k) % T.WEEK_SLOTS]) { ok = false; break; }
        }
        if (ok) attendees.push(members[i].id);
      }
      if (!attendees.length) continue;
      windows.push({
        utcSlot: start,
        attendees: attendees,
        count: attendees.length,
        civility: civilityScore(start, slotsNeeded, members, anchor)
      });
    }

    windows.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      if (b.civility !== a.civility) return b.civility - a.civility;
      return a.utcSlot - b.utcSlot;
    });

    // Collapse adjacent windows that are just the same block shifted by 30 min.
    var kept = [];
    for (var w = 0; w < windows.length; w++) {
      var win = windows[w];
      var overlapping = false;
      for (var j = 0; j < kept.length; j++) {
        var diff = Math.abs(kept[j].utcSlot - win.utcSlot);
        diff = Math.min(diff, T.WEEK_SLOTS - diff);
        if (diff < slotsNeeded && kept[j].count === win.count) { overlapping = true; break; }
      }
      if (!overlapping) kept.push(win);
      if (kept.length >= (options.limit || 6)) break;
    }
    return kept;
  }

  /* ---------- describing a window ---------- */

  function localWindowLabel(utcSlot, durationMinutes, tz, anchor, use12h) {
    var inv = T.utcToLocalMap(tz, anchor);
    var localSlot = inv[utcSlot];
    var day = T.slotDay(localSlot);
    var minute = T.slotMinuteOfDay(localSlot);
    var end = minute + durationMinutes;
    var endDay = day + Math.floor(end / (24 * 60));
    var label = T.DAY_SHORT[day % 7] + ' ' + T.formatSlotTime(minute, use12h) +
      '–' + T.formatSlotTime(end % (24 * 60), use12h);
    if (endDay !== day) label += ' (+1d)';
    return label;
  }

  global.KZGroup = {
    STORAGE_KEY: STORAGE_KEY,
    makeMember: makeMember,
    memberBits: memberBits,
    defaultGroup: defaultGroup,
    loadGroup: loadGroup,
    saveGroup: saveGroup,
    loadMyId: loadMyId,
    saveMyId: saveMyId,
    encodeMember: encodeMember,
    decodeMember: decodeMember,
    shareUrl: shareUrl,
    selfUrl: selfUrl,
    baseUrl: baseUrl,
    overlapCounts: overlapCounts,
    projectMember: projectMember,
    rankWindows: rankWindows,
    localWindowLabel: localWindowLabel
  };
})(window);
