import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
import { readFileSync } from 'node:fs';
// @ts-expect-error — a build script, deliberately plain .mjs with no types.
import { buildVersion } from './scripts/version.mjs';
// @ts-expect-error — same: plain .mjs, shared with `scripts/check-chunks.mjs`.
import { installedContentPackages } from './scripts/installed-packs.mjs';
import { restartOnVersionChange } from './scripts/vite/restart-on-version-change.mjs';

const version: string = buildVersion();

/**
 * Every installed `@moba2d/content-*` package, by package name.
 *
 * A content pack is **source Vite must transform**, not a built dependency,
 * and the difference is not cosmetic. A pack ships `.ts` with Vite-specific
 * import queries in it — `packs/riot/maps/summonersRiftGeometry.ts` imports
 * `./summoner_map.json?raw` precisely because `assetsInclude` below claims
 * `.json` ahead of Vite's JSON plugin. `?raw` is Vite's syntax, and
 * dependency pre-bundling is esbuild's: esbuild does not honour it, resolves
 * the specifier to the JSON *module*, and the pack's `JSON.parse(mapJsonRaw)`
 * then throws `"[object Object]" is not valid JSON` at module-eval time in
 * the browser. The match never boots and nothing in `verify` can see it —
 * Vitest runs its own transform, and `vite build` never evaluates the module.
 *
 * This could not happen while a pack was a directory in this repository or a
 * workspace symlink, because Vite does not pre-bundle either. It starts
 * happening the moment a pack is what the split makes it: an ordinary
 * `node_modules` dependency.
 */
const contentPackages: string[] = installedContentPackages(__dirname).map(
  (pack: { packageName: string }) => pack.packageName
);

