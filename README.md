# League of Legends - 2D (Fan-made)

[![Build](https://github.com/HoangTran0410/LOL2D/actions/workflows/build.yml/badge.svg)](https://github.com/HoangTran0410/LOL2D/actions/workflows/build.yml)

Play League-of-Legends-style champions right in the browser — 2D team fights, bot opponents, and an installable PWA you can play offline. This repository is the engine: it ships one champion of its own out of the box, and every larger roster — including a 58-champion Riot-derived one — comes from installing a separate content pack. See "Content packs" below.

**[▶ Play Now](https://hoangtran0410.github.io/LOL2D)**

![Screenshot](/assets/images/screenshots/Screenshot_1.jpg)

![Screenshot](/assets/images/screenshots/Screenshot_4.jpg)

![Screenshot](/assets/images/screenshots/Screenshot_3.jpg)

## Contents

- [League of Legends - 2D (Fan-made)](#league-of-legends---2d-fan-made)
  - [Contents](#contents)
  - [Introduction](#introduction)
  - [Controls](#controls)
  - [Getting started](#getting-started)
  - [npm scripts](#npm-scripts)
  - [Project layout](#project-layout)
  - [Architecture](#architecture)
  - [Content packs](#content-packs)
  - [Assets](#assets)
  - [Testing](#testing)
  - [Contributing](#contributing)
  - [Disclaimer](#disclaimer)

## Introduction

A fan-made, indie game based on [League of Legends](https://www.leagueoflegends.com/) by [Riot Games](https://www.riotgames.com/en). It runs entirely in the browser: [p5.js](https://p5js.org/) draws the canvas, [Vue 3](https://vuejs.org/) drives the HUD, all in TypeScript and bundled with [Vite](https://vitejs.dev/).

What core is:

- **A spell runtime** — skillshots, charged casts, channels, recasts, shields, heals, and a full spread of crowd control, all driven by a typed `castSpec` lifecycle rather than hand-rolled state.
- **A kit builder**: mix and match abilities from an installed roster into a custom loadout, save it, and drop it onto yourself or any bot.
- **Blue-vs-Red team fights** with bots, neutral jungle camps, allied fountains and turrets, and three lanes of minion waves.
- **Fog of war** built from a visibility-polygon sweep, with bushes and walls that really do block line of sight.
- **Touch controls** and a mobile-friendly HUD alongside mouse/keyboard.
- **Installable as a PWA** — works offline once cached.
- **A content-pack SDK**: champions, spells, maps and monsters are npm packages built against a public `ContentApi`, not code forked into this repository.

## Controls

| Action | Key |
| --- | --- |
| Move / attack target | Right click ground / enemy |
| Abilities | `A` `Q` `W` `E` `R` |
| Summoner spells | `D` `F` |
| Toggle camera follow | `Space` |
| Zoom | Mouse wheel |
| Nav debug overlay | `N` |
| Practice panel (pause + live settings) | `Esc` |

Charged abilities are held down and fire on release. `Esc` pauses and opens the practice panel rather than leaving the match — exit from the panel's *Trận đấu* tab.

## Getting started

Requires [Node.js](https://nodejs.org/) 20 or newer.

```bash
git clone https://github.com/HoangTran0410/LOL2D.git
cd LOL2D
npm install
npm run dev
```

Open the URL Vite prints (http://localhost:5173 by default).

> `npm run dev` runs `assets:generate` first, so the asset manifest always matches what is on disk in `assets/` without you having to think about it.

Production build:

```bash
npm run build     # emits dist/
npm run preview   # serve the built output
```

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload (copies vendor libs + regenerates assets and the spell catalogue first) |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built output |
| `npm test` | Run the unit suite once |
| `npm run test:watch` | Run the unit suite in watch mode |
| `npm run typecheck` | Type-check the whole project |
| `npm run typecheck:core` | Strict type-check of the core modules |
| `npm run verify` | **Everything CI runs** — installed-packs/asset/catalogue checks, both type-checks, tests, build, the per-champion chunk check, and the source-scan seams. Run before opening a PR |
| `npm run verify:all` | `verify`, plus the reference pack's own `check-seams` |
| `npm run assets:generate` | Regenerate the asset manifest from `assets/` |
| `npm run assets:check` | Fail if the asset manifest is out of date |
| `npm run catalog:generate` / `catalog:check` | Regenerate / verify the generated spell catalogue |
| `npm run vendor:copy` | Copy p5 from `node_modules` into `public/vendor/` (PWA needs it local, not a CDN) |
| `npm run pack:new` | Scaffold a new content pack — see `docs/PACK_AUTHORING.md` |
| `npm run chunks:check` | Fail if a per-champion spell chunk exists, or if menu/pregame code leaked into the match chunk |
| `npm run check-seams` | Run the source-scan seam rules (`pack-core-boundary`, `dash-onupdate`, and the rest) over core's own spell/buff/attackable-unit trees |
| `npm run e2e:core-alone` | Drive a real browser to a real, playable match with no optional content pack installed |
| `npm run e2e:pwa` | Build, then verify the PWA boots offline in a real browser |
| `npm run e2e:pack` / `e2e:map-picker` / `e2e:bots` | Narrower Playwright scripts — see `tests/e2e/` for the full list |
| `npm run verify:pack-standalone <path>` | The pack-repository acceptance drill: pack core, install it from that tarball into a fresh sandbox alongside a scaffolded pack, and prove both green |

## Project layout

```
src/
├── main.ts               # entry point: boots p5 (global mode) and the SceneManager
├── scenes/                   # LoadingScene → MenuScene → GameScene
│   └── setup/                 # pregame setup screen (roster, kit builder, rules)
├── game/
│   ├── Game.ts               # main loop, owns camera/objectManager/terrainMap/fogOfWar
│   ├── MatchDirector.ts       # every mutation of a running match, and the only thing that persists them
│   ├── preset.ts              # champion kits, jungle camps, turret and fountain spots
│   ├── gameObject/
│   │   ├── attackableUnits/    # Champion, AIChampion, Minion, Monster, Turret
│   │   ├── coreSpells/         # engine-owned spells only — champion abilities live in a content pack
│   │   ├── spellObjects/       # base classes: Missile, Area, Beam, HomingMissile
│   │   ├── buffs/              # Stun, Slow, Shield, Invisible, ...
│   │   ├── structures/         # Turret, Fountain
│   │   └── map/                # TerrainMap, FogOfWar, Camera, Obstacle, Minimap
│   ├── combat/                # Vision, MatchTally, ExecuteTargeting
│   ├── nav/                   # NavGrid pathfinding
│   ├── managers/               # ObjectManager (quadtree), MinionSpawner, EventManager
│   ├── input/                  # keyboard/mouse + TouchControls
│   ├── spell/runtime/          # the spell lifecycle state machine
│   ├── config/                 # PregameConfig, savedKits (localStorage)
│   ├── enums/                   # TeamId, ActionState, StatusFlags, SpellState, EventType
│   ├── vfx/, debug/             # shared VFX helpers, nav/debug overlays
│   └── hud/                     # Vue-based HUD, incl. hud/practice/ (the Esc panel)
├── managers/                  # AssetManager, SceneManager
├── pwa/                       # service worker registration/update flow
└── generated/                 # script-generated asset manifest — do not hand-edit
```

## Architecture

**Spell lifecycle.** Every spell declares a `castSpec` describing how it is cast — press, hold-and-release, channel, or recast — and `SpellRuntime` runs the `READY → CASTING/CHARGING → ACTIVE → COOLDOWN` state machine, including resource commit, refund on interrupt, and interrupt sources (death, stun, silence, displacement). Spells only implement the `onCastStart` / `onRelease` / `onSpellCast` hooks.

**Spell objects.** Projectiles extend `MissileSpellObject`, area effects extend `AreaSpellObject`, lines use `BeamSpellObject` — note that the beam is hit detection only and **does not draw itself**, so subclass it and write a `draw()`.

**Collision and queries.** `ObjectManager` maintains a quadtree rebuilt each frame; all target selection goes through `queryObjects({ area, filters })` with the ready-made predicates in `PredefinedFilters`.

**Crowd control.** Buffs raise and clear bits in `StatusFlags`, which the system resolves into `ActionState` (can move / can cast / targetable).

**Teams and lanes.** A running match assigns the player to Blue and balances bots across Blue/Red; champions share their side's fountain, turret row, and lane minions. Neutral/standalone objects keep the unique `teamId` fallback. `MinionSpawner` runs mirrored waves down the three paths in `lanes.ts`, including melee, caster, and cannon minions.

**The practice panel** (`Esc`) is a superset of the pregame setup screen: three tabs (*Đấu thủ*, *Trận đấu*, *Gian lận*) that reshape a paused, live match through `MatchDirector` rather than touching `localStorage` directly.

**PWA.** The build copies p5 into `public/vendor/` and loads it locally instead of from a CDN, and a service worker precaches the app shell, so the game can boot fully offline after the first visit.

The full details live in [`docs/ADDING_SPELLS.md`](./docs/ADDING_SPELLS.md) — **read it before writing a new spell.** It covers the three registration points, the mandatory buff `stackId` rule, and the engine traps `tsc` cannot catch. Writing a spell, a champion or a map for a content pack of your own starts one level up, at [`docs/PACK_AUTHORING.md`](./docs/PACK_AUTHORING.md).

## Content packs

Core ships one champion of its own (`packs/reference/`) and reaches every
other champion, spell, map or monster only through a content pack — an
ordinary npm package that depends on `@moba2d/core` and never imports its
internals as a value, only through the published `ContentApi`. A 58-champion
Riot-derived pack used to live inside this repository at `packs/riot/` and
now lives in its own; installing it (or any other pack) as a real dependency
is what turns core from one champion into a full roster. `docs/PACK_AUTHORING.md`
is the whole guide to writing one, starting from `npx moba2d-pack-new`.

## Assets

Images and JSON live under `assets/`. `npm run assets:generate` walks that tree and emits `src/generated/assetManifest.ts` with a typed `AssetKey` union, so a typo in an asset name is a compile error rather than a broken image at runtime. To add art, drop the file in the right folder and re-run that script. A content pack has the identical pair of scripts, scoped to its own art and its own generated manifest.

`tools/` also holds [shape-maker](./tools/shape-maker/), a standalone p5 app for drawing a map's polygon data.

## Testing

**Unit tests** run under Vitest with no browser: every p5 drawing global is stubbed with a spy, so a test can prove which primitives a spell asks for and how its logic behaves.

```bash
npm test
npx vitest run tests/game/spells/MySpell.test.ts   # a single file
```

House rule: **tuning values are exported as constants from the spell file and imported by its test.** Tests assert the wiring, not a copy of the numbers — retuning damage should never mean editing a test.

**End-to-end** tests drive real Chrome through Playwright, because a unit test cannot prove the game boots and paints. `tests/e2e/` has 25+ scripts covering the practice panel, touch controls, minimap, kit builder, PWA offline boot, and more — run the one that touches what you changed rather than the whole folder:

```bash
npx vite --port 5199 --strictPort   # in another terminal
npm run e2e                         # or e.g. node tests/e2e/drive-practice-panel.mjs
```

Scripts reach into the running game through `window.__lol2d`, which only exists in dev builds. `drive-new-spells.mjs` and `drive-touch-controls.mjs` have known rare flakes unrelated to code correctness when a content pack is installed — a stray dev server already holding port 5173 makes both more likely — but neither runs at all with no pack installed, since both drive real spells by path.

## Contributing

Contributions are welcome. What you need to know:

1. **Fork and branch** off `main`.
2. **Run `npm run verify` before opening a PR.** It runs exactly what CI runs: installed-packs/asset/catalogue checks, both type-check passes, the full test suite, the build, the per-champion chunk check, and the source-scan seams. That is the repository's complete offline check.
3. **Adding a spell?** Read [`docs/ADDING_SPELLS.md`](./docs/ADDING_SPELLS.md) first — or [`docs/PACK_AUTHORING.md`](./docs/PACK_AUTHORING.md) if the spell belongs to a content pack rather than to `packs/reference/`. There are three registration points, and missing one means the spell never shows up.
4. **Bring tests.** Each spell should have a file in `tests/game/spells/`. Export the tuning constants from the spell and import them in the test rather than copying numbers.
5. **Look at it.** If your change is visual, open the real game — or write a script in `tests/e2e/`. A test asserting `draw()` was called proves nothing about how it looks.
6. **Formatting** follows Prettier (`.prettierrc`: 2 spaces, single quotes, trailing commas, 100 columns).
7. **Comments explain *why*, not *what*.** Prefer recording the reason an approach was chosen, or the trap that forced the code into its current shape.

## Disclaimer

This is a non-commercial, fan-made project, **not affiliated with or endorsed by [Riot Games](https://www.riotgames.com/en)**. The game is free and generates no revenue; it exists for entertainment only.

[League of Legends](https://www.leagueoflegends.com/) and all related trademarks, characters, artwork, and other assets are the property of [Riot Games](https://www.riotgames.com/en). This project claims no ownership over that intellectual property.
