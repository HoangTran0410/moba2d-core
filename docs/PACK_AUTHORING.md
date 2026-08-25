# Writing a content pack

A content pack is a repository of its own that depends on `@moba2d/core`,
declares a roster and a map, and ships the real spell classes that make the
roster playable. Players install one by pasting a URL into the game's **Tìm
pack** field; nothing about a pack is built into the game.

This page is the whole path from an empty directory to that URL. Every
command below was run, in order, on a machine with nothing installed but
Node and git — including the failures, which is why the two commands the
first version of this document recommended are not here.

## The runbook

**Stand outside core.** `moba2d-pack-new` writes into the directory you run
it from, so running it inside a checkout of core creates the pack inside
core's own tree — a pack you then cannot commit anywhere, because those files
belong to a repository that is not yours. Pick any empty directory.

```sh
cd ~/somewhere-that-is-not-core
npx --package=github:HoangTran0410/moba2d-core moba2d-pack-new my-pack \
  --id my-pack --name "My Pack"
```

`--package=github:...` is not optional and is the whole trick: neither
`@moba2d/core` nor `moba2d-pack-new` is published to any npm registry, so a
bare `npx moba2d-pack-new` fails with a 404 and always has. npx resolves a
git spec directly, which takes about fifteen seconds and needs nothing
installed first.

```sh
cd my-pack
npm install
npm run verify
```

`verify` is `typecheck` + `check-seams` + tests + the published build. On the
untouched scaffold every part of it passes — 14 tests, `dist/manifest.json`
written — and that is the point: this is a starting point, not a lecture with
`TODO`s that fail.

Then make it a repository of your own:

```sh
git init
git add -A
git commit -m "scaffold my-pack"
gh repo create my-pack --public --source=. --push
```

**Turn Pages on once, by hand:** the new repository's **Settings → Pages →
Build and deployment → Source: GitHub Actions**. The scaffolded
`.github/workflows/publish.yml` builds and deploys on every push to `main`,
and until that setting is changed every run of it fails at the deploy step
with a permissions error that reads like a broken token. Nothing is broken;
Pages simply has not been enabled.

The published manifest then lives at — and this whole string, `manifest.json`
included, is what a player pastes:

```
https://<owner>.github.io/<repo>/manifest.json
```

Any static host works as well as Pages. Core needs exactly two things from
one: `access-control-allow-origin: *`, because it fetches the manifest and
`import()`s the entry cross-origin, and a JavaScript MIME type for `.js`.

### Developing beside a local core

`--core` writes a different dependency spec into the scaffolded
`package.json`. Use it when you are changing core and the pack together:

```sh
node /path/to/moba2d-core/scripts/pack-new.mjs my-pack \
  --id my-pack --core file:/path/to/moba2d-core
```

Anything npm understands is accepted verbatim — a `file:` path, a fork, a
branch, a tarball. The default is `github:HoangTran0410/moba2d-core#main`.

## What core refuses, and when you find out

Four rules decide whether a published pack installs at all. Each of them used
to be discoverable only in a browser, after a deploy, with the URL already
handed out — so each of them is now something the scaffold gets right and
`npm run verify` re-checks every run.

- **A playable champion has a portrait and exactly four abilities.**
  `validatePackData` says so, and says it in those words. Three abilities is
  not a pack with a gap in it, it is a pack that fails to install. The
  scaffold ships four (the same bolt four times — making them different is
  your first job) and `tests/packInstallable.test.ts` runs core's own
  validator over your pack on every `npm test`.
- **`coreRange` is `*` or `>=X.Y.Z`, and nothing else.** Core's parser reads
  those two shapes and treats everything else as unsatisfiable, so `^1` — the
  ordinary npm way to write it — is not a loose range, it is a pack that
  refuses to install with a message that reads like a real version conflict.
  It is stated twice, in `pack.ts` and in `scripts/write-manifest.mjs`; raise
  both together. `npm run build` refuses a range it cannot parse, and refuses
  a floor above the core the pack was built against.
- **A manifest needs `id`, `version`, `coreRange`, `name`, `entry` and
  `assets`,** and `entry` and `assets` must resolve onto the manifest's own
  origin. A pack may be served from anywhere, but it may not point execution
  somewhere other than where the player was shown it came from — that
  disclosure is the whole security model of the install prompt.
- **The pack's `manifest.id` and its data half's `manifest.id` must agree.**
  Two places, one string, and core checks them against each other.

### Which floor to declare

The minor in `>=1.<n>.0` is core's **contract number**: the version of
`ContentApi`'s shape. Core moves it with `npm run contract:bump`, which
records the API surface and raises core's minor in one step, and a test fails
if the surface changes without it — because the number used to be a promise
that could not fail. Core's `package.json` read `1.0.0` from its first commit
until the API had 278 members, and every pack declared `>=1.0.0` against it.

