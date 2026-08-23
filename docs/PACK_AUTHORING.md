# Writing a content pack

A content pack is a plain npm package that depends on `@moba2d/core` and
exports a roster, a map, and the real spell classes that make the roster
playable. This repository ships two of them (`packs/reference/`, `1`
champion, and — if installed as a dependency — a Riot-derived one living in
its own repository), and nothing about either is special: this guide is
everything you need to write a third one, starting from an empty directory.

If you have not read anything else in this repository first: `npx
moba2d-pack-new my-pack` below is real, its output is copied from an actual
run, and every command after it is one you can type verbatim against the pack
it creates.

## Scaffold one

```sh
npx moba2d-pack-new my-pack --id my-pack --name "My Pack"
```

```
  My Pack (@moba2d/content-my-pack) scaffolded at .../my-pack — 11 file(s) written.

  Next:

    cd .../my-pack
    npm install
    npm test
```

This writes a complete, runnable pack: one champion (fixed at `Hero`), one
ability (`Hero_Q`), one map, a strict `tsconfig.json`, a Vitest config and
setup file, and a README that repeats the next steps. Nothing here is a
placeholder that fails to typecheck or fails its own test — `npm install &&
npm test` on the untouched scaffold passes, every time, which is what makes
it a starting point rather than a lecture.

Before `npm install` will resolve anything, point the scaffolded
`package.json`'s `"@moba2d/core": "*"` at a real install of core — a registry
version once one is published, or in the meantime a git dependency
(`"github:<owner>/<repo>#<branch>"`) or a `file:` path to a local checkout or
tarball. `npm install` after that, then:

```sh
npm test           # vitest run — 1 file, 3 tests, all green
npm run check-seams # moba2d-check-seams ./spells — clean
npm run typecheck   # tsc -p tsconfig.json — clean
```

Both `test` and `check-seams` are **this pack's own gate**, not core's —
`npm install` never runs them for you, and core's own `verify` never reaches
into a pack it does not own.

## Where things live

```
my-pack/
├── package.json       # name, @moba2d/core dependency, the three scripts above
├── tsconfig.json       # extends @moba2d/core's own strict base config
├── pack.ts             # the whole pack's declaration — see below
├── map.ts               # the cheap summary a pregame picker lists
├── geometry.ts            # the real walls/lanes, fetched only once a match starts
├── spells/
│   └── Hero_Q.ts          # one file per ability
├── tests/
│   └── Hero_Q.test.ts     # one test per ability, driven through press()
├── vitest.config.ts
└── vitest.setup.ts
```

`pack.ts` is split into a **data half** (`ContentPackData` — roster, map
list, spell display metadata: names, icons, cooldowns) and a **code half**
(`ContentPackCode` — real engine classes, built from `api`). The split exists
because the data half has to be readable without ever building a
`ContentApi`: a menu screen that only wants champion names and portraits
should never have to load the engine first. `@moba2d/core/content/ContentPack`
carries the full reasoning in its own header — read it once if you want the
"why", not just the "what".

```ts
export const data: ContentPackData = {
  manifest: { id: 'my-pack', version: '1.0.0', coreRange: '^1' },
  champions: [{ id: 'hero', name: 'Hero', playable: true, spells: ['Hero_Q'], /* ... */ }],
  spellDisplay: { Hero_Q: { name: 'Hero Q', coolDownMs: Q_COOLDOWN_MS, /* ... */ } },
  maps: [map],
};

const code = (api: ContentApi): ContentPackCode => ({
  spells: { Hero_Q: makeHero_Q(api) },
});

export default code;
```

Three comment markers inside the scaffolded `pack.ts` —
`// moba2d-pack-add spell: ... above this line`, one each for the import, the
champion's `spells: [...]` array, and the code half's factory map — are the
insertion points `moba2d-pack-add spell` writes into. They are plain,
greppable strings on purpose, not a parser hunting for "the end of this
object literal", which is the shape that breaks the day someone reformats a
spacing the generator did not predict.

## Add another ability

```sh
moba2d-pack-add spell Bolt --champion Hero --slot W
```

```
  Hero_W written into .
    spell    spells/Hero_W.ts
    test     tests/Hero_W.test.ts
    import   registered
    roster   registered
    code     registered
  Next:
    1. Write the player-visible script into the test names before touching
       the spell body — "press once and X happens" — then run it, watch it
       fail, and read the message.
    2. Fill in spells/Hero_W.ts, and add a spellDisplay entry for 'Hero_W'
       to pack.ts — this command does not write one.
    3. npm test && npm run check-seams
```

This is found by walking up from wherever you run it (never a hardcoded path
or a directory literally named `packs`), so it works the same from a pack's
own root, from a nested directory inside it, or inside a genuinely separate
pack repository. It writes `spells/<Champion>_<Slot>.ts` and its test from
the same template `moba2d-pack-new` renders its own sample ability from,
substituting the champion and slot you asked for — then wires the import, the
kit-slot roster entry, and the code-half factory into `pack.ts` for you. It
does **not** write a `spellDisplay` entry (name, icon, description); that has
no template because it is content, not mechanism, and the command tells you
so in its own "Next" output.

**Only `spell` is implemented.** `moba2d-pack-add champion`, `map` and
`monster` are named in the command's own usage line and every one of them
refuses to run, loudly, non-zero — deliberately, rather than pretending to
succeed and leaving you to discover later that no file was written. Add a
champion, a map or a monster to `pack.ts` by hand, using the one already
there as the model — the scaffold's own `pack.ts`, `map.ts` and `geometry.ts`
are real, typechecked files, not documentation, so "the one already there" is
never far away.

