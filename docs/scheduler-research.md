# Meeting coordination tools: research, gap analysis, roadmap

Background research into how the established group-scheduling tools work, what
they have in common, where their users complain, and what of that is worth
building into the Kereitsu overlap scheduler.

## A note on sources

This environment's network policy blocked every direct page fetch —
`when2meet.com`, `rallly.co`, `doodle.com` and even the third-party comparison
write-ups all returned `EGRESS_BLOCKED`. What follows is assembled from search
result summaries, not from using the products first-hand. Claims corroborated
across several independent write-ups are marked **[strong]**; single-source
claims are marked **[weak]** and should be checked before anyone leans on them.

## The four tools

| | When2meet | Doodle polls | Rallly | SimplyMeet |
| --- | --- | --- | --- | --- |
| Model | Paint a grid | Vote on listed options | Vote on listed options | Booking pages |
| Account to respond | No **[strong]** | No | No **[strong]** | No |
| Timezone conversion | Per-viewer **[strong]** | Per-viewer | Per-viewer, or ignore entirely **[strong]** | Per-viewer |
| Third "maybe" state | No | Yes — *if-need-be* **[strong]** | Yes | — |
| Calendar read | No **[strong]** | Yes **[strong]** | No **[strong]** | Yes |
| Chase non-responders | No **[strong]** | Paid tier **[strong]** | Yes, email **[weak]** | Yes |
| Finalise → invite | No **[strong]** | Yes | Yes, emails an .ics **[weak]** | Yes |
| Cost | Free | Free tier is limited; ads **[strong]** | Free, open source, self-hostable **[strong]** | Freemium |

## What they all do

Five things show up in every one of them. They're the table stakes:

1. **A participant never makes an account.** One link, answer, done.
2. **Times are shown in the viewer's own timezone**, converted automatically.
3. **The group's answers collapse into one visual** — a heatmap or a tally row —
   where denser means more people.
4. **You can see who is behind any given slot**, by name.
5. **Choosing the time is the organiser's explicit act**, not an automatic pick.

Kereitsu already does all five.

## Where they split

**Grid vs. options.** When2meet asks for your whole week and computes the
intersection. Doodle and Rallly ask you to vote on a handful of times the
organiser proposed. The grid gathers far more information, which is why it
finds times a poll would never have offered — but it asks more of each
participant. Kereitsu is a grid tool, which is the right call for a standing
commitment, where the same slot has to survive for months.

**Specific dates vs. days of the week.** When2meet offers both **[strong]**.
Kereitsu only does days-of-the-week, which is correct for a recurring circle
but means there's no way to schedule a one-off around specific dates.

## What their users complain about

The complaints converge, and they're more useful than the feature lists:

- **When2meet stops at "found a time."** No notification when a time is
  confirmed, no reminder, no way to chase whoever hasn't answered. The
  organiser tracks all of it by hand. This is the single most repeated
  criticism **[strong]**.
- **No calendar read.** Everyone fills the grid from memory, so the answers are
  optimistic and wrong **[strong]**.
- **The interface is dated and desktop-shaped** **[strong]**.
- **Doodle paywalls the useful parts** — deadlines, reminders, hiding
  responses — and shows ads on the free tier **[strong]**.
- **Doodle's "maybe" is ambiguous.** The third state clutters the result and
  people read it differently from each other **[weak, but repeated]**. Worth
  taking seriously: a maybe is only useful if the display never makes you guess
  what it meant.

## Where Kereitsu already answers a complaint

| Complaint | Kereitsu |
| --- | --- |
| No follow-up after the time is found | Recurring `.ics`, Google link, emailed summary |
| No way to chase non-responders | "Chase the N still to answer" |
| Re-sending a changed time duplicates the event | Stable UID, `SEQUENCE` bump |
| Features behind a paywall | No server, so nothing to charge for |
| Desktop-shaped | Grid works at 390px |

## Where Kereitsu is behind

1. **No tentative state.** Availability is binary. Real people have hours they
   *could* do at a push, and forcing them into yes or no loses the information
   that would break a tie.
2. **You can't see who's behind a slot without hovering.** There's a `title`
   tooltip, which is invisible on touch and easy to miss on desktop.
3. **No calendar read.** Structurally out of reach — it needs OAuth and a
   server. Worth naming as a deliberate non-goal rather than a gap.
4. **Days-of-week only.** No one-off, specific-date mode.
5. **The anchor week is always "the upcoming Monday."** Fine day to day; wrong
   across a daylight-saving boundary.

## Roadmap

Ordered by value per unit of work, and by what a static site can honestly do.

### Phase 1 — tentative availability, and a readout that removes the ambiguity

Add a third state to the grid: *free*, *if need be*, *can't*. This is the one
feature the grid tools lack and the poll tools have, and it directly improves
ranking quality — a window four people can definitely make beats one where two
are stretching.

The known failure mode is Doodle's: a maybe that muddies the result. The
defence is to never aggregate the two states into one number. Every place a
count appears, the split appears with it — "4 free · 1 at a push" — and a
readout panel names exactly who is in each bucket for whatever slot you're
pointing at.

Ranking changes to sort on fully-free count first, and only then on
free-plus-tentative, so a stretch is a tie-breaker rather than a headline.

### Phase 2 — the week you're actually scheduling

Pin the anchor week to the chosen start date rather than always the upcoming
Monday, so a circle formed in February and starting in April converts against
April's offsets. Show each member's local time for the chosen slot on the
invite preview.

### Phase 3 — a one-off mode

Specific-date columns instead of weekday columns, for a circle's first meeting
or an off-cycle session. Reuses the whole slot engine; mostly a labelling and
anchoring change.

### Phase 4 — response deadlines and a nudge cadence

"Answers close Friday" on the circle, with the chase email wording adapting as
it approaches. Purely local, so it's a display and copy change rather than
infrastructure.

### Explicit non-goals

- **Calendar read/sync.** Needs OAuth and a server. The moment this site has a
  backend it stops being the thing it is.
- **Real-time updates between participants.** Same reason. The share-link round
  trip is the substitute, and it's honest about when it's stale.
- **Comment threads.** Rallly has them; a circle of five people already has a
  group chat.