For a pack the rule is short:

- **Leave it at `>=1.0.0` unless you have a reason.** A floor raised for no
  reason only narrows who can play.
- **Raise it when you start using something a newer contract added**, so a
  player on an older core is told the pack is too new instead of meeting a
  missing member mid-match.
- **Raise it only after a core carrying that contract is deployed.** The pack
  is the half that is already published: a floor the live core cannot meet is
  refused on every player's machine at once, and the fix has to travel through
  core's deploy before yours can land.

What a floor cannot say is the other direction — an old pack running on a
*newer* core that removed something. Nothing checks that; core's side of the
bargain is not removing members.

## Where things live

```
my-pack/
├── package.json           # name, the @moba2d/core spec, the five scripts
├── tsconfig.json          # extends @moba2d/core's own strict base config
├── pack.ts                # the whole pack's declaration — see below
├── packClass.ts           # the memo every class factory goes through
├── assetManifest.ts       # this pack's art, under this pack's own keys
├── map.ts                 # the cheap summary a pregame picker lists
├── geometry.ts            # the real walls/lanes, fetched once a match starts
├── spells/
│   └── Hero_Q.ts          # one file per ability, four to a champion
├── tests/
│   ├── Hero_Q.test.ts     # one test per ability, driven through press()
│   └── packInstallable.test.ts   # core's own install check, run locally
├── runtime-entry.ts       # the single module a runtime install imports
├── vite.config.ts         # the published build
├── scripts/write-manifest.mjs    # writes dist/manifest.json
└── .github/workflows/     # publish.yml (Pages) + verify.yml (PRs)
```

`pack.ts` is split into a **data half** (`ContentPackData` — roster, map list,
spell display metadata: names, icons, cooldowns) and a **code half**
(`ContentPackCode` — real engine classes, built from `api`). The split exists
because the data half has to be readable without ever building a
`ContentApi`: a menu screen that only wants champion names and portraits
should never have to load the engine first. `@moba2d/core/content/ContentPack`
carries the full reasoning in its own header.

```ts
export const data: ContentPackData = {
  manifest: { id: 'my-pack', version: '1.0.0', coreRange: '>=1.0.0' },
  champions: [{ id: 'hero', name: 'Hero', image: 'champ_hero', playable: true,
                spells: ['Hero_Q', 'Hero_W', 'Hero_E', 'Hero_R'] }],
  spellDisplay: { Hero_Q: { name: 'Hero Q', coolDownMs: Q_COOLDOWN_MS, /* ... */ } },
  maps: [map],
};

const code = (api: ContentApi): ContentPackCode => ({
  spells: { Hero_Q: makeHero_Q(api), /* ... */ },
});

export default code;
```

Three comment markers inside `pack.ts` — `// moba2d-pack-add spell: ... above
this line`, one each for the import, the champion's `spells: [...]` array, and
the code half's factory map — are the insertion points `moba2d-pack-add spell`
writes into. They are plain, greppable strings on purpose, not a parser
hunting for "the end of this object literal", which is the shape that breaks
the day someone reformats a spacing the generator did not predict.

### Every class is a factory, and `packClass` is why that is one line

A pack may not value-import core. `Spell`, `SpellObject`,
`MissileSpellObject` and the rest arrive on the injected `api`, so a class
body cannot `extends Spell` — it can only be built inside a function that has
been handed an `api`. That much is the boundary (`pack-core-boundary`, below),
not a preference.

The factory also has to be memoized per `api`: the real game, an e2e script
and a test each build their own `ContentApi`, and an unmemoized factory hands
two callers two different classes with the same name, between which every
`instanceof` answers false.

Written out by hand that is three top-level declarations per class — a
`__build`, a `__cache` WeakMap and a `make` that reads and writes it. The
codemod that first moved a 237-file pack onto `api` did exactly that, 650
times, and the result read like build output rather than like source; it was
reported as such, and collapsing it back onto `packClass` removed some five
thousand lines without changing a single class body. `packClass.ts` is the
eight lines that hold the memo instead:

```ts
export default packClass(api => class Hero_Q extends api.Spell { /* ... */ });
```

It imports nothing of core but a type, so it costs the pack nothing at
runtime and stays the pack's own to change.

### Naming a type

`api` hands out *constructors*. To write a field or a parameter you need the
instance type, and both halves have a published name:

```ts
import type { AttackableUnit, Slow } from '@moba2d/core/content/types';
import { packClass, type Instance } from '../packClass';

type Thresh_Q_Object = Instance<typeof makeThresh_Q_Object>;
```

