/* Kereitsu — UI wiring. */
(function (global) {
  'use strict';

  var T = global.KZTime;
  var G = global.KZGroup;
  var I = global.KZInvite;

  var PREFS_KEY = 'kereitsu.prefs.v1';

  var state = {
    group: G.loadGroup(),
    myId: G.loadMyId(),
    anchor: T.anchorMonday(),
    myBits: T.emptyBitset(),
    prefs: { allHours: false, use12h: false }
  };

  var els = {};
  var drag = { active: false, mode: 0 };

  function $(id) { return document.getElementById(id); }

  function me() {
    if (!state.myId) return null;
    for (var i = 0; i < state.group.members.length; i++) {
      if (state.group.members[i].id === state.myId) return state.group.members[i];
    }
    return null;
  }

  function viewerTz() {
    var m = me();
    return (m && m.tz) || T.localTimezone();
  }

  function persist() { G.saveGroup(state.group); }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (raw) state.prefs = Object.assign(state.prefs, JSON.parse(raw));
    } catch (e) { /* defaults are fine */ }
  }

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch (e) { /* ignore */ }
  }

  function status(el, message, isError) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('error', !!isError);
    if (message) {
      clearTimeout(el._timer);
      el._timer = setTimeout(function () { el.textContent = ''; el.classList.remove('error'); }, 5000);
    }
  }

  function copyText(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  /* ───────────────────────── signup ───────────────────────── */

  function populateTimezones() {
    var zones = T.timezoneList();
    var frag = document.createDocumentFragment();
    for (var i = 0; i < zones.length; i++) {
      var opt = document.createElement('option');
      opt.value = zones[i];
      opt.textContent = zones[i].replace(/_/g, ' ');
      frag.appendChild(opt);
    }
    els.tz.appendChild(frag);
    setTimezone(T.localTimezone());
  }

  // Browsers disagree about which timezone names are canonical — Chrome lists
  // Asia/Calcutta where others list Asia/Kolkata, and a name arriving from a
  // share link may be missing from the list entirely. Add it rather than let
  // the select silently fall back and rewrite someone's timezone on save.
  function setTimezone(tz) {
    if (!tz) return;
    if (!els.tz.querySelector('option[value="' + (global.CSS && CSS.escape ? CSS.escape(tz) : tz) + '"]')) {
      var known = false;
      for (var i = 0; i < els.tz.options.length; i++) {
        if (els.tz.options[i].value === tz) { known = true; break; }
      }
      if (!known) {
        var opt = document.createElement('option');
        opt.value = tz;
        opt.textContent = tz.replace(/_/g, ' ');
        els.tz.insertBefore(opt, els.tz.firstChild);
      }
    }
    els.tz.value = tz;
  }

  function fillFormFromMe() {
    var m = me();
    if (!m) {
      setTimezone(T.localTimezone());
      updateTzHint();
      return;
    }
    els.name.value = m.name;
    els.email.value = m.email;
    setTimezone(m.tz);
    els.focus.value = m.focus;
    els.ask.value = m.ask;
    state.myBits = G.memberBits(m);
    updateTzHint();
  }

  function updateTzHint() {
    var tz = els.tz.value || T.localTimezone();
    els.tzHint.textContent = 'Currently ' + T.offsetLabel(tz) + ' — ' +
      new Date().toLocaleTimeString([], { timeZone: tz, hour: '2-digit', minute: '2-digit' }) + ' there now.';
    els.gridTzLabel.textContent = tz.replace(/_/g, ' ');
  }

  function saveProfile(event) {
    if (event) event.preventDefault();
    var name = els.name.value.trim();
    if (!name) {
      status(els.signupStatus, 'What should we call you?', true);
      els.name.focus();
      return;
    }
    var email = els.email.value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      status(els.signupStatus, "That email doesn't look right.", true);
      els.email.focus();
      return;
    }

    var existing = me();
    var fields = {
      id: existing ? existing.id : undefined,
      name: name,
      email: email,
      tz: els.tz.value || (existing && existing.tz) || T.localTimezone(),
      focus: els.focus.value,
      ask: els.ask.value,
      slots: T.bitsToBase64(state.myBits)
    };

    if (existing) {
      Object.assign(existing, G.makeMember(fields));
    } else {
      var member = G.makeMember(fields);
      state.group.members.push(member);
      state.myId = member.id;
      G.saveMyId(member.id);
    }
    persist();
    status(els.signupStatus, 'Saved. Now paint your week below.');
    renderAll();
  }

  function syncMySlots() {
    var m = me();
    if (!m) return;
    m.slots = T.bitsToBase64(state.myBits);
    persist();
  }

  /* ───────────────────── availability grid ───────────────────── */

  function visibleRows() {
    var startMinute = state.prefs.allHours ? 0 : 6 * 60;
    var endMinute = state.prefs.allHours ? 24 * 60 : 23 * 60;
    var rows = [];
    for (var m = startMinute; m < endMinute; m += T.SLOT_MINUTES) rows.push(m);
    return rows;
  }

  function buildGridSkeleton(container, interactive) {
    container.textContent = '';
    var frag = document.createDocumentFragment();

    var corner = document.createElement('div');
    corner.className = 'grid-head';
    frag.appendChild(corner);
    for (var d = 0; d < T.DAYS; d++) {
      var head = document.createElement('div');
      head.className = 'grid-head';
      head.textContent = T.DAY_SHORT[d];
      frag.appendChild(head);
    }

    var rows = visibleRows();
    for (var r = 0; r < rows.length; r++) {
      var minute = rows[r];
      var isHour = minute % 60 === 0;
      var time = document.createElement('div');
      time.className = 'grid-time' + (isHour ? '' : ' minor');
      time.textContent = T.formatSlotTime(minute, state.prefs.use12h);
      frag.appendChild(time);

      for (var day = 0; day < T.DAYS; day++) {
        var cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cell' + (isHour ? ' hour-start' : '');
        cell.dataset.slot = String(T.slotIndex(day, minute));
        if (interactive) {
          cell.setAttribute('aria-pressed', 'false');
          cell.setAttribute('aria-label', T.DAY_NAMES[day] + ' ' + T.formatSlotTime(minute, state.prefs.use12h));
        }
        frag.appendChild(cell);
      }
    }
    container.appendChild(frag);
  }

  function paintMyGrid() {
    var cells = els.myGrid.querySelectorAll('.cell');
    for (var i = 0; i < cells.length; i++) {
      var slot = Number(cells[i].dataset.slot);
      cells[i].setAttribute('aria-pressed', T.bitGet(state.myBits, slot) ? 'true' : 'false');
    }
    var count = T.bitCount(state.myBits);
    var hours = (count * T.SLOT_MINUTES) / 60;
    els.mySummary.innerHTML = count
      ? '<strong>' + hours.toFixed(hours % 1 ? 1 : 0) + ' hours</strong> marked free across the week, in ' + viewerTz().replace(/_/g, ' ') + '.'
      : 'Nothing yet. Drag across the grid, or use a quick fill.';
  }

  function setSlot(slot, on) {
    if (slot < 0 || slot >= T.WEEK_SLOTS) return;
    T.bitSet(state.myBits, slot, on);
  }

  function cellFromPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el || !el.classList.contains('cell')) return null;
    return els.myGrid.contains(el) ? el : null;
  }

  function applyToCell(cell) {
    if (!cell) return;
    var slot = Number(cell.dataset.slot);
    if (T.bitGet(state.myBits, slot) === drag.mode) return;
    setSlot(slot, drag.mode);
    cell.setAttribute('aria-pressed', drag.mode ? 'true' : 'false');
  }

  function bindGridDragging() {
    els.myGrid.addEventListener('pointerdown', function (e) {
      var cell = e.target.closest ? e.target.closest('.cell') : null;
      if (!cell || !els.myGrid.contains(cell)) return;
      e.preventDefault();
      drag.active = true;
      drag.mode = T.bitGet(state.myBits, Number(cell.dataset.slot)) ? 0 : 1;
      applyToCell(cell);
    });

    document.addEventListener('pointermove', function (e) {
      if (!drag.active) return;
      e.preventDefault();
      applyToCell(cellFromPoint(e.clientX, e.clientY));
    }, { passive: false });

    function endDrag() {
      if (!drag.active) return;
      drag.active = false;
      syncMySlots();
      paintMyGrid();
      renderGroupViews();
    }
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);

    // Keyboard: the cells are real buttons, so Enter/Space toggles.
    els.myGrid.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var cell = e.target.closest ? e.target.closest('.cell') : null;
      if (!cell) return;
      e.preventDefault();
      var slot = Number(cell.dataset.slot);
      setSlot(slot, T.bitGet(state.myBits, slot) ? 0 : 1);
      syncMySlots();
      paintMyGrid();
      renderGroupViews();
    });
  }

  var FILLS = {
    'weekday-morning': { days: [0, 1, 2, 3, 4], from: 8 * 60, to: 11 * 60 },
    'weekday-lunch': { days: [0, 1, 2, 3, 4], from: 12 * 60, to: 14 * 60 },
    'weekday-evening': { days: [0, 1, 2, 3, 4], from: 18 * 60, to: 21 * 60 },
    'weekend': { days: [5, 6], from: 10 * 60, to: 16 * 60 }
  };

  function applyFill(kind) {
    if (kind === 'clear') {
      state.myBits = T.emptyBitset();
    } else {
      var spec = FILLS[kind];
      if (!spec) return;
      for (var i = 0; i < spec.days.length; i++) {
        for (var m = spec.from; m < spec.to; m += T.SLOT_MINUTES) {
          T.bitSet(state.myBits, T.slotIndex(spec.days[i], m), 1);
        }
      }
    }
    syncMySlots();
    paintMyGrid();
    renderGroupViews();
  }

  /* ───────────────────────── members ───────────────────────── */

  function addMemberFromToken(raw) {
    var parsed = G.decodeMember(raw);
    if (!parsed) {
      status(els.addStatus, "That link couldn't be read. Paste the whole thing, including the #m= part.", true);
      return null;
    }
    var existing = null;
    for (var i = 0; i < state.group.members.length; i++) {
      var m = state.group.members[i];
      var sameEmail = m.email && parsed.email && m.email.toLowerCase() === parsed.email.toLowerCase();
      var sameName = !m.email && !parsed.email && m.name.toLowerCase() === parsed.name.toLowerCase();
      if (sameEmail || sameName) { existing = m; break; }
    }
    if (existing) {
      parsed.id = existing.id;
      Object.assign(existing, parsed);
      status(els.addStatus, 'Updated ' + (parsed.name || 'that member') + "'s availability.");
    } else {
      state.group.members.push(parsed);
      status(els.addStatus, 'Added ' + (parsed.name || 'a member') + ' to the circle.');
    }
    persist();
    renderAll();
    return parsed;
  }

  function removeMember(id) {
    state.group.members = state.group.members.filter(function (m) { return m.id !== id; });
    if (state.myId === id) {
      state.myId = null;
      G.saveMyId(null);
    }
    persist();
    renderAll();
  }

  function renderMembers() {
    var list = els.members;
    list.textContent = '';
    if (!state.group.members.length) {
      var note = document.createElement('p');
      note.className = 'empty-note';
      note.textContent = 'Nobody yet. Save your profile, then paste in the links people send you.';
      list.appendChild(note);
      return;
    }
    state.group.members.forEach(function (m) {
      var card = document.createElement('div');
      card.className = 'member' + (m.id === state.myId ? ' is-me' : '');

      var name = document.createElement('div');
      name.className = 'member-name';
      name.textContent = m.name || 'Unnamed';
      if (m.id === state.myId) {
        var badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'you';
        name.appendChild(badge);
      }
      card.appendChild(name);

      var meta = document.createElement('div');
      meta.className = 'member-meta';
      var hours = (T.bitCount(G.memberBits(m)) * T.SLOT_MINUTES) / 60;
      var bits = [];
      if (m.focus) bits.push(m.focus);
      bits.push(m.tz.replace(/_/g, ' ') + ' (' + T.offsetLabel(m.tz) + ')');
      bits.push(hours ? hours.toFixed(hours % 1 ? 1 : 0) + 'h free' : 'no availability yet');
      meta.textContent = bits.join(' · ');
      card.appendChild(meta);

      if (m.ask) {
        var ask = document.createElement('p');
        ask.className = 'member-ask';
        ask.textContent = '“' + m.ask + '”';
        card.appendChild(ask);
      }

      if (m.email && m.id !== state.myId) {
        var mail = document.createElement('button');
        mail.type = 'button';
        mail.className = 'member-mail';
        mail.textContent = 'Email their link';
        mail.addEventListener('click', function () {
          openMail(mailtoForMember(m));
          status(els.mailStatus, 'Opened an email to ' + (m.name || m.email) + '.');
        });
        card.appendChild(mail);
      }

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'member-remove';
      remove.innerHTML = '&times;';
      remove.title = 'Remove ' + (m.name || 'member');
      remove.setAttribute('aria-label', 'Remove ' + (m.name || 'member'));
      remove.addEventListener('click', function () { removeMember(m.id); });
      card.appendChild(remove);

      list.appendChild(card);
    });
  }

  /* ───────────────────── overlap heatmap ───────────────────── */

  function renderOverlapGrid() {
    var tz = viewerTz();
    els.overlapTzLabel.textContent = tz.replace(/_/g, ' ');
    buildGridSkeleton(els.overlapGrid, false);

    var members = state.group.members;
    var total = members.length;
    var counts = G.overlapCounts(members, state.anchor);
    var projections = members.map(function (m) { return G.projectMember(m, state.anchor); });
    var fwd = T.localToUtcMap(tz, state.anchor);
    var slotsNeeded = Math.max(1, Math.ceil(state.group.duration / T.SLOT_MINUTES));

    var chosenSlots = {};
    if (state.group.chosenUtcSlot != null) {
      for (var k = 0; k < slotsNeeded; k++) {
        chosenSlots[(state.group.chosenUtcSlot + k) % T.WEEK_SLOTS] = true;
      }
    }

    var cells = els.overlapGrid.querySelectorAll('.cell');
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var localSlot = Number(cell.dataset.slot);
      var utcSlot = fwd[localSlot];
      var count = counts[utcSlot];
      cell.dataset.utcSlot = String(utcSlot);

      if (total && count) {
        var ratio = count / total;
        cell.style.background = 'rgba(56, 189, 248, ' + (0.14 + ratio * 0.78).toFixed(3) + ')';
      }
      if (chosenSlots[utcSlot]) cell.classList.add('selected-window');

      var free = [];
      for (var p = 0; p < members.length; p++) {
        if (projections[p][utcSlot]) free.push(members[p].name || 'Unnamed');
      }

      var day = T.slotDay(localSlot);
      var label = T.DAY_NAMES[day] + ' ' + T.formatSlotTime(T.slotMinuteOfDay(localSlot), state.prefs.use12h) +
        ' — ' + count + ' of ' + total + ' free' + (free.length ? ': ' + free.join(', ') : '');
      cell.title = label;
      cell.setAttribute('aria-label', label);
      cell.addEventListener('click', onOverlapCellClick);
    }

    renderLegend(total);
  }

  function onOverlapCellClick(e) {
    var utcSlot = Number(e.currentTarget.dataset.utcSlot);
    state.group.chosenUtcSlot = utcSlot;
    persist();
    renderGroupViews();
    status(els.inviteStatus, 'Meeting time set. The invite below is ready.');
  }

  function renderLegend(total) {
    els.legend.textContent = '';
    if (!total) {
      els.legend.textContent = 'Add members to see where the week overlaps.';
      return;
    }
    var steps = [0, Math.ceil(total / 2), total];
    var seen = {};
    steps.forEach(function (n) {
      if (seen[n]) return;
      seen[n] = true;
      var item = document.createElement('span');
      item.className = 'legend-item';
      var swatch = document.createElement('span');
      swatch.className = 'legend-swatch';
      swatch.style.background = n ? 'rgba(56, 189, 248, ' + (0.14 + (n / total) * 0.78).toFixed(3) + ')' : '#12132a';
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(n + ' of ' + total + ' free'));
      els.legend.appendChild(item);
    });
  }

  /* ───────────────────────── windows ───────────────────────── */

  function renderWindows() {
    var container = els.windows;
    container.textContent = '';
    var members = state.group.members;
    var withAvailability = members.filter(function (m) { return T.bitCount(G.memberBits(m)); });

    if (withAvailability.length < 1) {
      els.windowsNote.textContent = 'Paint a week and the best windows turn up here.';
      return;
    }

    var windows = G.rankWindows(withAvailability, state.anchor, state.group.duration, { limit: 6 });
    if (!windows.length) {
      els.windowsNote.textContent = 'Nothing long enough for a ' + state.group.duration +
        '-minute session yet. Try a shorter one, or ask for more hours.';
      return;
    }

    var who = withAvailability.length === 1
      ? 'Only one week painted so far, so these are just your own free hours.'
      : 'Ranked by how many of the ' + withAvailability.length +
        ' can make the whole session, then by how kind the hour is to everyone.';
    els.windowsNote.textContent = who;

    var tz = viewerTz();
    windows.forEach(function (w) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'window' + (state.group.chosenUtcSlot === w.utcSlot ? ' is-chosen' : '');

      var main = document.createElement('div');
      main.className = 'window-main';

      var time = document.createElement('div');
      time.className = 'window-time';
      time.textContent = G.localWindowLabel(w.utcSlot, state.group.duration, tz, state.anchor, state.prefs.use12h) +
        ' · ' + tz.split('/').pop().replace(/_/g, ' ');
      main.appendChild(time);

      var others = withAvailability.filter(function (m) { return m.tz !== tz; });
      if (others.length) {
        var sub = document.createElement('div');
        sub.className = 'window-sub';
        sub.textContent = others.slice(0, 4).map(function (m) {
          return (m.name || 'Member') + ' ' +
            G.localWindowLabel(w.utcSlot, state.group.duration, m.tz, state.anchor, state.prefs.use12h);
        }).join('  ·  ');
        main.appendChild(sub);
      }

      var missing = withAvailability.filter(function (m) { return w.attendees.indexOf(m.id) === -1; });
      if (missing.length) {
        var miss = document.createElement('div');
        miss.className = 'window-sub window-missing';
        miss.textContent = 'Misses ' + missing.map(function (m) { return m.name || 'a member'; }).join(', ');
        main.appendChild(miss);
      }

      btn.appendChild(main);

      var score = document.createElement('div');
      score.className = 'window-score';
      score.innerHTML = '<strong>' + w.count + '/' + withAvailability.length + '</strong>can make it';
      btn.appendChild(score);

      btn.addEventListener('click', function () {
        state.group.chosenUtcSlot = w.utcSlot;
        persist();
        renderGroupViews();
        status(els.inviteStatus, 'Meeting time set. The invite below is ready.');
      });

      container.appendChild(btn);
    });
  }

  /* ───────────────────────── invite ───────────────────────── */

  function currentPlan() {
    if (state.group.chosenUtcSlot == null) return null;
    return I.buildPlan(state.group, state.anchor);
  }

  function renderInvite() {
    var panel = els.invitePreview;
    panel.textContent = '';
    var heading = document.createElement('h3');
    heading.textContent = 'The invite';
    panel.appendChild(heading);

    var plan = currentPlan();
    if (!plan) {
      var empty = document.createElement('p');
      empty.className = 'invite-empty';
      empty.textContent = 'Pick a meeting time above and the invite builds itself here.';
      panel.appendChild(empty);
      setInviteEnabled(false);
      return;
    }

    var tz = viewerTz();
    var first = new Date(plan.start).toLocaleString([], {
      timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    var attendees = state.group.members.filter(function (m) { return m.email; });

    var lines = [
      ['Event', state.group.name || 'Mastermind circle'],
      ['Repeats', plan.label],
      ['First one', first + ' (' + tz.replace(/_/g, ' ') + ')'],
      ['Length', state.group.duration + ' minutes'],
      ['Where', state.group.location || '—'],
      ['Invitees', attendees.length
        ? attendees.map(function (m) { return (m.name || m.email) + ' <' + m.email + '>'; }).join(', ')
        : 'No emails yet. Add them and the invite carries attendees.']
    ];

    lines.forEach(function (pair) {
      var row = document.createElement('div');
      row.className = 'invite-line';
      var key = document.createElement('span');
      key.className = 'invite-key';
      key.textContent = pair[0];
      var val = document.createElement('span');
      val.className = 'invite-val';
      val.textContent = pair[1];
      row.appendChild(key);
      row.appendChild(val);
      panel.appendChild(row);
    });

    setInviteEnabled(true, plan);
  }

  function setInviteEnabled(enabled, plan) {
    els.downloadIcs.disabled = !enabled;
    els.copySummary.disabled = !enabled;
    els.googleLink.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    els.emailLink.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    if (!enabled || !plan) {
      els.googleLink.removeAttribute('href');
      els.emailLink.removeAttribute('href');
      return;
    }
    els.googleLink.href = I.googleCalendarUrl(state.group, plan);
    var emails = state.group.members.map(function (m) { return m.email; }).filter(Boolean);
    els.emailLink.href = 'mailto:' + encodeURIComponent(emails.join(',')) +
      '?subject=' + encodeURIComponent(state.group.name || 'Our mastermind circle') +
      '&body=' + encodeURIComponent(inviteSummary(plan));
  }

  function inviteSummary(plan) {
    var tz = viewerTz();
    var first = new Date(plan.start).toLocaleString([], {
      timeZone: tz, weekday: 'long', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    var perTz = {};
    state.group.members.forEach(function (m) { perTz[m.tz] = true; });
    var localLines = Object.keys(perTz).map(function (zone) {
      return '  ' + zone.replace(/_/g, ' ') + ': ' +
        G.localWindowLabel(state.group.chosenUtcSlot, state.group.duration, zone, state.anchor, state.prefs.use12h);
    });
    return [
      state.group.name || 'Our mastermind circle',
      '',
      plan.label + ', ' + state.group.duration + ' minutes.',
      'First session: ' + first + ' (' + tz.replace(/_/g, ' ') + ').',
      state.group.location ? 'Where: ' + state.group.location : '',
      '',
      'Local times:',
      localLines.join('\n'),
      '',
      I.buildDescription(state.group, plan)
    ].filter(function (line) { return line !== ''; }).join('\n');
  }

  function downloadICS() {
    var plan = currentPlan();
    if (!plan) return;

    // Keep the UID and advance the sequence before building, so a second
    // download updates the event already in people's calendars.
    var issue = I.nextIssue(state.group, plan);
    var isUpdate = issue.sequence > 0 && issue.sequence !== state.group.sequence;
    state.group.uid = issue.uid;
    state.group.sequence = issue.sequence;
    state.group.icsSignature = issue.signature;
    persist();

    var ics = I.buildICS(state.group, plan, me());
    var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = I.filename(state.group);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    status(els.inviteStatus, isUpdate
      ? 'Downloaded an update. Opening it moves the existing event rather than adding a second one.'
      : 'Downloaded ' + I.filename(state.group) + '. Open it to add every session.');
  }

  /* ───────────────────────── share ───────────────────────── */

  function renderShareLink() {
    var m = me();
    if (!m) {
      els.shareLink.value = '';
      els.shareLink.placeholder = 'Save your profile to generate a link';
      return;
    }
    els.shareLink.value = G.shareUrl(m);
  }

  // A self-link restores someone's own answers rather than adding them as
  // somebody else in their own circle.
  function claimProfileFromToken(token) {
    var parsed = G.decodeMember(token);
    if (!parsed) return null;
    var existing = null;
    for (var i = 0; i < state.group.members.length; i++) {
      var m = state.group.members[i];
      if (m.email && parsed.email && m.email.toLowerCase() === parsed.email.toLowerCase()) {
        existing = m;
        break;
      }
    }
    if (existing) {
      parsed.id = existing.id;
      Object.assign(existing, parsed);
    } else {
      state.group.members.push(parsed);
    }
    state.myId = parsed.id;
    G.saveMyId(parsed.id);
    state.myBits = G.memberBits(parsed);
    persist();
    fillFormFromMe();
    renderAll();
    return parsed;
  }

  function consumeIncomingLink() {
    var hash = location.hash || '';

    if (hash.indexOf('#me=') === 0) {
      var selfToken = hash.slice(4);
      history.replaceState(null, '', location.pathname + location.search);
      var mine = claimProfileFromToken(selfToken);
      if (mine) {
        status(els.signupStatus, 'Welcome back, ' + (mine.name || 'you') +
          '. Your answers are loaded — change what you need and send your link back.');
        document.getElementById('availability').scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }

    if (hash.indexOf('#m=') !== 0) return;
    var token = hash.slice(3);
    history.replaceState(null, '', location.pathname + location.search);
    var added = addMemberFromToken(token);
    if (added) {
      status(els.addStatus, (added.name || 'A member') + ' joined from a shared link.');
      document.getElementById('schedule').scrollIntoView({ behavior: 'smooth' });
    }
  }

  /* ───────────────────── mailing links out ───────────────────── */

  function mailtoForMember(member) {
    var circle = state.group.name || 'our mastermind circle';
    var from = me();
    var firstName = (member.name || '').split(' ')[0];
    var body = [
      'Hi' + (firstName ? ' ' + firstName : '') + ',',
      '',
      'This link opens your place in ' + circle + ' — your details and the hours you marked free:',
      '',
      G.selfUrl(member),
      '',
      'Change whatever is out of date, then copy your share link underneath the grid and send it',
      'back to me so I can update the circle.'
    ];
    if (from && from.name && from.id !== member.id) body.push('', '— ' + from.name);
    return 'mailto:' + encodeURIComponent(member.email) +
      '?subject=' + encodeURIComponent('Your link for ' + circle) +
      '&body=' + encodeURIComponent(body.join('\n'));
  }

  function openMail(url) {
    var a = document.createElement('a');
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Mail apps only open one compose window per click, so walk the circle one
  // person at a time instead of firing a burst the browser would swallow.
  var mailQueue = [];

  function mailableMembers() {
    return state.group.members.filter(function (m) {
      return m.email && m.id !== state.myId;
    });
  }

  function updateMailButton() {
    var pending = mailQueue.length;
    var total = mailableMembers().length;
    if (!total) {
      els.mailNext.disabled = true;
      els.mailNext.textContent = 'Email everyone their link';
      return;
    }
    els.mailNext.disabled = false;
    els.mailNext.textContent = pending
      ? 'Next: ' + (mailQueue[0].name || mailQueue[0].email)
      : 'Email everyone their link';
  }

  function sendNextLink() {
    if (!mailQueue.length) {
      mailQueue = mailableMembers();
      if (!mailQueue.length) {
        status(els.mailStatus, 'Nobody in the circle has an email address yet.', true);
        return;
      }
    }
    var member = mailQueue.shift();
    openMail(mailtoForMember(member));
    var left = mailQueue.length;
    status(els.mailStatus, left
      ? 'Opened an email to ' + (member.name || member.email) + '. ' + left + ' to go.'
      : 'Opened the last one — that\'s everybody.');
    updateMailButton();
  }

  /* ───────────────────────── render ───────────────────────── */

  function renderGroupViews() {
    renderShareLink();
    renderMembers();
    updateMailButton();
    renderOverlapGrid();
    renderWindows();
    renderInvite();
  }

  function renderAll() {
    buildGridSkeleton(els.myGrid, true);
    paintMyGrid();
    renderGroupViews();
  }

  function syncGroupInputs() {
    els.gName.value = state.group.name;
    els.gDuration.value = String(state.group.duration);
    els.gStart.value = state.group.startDate;
    els.gLocation.value = state.group.location;
    var radios = document.querySelectorAll('input[name="cadence"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === state.group.cadence;
    els.showAllHours.checked = state.prefs.allHours;
    els.use12h.checked = state.prefs.use12h;
  }

  /* ───────────────────────── boot ───────────────────────── */

  function bindEvents() {
    els.signupForm.addEventListener('submit', saveProfile);
    els.tz.addEventListener('change', function () {
      updateTzHint();
      var m = me();
      if (m) { m.tz = els.tz.value; persist(); renderGroupViews(); }
    });

    document.querySelectorAll('[data-fill]').forEach(function (btn) {
      btn.addEventListener('click', function () { applyFill(btn.dataset.fill); });
    });

    els.showAllHours.addEventListener('change', function () {
      state.prefs.allHours = els.showAllHours.checked;
      savePrefs();
      renderAll();
    });
    els.use12h.addEventListener('change', function () {
      state.prefs.use12h = els.use12h.checked;
      savePrefs();
      renderAll();
    });

    els.copyLink.addEventListener('click', function () {
      if (!els.shareLink.value) {
        status(els.shareStatus, 'Save your profile first.', true);
        return;
      }
      copyText(els.shareLink.value).then(function () {
        status(els.shareStatus, "Copied. Send it to whoever's organising.");
      }, function () {
        els.shareLink.select();
        status(els.shareStatus, 'Press ⌘/Ctrl+C to copy.', true);
      });
    });

    els.addMember.addEventListener('click', function () {
      var value = els.memberToken.value.trim();
      if (!value) {
        status(els.addStatus, 'Paste a share link first.', true);
        return;
      }
      if (addMemberFromToken(value)) els.memberToken.value = '';
    });
    els.memberToken.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); els.addMember.click(); }
    });

    els.gName.addEventListener('input', function () {
      state.group.name = els.gName.value;
      persist();
      renderInvite();
    });
    els.gDuration.addEventListener('change', function () {
      state.group.duration = Number(els.gDuration.value);
      persist();
      renderGroupViews();
    });
    els.gStart.addEventListener('change', function () {
      state.group.startDate = els.gStart.value;
      persist();
      renderInvite();
    });
    els.gLocation.addEventListener('input', function () {
      state.group.location = els.gLocation.value;
      persist();
      renderInvite();
    });
    document.querySelectorAll('input[name="cadence"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        state.group.cadence = radio.value;
        persist();
        renderInvite();
      });
    });

    els.mailNext.addEventListener('click', sendNextLink);

    els.downloadIcs.addEventListener('click', downloadICS);
    els.copySummary.addEventListener('click', function () {
      var plan = currentPlan();
      if (!plan) return;
      copyText(inviteSummary(plan)).then(function () {
        status(els.inviteStatus, 'Copied. Paste it into the group chat.');
      }, function () {
        status(els.inviteStatus, 'Copying failed; your browser blocked it.', true);
      });
    });

    els.resetAll.addEventListener('click', function () {
      if (!confirm('Delete your profile and your circle from this device?')) return;
      try {
        localStorage.removeItem(G.STORAGE_KEY);
        localStorage.removeItem('kereitsu.me.v1');
        localStorage.removeItem(PREFS_KEY);
      } catch (e) { /* nothing to clean up */ }
      location.hash = '';
      location.reload();
    });
  }

  function init() {
    els = {
      signupForm: $('signup-form'), name: $('f-name'), email: $('f-email'), tz: $('f-tz'),
      focus: $('f-focus'), ask: $('f-ask'), tzHint: $('tz-hint'), signupStatus: $('signup-status'),
      gridTzLabel: $('grid-tz-label'), myGrid: $('my-grid'), mySummary: $('my-summary'),
      showAllHours: $('show-all-hours'), use12h: $('use-12h'),
      shareLink: $('share-link'), copyLink: $('copy-link'), shareStatus: $('share-status'),
      gName: $('g-name'), memberToken: $('member-token'), addMember: $('add-member'),
      addStatus: $('add-status'), members: $('members'),
      mailNext: $('mail-next'), mailStatus: $('mail-status'),
      overlapGrid: $('overlap-grid'), overlapTzLabel: $('overlap-tz-label'), legend: $('legend'),
      windows: $('windows'), windowsNote: $('windows-note'),
      gDuration: $('g-duration'), gStart: $('g-start'), gLocation: $('g-location'),
      invitePreview: $('invite-preview'), downloadIcs: $('download-ics'),
      googleLink: $('google-link'), emailLink: $('email-link'), copySummary: $('copy-summary'),
      inviteStatus: $('invite-status'), resetAll: $('reset-all')
    };

    loadPrefs();
    populateTimezones();
    fillFormFromMe();
    syncGroupInputs();
    bindEvents();
    bindGridDragging();
    renderAll();
    consumeIncomingLink();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
