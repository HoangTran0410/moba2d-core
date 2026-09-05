---
name: moba2d-recap-bar-stability
description: "Death recap bottom bar stops moving (2026-09-05) — live strip on its own line above the buttons, one width in every state; uncommitted on core main"
metadata: 
  node_type: memory
  type: project
  originSessionId: 39240f27-05a9-4656-82f9-d50bb98cf249
  modified: 2026-09-04T20:29:49.146Z
---

Landed 2026-09-05, **uncommitted** on `moba2d-core` `main`, same session as
[[moba2d-announcer-smoothing]]. User: the bottom pill drew title + countdown +
spectate on one row so content got pushed out, then the countdown and camera
button vanished at respawn, content slid back, and they mis-tapped.

**The invariant that makes it work:** `.death-recap` is `position: fixed` with
`bottom: var(--recap-bottom)` and no `top`, so it grows *upward* — whatever sits
on the **last line keeps its distance from the bottom edge** no matter what
appears or disappears above it. That holds while collapsed *and* while open (the
arithmetic cancels: the panel's top drops by exactly what the removed line cost).
So volatile content goes above, things a thumb aims at go below. Three changes:

- `.death-recap-live` (countdown + spectate) is its own line above
  `.death-recap-head`, and the spectate pill takes `margin-left: auto` — the
  countdown changes width (`10s` is not `9s`; tabular figures don't fix a digit
  *count*) and must not push a button.
- Both buttons live in `.death-recap-actions`, one flex item, so they are always
  the row's last item. Loose they were 3rd and 4th of 4 under
  `justify-content: space-between`, and the chevron moved 63px left at respawn —
  measured, that is the mis-tap.
- `.death-recap.collapsed` no longer sets `width: auto` (**both** rules — there
  are two, ~2465 and ~3450 in `hud.css`). It reversed a deliberate earlier
  decision: the panel is centred, so shrinking re-centres it.

`.death-recap-title` now takes `flex: 1 1 auto; min-width: 0` + ellipsis, so a
long killer name gives way instead of shoving the buttons off a phone.

Guards added: `drive-kill-feed.mjs` measures panel + both button rects across a
real respawn (fails on the old markup, 536→473); `hudStacking.test.ts` scans
*every* `.death-recap.collapsed` rule for `width: auto`.

**Why:** the "grows upward, so the last line never moves" property is the whole
reason the layout is ordered the way it is, and nothing in the DOM order says so.

**How to apply:** anything new on this bar that comes and goes belongs above the
headline, never on it. `.death-recap-close` is the class for *both* buttons —
`querySelector('.death-recap-close i')` in the e2e driver is the chevron.