## The two doors

Content never touches core's internals directly — never `import { Spell }
from '@moba2d/core/...'`, never a bare `AssetManager` reference. Two doors,
for two different callers:

- **`api: ContentApi`**, handed to every spell factory, is what a *spell*
  sees at runtime: `api.Spell`, `api.SpellObject`, `api.MissileSpellObject`,
  `api.buffs.Slow`, `api.combat.Reach.effectiveRange`, `api.asset(key)` in
  place of `AssetManager.get(key)`, `api.layers.GROUND_Z_INDEX` for a decal's
  z-index, and so on. `packs/reference/spells/Vera_Q.ts`, in core's own
  checkout, is the worked example with the full surface exercised.
- **`@moba2d/core/testing`** (plus its subpaths — `/testing/spell` and
  `/testing/setup`, below, and `/testing/spells`, which exports
  `loadSpellsForTests(...barrels)`: the pack-parameterised way to fill a real
  spell registry for a test file that wants more than one spell resolvable by
  id, without hard-importing a barrel) is what an *observer* — a test — sees:
  `buildTestApi()` builds a real `ContentApi` without a browser,
  `createGame()`/`stubGameGlobals()` give a test a real match to drop units
  into, and `@moba2d/core/testing/spell`'s `pressSpell(spell, context)`
  drives a cast exactly the way a keypress does — never a lifecycle hook like
  `onSpellCast()` directly, which cannot see activation, cooldown, resource
  cost, or targeting rejection, and stays green against an ability that does
  not work at all. The scaffolded `Hero_Q.test.ts` is the worked example:
  read it before writing a second test, the same way you read `Hero_Q.ts`
  before writing a second spell — the shape (tuning as exported constants, a
  memoized factory, `pressSpell` never a hook) is not decoration, it is what
  keeps this pack's own tests honest.

The same preset a separated pack's `vitest.config.ts` spreads
(`@moba2d/core/testing/vitest`) is what core's own suite runs under too — so
core is the preset's first real consumer, not just its publisher, and the two
cannot silently drift the way two independently hand-written test setups
would.

## What `pack-core-boundary` refuses, and why

`npm run check-seams` runs `moba2d-check-seams ./spells`, which is the
`moba2d-check-seams` bin wrapping the same rule functions core publishes as
value imports under `@moba2d/core/seams` — reach for that subpath directly if
your pack's own script needs to run a specific rule (`checkManaSpend`,
`checkTargetVision`, ...) rather than the whole scan. Below, that scan is
`pack-core-boundary` and `pack-asset-key` scanning every file your
`package.json` owns, plus whatever narrower rules a spell file trips
(`castspec-frozen`, `targeting-mode-declared`, `unit-target-team`,
`target-vision`, and the rest `docs/ADDING_SPELLS.md` names).

- **`pack-core-boundary`** fails the scan on any *value* import out of core
  that is not `api` — `import { Spell } from '@moba2d/core/...'`, or an
  import of core's `src/` by relative path, both fail it. The reason is
  physical, not stylistic: a pack installed from a tarball or a git
  dependency gets exactly the subpaths core's `exports` field publishes, and
  nothing else — a value import of an unpublished internal is not a style
  violation, it is a module that will not resolve outside this monorepo, so
  the scan catches it here rather than at a stranger's `npm install`.
  `import type` is exempt — a type-only import erases at compile time and
  never touches a script tag or a bundle at all — which is exactly why the
  three modules a pack needs types from (`ContentApi`, `ContentPack`,
  `types`) are declared `devDependencies`, never `dependencies`: this pack
  needs nothing of core at runtime, only the object `api` hands it.
- **`pack-asset-key`** fails the scan on a bare asset key reused from core's
  own manifest. A pack resolves art through **its own** generated manifest,
  never core's — `api.asset('spell_hero_q')` looks the key up in whichever
  manifest belongs to the pack that called it, and a key that happens to
  exist in core's own art (because you copied an example without renaming
  it) is exactly the failure this rule exists to catch before it ships.

Both rules run over the **package** that owns the scanned tree, not only over
`./spells` — a pack's `pack.ts`, its generated barrels, its maps, its monster
factories and its VFX modules can break either rule exactly as a spell file
can, and none of those sit under `./spells`.

## Art and VFX

`docs/VFX_STANDARD.md`, in core's own repository, is the whole bar in one
page — unique-per-champion motifs, no instant pop-in, damage scaled to a
~100 HP pool (abilities 15–35, ultimates 40–60), a size floor for anything a
player has to find on the ground, and the two traps `tsc` cannot catch
(`getDisplayBoundingBox()`, `onDashUpdate`). Read it there rather than a copy
here — a second copy is a second thing that can drift from the first.

## The full spell-authoring mechanism

Everything above `castSpec` — activation and targeting modes, `CancelPolicy`
and the four `SpellForm`s, delivery primitives (`MissileSpellObject`,
`BeamSpellObject`, `AreaSpellObject`), binding VFX to lifecycle, `Reach`, and
on-hit passives — is `docs/ADDING_SPELLS.md`, also in core's own repository.
It is written for exactly this audience: no Riot vocabulary anywhere in it,
and its one worked local example is `Vera` — core's own reference pack, the
same shape this scaffold gave you as `Hero`. Read it once, fully, before your
second ability; this document is the door into it, not a replacement for it.
