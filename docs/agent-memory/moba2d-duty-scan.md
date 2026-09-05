---
name: moba2d-duty-scan
description: "npm run duty:scan (2026-09-05) — how much of the time an ability's own power state is up; the three ways a naive duration/cooldown ratio lies"
metadata: 
  node_type: memory
  type: project
  originSessionId: 39240f27-05a9-4656-82f9-d50bb98cf249
  modified: 2026-09-05T06:14:41.240Z
---

`npm run duty:scan` (core, `scripts/duty-scan.mjs`, bin `moba2d-duty-scan`)
ranks every ability that puts a timed state on **its own caster** by
duration/cooldown. Committed 2026-09-05 on `fight-perf-and-hud-stability`.

**Why it exists.** Capping twenty-four cooldowns to the practice room's 20s pace
(see [[moba2d-perf-scan]]) raised every one of those abilities' uptime
mechanically — a duty cycle is both numbers and only one moved. Reading the
files by hand found two inflated abilities; this found **four**, which is the
whole argument for it.

**It reports and exits 0**, the same call `perf-scan` makes: 60% is generous for
an ultimate and miserly for a stance, and several of the highest rows are not
power states at all but *windows* (how long you have to spend an empowered
attack), where being generous is the point. `--max N` holds a line, `--floor`
sets what prints.

## The three ways a naive duration/cooldown ratio lies

All three were found by reading the rows it ranked highest — the first version's
top five were **all** wrong. Each is a test in `tests/scripts/dutyScan.test.ts`:

- **The cooldown that counts is the one bound to `coolDown`**, not whichever
  constant has COOLDOWN in its name. Axe E's is a 700ms *internal proc* timer,
  Xin Zhao Q's is a cooldown *refund*. By name they read 857% and 625% up; they
  are 43% and 71%.
- **`cooldown: { startAt: 'end' }`** means the clock starts when the effect
  ends, so the cycle is duration **+** cooldown. Sasuke R and Naruto R read 180%
  and 150% — impossible — and are 64% and 60%. (`CooldownStartPoint` is
  `'start' | 'release' | 'end'`; `Spell.ts` defaults to `'start'`.)
- **A duration on a debuff is not the caster's uptime.** Teemo E's 4s poison on
  a 4s cooldown is an ability that is always *available*. Only durations passed
  as `new X(DURATION, source, this.owner)` count, plus `maxDurationMs` for a
  toggle that states its own length.

## What the pass actually changed

Only dota, and only four. Each restores the duty cycle the ability was **drawn
with**, rounded to a whole second — undoing a side effect, not inventing a
ceiling:

    Slark E             70% -> 87.5%   14s -> 11s
    Earthshaker E       68% -> 83%     15s -> 12s
    Vengeful Spirit E   55% -> 75%     12s ->  9s
    Sniper E            60% -> 71%     12s -> 10s

Descriptions interpolate the constants, so the cards followed; tests import them
too. Left alone deliberately: Crystal Maiden E (40→53%), and every item
(BKB 32%, Blade Mail 38%, Ghostblade 42%).

**Still open, and the user has not been asked to decide it:** median uptime
across the packs is 40%, but **18 abilities sit at or above 75%** and they are
all lol's own pre-existing design — Vayne R is 10s on a 10s cooldown (100%, it
never actually lapses), Singed R 90%, and a cluster of eight at exactly 8s/10s.
Nothing here touched them.

**Why:** the number nobody was looking at is the one that decides whether an
ability is an ability or a stat with a keypress.

**How to apply:** it is a *reporting* tool by design — do not turn it into a
seam without deciding what a legitimate window looks like first. The bin count
tripwire in `tests/content/publicSurface.test.ts` had to be bumped to fourteen.
See [[moba2d-sandbox-not-win-condition]] for why the pace rule exists at all.
