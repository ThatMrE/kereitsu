# Kereitsu

A static site for starting and scheduling a mastermind circle. It covers the
whole path from "we should do this" to a recurring event in everyone's
calendar:

- **An explainer** — what a keiretsu is, where the idea comes from, and what a
  modern mastermind borrows from it.
- **Signup** — name, email, timezone, what you're building, what you want help
  with.
- **A schedule overlap tool** — every member paints the half-hours they're free
  in their own local time; the site projects all of it onto one timeline and
  shows where the week actually overlaps.
- **Cadence** — weekly, fortnightly or monthly, with a session length.
- **A calendar invite** — a standard recurring `.ics` with attendees attached,
  plus a Google Calendar link and a copyable summary.

## Running it

There is no build step and no dependencies. Open `index.html`, or serve the
directory:

```sh
python3 -m http.server 8000
```

It also works as-is on GitHub Pages or any static host.

## How it works without a server

Everything lives in the browser. There is no backend, no account and no
database.

A member fills in their profile and availability, and the page compresses it
into a link carrying only their name, email, timezone and availability bitset.
Group state is kept in `localStorage` under `kereitsu.*` keys, and the footer
has a reset that clears it.

There are two kinds of link, because they mean opposite things on arrival:

| Link | Sent by | On opening |
| --- | --- | --- |
| `#m=…` | a member, to the organiser | adds that person to your circle |
| `#me=…` | the organiser, back to a member | loads it as *your own* profile |

The organiser pastes a `#m=` link into *Add a member*, or just opens it. The
`#me=` direction is what *Email everyone their link* sends: it puts someone
back in front of their own answers on any device, so they can adjust the hours
they marked and send a fresh `#m=` link back.

The trade-off is deliberate: no data leaves the device, and the cost is that
the organiser holds the canonical copy of the circle.

## Timezones

Availability is stored per member as a 336-bit set — 7 days × 48 half-hour
slots — in their **own local wall-clock time**. To compare members, every set
is projected onto a common UTC week (the upcoming Monday, used as an anchor)
using `Intl` offsets, so half-hour zones like `Asia/Kolkata` and cross-midnight
wraps like `Australia/Sydney` land correctly.

Meeting windows are ranked by how many members can attend the *whole* session,
then by how civil the local hour is for everyone (08:00–20:00 scores best),
then by how early in the week they fall.

The anchor week follows the circle's chosen start date, so offsets are read at
the time of year the circle actually begins. Changing that date re-reads every
offset and remaps the chosen slot, holding the wall-clock time rather than the
UTC index.

The `.ics` pins the series to the organiser's timezone with `DTSTART;TZID=` and
a generated `VTIMEZONE`, so a meeting set for 14:00 stays at 14:00 when the
clocks change — rather than sliding an hour, which is what a UTC `DTSTART`
would do.

## Layout

```
index.html              markup for every section
assets/css/styles.css   all styling
assets/js/time.js       timezone maths, week slots, bitsets
assets/js/group.js      group state, share links, overlap ranking
assets/js/invite.js     .ics generation, RRULEs, Google Calendar links
assets/js/app.js        UI wiring
```

The three logic modules have no DOM dependencies and attach to `window`, so
they can be exercised directly in Node with a small shim.
