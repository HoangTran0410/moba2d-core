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
npx --package=github:moba2d-game/core moba2d-pack-new my-pack \
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

## Seeing your changes in a real game

You do not need a copy of core to play your pack. Core is already running
somewhere — moba2d.pages.dev, your own Pages deploy — and a pack is installed
by URL, so the fastest loop is to serve your own `dist/` and paste that
address into the game.

```sh
npm run build      # writes dist/ and dist/manifest.json
npm run serve      # -> http://localhost:5174/manifest.json
```

Then in the game: **Packs → Thêm bằng URL**, paste the printed URL, install.
After that the loop is `npm run build` and the game offers you a reload on its
own — it polls your manifest and notices the new build.

`npm run serve` is `moba2d-pack-serve`, one of core's bins, so it is there
without anything to set up. It sends the four headers this exact situation
needs: `access-control-allow-origin: *` and a JavaScript MIME type (the two
any host must send, above), `access-control-allow-private-network: true` for
the preflight Chrome sends when a public page asks something on your local
network, and `cache-control: no-store` so your own browser cannot answer a
read you made *because* you rebuilt. `--port` and `--dir` are there if you
need them.

**Core treats a pack served from `localhost` as a pack under development.** It
does not pin its manifest and does not let the service worker cache it, so
every reload reads what you are actually serving — the opposite of what it
does for a published pack, and the reason a rebuild shows up at all. The
packs screen marks such a row `dev`. Nothing about this applies to a pack
served from anywhere else.

Two things to know before you blame your pack:

- **Safari refuses `http://localhost` from an `https://` page.** Chrome and
  Firefox allow it (loopback counts as a trustworthy origin); Safari does not.
  Use one of those, or put a tunnel in front of the port — `cloudflared tunnel
  --url http://localhost:5174` gives you an `https` address that works
  everywhere, and is also how you hand your pack to someone else for five
  minutes without publishing it.
- **A dev pack has no offline copy, on purpose.** That is the trade for seeing
  your rebuilds. Publish it and it caches like any other pack.

### Developing beside a local core

`--core` writes a different dependency spec into the scaffolded
`package.json`. Use it when you are changing core and the pack together:

```sh
node /path/to/moba2d-core/scripts/pack-new.mjs my-pack \
  --id my-pack --core file:/path/to/moba2d-core
```

Anything npm understands is accepted verbatim — a `file:` path, a fork, a
branch, a tarball. The default is `github:moba2d-game/core#main`.

If you have both repositories checked out side by side, core can link them for
you instead — run this **in core**:

```sh
npm run pack:link -- ../my-pack     # both directions
npm run dev                         # your pack, from source, with HMR
npm run pack:unlink -- --all        # before committing core
```

This is the fastest loop there is — no build step, no reinstall, edit a spell
and the page updates — but it is available only when both halves are on the
same disk, and it does not exercise the manifest, the CORS or the
cross-origin `import()` that a real install goes through. Build and serve
once before you publish.

It links **both** directions, because both are broken by default: core finds
packs by reading `node_modules/@moba2d/`, where a sibling directory does not
appear; and a scaffolded pack's own `@moba2d/core` is a copy npm fetched from
GitHub, so without the second link your pack's tests run against the published
core rather than the one you are editing. The npm copy is moved aside, not
deleted, so unlinking restores it with no network.

While a pack is linked, core's `src/generated/installedPacks.ts` names it —
that is a tracked file, so unlink before committing core. An `npm install` can
also drop the symlink; re-running `pack:link` is the fix.

Core's own suite also expects a core-only checkout: with a pack linked,
`BUNDLED_PACK_ID` is your pack rather than `reference`, two packs are installed
where one was, and the shop stocks your items — four test files check exactly
those things and go red. That is them working, not breaking. Unlink before
running core's `npm test`.

