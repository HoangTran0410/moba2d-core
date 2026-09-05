---
name: moba2d-hud-stacking
description: "The HUD vanished on death because #InGameHUD's z-index was inert; the dead-view canvas filter lifted the canvas over it (fixed 2026-09-02, core `7054cc5`, pushed)"
metadata:
  type: project
---

Reported 2026-09-02: "khi chết thì ko thấy bottom hud nữa" and "ko xem đc modal
chọn đội luôn". One cause, two symptoms.

**The trap.** `styles/hud.css` opens with `#InGameHUD { z-index: 100 }` and
**no `position`** — `z-index` is ignored on a static element, so that rule had
never done anything. The HUD floated over the world by accident: an
unpositioned, unfiltered `<canvas>` paints in the background layer, below every
`position: fixed` child of the HUD.

`#game-scene.dead-view canvas { filter: grayscale(...) }` breaks that. A filter
makes an element a stacking context, and a stacking context on a *non-positioned*
element paints with the `z-index: 0` group — the same group as the HUD's
`z-index: auto` children — and p5 appends the canvas **after** `#InGameHUD`
inside `#game-scene` (`createCanvas(...).parent('game-scene')`), so it won the
tie. Everything in the HUD without an explicit rank (the bottom bar, the
practice/team panel) was painted over the moment the player died. Everything
with one survived: spectate pill 105, kill feed 110, score strip 112, corner
cluster 120, shop 120 — which is why the bug looked selective.

**The fix** (2 lines in `styles/hud.css`, plus `tests/game/hud/hudStacking.test.ts`
as a source-scan guard, modelled on `tests/scenes/viewportFit.test.ts`):
`#InGameHUD { position: relative; z-index: 100 }`, and `.death-recap` from
`absolute` to `fixed` — `relative` on the root makes it the containing block
for absolute descendants and it is a **zero-height** box, so the recap's
`top: 12%` would have resolved against nothing. The recap also lost its
`z-index: 30`, which only ever bought it the right to cover the two modals.

**Facts worth not re-deriving.**

- `.center-page-container > div` in `styles/main.css` gives every scene root a
  `transform`, so `#game-scene` is the containing block for *every*
  `position: fixed` descendant AND is already a stacking context. That is why
  the whole HUD subtree could be pinned at 100 without any risk to
  `#pregame-scene`'s z-200/300 chrome — the two were never in the same context.
- `relative` and not `fixed` on the root: `fixed` would capture the fixed
  children too, which are all laid out against `#game-scene`.
- The only `position: absolute` descendant of `#InGameHUD` anchored to
  `#game-scene` is `.death-recap`. Verified in the browser, not by reading.

**How it was found, and the reusable part.** "In the DOM but invisible" is not
visible to any unit test and not to a DOM-presence e2e check either — the first
probe reported `.bottom-HUD` present, computed `display: flex`, `opacity: 1`,
`visibility: visible`, correct rect, and the panel opening on click with no
page errors. What identified it in one shot was
`document.elementFromPoint(centre of the element)`: `CANVAS.p5Canvas` while
dead, `IMG` while alive. Drive it with `tests/e2e/harness.mjs`
(`startHarness` + `startMatch`, then
`game.player.takeDamage(999999, undefined, 'TRUE')`); the harness boots its own
Vite server, so port 5173 being busy is fine.
