# Procedural leg rig — creatures that walk

Status: implemented 2026-08-31. Phase 2 (`api.rig` for a pack's own code) is
deliberately a later PR with its own contract bump.

Three things in §5 changed **during** implementation, because a test found them
— they are written here as they shipped, with the reason beside each.

Every unit in this game is one circular avatar image. A jungle camp crossing
its clearing is that circle, sliding. This spec gives a camp **legs that
plant on the ground and step** — inverse kinematics for the joints, a
step-trigger for when a foot picks itself up — and a body that can be drawn
from code instead of from a sprite, so a pack can ship a creature that never
had art.

## 1. The compatibility rule

**`rig` absent means nothing changes.** No camp grows legs from a derived
default, unlike `attackStyle` which core infers from `attackRange`. Growing
legs is a visual change nobody asked for; inferring one would rewrite the
look of every pack at once. Opt-in, always.

## 2. Architecture

```
src/game/render/creature/
  legIk.ts         solveTwoBone() — law of cosines, no p5, no game state
  legRig.ts        step trigger + gait + facing. Emits geometry, draws nothing
  creatureSpec.ts  CreatureRigSpec type + resolveRig(spec, bodyRadius)
  drawCreature.ts  every p5 call lives here, and only here
```

The split is not tidiness. `legRig.ts` has to run in three places: the game
(p5), the map editor (Canvas2D), and vitest (node, no canvas at all). A
module that draws cannot run in the third, and a module that knows about p5
cannot run in the second. So **the rig emits joint positions and the caller
strokes them** — two renderers, one implementation of the hard part.

Approaches rejected: the rig as its own `SpellObject` (a lifetime to keep
in sync with a body that respawns, bought nothing — legs *should* die with
the body); a `ProceduralMonster` subclass (a pack cannot value-import a core
class, `pack-core-boundary`, so no pack could ever select it).

## 3. What a pack writes

```ts
// a spider: keeps its avatar, grows six legs
rig: { legs: { count: 6, reach: 1.6, bend: 'up' } }

// a mystical entity: no sprite at all, and it floats
rig: { body: { kind: 'orb', color: [140, 90, 255], glow: 0.6 } }
```

```ts
export interface CreatureRigSpec {
  /** Default 'avatar' — today's circular sprite, drawn over the legs. */
  // `color` is optional with a default, exactly as `attackColor` is: the
  // editor's body control would otherwise have to write two fields in one edit
  // to leave valid data behind.
  body?: 'avatar' | { kind: 'orb'; color?: [number, number, number]; glow?: number };
  legs?: {
    /** Even, 2..12. Mounted in symmetric pairs. */
    count: number;
    /** Foot plant distance as a MULTIPLE OF BODY RADIUS. Default 1.6. */
    reach?: number;
    /** Step when the foot is this many `reach` from where it belongs. Default 0.35. */
    step?: number;
    /** Knee solution: 'up' bends away from the body (spider), 'down' toward it. */
    bend?: 'up' | 'down';
    thickness?: number;
    color?: [number, number, number];
    /** Radians the legs span around the body. Default covers both flanks. */
    spread?: number;
  };
}
```

Four decisions inside that shape:

- **`reach` is a ratio, not pixels.** Camps in this game differ by an order
  of magnitude in `size` (a scuttle crab against Baron). A ratio means one
  spec reads correctly at any size, and a map that scales a camp does not
  break its legs.
- **`legs` and `body` are independent.** "Procedural body, no legs" (a
  drifting entity) and "sprite with legs" (a spider wearing its portrait)
  are both sentences the shape can say, with no extra flag.
- **`body` is a tagged union.** A second kind added later is a new branch,
  not a breaking change.
- **`count` is even.** The gait splits legs into two alternating groups; an
  odd count leaves one leg with no opposite and the body limps.

## 4. Where it plugs in

No new subpath export, no `ContentApi` surface, **no contract bump**.

| File | Change |
|---|---|
| `src/content/ContentPack.ts` | `rig?` on the monster entry, and on `MonsterSlotStats` |
| `src/content/validate.ts` | checker — a bad rig is a pack that fails to install, not a camp that crashes a frame |
| `src/game/preset.ts` | carry it into `MonsterPresetData` |
| `src/game/config/mapTuning.ts` | `rig: own.rig ?? base.rig` in `resolveMonsterPreset` |
| `Monster.ts` | build the rig when the preset declares one; drive it from `draw()`; widen `getDisplayBoundingBox()` |
| `src/mapEditor/ui.ts` | inspector fields + the live preview |

**`rig` IS overridable per map slot.** `roam` is not, because a roam region
can contradict where the map actually put the water; a leg count cannot
contradict geometry. It is cosmetic, so a map may state it.

## 5. The algorithm

Each leg holds a `hip` (a fixed angle around the body), a `foot` in world
space, and a step in progress or not.

- **Two positions, not one.** `rest` is where a foot belongs with the body
  standing where it is, and it is what the trigger measures against. `landing`
  is where a foot that steps *now* touches down: rest, plus the **lead**.
  Folding the lead into the trigger's own target makes every foot chase its own
  threshold.
- **The lead is a distance, not a duration.** A foot lands `step × reach × lead`
  ahead along the direction of travel — one trigger-width by default. A lead in
  milliseconds is multiplied by speed, so it overshoots at a run exactly as
  badly as no lead undershoots; a lead in trigger-widths bounds `|foot − rest|`
  by the trigger at **every** speed, which is what lets the leg geometry be a
  fixed multiple of `reach`.
- **A step fires** when `|foot − target| > step × reach` *and* no leg in the
  same group is mid-step. Legs alternate in two groups, so the body always
  has half its feet on the ground.
- **During a step the foot arcs outward, away from the body** — not "up".
  This is top-down; there is no Z. An outward arc reads as a leg swinging
  over, a Z-lift reads as nothing at all.
- **Two-bone IK by the law of cosines**, picking one of the two knee
  solutions from `bend`. A target beyond `upper + lower` **extends straight
  toward it** — not a detail: `Math.acos` of anything over 1 is `NaN`, and a
  `NaN` joint erases the whole leg from the frame.
- **A foot may never be further from its hip than the leg is long.** Past that
  the solver extends straight and the drawn leg stops short of its own foot,
  which reads as a foot floating along beside the body — the one failure here
  that looks like a different bug entirely. Gait and lead keep a walking
  creature well inside the limit; `clampToReach` makes it a property of the
  module rather than of the tuning, so a camp hauled by a knock-back cannot
  break the picture. Bone length is `1.1 × reach` each, chosen off a measured
  table of worst-case excursion against body speed — see the comment on `BONE`.
- **Snap on lost track.** If `dt > 200ms` (the body was culled, or the tab
  was hidden) or the body moved further than `RENDER_SNAP_PX` in one frame,
  every foot is placed at its target with no step. Without this a camp that
  leaves the screen and comes back takes all six steps at once.
- **Facing comes from smoothed velocity, never from `targetLock`.** The rig
  must not read gameplay state: it also runs in the editor, where there is
  no `Game` at all.

The rig advances in `draw()`, off `this.position` — which `ObjectManager.draw`
has already swapped for the interpolated one. That is why **nothing crosses
the wire**: a LAN client's camps are snapshot positions, and legs computed
from a drawn position are correct on both ends with no sync.

## 5b. The colour, which shipped wrong

The first default was `[26, 30, 40]`, picked as "dark enough to read as a
silhouette". The floor is `background(30)`. That is a luminance difference of
**0.1 out of 255**: the legs were not faint, they were absent, and every test
passed — the rig walked correctly in a colour nobody could see.

The map is dark everywhere a camp can stand (floor 30 luma, water 34, bush 77,
walls 119), so anything drawn on it must be **lighter** than it. The default is
bone now, `src/game/render/palette.ts` names `MAP_BACKGROUND_GREY` so
`Game.draw` and the test share one number, and the editor's preview canvas uses
that same floor colour — a preview on a different background is how a leg gets
declared visible in one place and vanishes in the other.

## 5c. Numbers are clamped; words are refused

Reported: typing an odd leg count, or too many, stopped the game. The chain was
`validate` refusing the slot -> `localMaps.keepValid` dropping the whole map with
a `console.warn` -> the map leaving the picker -> `takePlaytestMapId` finding
nothing and dropping to the menu. A cosmetic field deleted somebody's map.

`resolveRig` already clamped every one of those numbers, so refusing was a
second and far harsher answer to a question already answered. The line now:

- **a number out of range has one obvious repair**, so `resolveRig` takes it —
  odd counts down to a pair, counts past 12 to 12, a nonsense `reach`/`step`/
  `spread`/`thickness` back to its default or bound;
- **a word or a shape core does not know has no repair**, so `bend: 'sideways'`,
  `body.kind: 'blob'` and a malformed colour are still refused.

The validator therefore checks *types* on the numbers and *vocabulary* on the
rest. The editor also constrains the count input, but that is a convenience —
the guarantee is that no number typed anywhere can cost a map.

## 5d. The chunk the editor pays for

The editor importing core is the point of §7, and it has a price the build
enforces. Two shapes went wrong on the way in:

1. `content/validate.ts` importing the leg-count bounds gave `pregame` a static
   edge to `game`. (Moot now — §5c removed that import — but it is why
   `creatureSpec` was pinned in the first place.)
2. Worse and quieter: `editor-*.js` gained static edges to **both** `game-*.js`
   and `pregame-*.js`, so opening the map editor downloaded the whole match
   engine. Baseline was `shared-*.js` alone, 153KB.

Nothing caught (2), because `scripts/check-chunks.mjs` had no rule for the
editor chunk. It has one now. `legIk`, `legRig`, `creatureSpec`, `Interpolation`
and `palette` are pinned to `shared` — the chunk that exists for exactly this,
small pure modules read from both sides of a boundary. `drawCreature.ts` is
deliberately not among them: it is the p5 half, reached only from `game`.

## 6. Testing

Node env, no canvas — which is the whole reason for the split in §2.

- `legIk`: the knee sits exactly `upper` from the hip and `lower` from the
  foot; an out-of-reach target extends straight and returns **no `NaN`**;
  `bend: 'up'` and `'down'` land on opposite sides of the hip–foot line.
- `legRig`: a body standing still for ten seconds takes **zero** steps (no
  twitching in place); two legs of one group are never mid-step together; a
  large `dt` snaps rather than steps; a completed step leaves the foot on
  its target.
- `creatureSpec`: `rig` absent → no rig built; defaults resolve as documented;
  and the default leg colour clears the map floor by 90 luma — see §5b.
- `validate`: `bend: 'sideways'` and a two-entry colour fail **naming the
  field**; `count: 7`, `count: 40` and `reach: -1` **install** — see §5c.
- **Seam scan**: `legRig.ts` and `legIk.ts` import neither p5 nor anything
  under `src/game/gameObject/`. This is what keeps them usable from the
  editor, and it is the kind of rule a source scan closes permanently.
- `editorCatalog`: a slot carrying `stats.rig` survives export to `Geometry.ts`.

## 7. The map editor

The editor is TypeScript under `src/mapEditor/`, a Vite entry, and it
**already imports core** (`ui.ts` takes `TUNING_SCHEMA` from
`@/game/config/tuningSchema`). So it imports `legRig.ts` directly: one
implementation, two renderers.

- **The whole panel folds now, not just the rig.** The draw pane was a flat
  column — object, layers, map (which also held factions *and* the background
  picker), grid, check — and the rig added seven more fields and a preview to
  it. Every `.sec-title[data-sec]` is now paired with a `.sec-body` and folds;
  `wireSections` does it generically at build time without moving a node, so
  the several dozen ids `buildInspector` holds stay valid. The `Map` block was
  split into **Map / Phe / Ảnh nền**, which were three unrelated things under
  one heading, and the object block's rotate/flip/scale went into **Biến hình
  & thứ tự**. The title/body pair is explicit markup rather than "everything
  until the next heading", because Nhân bản/Xoá sit *after* the transform
  section and must always show.

  **Everything starts closed, and the state survives a reload.** It lives in
  `E.openSections` and rides `savePrefs` with grid, snap and the panel's own
  open/closed — `loadPrefs()` runs before `buildInspector()`, so the panel is
  built already knowing. The list stores what is **open**, not what is closed:
  nothing stored then means everything closed, and a section added later is
  closed too without anyone editing a default. Sections are keyed by a stable
  id (`monster-rig`), never by the heading text, so renaming a label cannot
  wipe what somebody left open.

  One thing to know before touching a heading: `.sec-title` carries
  `justify-content: space-between`, which is right for `[label][count]` and
  puts the *label in the middle* the moment a chevron makes it three items.
  `wireSections` sets `flex-start` and pushes the tail span right with an auto
  margin instead.
- Inspector, `neutral` group **"Hình dáng con vật"**: `stats.rig.legs.count`,
  `.reach`, `.bend`, `.thickness`, `.color`, plus `stats.rig.body.kind` and
  `.color`. The group header carries no "change for all" button, unlike the
  stat group above it — there is no map-wide rig, and there should not be one.
  A `color` field kind was added to the inspector for the two swatches; it
  writes `[r, g, b]`, the shape `attackColor` established. `setDeep` writes
  arbitrary depth and `withStats` copies the whole `stats` object, so the
  export/import/emitter path needs no edit — the three-place drop fixed on
  2026-08-30 stays fixed.
- **Preview**: its own small canvas inside the inspector, the creature
  walking a circle, on its own `requestAnimationFrame` — started when the
  group opens, stopped when it closes or the selection changes.
  `render.ts` deliberately has no 60fps loop ("máy đứng yên = 0% CPU") and
  this must not give it one. The main canvas gains only a **static rest
  pose**, which its on-demand renderer draws once like everything else.

## 8. Workstream 0 — the editor's stale documentation

Three documents state, in so many words, that nothing in `src/` can import
the editor. That was true of the old `public/map-editor/js/*.js` and is
false of the TypeScript port, and it is false about **precisely the fact
§7 depends on** — so it is fixed first, not last.

- `docs/TRAPS.md:203` and `CLAUDE.md:444`: "plain HTML and globals with no
  bundler, so nothing in `src/` can import it and no type checker compares
  the two halves."
- `tests/content/localMaps.test.ts:26`: "plain browser JavaScript — no
  modules... runs the real editor code (in a `vm`)" — in a file that
  imports `@/mapEditor/state` on line 4.
- `docs/MAP_EDITOR.md:419-433`: "không build step — chỉ là các file `.js`",
  plus a table of eight `js/*.js` that no longer exist and three `.ts` files
  it never mentions.
- `map-editor/index.html:21` points at `js/geom.js`.
- Path-only mentions, one phrase each: `README.md:193`,
  `src/content/localMaps.ts:6`, `src/content/catalog.ts:34`,
  `src/scenes/playtest.ts:10`, `scripts/generate-maps.mjs:6`,
  `scripts/pack-maps.mjs:6`.

**`docs/superpowers/specs/2026-08-29-map-tuning-design.md` is left alone.**
A dated spec records what was true when it was written; editing one is
falsifying the record, not fixing a bug.

**Deleting the old editor: already done.** `public/map-editor/js/` is gone.
The nine files left are all live — `asset/` (tracing backgrounds and
`dummy.png`, loaded by `main.ts:32`), `css/style.css` (linked by the entry
HTML), and `lib/*.min.js` (classic script tags, kept out of the module graph
on purpose — see `vendor.d.ts` — and read directly by
`tests/content/editorVendor.ts`). Nothing further to remove.

## 9. Out of scope

Legs on champions, minions or pets. Legs that react to an attack wind-up or
a stun. Shadows. `api.rig` for a pack's own code — phase 2, its own PR, its
own `contract:bump`.