`npm run verify` stops you first: its opening step is `links:check`, which
fails while anything is linked and names it. That is deliberate — `packs:check`
cannot catch a forgotten link, because while the link is there the barrel and
the filesystem genuinely agree, and the disagreement only appears on the next
person's machine after they pull it.

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
- **`buildId` is written for you, and you must not bump anything by hand.**
  `scripts/write-manifest.mjs` hashes the sorted list of files the build
  emitted, so the value moves exactly when a content hash does. Core hangs it
  off the entry URL as `pack.js?b=<buildId>`, which is what makes two builds
  two URLs — the fix for a republished pack whose old chunk graph pointed at
  files the deploy had already deleted, 404ing one ability into silence. It is
  also what lets core notice that a player's installed copy is out of date and
  offer them the update. `version` is the semver a person reads and takes no
  part in either: it is a number a human has to remember to bump, and the riot
  pack's stayed `1.0.0` across dozens of publishes.

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
├── packApi.ts             # where the engine arrives; read its header
├── catalog.config.mjs     # this pack's layout, for the catalogue generator
├── assetManifest.ts       # this pack's art, under this pack's own keys
├── map.ts                 # the cheap summary a pregame picker lists
├── geometry.ts            # the real walls/lanes, fetched once a match starts
├── spells/
│   ├── index.ts           # the barrel — the one place a spell registers
│   └── Hero_Q.ts          # one file per ability, four to a champion
├── tests/
│   ├── Hero_Q.test.ts     # one test per ability, driven through press()
│   └── packInstallable.test.ts   # core's own install check, run locally
├── runtime-entry.ts       # the single module a runtime install imports
├── vite.config.ts         # the published build
├── scripts/write-manifest.mjs    # writes dist/manifest.json
├── generated/             # gitignored: spellCatalog.ts + spellModules.ts
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
  // Off `generated/spellCatalog.ts`, never off a spell module — see below.
  spellDisplay: displayData(),
  maps: [map],
};

const code = (api: ContentApi): ContentPackCode => {
  setPackApi(api);          // first, and before anything reaches a spell
  const spells: Record<string, SpellSource> = {};
  for (const [id, load] of Object.entries(spellModules)) {
    spells[id] = () => load().then(module => module.default);
  }
  return { spells };
};

export default code;
```

**A spell registers in two places, and only two**: one export line in
`spells/index.ts`, and its id in a champion's `spells: [...]`. Everything else
— the display values, the lazy import map — the catalogue generator derives
from the barrel, so there is nothing else to keep in step. `moba2d-pack-add
spell` writes both, at the `// moba2d-pack-add spell: ... above this line`
markers in each file. They are plain, greppable strings on purpose, not a
parser hunting for "the end of this object literal", which is the shape that
breaks the day someone reformats a spacing the generator did not predict.

### A spell is an ordinary class

A pack may not value-import core. That is physical, not stylistic: the pack is
built with `@moba2d/core` marked `external`, published as its own `pack.js`,
and `import()`ed cross-origin — an `import { Spell } from '@moba2d/core'`
surviving into that file is a bare specifier nothing can resolve. The engine
has to *arrive*.

`packApi.ts` is where it arrives, and it arrives before any spell module
evaluates. So a spell is just a class:

```ts
import { api } from '../packApi';

export class Hero_Q_Object extends api.MissileSpellObject { /* ... */ }

export default class Hero_Q extends api.Spell {
  live: Hero_Q_Object | null = null;   // the class name is the type
}
```

Three callers set the api, and there are only three: `pack.ts`'s code half
(the game and a runtime install), `vitest.setup.ts` (before any test file is
imported), and `catalog.config.mjs`'s `apiSetter` (the catalogue generator).
Each runs before anything reaches a spell module. Miss one and `packApi.ts`'s
proxy says so by name rather than throwing an undefined-property error on a
line that looks fine.

**The data half must never statically import a spell.** `data` is read before
any api exists — that is the whole point of the split — so an import there
evaluates a class too early, in a browser, after publish. The temptation is
real: `import { Q_COOLDOWN_MS } from './spells/Hero_Q'` to fill `spellDisplay`
without restating a number. The answer is `generated/spellCatalog.ts`: the
generator constructs each spell once at build time and writes its cooldown out
as a plain value, so the number still has one source and the data half still
imports nothing. `tests/dataHalf.test.ts` enforces it.

This replaces a factory-and-memo shape that one pack carried 650 times — a
`__build`, a `WeakMap<ContentApi, …>` and a `make` per class, plus an
`InstanceType<ReturnType<typeof makeX>>` alias to name what the factory
eventually built. All of it existed to guarantee one class per api. An ES
module already guarantees that: it evaluates once.

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
It writes `spells/<Champion>_<Slot>.ts` and its test, exports it from
`spells/index.ts`, and adds its id to that champion's kit. There is no
`spellDisplay` entry to write and no number to restate: `npm run
catalog:generate` reads the name, description, icon, cooldown and mana off the
class itself.

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