export default defineConfig({
  root: '.',
  base: './',
  plugins: [
    // `__CORE_VERSION__` below is read from `package.json` once, here, when
    // this config loads — and Vite watches this file but not that one. So a
    // `contract:bump` against a running dev server leaves it serving the old
    // number, and the next pack install fails with a message that accuses the
    // code of being un-bumped. See the plugin's own comment; it has cost a
    // debugging cycle already.
    restartOnVersionChange({ packageJsonPath: resolve(__dirname, 'package.json') }),
    vue(),
    VitePWA({
      /**
       * `prompt`, not `autoUpdate`: this is a game, and a service worker that
       * swaps itself in mid-match would reload the page out from under a fight.
       * The new build waits, and `UpdatePrompt.vue` offers it on the menu.
       */
      registerType: 'prompt',
      /**
       * The registration lives in `src/pwa/updates.ts` instead of an injected
       * script, because the prompt above needs the callbacks it returns.
       */
      injectRegister: null,
      /**
       * The worker is `src/sw.ts`, not a generated file — see its own header.
       * In this mode the `workbox` key is *ignored*; the glob options move
       * to `injectManifest` below, and every runtime-caching rule moves into
       * the worker itself.
       */
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      /** Referenced by the manifest rather than by index.html, so name them. */
      includeAssets: [
        'favicon/favicon.ico',
        'favicon/favicon-16x16.png',
        'favicon/favicon-32x32.png',
        'favicon/apple-touch-icon.png',
        'favicon/safari-pinned-tab.svg',
      ],
      manifest: {
        name: 'MOBA2D',
        short_name: 'MOBA2D',
        description:
          'Game MOBA 2D chơi thẳng trong trình duyệt. Tướng và bản đồ nạp bằng content pack.',
        lang: 'vi',
        theme_color: '#0a1428',
        background_color: '#0a1428',
        display: 'standalone',
        /**
         * The game is landscape. Android honours this for an installed app,
         * which is the one place it can rotate the screen without the
         * fullscreen + `screen.orientation.lock` dance `DomUtils` does; iOS
         * ignores it, and `OrientationHint.vue` covers that.
         */
        orientation: 'landscape',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'favicon/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'favicon/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'favicon/android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        /**
         * Everything the game needs to start with no network — including
         * `vendor/`, which is why p5 and stats.js were taken off their CDNs
         * (see `scripts/copy-vendor.mjs`). Champion art is the bulk of it and
         * the reason the precache is a few megabytes: a match that cannot draw
         * its champions offline is not an installed game.
         */
        /**
         * `webp` is here and `jpg` deliberately is not. The menu used to rotate
         * six full-bleed JPEGs, ~1.1MB, and the glob has never listed `jpg`, so
         * they were the one visible thing an offline launch did not have. One
         * 88KB WebP replaces the lot and is cheap enough to precache, which is
         * what makes the installed app look the same with the network off.
         * There is no `jpg` left in `assets/` to exclude any more: the three
         * `Screenshot_*.jpg` were store art nothing in the game rendered, and
         * they were shipped into `dist/` on every build for years because the
         * manifest generator walks all of `assets/`. Deleted rather than
         * ignored — 265KB, and the honest fix for an asset with no reader is
         * not to route around it.
         */
        globPatterns: ['**/*.{js,css,html,ico,png,webp,svg,json,webmanifest,woff2}'],
        /**
         * `assets/source-manifest.json` is provenance for the wiki importer —
         * 110KB that `scripts/wiki/check-abilities.mjs` reads off disk and no
         * running game ever fetches. It reaches `dist/` only because the asset
         * manifest generator walks all of `assets/`, and the `json` glob above
         * then made every install download it.
         */
        /**
         * The map editor's tracing backgrounds (`public/map-editor/asset/`) are
         * ~850KB of `png`/`webp` that the glob above would otherwise make
         * every install download. They are reference art a map author picks
         * as a canvas underlay — reachable from one screen, useless offline
         * to everyone who never opens it. The editor's own `js`/`css`/`html`
         * stay precached: those are the app, and an author on a train should
         * still be able to draw.
         */
        globIgnores: ['**/source-manifest-*.json', 'map-editor/asset/**'],
        /** The menu chunk alone is ~830KB; the default 2MB cap is too tight to trust. */
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: {
        /**
         * Off in dev on purpose. A service worker caching a hot-reloading app
         * turns every "why is my change not showing" into a cache hunt; the
         * build is where this feature is exercised (`npm run preview`).
         */
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
    /**
     * The commit's own clock — `2026.8.17.15.0`. See `scripts/version.mjs` for
     * why it is not `package.json`'s version, and why it is computed here
     * rather than written to a file.
     */
    __APP_VERSION__: JSON.stringify(version),
    /**
     * Core's package version, for a pack manifest's `coreRange` to be
     * checked against. Deliberately not `__APP_VERSION__`, which is the
     * commit's clock (`2026.8.17.15.0`) and is not semver — see
     * `scripts/version.mjs`.
     */
    __CORE_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version
    ),
  },
  optimizeDeps: {
    // See `contentPackages` above: packs are source, never pre-bundled deps.
    exclude: contentPackages,
  },
  assetsInclude: ['**/*.json'],
  build: {
    target: 'esnext',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        /**
         * Chunks split by **how often they change**, which is what a returning
         * player's cache actually cares about.
         *
         * `assetManifest.ts` is the reason this exists. It is one generated
         * module holding all ~410 asset URLs, and adding a single champion icon
         * rewrites it — which, folded into the entry chunk, meant re-downloading
         * 161KB of application code for one new PNG. On its own it is ~31KB, and
         * nothing else is invalidated with it.
         *
         * Vue and the physics libraries move on their own release schedule
         * rather than with this repo, so they are worth the same treatment: a
         * normal commit no longer touches them at all.
         *
         * The images themselves were never the problem — Vite hashes those on
         * content, so `ahri_q-ViZcqiii.png` keeps its name across builds and the
         * service worker precaches all ~380 of them with `revision: null`,
         * meaning the URL *is* the version and an unchanged file is never
         * re-fetched.
         */
        manualChunks(id) {
          /**
           * `AssetManager` rides with the manifest it wraps. Both are needed
           * before the first frame, both change rarely, and — the reason this
           * line exists — leaving `AssetManager` unassigned let Rollup hoist it
           * into the `game` chunk as a shared module, so the entry imported one
           * binding out of a megabyte and preloaded the lot before the menu
           * could draw.
           *
           * `generated/assetManifest` (no `src/` anchor) also catches
           * `packs/riot/generated/assetManifest.ts` — batch 4 task 4 moved 377
           * of the ~410 entries this comment describes out of core's own tree
           * and into the pack's, and `src/content/install.ts` (forced into
           * `pregame` by the `src/content/` rule below — the same role
           * `bundledPack.ts` carried until batch 4 task 7 deleted it) imports
           * that file directly to register it with `AssetManager`. Left
           * unassigned, Rollup's
           * single-importer default inlined the whole 377-entry manifest
           * straight into `pregame` — the same "one new PNG re-downloads
           * everything" problem this chunk exists to prevent, just moved to a
           * bigger victim: it measured as a ~57KB, ceiling-breaching regression
           * (`chunks:check`) the first time this file's own pack tree gained
           * real art. A pack manifest changes exactly as often as core's does
           * (an art update, never a code change), so it belongs in the same
           * cache-stable chunk for the same reason.
           */
          if (id.includes('generated/assetManifest') || id.includes('src/managers/AssetManager')) {
            return 'asset-manifest';
          }
          /**
           * Dependency-free helpers used on both sides of a scene boundary.
           *
           * Left unassigned, a shared module goes wherever Rollup decides, and
           * it decided `game` for all three — so `MenuScene`'s chunk statically
           * imported the 1.1MB match chunk to get `DomUtils.preventZoom`, and
           * the pregame screen imported it to format a cooldown. One binding
           * each, a megabyte apiece.
           *
           * All three are pure functions with no imports of their own, so this
           * chunk is ~4KB and safe anywhere. `collide.utils` and
           * `optimized.utils` are deliberately excluded: the first pulls
           * poly-decomp, and the second runs on the entry path before p5 loads.
           */
          if (/src\/utils\/(index|format\.utils|dom\.utils)\.ts$/.test(id)) return 'shared';
          /**
           * The same shape, one directory over: `ITEM_STAT_KEYS` is a bare
           * string array with no imports, and **both sides of the pack
           * boundary read it** — `game/items/Item.ts` builds an item's
           * modifier from it, and `content/validate.ts` refuses a pack that
           * names a key not on it. Left unassigned it landed in `game`
           * (it lives under `src/game/`), and validation runs in `pregame`, so
           * Rollup reported a `pregame -> game -> pregame` cycle.
           *
           * It cannot live in `src/content/` instead: `Item.ts` would then
           * value-import the pack contract to learn what an item's own stats
           * are, which is the dependency backwards. `shared` is what this
           * chunk is for.
           */
          if (id.includes('src/game/items/itemStats')) return 'shared';
          /**
           * Vite's own `__vitePreload` runtime, which every dynamic import in
           * the app calls.
           *
           * Unassigned it goes wherever Rollup puts it, and once
           * `spellModules.ts` arrived with 238 dynamic imports in one module,
           * "wherever" became the `game` chunk — so `MenuScene` imported a
           * single helper function out of the match chunk and dragged the whole
           * thing back onto the menu. Exactly the failure the two boot-path
           * tests exist for, and exactly the one they cannot see: the source
           * imports were clean, because this module is not in the source.
           */
          if (id.includes('vite/preload-helper')) return 'shared';
          /**
           * `packAsset` — the cast that lets a pack's own asset key through
           * `AssetManager.get`, typed against core's generated `AssetKey`
           * union. It lives under `src/game/config/`, which the pregame
           * carve-out below would otherwise claim, but `ContentApi.ts`
           * (pinned `game`, by the rule right after this one) imports it
           * too — `Champion.ts` needs the same crossing and cannot import
           * `spellCatalog.ts` to get it without recreating the
           * `Champion.ts -> spellCatalog.ts -> registry.ts -> install.ts ->
           * ContentApi.ts -> Champion.ts` cycle (see `packAsset.ts`'s own
           * header). Left unassigned, this two-line leaf would be hoisted
           * into whichever of `pregame`/`game` Rollup resolves first —
           * exactly the trap `vite/preload-helper` above and the
           * `src/content/` rule below both call out. Its own chunk is
           * cheaper than either duplicating it back into two places or
           * reopening the cycle.
           */
          if (id.includes('src/game/config/packAsset')) return 'shared';
          /**
           * The content pack machinery — `src/content/` and the reference pack
           * under `packs/reference/` — split by whether the file still names
           * `ContentApi.ts` as a *value*, ahead of the pregame carve-out and
           * the generic `/src/game/` rule below.
           *
           * Batch 2 pinned this whole directory to `game`, because
           * `spellCatalog.ts` read the roster and display data through
           * `contentRegistry()` (`registry.ts`), and that module's own
           * dependency chain — `install.ts` -> `ContentApi.ts` — statically
           * imported the ~80 real engine modules a content pack needs to
           * build real spell classes (24 buffs, the combat and vfx helpers,
           * the spell-object base classes: see `ContentApi.ts`'s own
           * header). Left unassigned, that chain was reachable from *both*
           * `pregame` (via `spellCatalog.ts`) and `game` (via
           * `spellRegistry.ts`), and Rollup's cycle resolution for that
           * shape folded the whole chain, engine imports included, into
           * `pregame`: `DamageReflect`, `TrueSight`, `ParticleSystem` and
           * `MissileSpellObject` all measurably moved chunks that way.
           *
           * Batch 3 is the fix the old comment here said batch 2 was
           * deferring: the pack contract split into a data half
           * (`ContentPackData` — manifest, champions, spell display, maps)
           * and a code half (`ContentPackCode` — spells), and `install.ts`
           * no longer value-imports `ContentApi.ts` at all — `registry.ts`
           * builds the api and hands it in as a parameter instead. That
           * leaves exactly two files in this directory that still reach
           * `ContentApi.ts` as a value: `ContentApi.ts` itself, and
           * `registry.ts`, whose `contentRegistry()` is the one place that
           * calls `buildContentApi()`. Every other file here — `catalog.ts`,
           * `install.ts`, `PackRegistry.ts`, `validate.ts`, `ContentPack.ts`
           * — and all of `packs/reference/` (its spell files
           * take `ContentApi` as a *parameter* of their exported factory,
           * never an import — `tests/content/contentApiChunk.test.ts` walks
           * this exact closure) — never names the engine surface, so pinning
           * them to `pregame` no longer drags it along. `spellCatalog.ts`
           * and `pregameCatalog.ts` were moved onto `contentCatalog()`
           * (`catalog.ts`) for the same reason: they only ever read data.
           *
           * The one edge this does not close: `registry.ts` (`game`) still
           * imports `catalog.ts` (`pregame`) for the shared registry
           * instance — a `game -> pregame` edge, required, since installing
           * the code half means completing the same `PackRegistry` the data
           * half already built. `preset.ts`'s pre-existing import of
           * `config/spellCatalog.ts` is the other one, unrelated to content
           * and not this batch's to change. Both run the same direction, so — unlike
           * batch 2 — there is no longer a `pregame -> game` edge to close
           * the cycle: `vite build` no longer prints `Circular chunk:
           * pregame -> game -> pregame`.
           *
           * **Whoever writes batch 4's chunk rule: `pregame` now carries real
           * spell-behaviour code, not just data.** `packs/reference/` is
           * pinned here as a whole file per module, and a pack's own file —
           * `packs/reference/spells/Vera_Q.ts` and its three siblings — mixes
           * the tuning constants `data.spellDisplay` needs with the
           * `onHit`/`draw`/damage logic only `code` ever calls; Vite cannot
           * split one file's exports across two chunks, so the whole thing
           * rides along. Measured at ~3.9KB for the reference pack's four
           * spells — harmless, and the reason `scripts/check-chunks.mjs`'s
           * engine-leak check now requires the `Name:` object-literal-key
           * shape rather than a bare substring match (a `class extends
           * api.MissileSpellObject` property access in exactly this file
           * tripped the old, looser check). **It would not be harmless at
           * 240** — the Riot pack batch 4 moves into `packs/riot/`. Pinning
           * that whole directory here the same way would put every spell's
           * real implementation into the chunk the menu downloads first,
           * which is precisely the regression this task closed, reopened
           * from a different file. Batch 4's pack will need its `data` and
           * `code` kept in genuinely separate files (or its own manualChunks
           * rule that pins spell implementation files to `game` regardless
           * of which pack directory they live under) — do not pin it here by
           * analogy with `packs/reference/`.
           *
           * **Task 7 was that split**, whose own chunking half pinned
           * `packs/riot/data.ts`/`code.ts`/`pack.ts` to `pregame` explicitly,
           * the same reasoning as `packs/reference/` above but kept as its
           * own rule because `packs/riot/spells/*.ts` needed to keep landing
           * in their own per-champion `spell-<name>` chunks rather than
           * riding along whole.
           *
           * Content-pack-and-repo-split batch 6 task 10 is that rule's
           * retirement, not a further split: `packs/riot/` left this
           * repository entirely (it is `@moba2d/content-riot`'s own
           * repository now), so there is no `packs/riot/` path left in this
           * tree for a rule to match. The per-champion regex it depended on
           * is gone from this file too — see where it used to sit, further
           * down.
           *
           * **Runtime-pack-loading Task 7 adds a third file to this list:
           * `runtimePacks.ts`.** It is `LoadingScene.ts`'s own orchestrator —
           * installing every remembered pack during the loading screen, the
           * same moment `main.ts`'s warm call already installs core and the
           * reference pack — and, like `registry.ts`, it has to call
           * `buildContentApi()` and `rebuildContentRegistry()` for real: a
           * pack fetched from a URL needs an actual `ContentApi` to build
           * real spell classes against, not the data-only view
           * `contentCatalog()` gives the rest of `pregame`. Left under the
           * generic `/src/content/` rule below it would pin to `pregame` by
           * path alone and open exactly the edge `RULES` in
           * `scripts/check-chunks.mjs` forbids (`pregame` statically
           * importing `game`) — measured, not assumed: the first version of
           * this file did exactly that and `chunks:check` caught it.
           * Pinning it to `game` instead costs nothing new: `LoadingScene.ts`
           * imports it from the entry chunk, which is not a chunk `RULES`
           * restricts and which already depends on `game` today through
           * `main.ts -> registry.ts`. `runtimePacks.ts` keeps importing
           * `install.ts` / `packSource.ts` / `installedPackStore.ts`
           * (`pregame`), which is the same `game -> pregame` edge
           * `registry.ts` already carries via `catalog.ts`, two paragraphs
           * up — required, not new.
           */
          if (
            id.includes('/src/content/ContentApi') ||
            id.includes('/src/content/registry') ||
            id.includes('/src/content/runtimePacks')
          ) {
            return 'game';
          }
          /**
           * A map's heavy geometry — Task 4's lazy half of `MapDefinition` —
           * ahead of the blanket `/src/content/` rule below, which matches by
           * *path* and does not know or care that this file is reached only
           * through a dynamic `import()` from its own map's summary module
           * (`summonersRift.ts` -> `() => import('./summonersRiftGeometry')`).
           * Left to that rule, this measurably landed back in `pregame`
           * anyway — the whole point of Task 4's split, undone by a chunking
           * rule from batch 1 that predates the split existing. Named per map
           * (`map-<id>`, lowercased) the same way spells are named per
           * champion, so Task 9's second map gets its own chunk instead of
           * growing this one.
           *
           * Task 9's own map lives under `packs/reference/`, not
           * `src/content/maps/` — a pack's map ships with the rest of its
           * pack, the same way `packs/reference/spells/` ships beside
           * `pack.ts` rather than under `src/content/`. The pattern below
           * matches either directory so `provingGroundsGeometry.ts` gets the
           * same carve-out `summonersRiftGeometry.ts` gets, ahead of the
           * blanket `/packs/reference/` -> `pregame` rule two lines down,
           * which would otherwise win by matching first on path alone and
           * quietly put this map's polygons back in the chunk the menu
           * loads. Confirmed by `npm run chunks:check` plus a real
           * `vite build` and reading the manifest, not assumed from the
           * rule matching in isolation — see that script's own comment for
           * why a source-level check cannot see this class of regression.
           *
           * Batch 4 task 6 moved Summoner's Rift's own map out of core and
           * into `packs/riot/maps/summonersRiftGeometry.ts` — one path
           * segment deeper than `packs/reference/provingGroundsGeometry.ts`,
           * which sits directly under its pack's own root. The optional
           * `(?:\/[A-Za-z0-9_-]+)?` segment below matches either shape, so a
           * future pack's own `maps/` subdirectory (or a flat one, like the
           * reference pack's) both get the same carve-out without this rule
           * growing a third alternative per pack.
           */
          if (
            /\/(?:src\/content\/maps|packs\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?)\/([A-Za-z0-9]+)Geometry\.ts$/.test(
              id
            )
          ) {
            const match =
              /\/(?:src\/content\/maps|packs\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?)\/([A-Za-z0-9]+)Geometry\.ts$/.exec(
                id
              );
            return `map-${match![1].toLowerCase()}`;
          }
          if (id.includes('/src/content/') || id.includes('/packs/reference/')) return 'pregame';
          /**
           * The pregame screen's data layer, carved out of `src/game/` ahead of
           * the `game` rule below.
           *
           * These modules sit under `src/game/` because that is what they are
           * *about* — a match's config, its saved kits, its spell catalogue,
           * its touch settings — but none of them can execute anything. The
           * rule below is a path test, so without this carve-out the setup
           * screen importing `PregameConfig` was enough to pull the megabyte:
           * `SetupScene` reached `preset.ts`, `preset.ts` reached
           * `import * as AllSpells`, and rendering a roster of names and icons
           * loaded all 238 spell modules.
           *
           * `config/spellCatalog.ts` is the piece that made this possible —
           * generated display data instead of 238 constructors. See its header,
           * and `tests/scenes/pregameBootPath.test.ts`, which is what stops
           * a single stray import putting it all back.
           */
          if (
            id.includes('src/game/config/') ||
            id.includes('src/game/constants') ||
            id.includes('src/game/input/touchPreferences') ||
            id.includes('src/generated/spellCatalog') ||
            // The generated installed-packs barrel. `src/content/install.ts`
            // (already `pregame`, by the `/src/content/` rule above) is its
            // only importer in the app, so Rollup would hoist it here anyway
            // — pinned explicitly because "would anyway" is exactly the
            // reasoning `DomUtils` and `__vitePreload` each falsified once,
            // and because an unassigned module reached from two chunks lands
            // in whichever one Rollup prefers. It carries a pack's `data`
            // half and its generated asset manifest, both of which this
            // chunk already had before batch 5 task 8 moved them behind the
            // barrel; a pack's `code` half is kept out of `pregame` by a
            // rule of its own, the same way `packs/riot/code.ts`'s did
            // before content-pack-and-repo-split batch 6 task 10 retired it
            // along with the rest of that pack's presence in this tree —
            // the barrel is empty today, with no pack installed.
            id.includes('src/generated/installedPacks') ||
            // The picker components themselves. They are *shared* — the in-game
            // practice panel opens the same `LoadoutEditorModal` — and a shared
            // module goes wherever Rollup puts it, which was `game`. So the
            // setup screen was importing its own roster back out of the match.
            // Pinned to the side that can stand alone; the game chunk depends
            // on this one anyway, through `PregameConfig`.
            id.includes('src/scenes/setup/') ||
            // The match-config panel, which is now mounted in *both* places —
            // over the menu and over a running match — so it is shared exactly
            // the way the picker above it is, and would otherwise be hoisted
            // into `game` and dragged back onto the menu.
            //
            // `MatchDirectorSource` is the deliberate exception and the whole
            // point of the seam: it is the only file in that directory that
            // touches `MatchDirector`, `AIChampion` and `Camera`, so it belongs
            // to the match. `tests/scenes/matchConfigChunk.test.ts` is what
            // keeps the rest of the directory able to live out here.
            (id.includes('src/game/hud/config/') && !id.includes('MatchDirectorSource')) ||
            // The tap directive is shared the same way: the config tabs above
            // (pregame) and the shop/HUD (game) both wire touch controls
            // through it, and it imports nothing but a Vue type. Left
            // unpinned it lands in `game` and hands `pregame` back the static
            // `pregame -> game` edge this list exists to prevent; pinned
            // here, the shop's import of it is one more `game -> pregame`
            // edge, which already exists and is the allowed direction.
            id.includes('src/game/hud/tapGuard') ||
            // The LAN broker's address and its room arithmetic. It imports
            // nothing at all and is read from both sides of the boundary:
            // `scenes/LanScene.vue` (its own chunk, off the menu) and
            // `src/game/net/netRole.ts` (`game`).
            //
            // An unassigned module reached from two chunks lands in whichever
            // Rollup prefers, and when the lobby moved off the menu into its
            // own scene it preferred `game` — measured, in the build that
            // introduced `LanScene`: a 5.6KB screen whose whole job is to
            // write two URL parameters gained a static
            // `from"./game-*.js"` edge and pulled the entire match behind
            // it. While the menu itself imported this file that never
            // happened, which is exactly why the module's own header ("lives
            // under `src/scenes/` — not `src/game/net/` — on purpose") was
            // not enough on its own: the header states the direction, and
            // only a pin holds it. Pinned to the side that can stand alone;
            // `game` reading it is one more `game -> pregame` edge, the
            // allowed direction. `tests/scenes/lanBootPath.test.ts` guards
            // the source half, `chunks:check` the compiled half.
            id.includes('src/scenes/lanSignal')
          ) {
            return 'pregame';
          }
          /**
           * The match itself, in one deliberately-named chunk. Rollup already
           * hoisted it into a shared chunk of its own once `GameScene` and
           * `SetupScene` became dynamic imports, but named it after whichever
           * module happened to lead — `TouchControls-*.js` — which is both
           * meaningless to read and free to change when the module graph
           * shifts. Naming it pins the filename to its contents.
           *
           * It is also the tripwire: nothing on the menu's path may import
           * `src/game/`, or this whole megabyte lands back in front of the logo.
           * `tests/scenes/menuBootPath.test.ts` is that rule.
           */
          // One chunk per champion, so a match fetches only the kits it is
          // playing rather than one `game`-chunk-sized request per spell.
          //
          // Content-pack-and-repo-split batch 6 task 10 moved
          // `packs/riot/spells/*.ts` out of this tree entirely, which
          // retired this rule — its path shape (`packs/riot/spells/…`)
          // cannot exist here any more, `packs/riot/` being gone. But an
          // *installed* pack is not gone, it is a real dependency:
          // `installedContentPackages()` (`scripts/installed-packs.mjs`)
          // resolves every `@moba2d/content-*` package out of
          // `node_modules/@moba2d/`, and once `@moba2d/content-riot` (or any
          // future pack) is wired in as a real `package.json` dependency —
          // this branch's own stated next step — its spell files live at
          // `node_modules/@moba2d/content-<name>/spells/*.ts`, an entirely
          // different path shape than the old `packs/riot/spells/` one.
          // Whole-branch fix pass: restored against *that* shape, generically
          // over every installed pack's scope rather than the one name
          // `riot` used to be. `scripts/check-chunks.mjs`'s per-champion
          // floor is what proves this rule is actually applying — it derives
          // its expected chunk names from each installed pack's own
          // `generated/spellModules.ts` rather than a literal count.
          const packSpell =
            /node_modules\/@moba2d\/content-[^/]+\/spells\/([A-Za-z0-9]+?)(?:_[QWER][0-9]*)?\.ts$/.exec(
              id
            );
          if (packSpell) {
            // Summoner spells and the basic attack have no champion prefix to
            // group by, and every kit can hold them — one shared chunk rather
            // than six chunks of one file.
            const champion = /_[QWER][0-9]*\.ts$/.test(id) ? packSpell[1].toLowerCase() : 'common';
            return `spell-${champion}`;
          }
          if (id.includes('/src/game/')) return 'game';
          if (id.includes('node_modules/@vue/') || id.includes('node_modules/vue/')) {
            return 'vendor-vue';
          }
          if (
            id.includes('node_modules/detect-collisions') ||
            id.includes('node_modules/sat/') ||
            id.includes('node_modules/poly-decomp')
          ) {
            return 'vendor-physics';
          }
          return undefined;
        },
      },
    },
  },
});
