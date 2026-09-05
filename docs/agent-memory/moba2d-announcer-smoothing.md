---
name: moba2d-announcer-smoothing
description: "Kill-feed/banner stacking + jitter fix (2026-09-05) — banner priority + min hold, reserved feed height, pinned leaving rows; uncommitted on core main"
metadata: 
  node_type: memory
  type: project
  originSessionId: 39240f27-05a9-4656-82f9-d50bb98cf249
  modified: 2026-09-04T20:15:36.908Z
---

Landed 2026-09-05, **uncommitted** on `moba2d-core` `main`. User reported the
announcer stacking on itself and juddering in a 1v10 bot fight, and asked
whether rendering it in p5 would be smoother. It would not — p5 runs the game's
own draw chain (`RenderGuard`), so the HUD would inherit every frame hitch it
has and lose GPU-composited CSS. Every symptom was layout/selection logic, not
raster cost. Do not revisit the p5 idea.

Five causes, all only reachable when kills land faster than a row lives:

1. `<transition>` on the banner was keyed on the announcement → enter and leave
   run together, both `position: absolute` at the same spot → two lots of 40px
   gradient type superimposed. Fixed by dropping the key (one element rewrites
   itself) + `mode="out-in"` + alternating `pop-0`/`pop-1` classes with twin
   keyframes, because CSS will not replay an animation whose name is already on
   the element.
2. `.kill-banner{top:calc(100% + 12px)}` measures `.kill-callouts`, whose height
   is the feed's → every row entering/ageing moved the banner ~39px with no
   transition. A percentage `top` does not transition when the *parent* resizes,
   so the fix is a reserved `min-height` on `.kill-feed` (`--feed-row-h` /
   `--feed-gap`, with `.kill-feed-row` pinned to `--feed-row-h`). Visible
   consequence: the banner now sits at a constant spot even when the feed is
   short — same trade `--recap-bottom` already makes.
3. `buildFeed` sliced the newest `FEED_ROWS` groups by *opening* seq, so a run
   still growing was evicted for three fresh single kills and re-entered with
   the drop animation when one aged out. Now chosen on `latestAtMs`, still
   *drawn* in opening order (choosing on recency and drawing on recency are
   different things — the second reorders the stack every kill).
4. `nth-child(n+4)` / touch `nth-child(n+3)` counted rows on their way out, so a
   ghost at the head blanked a live row. Cap moved into `KillFeed.vue`
   (`:touch` prop, like `Scoreboard`); both CSS rules deleted.
5. Inline `style="opacity"` outranks every class in `hud.css`, so
   `.kill-feed-leave-to{opacity:0}` was dead and evicted rows left *opaque*
   ghosts. Fade now arrives as `--row-fade`. Separately, an out-of-flow child of
   a centred flex column takes its static position at the column's **top**, so
   ghosts teleported onto the newest callout — Vue 3's TransitionGroup pins
   moved rows but not leaving ones, hence `pinLeaving`/`unpin` hooks.

`MatchAnnouncer.banner()` is no longer "newest that deserves one": it is the
loudest within TTL (`bannerPriority`, bands with gaps so a tier grows inside its
band), and an equal only takes over after `BANNER_MIN_HOLD_MS` (700) — measured
*between the two kills*, not against `nowMs`, so it stays deterministic across
the 20Hz HUD ticks. See [[moba2d-hud-stacking]], [[moba2d-death-recap]].

**Why:** the whole diagnosis is reconstructible only from a running burst; the
code comments carry the reasoning but not that p5 was already ruled out.

**How to apply:** when the announcer misbehaves again, look at selection and
layout before rendering. Verify with the note in [[moba2d-workspace-layout]] —
`npm run verify` cannot complete while packs are linked (stops at `links:check`)
and `| tail` masks the exit code; run `test:all`/`build`/`check-seams`
separately and expect the 7 known failures plus the chunk regression.