`@moba2d/core/content/types` carries the instance type of every class `api`
gives you — the spell hierarchy, the six unit classes, all 25 buffs, the VFX
helpers, the two Quadtree shapes. `Instance<typeof makeX>` is for the pack's
*own* classes, which no barrel can publish because `packClass` returns a
factory.

Do not derive these by hand. `InstanceType<ContentApi['units']['AttackableUnit']>`
is correct and it is what a pack wrote before the barrel existed — one pack
accumulated 221 of them, 120 being that exact line — and each one is a place
the name can go stale on its own.

## Add another ability

```sh
moba2d-pack-add spell Bolt --champion Hero --slot W
```

Found by walking up from wherever you run it (never a hardcoded path or a
directory literally named `packs`), so it works the same from a pack's own
root, from a nested directory inside it, or inside a genuinely separate pack
repository. It writes `spells/<Champion>_<Slot>.ts` and its test from the same
template `moba2d-pack-new` renders its own abilities from, then wires the
import, the kit-slot roster entry, and the code-half factory into `pack.ts`.
It does **not** write a `spellDisplay` entry (name, icon, description); that
has no template because it is content, not mechanism, and the command says so
in its own "Next" output.

Note that a **playable** champion's kit is full at four, so this command is
for a champion you have just added, or for a slot you are replacing
(`--force`). Adding a fifth ability to a playable champion produces a pack
core will not install — which `npm test` will tell you.

**Only `spell` is implemented.** `moba2d-pack-add champion`, `map` and
`monster` are named in the command's own usage line and every one of them
refuses to run, loudly, non-zero — deliberately, rather than pretending to
succeed and leaving you to discover later that no file was written. Add a
champion, a map or a monster to `pack.ts` by hand, using the one already
there as the model — the scaffold's own `pack.ts`, `map.ts` and `geometry.ts`
are real, typechecked files, not documentation.

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
  `/testing/setup`, and `/testing/spells`, which exports
  `loadSpellsForTests(...barrels)`: the pack-parameterised way to fill a real
  spell registry for a test file that wants more than one spell resolvable by
  id, without hard-importing a barrel) is what an *observer* — a test — sees:
  `buildTestApi()` builds a real `ContentApi` without a browser,
  `createGame()`/`stubGameGlobals()` give a test a real match to drop units
  into, `validatePackData` is the install check core itself runs, and
  `@moba2d/core/testing/spell`'s `pressSpell(spell, context)` drives a cast
  exactly the way a keypress does — never a lifecycle hook like
  `onSpellCast()` directly, which cannot see activation, cooldown, resource
  cost, or targeting rejection, and stays green against an ability that does
  not work at all. The scaffolded `Hero_Q.test.ts` is the worked example:
  read it before writing a second test, the same way you read `Hero_Q.ts`
  before writing a second spell.

The same preset a pack's `vitest.config.ts` spreads
(`@moba2d/core/testing/vitest`) is what core's own suite runs under too — so
core is the preset's first real consumer, not just its publisher, and the two
cannot silently drift the way two independently hand-written test setups
would.

## What `check-seams` refuses, and why

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
  own manifest. A pack resolves art through **its own** `assetManifest.ts`,
  never core's — `api.asset('champ_hero')` looks the key up in whichever
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

The scaffold's `assetManifest.ts` ships one placeholder tile inlined as a
data URI, so the art path works before you have any art. Real art is a file:

```ts
import heroPortrait from './assets/champ_hero.png?url';
```

`?url` is Vite's own syntax and hands back the emitted file's URL rather than
its bytes, which is what keeps `vite.config.ts`'s `assetsInlineLimit: 0`
meaningful — art lands in `dist/assets/` as real files, and `pack.js`, which
a player downloads before the menu can draw, carries none of it. A pack with
more than a handful of images generates that file rather than writing it;
core's own `scripts/generate-assets.mjs` is the worked example, and the
scaffold's `.gitignore` already ignores a `generated/` directory for it.

## The full spell-authoring mechanism

Everything above `castSpec` — activation and targeting modes, `CancelPolicy`
and the four `SpellForm`s, delivery primitives (`MissileSpellObject`,
`BeamSpellObject`, `AreaSpellObject`), binding VFX to lifecycle, `Reach`, and
on-hit passives — is `docs/ADDING_SPELLS.md`, also in core's own repository.
It is written for exactly this audience: no Riot vocabulary anywhere in it,
and its one worked local example is `Vera` — core's own reference pack, the
same shape this scaffold gave you as `Hero`. Read it once, fully, before your
second ability; this document is the door into it, not a replacement for it.
