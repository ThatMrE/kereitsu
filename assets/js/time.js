/* Kereitsu — time + availability slot engine.
 *
 * Availability is stored per member in *their own local wall-clock time* as a
 * bitset over the week: 7 days x 48 half-hour slots = 336 bits, indexed from
 * Monday 00:00 local. Overlap is computed by projecting every member's local
 * slots onto a common UTC timeline for one anchor week, so people in different
 * timezones can be compared honestly.
 */
(function (global) {
  'use strict';

  var SLOT_MINUTES = 30;
  var SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES; // 48
  var DAYS = 7;
  var WEEK_SLOTS = SLOTS_PER_DAY * DAYS; // 336
  var DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var ICS_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

  /* ---------- timezone primitives ---------- */

  var offsetCache = Object.create(null);

  function formatterFor(tz) {
    if (!offsetCache[tz]) {
      offsetCache[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    return offsetCache[tz];
  }

  // Offset of `tz` from UTC, in milliseconds, at the instant `ts`.
  function offsetAt(ts, tz) {
    var parts = formatterFor(tz).formatToParts(new Date(ts));
    var f = {};
    for (var i = 0; i < parts.length; i++) f[parts[i].type] = parts[i].value;
    var hour = Number(f.hour) === 24 ? 0 : Number(f.hour);
    var asUTC = Date.UTC(Number(f.year), Number(f.month) - 1, Number(f.day), hour, Number(f.minute), Number(f.second));
    return asUTC - ts;
  }

  // The UTC instant at which the wall clock in `tz` reads the given date/time.
  function wallTimeToInstant(year, month, day, hours, minutes, tz) {
    var naive = Date.UTC(year, month, day, hours, minutes);
    var off = offsetAt(naive, tz);
    var ts = naive - off;
    var off2 = offsetAt(ts, tz);
    if (off2 !== off) ts = naive - off2;
    return ts;
  }

  function localTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) {
      return 'UTC';
    }
  }

  function timezoneList() {
    var list = [];
    try {
      if (typeof Intl.supportedValuesOf === 'function') list = Intl.supportedValuesOf('timeZone');
    } catch (e) { /* fall through */ }
    if (!list.length) {
      list = ['UTC', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
        'America/Sao_Paulo', 'Europe/London', 'Europe/Lisbon', 'Europe/Berlin', 'Europe/Paris',
        'Europe/Amsterdam', 'Europe/Madrid', 'Europe/Warsaw', 'Europe/Athens', 'Europe/Istanbul',
        'Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Karachi',
        'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai',
        'Asia/Tokyo', 'Asia/Seoul', 'Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland'];
    }
    var here = localTimezone();
    if (list.indexOf(here) === -1) list = [here].concat(list);
    return list;
  }

  // "UTC+05:30" style label for a timezone right now.
  function offsetLabel(tz, ts) {
    var off = offsetAt(ts == null ? Date.now() : ts, tz);
    var mins = Math.round(off / 60000);
    var sign = mins < 0 ? '-' : '+';
    mins = Math.abs(mins);
    return 'UTC' + sign + pad2(Math.floor(mins / 60)) + ':' + pad2(mins % 60);
  }

  /* ---------- the anchor week ---------- */

  // Monday 00:00 UTC of the week that starts on or after `from`. Everyone's
  // availability is projected onto this same week so comparisons line up.
  function anchorMonday(from) {
    var d = new Date(from == null ? Date.now() : from);
    var utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    var dow = (new Date(utcMidnight).getUTCDay() + 6) % 7; // 0 = Monday
    return utcMidnight + (7 - dow) * 86400000;
  }

  /* ---------- slot math ---------- */

  function slotIndex(day, minuteOfDay) {
    return day * SLOTS_PER_DAY + Math.floor(minuteOfDay / SLOT_MINUTES);
  }

  function slotDay(index) { return Math.floor(index / SLOTS_PER_DAY); }
  function slotMinuteOfDay(index) { return (index % SLOTS_PER_DAY) * SLOT_MINUTES; }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function formatSlotTime(minuteOfDay, use12h) {
    var h = Math.floor(minuteOfDay / 60) % 24;
    var m = minuteOfDay % 60;
    if (!use12h) return pad2(h) + ':' + pad2(m);
    var suffix = h < 12 ? 'am' : 'pm';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + (m ? ':' + pad2(m) : '') + suffix;
  }

  /* ---------- projection between local and UTC slot space ---------- */

  // Maps each of a timezone's 336 local slots to the UTC slot it falls in,
  // for the given anchor week. Cached per (tz, anchor).
  var projectionCache = Object.create(null);

  function localToUtcMap(tz, anchor) {
    var key = tz + '@' + anchor;
    if (projectionCache[key]) return projectionCache[key];

    var map = new Int16Array(WEEK_SLOTS);
    var monday = new Date(anchor);
    for (var day = 0; day < DAYS; day++) {
      for (var s = 0; s < SLOTS_PER_DAY; s++) {
        var minute = s * SLOT_MINUTES;
        var ts = wallTimeToInstant(
          monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + day,
          Math.floor(minute / 60), minute % 60, tz
        );
        var delta = Math.round((ts - anchor) / 60000 / SLOT_MINUTES);
        map[slotIndex(day, minute)] = ((delta % WEEK_SLOTS) + WEEK_SLOTS) % WEEK_SLOTS;
      }
    }
    projectionCache[key] = map;
    return map;
  }

  // Inverse: for each UTC slot, which local slot shows it. Used for rendering
  // the group heatmap in the viewer's own timezone.
  function utcToLocalMap(tz, anchor) {
    var key = 'inv:' + tz + '@' + anchor;
    if (projectionCache[key]) return projectionCache[key];
    var fwd = localToUtcMap(tz, anchor);
    var inv = new Int16Array(WEEK_SLOTS);
    for (var i = 0; i < WEEK_SLOTS; i++) inv[fwd[i]] = i;
    projectionCache[key] = inv;
    return inv;
  }

  // The UTC instant of a UTC slot within the anchor week.
  function utcSlotToInstant(utcSlot, anchor) {
    return anchor + utcSlot * SLOT_MINUTES * 60000;
  }

  /* ---------- bitsets ---------- */

  function emptyBitset() { return new Uint8Array(Math.ceil(WEEK_SLOTS / 8)); }

  function bitGet(bits, i) { return (bits[i >> 3] >> (i & 7)) & 1; }

  function bitSet(bits, i, on) {
    if (on) bits[i >> 3] |= (1 << (i & 7));
    else bits[i >> 3] &= ~(1 << (i & 7));
  }

  function bitCount(bits) {
    var n = 0;
    for (var i = 0; i < WEEK_SLOTS; i++) n += bitGet(bits, i);
    return n;
  }

  function bitsToBase64(bits) {
    var s = '';
    for (var i = 0; i < bits.length; i++) s += String.fromCharCode(bits[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function bitsFromBase64(str) {
    var bits = emptyBitset();
    if (!str) return bits;
    var b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var raw = atob(b64);
    for (var i = 0; i < bits.length && i < raw.length; i++) bits[i] = raw.charCodeAt(i);
    return bits;
  }

  global.KZTime = {
    SLOT_MINUTES: SLOT_MINUTES,
    SLOTS_PER_DAY: SLOTS_PER_DAY,
    WEEK_SLOTS: WEEK_SLOTS,
    DAYS: DAYS,
    DAY_NAMES: DAY_NAMES,
    DAY_SHORT: DAY_SHORT,
    ICS_DAYS: ICS_DAYS,
    offsetAt: offsetAt,
    wallTimeToInstant: wallTimeToInstant,
    localTimezone: localTimezone,
    timezoneList: timezoneList,
    offsetLabel: offsetLabel,
    anchorMonday: anchorMonday,
    slotIndex: slotIndex,
    slotDay: slotDay,
    slotMinuteOfDay: slotMinuteOfDay,
    formatSlotTime: formatSlotTime,
    localToUtcMap: localToUtcMap,
    utcToLocalMap: utcToLocalMap,
    utcSlotToInstant: utcSlotToInstant,
    emptyBitset: emptyBitset,
    bitGet: bitGet,
    bitSet: bitSet,
    bitCount: bitCount,
    bitsToBase64: bitsToBase64,
    bitsFromBase64: bitsFromBase64,
    pad2: pad2
  };
})(window);
