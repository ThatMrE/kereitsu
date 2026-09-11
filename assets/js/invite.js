/* Kereitsu — calendar invite generation (.ics + Google Calendar link). */
(function (global) {
  'use strict';

  var T = global.KZTime;

  function pad2(n) { return T.pad2(n); }

  function stampUTC(ts) {
    var d = new Date(ts);
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' +
      pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
  }

  // First instant on or after `from` whose UTC weekday and time-of-day match
  // the chosen slot of the anchor week.
  function firstOccurrence(utcSlot, anchor, from) {
    var candidate = T.utcSlotToInstant(utcSlot, anchor);
    var floor = from == null ? Date.now() : from;
    while (candidate < floor) candidate += 7 * 86400000;
    return candidate;
  }

  function parseStartDate(value) {
    if (!value) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  // Which weekday-of-month the date is: 1st..4th, or -1 for the last.
  function weekdayOrdinal(ts) {
    var d = new Date(ts);
    var dom = d.getUTCDate();
    var nth = Math.floor((dom - 1) / 7) + 1;
    var daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    if (dom + 7 > daysInMonth) return -1; // no room for another one: it's the last
    return nth;
  }

  function rruleFor(cadence, startTs) {
    var dow = (new Date(startTs).getUTCDay() + 6) % 7; // 0 = Monday
    var day = T.ICS_DAYS[dow];
    if (cadence === 'biweekly') return 'FREQ=WEEKLY;INTERVAL=2;BYDAY=' + day;
    if (cadence === 'monthly') return 'FREQ=MONTHLY;BYDAY=' + weekdayOrdinal(startTs) + day;
    return 'FREQ=WEEKLY;BYDAY=' + day;
  }

  function cadenceLabel(cadence, startTs) {
    var dow = (new Date(startTs).getUTCDay() + 6) % 7;
    var dayName = T.DAY_NAMES[dow];
    if (cadence === 'biweekly') return 'Every other ' + dayName;
    if (cadence === 'monthly') {
      var n = weekdayOrdinal(startTs);
      var ordinals = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', '-1': 'last' };
      return 'The ' + (ordinals[n] || 'first') + ' ' + dayName + ' of every month';
    }
    return 'Every ' + dayName;
  }

  function escapeText(value) {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  // RFC 5545 caps lines at 75 octets, so fold on UTF-8 byte length rather than
  // character count and never split a multi-byte character.
  function utf8Length(ch) {
    var code = ch.codePointAt(0);
    if (code < 0x80) return 1;
    if (code < 0x800) return 2;
    if (code < 0x10000) return 3;
    return 4;
  }

  function fold(line) {
    var chunks = [];
    var current = '';
    var bytes = 0;
    var limit = 73; // leave room for CRLF
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      // Keep surrogate pairs together.
      if (ch.charCodeAt(0) >= 0xD800 && ch.charCodeAt(0) <= 0xDBFF && i + 1 < line.length) {
        ch += line[i + 1];
        i++;
      }
      var size = utf8Length(ch);
      if (bytes + size > limit) {
        chunks.push(current);
        current = '';
        bytes = 0;
        limit = 72; // continuation lines carry a leading space
      }
      current += ch;
      bytes += size;
    }
    chunks.push(current);
    return chunks.join('\r\n ');
  }

  function buildDescription(group, plan) {
    var lines = [];
    lines.push(group.name + ' — a Kereitsu mastermind circle.');
    lines.push('');
    lines.push('Cadence: ' + cadenceLabel(group.cadence, plan.start));
    lines.push('Length: ' + group.duration + ' minutes');
    lines.push('');
    lines.push('Members:');
    group.members.forEach(function (m) {
      var line = '- ' + (m.name || 'Unnamed');
      if (m.focus) line += ' — ' + m.focus;
      if (m.tz) line += ' (' + m.tz + ')';
      lines.push(line);
    });
    var asks = group.members.filter(function (m) { return m.ask; });
    if (asks.length) {
      lines.push('');
      lines.push('Bringing:');
      asks.forEach(function (m) { lines.push('- ' + (m.name || 'Someone') + ': ' + m.ask); });
    }
    lines.push('');
    lines.push('How it runs: quick check-in, then one hot seat. Ask questions before giving ' +
      'advice. Finish with what everyone is doing next.');
    return lines.join('\n');
  }

  // plan: { start: ts, end: ts, rrule, organizer }
  function buildPlan(group, anchor) {
    if (group.chosenUtcSlot == null) return null;
    var from = parseStartDate(group.startDate);
    var start = firstOccurrence(group.chosenUtcSlot, anchor, from == null ? Date.now() : from);
    var end = start + group.duration * 60000;
    return {
      start: start,
      end: end,
      rrule: rruleFor(group.cadence, start),
      label: cadenceLabel(group.cadence, start)
    };
  }

  function buildICS(group, plan, organizer) {
    var uid = 'kereitsu-' + stampUTC(plan.start).replace(/[TZ]/g, '') + '-' +
      Math.random().toString(36).slice(2, 8) + '@kereitsu';
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Kereitsu//Mastermind Scheduler//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + stampUTC(Date.now()),
      'DTSTART:' + stampUTC(plan.start),
      'DTEND:' + stampUTC(plan.end),
      'RRULE:' + plan.rrule,
      'SUMMARY:' + escapeText(group.name),
      'DESCRIPTION:' + escapeText(buildDescription(group, plan)),
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'SEQUENCE:0'
    ];
    if (group.location) lines.push('LOCATION:' + escapeText(group.location));
    if (organizer && organizer.email) {
      lines.push('ORGANIZER;CN=' + escapeText(organizer.name || organizer.email) + ':mailto:' + organizer.email);
    }
    group.members.forEach(function (m) {
      if (!m.email) return;
      if (organizer && m.email === organizer.email) return;
      lines.push('ATTENDEE;CN=' + escapeText(m.name || m.email) +
        ';ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:' + m.email);
    });
    lines.push('BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY',
      'DESCRIPTION:' + escapeText(group.name + ' starts in 15 minutes'), 'END:VALARM');
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  function googleCalendarUrl(group, plan) {
    var params = [
      'action=TEMPLATE',
      'text=' + encodeURIComponent(group.name),
      'dates=' + stampUTC(plan.start) + '%2F' + stampUTC(plan.end),
      'details=' + encodeURIComponent(buildDescription(group, plan)),
      'recur=' + encodeURIComponent('RRULE:' + plan.rrule)
    ];
    if (group.location) params.push('location=' + encodeURIComponent(group.location));
    var emails = group.members.map(function (m) { return m.email; }).filter(Boolean);
    if (emails.length) params.push('add=' + encodeURIComponent(emails.join(',')));
    return 'https://calendar.google.com/calendar/render?' + params.join('&');
  }

  function filename(group) {
    var slug = (group.name || 'mastermind').toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'mastermind';
    return slug + '.ics';
  }

  global.KZInvite = {
    stampUTC: stampUTC,
    firstOccurrence: firstOccurrence,
    parseStartDate: parseStartDate,
    weekdayOrdinal: weekdayOrdinal,
    rruleFor: rruleFor,
    cadenceLabel: cadenceLabel,
    buildDescription: buildDescription,
    buildPlan: buildPlan,
    buildICS: buildICS,
    googleCalendarUrl: googleCalendarUrl,
    filename: filename
  };
})(window);
