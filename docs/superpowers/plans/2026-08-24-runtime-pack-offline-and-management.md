# Runtime Pack Loading — Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the runtime-pack path — packs survive offline, a player can install and remove one from a screen that tells them whose code they are about to run, and core's CI stops compiling a pack in.

**Architecture:** Three moves, in the spec's own order. (1) The service worker becomes ours: `generateSW` → `injectManifest` plus a hand-written `src/sw.ts`, because a pack's URL is not known at build time and no static `urlPattern` can name it. (2) A pack's bytes reach the cache two ways — a `CacheFirst` route in that worker, keyed on the *base URLs* the page announces, and a background prefetch after install that walks the manifest's new `files` list so an unplayed champion's chunk is offline too. (3) A packs screen, reached from the menu (not a fourth config tab — 390px holds three), that lists, adds, removes, and — the part that pays for "any URL may be installed" — shows the origin before a single line of a stranger's code runs.

**Tech Stack:** TypeScript, Vite 5, `vite-plugin-pwa` 1.3 in `injectManifest` mode, `workbox-*` 7.4, Vue 3 SFCs, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-24-runtime-pack-loading-design.md` — §6 (storage and offline), §7 (management screen), §11 steps 6–8.

**Predecessor:** `docs/superpowers/plans/2026-08-24-runtime-pack-loading.md` (Plan 1, §11 steps 1–5, merged as core `cde6b95` / pack `a53a084`). Plan 1 ended with a pack installing from a URL and the roster growing. Everything it built is load-bearing here and is not re-litigated.

**Repos:** core `/Users/hoangtran/Desktop/Github/moba2d-core`, pack `/Users/hoangtran/Desktop/Github/moba2d-content-riot`.

---

## Global Constraints

Copied from the spec. Every task's requirements implicitly include this section.

- **Nothing on the boot path may throw.** `LoadingScene.enter()` fires `void this.boot()`, so a rejection above the menu handover is an unhandled rejection and the menu never opens. Every new async call on that path is inside a `try`, and the prefetch is fire-and-forget (`void`), never awaited.
- **Any URL may be installed — fully open** (spec §2, decision 2). No allowlist. No CSP. Do not add either, and do not add a "trusted hosts" list by another name.
- **The confirmation screen is the whole mitigation** (spec §2.1, §7). It must state, in this order of prominence: the **origin, unabbreviated and not shortened**; the pack's name and version; the `coreRange` check result; and one plain sentence saying the pack will run with full authority on the page. It is shown **after** `fetchPackManifest` and **before** `loadPackFromManifest` — that boundary between spec §3's step 2 and step 3 is the only security boundary in the design.
- **The failure banner does not dismiss itself** (spec §7). Already true; do not regress it.
- **The packs screen is its own scene**, not a fourth `MatchConfigPanel` tab: `.pregame-tab` is `flex: 1` and 390px holds three plus the close button (`CLAUDE.md`).
- **`src/scenes/packs/*` must never statically import a `src/game/` runtime value.** The screen is reached from the menu before any match exists. `tests/scenes/packsBootPath.test.ts` (Task 6) and a new `chunks:check` rule hold it.
- **The `pregame` chunk must not statically import `game-*`.** `scripts/check-chunks.mjs` RULES. Anything that needs `buildContentApi()` for real lives in `runtimePacks.ts` (pinned `game`) and is reached by dynamic `import()`.
- **`Array.prototype.filter` cannot narrow types** — it is polyfilled and `src/types/global.d.ts` puts the non-predicate overload first. Write a plain loop, never a cast.
- **`tsconfig.json` sets `"strict": false`**, under which `!x.ok` narrows a discriminated union to the wrong branch. Write `x.ok === false`, matching `PackRegistry.ts:89,111,146` and `packSource.ts`.
- **Every HUD control needs `@touchend.prevent` beside `@click`.** Not strictly required on a screen that never coexists with `GameScene` — but `RosterTab.vue`'s shape is the house style and `MenuScene.vue`'s pack banner already follows it. Follow it.
- **p5 global mode**: `map`, `text`, `fill`, `color`, `pop`, `random`, `line`, `point`, `scale`, `rotate`, `image` are globals a local silently shadows and `tsc` cannot see it. Name locals for what they mean.
- **Prettier**: `.prettierrc`, 2 spaces, single quotes, 100 columns. Never run `--write` across files this plan does not touch.
- **Every test must be shown to fail.** Write it, run it, read the message. A check that cannot fail is worse than no check — Plan 1 shipped two of them (a `count() > 0` on a `display:none` element, and an e2e that reported 6/6 while every champion's code half was being rejected).
- **Commit with explicit paths.** Never `git add -A`, never `.`, never a bare `git commit`. Concurrent agents share the tree.
- **`npm run verify` is the gate** and must be green at the end of every task. `npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"` is the whole signal.
- **Do not push.** The user's network cannot reach GitHub this session. Commit locally on a branch; the controller reports when a push is needed and waits.

### One amendment to the spec, made by this plan

Spec §3's manifest listing has no way to enumerate a pack's files, and spec §6's background prefetch needs exactly that ("kéo hết 1.2 MB chunk vào cache" — a prefetch cannot walk a directory it can only fetch from). Task 2 adds an **optional** `files: string[]` to the manifest and writes it into the spec as §3.1. Optional, not required: a pack without it still installs, still plays online, and simply gets its chunks cached on demand rather than ahead of time. Measured shape of the real pack: 238 chunks (1.5MB), 351 assets (3.0MB), one 191KB entry — 590 entries, ~21KB of JSON before gzip.

---

## File Structure

**Core — created:**

| File | Responsibility |
|---|---|
| `src/sw.ts` | The service worker itself. Precache + navigation fallback + the Font Awesome rule (all three exactly what `generateSW` emitted) plus the pack `CacheFirst` route and the base-URL message channel. |
| `tsconfig.sw.json` | Its own TypeScript program: `lib: ["ESNext", "WebWorker"]`. The DOM lib and the WebWorker lib cannot both describe `self`. |
| `src/content/packCache.ts` | The page's half of the cache: announce the bases, prefetch a pack's files, measure what a pack occupies, forget one. No network protocol, no UI. |
| `src/scenes/PacksScene.ts` | Scene lifecycle for the packs screen — mount, unmount, back to the menu. |
| `src/scenes/PacksScene.vue` | The list, the add field, the remove button. |
| `src/scenes/packs/PackInstallConfirm.vue` | The origin disclosure. Its own component because it is the one piece of this screen that must not be edited casually. |
| `styles/packs-scene.css` | Its styles, linked from `index.html` beside the other four scenes. |
| `tests/pwa/serviceWorkerSource.test.ts` | Source scan: the worker still does everything `generateSW` did. |
| `tests/content/packCache.test.ts` | Unit: prefetch skips what is cached, never throws, counts honestly. |
| `tests/scenes/packsBootPath.test.ts` | The packs screen does not drag `src/game/` in. |
| `tests/e2e/verify-pack-management.mjs` | Playwright: install from the UI, see the origin, remove it, and the roster follows. |

**Core — modified:**

| File | Change |
|---|---|
| `vite.config.ts` | `strategies: 'injectManifest'`, `srcDir`, `filename`, `workbox:` → `injectManifest:`. A `PacksScene` chunk needs no rule of its own (Rollup names it), but `check-chunks.mjs` gains one. |
| `tsconfig.json` | `exclude` gains `src/sw.ts`. |
| `package.json` | Five direct `workbox-*` devDependencies, `typecheck:sw`, `e2e:packs`; `verify` gains `typecheck:sw`. |
| `src/content/packSource.ts` | `RuntimePackManifest` gains optional `files?: string[]`, validated. |
| `src/content/runtimePacks.ts` | After the install loop: announce the bases, kick off the prefetch, expose `installPackNow()` for the UI. |
| `src/scenes/MenuScene.ts` / `.vue` | A `#packs-btn` that opens the new scene by dynamic import. |
| `index.html` | `#packs-scene` host and its stylesheet link. |
| `scripts/check-chunks.mjs` | `PacksScene` must not statically import `game-*`. |
| `tests/e2e/verify-pwa-offline.mjs` | A second phase: a pack installed, prefetched, then played with the network cut. |
| `.github/workflows/build.yml` | **Delete** "Build the published game — core plus the content pack". |

**Pack — modified:**

| File | Change |
|---|---|
| `scripts/write-manifest.mjs` | Emit `files`. |
| `tests/build/runtimeBundle.test.ts` | Assert `files` covers what `dist/` actually holds. |

---

## Task 1: The service worker becomes ours

`generateSW` writes the worker from config. `injectManifest` writes only the precache list into a worker we own — which is the whole point: spec §6 needs a cache rule whose URL is not known until a player types it, and no build-time `urlPattern` can express that.

This task changes **nothing about behaviour**. The worker it hand-writes does exactly what the generated one does today, verified against the generated bytes. The pack rule arrives in Task 3, on a worker that has already been proven not to have broken the PWA.

**Files:**
- Create: `src/sw.ts`
- Create: `tsconfig.sw.json`
- Create: `tests/pwa/serviceWorkerSource.test.ts`
- Modify: `vite.config.ts:40-136` (the `VitePWA({...})` call)
- Modify: `tsconfig.json`
- Modify: `package.json`
- Modify: `tests/e2e/verify-pwa-offline.mjs:36-52` (`declaredPrecacheCount`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `src/sw.ts` with a documented shape later tasks append to — a module-scope `PACK_CACHE_NAME`, a `message` listener, and route registrations in a fixed order (precache, navigation, Font Awesome, then anything new). Task 3 adds its route **after** the Font Awesome one, because workbox's router is first-match-wins and the CDN rule must keep its own cache.

**Reference — what the current generated worker does.** Read off `dist/sw.js` (build first if `dist/` is absent), in this order:

```js
self.addEventListener("message", s => { s.data && "SKIP_WAITING" === s.data.type && self.skipWaiting() })
precacheAndRoute([...], {})
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")))
registerRoute(/^https:\/\/cdnjs\.cloudflare\.com\/.*/i, new CacheFirst({
  cacheName: "cdn-fontawesome",
  plugins: [new ExpirationPlugin({maxEntries: 24, maxAgeSeconds: 7776e3}),
            new CacheableResponsePlugin({statuses: [0, 200]})]
}), "GET")
```

Note what is **not** there: no `clientsClaim()`, no `navigateFallbackDenylist`. Do not add either — `registerType: 'prompt'` deliberately does not take over an open page.

- [ ] **Step 1: Add the workbox packages as direct dependencies**

They are all already in `node_modules` as transitive dependencies of `vite-plugin-pwa` (7.4.1). A file in `src/` that imports them needs them declared.

```bash
npm install --save-dev workbox-precaching@7 workbox-routing@7 workbox-strategies@7 workbox-expiration@7 workbox-cacheable-response@7
```

Expected: `package.json` gains five `devDependencies`, `package-lock.json` updates, and no version in `node_modules` moves (they were already 7.4.1).

- [ ] **Step 2: Write the failing test**

Create `tests/pwa/serviceWorkerSource.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/seams/importScan';

/**
 * The worker is hand-written now (spec §6: a pack's URL is not known at build
 * time, so no `generateSW` `urlPattern` can name it), which means every
 * behaviour `generateSW` used to supply for free is a line someone has to
 * keep. This is the list of those lines.
 *
 * It is a source scan rather than a behavioural test on purpose: the
 * behaviour needs a real service worker, a real cache and a real offline
 * toggle, and `npm run e2e:pwa` is where that is checked. What this catches
 * is the cheap half — a line deleted in a later edit — in milliseconds
 * rather than in the four minutes a build-plus-browser run costs.
 *
 * Comments are stripped before matching, or this test flags the paragraph
 * you are reading.
 */
const ROOT = join(__dirname, '../..');
const sw = (): string => stripComments(readFileSync(join(ROOT, 'src/sw.ts'), 'utf8'));
const viteConfig = (): string =>
  stripComments(readFileSync(join(ROOT, 'vite.config.ts'), 'utf8'));

describe('the hand-written service worker keeps what generateSW gave us', () => {
  it('takes the precache manifest from the injection point', () => {
    // Without this exact identifier the plugin fails the build outright, but
    // it fails with "could not find the injection point", which reads like a
    // plugin bug rather than a deleted line.
    expect(sw()).toContain('self.__WB_MANIFEST');
    expect(sw()).toMatch(/precacheAndRoute\(\s*self\.__WB_MANIFEST/);
  });

  it('answers a navigation with the precached index.html', () => {
    expect(sw()).toMatch(/new NavigationRoute\(\s*createHandlerBoundToURL\('index\.html'\)/);
  });

  it('drops caches from an older precache format', () => {
    expect(sw()).toContain('cleanupOutdatedCaches()');
  });

  it('still honours the SKIP_WAITING message the update prompt posts', () => {
    // `registerType: 'prompt'` + `src/pwa/updates.ts`'s `applyUpdate()` is a
    // message, not a reload: the page posts SKIP_WAITING and the worker has
    // to act on it. Without this listener "Có bản mới — cập nhật" does
    // nothing, forever, and the only symptom is a player on a stale build.
    const source = sw();
    expect(source).toContain("'SKIP_WAITING'");
    expect(source).toContain('self.skipWaiting()');
  });

  it('keeps Font Awesome on its own CacheFirst cache', () => {
    const source = sw();
    expect(source).toMatch(/cdnjs\\\.cloudflare\\\.com/);
    expect(source).toContain("cacheName: 'cdn-fontawesome'");
    expect(source).toContain('maxEntries: 24');
  });

  it('vite.config.ts is in injectManifest mode and points at this file', () => {
    const source = viteConfig();
    expect(source).toContain("strategies: 'injectManifest'");
    expect(source).toContain("srcDir: 'src'");
    expect(source).toContain("filename: 'sw.ts'");
    // The `workbox` key is silently ignored in injectManifest mode. A glob
    // left under it precaches nothing and the build says nothing.
    expect(source).not.toMatch(/^\s*workbox:\s*\{/m);
  });
});
```

- [ ] **Step 3: Run it and read the failure**

```bash
npx vitest run tests/pwa/serviceWorkerSource.test.ts 2>&1 | tail -30
```

Expected: every case fails. The first several on `ENOENT ... src/sw.ts`; the last on the `vite.config.ts` assertions, which is the one that proves the file-reading half works before `src/sw.ts` exists.

- [ ] **Step 4: Write the worker**

Create `src/sw.ts`:

```ts
/// <reference lib="webworker" />
/**
 * The game's service worker, hand-written.
 *
 * It used to be generated: `VitePWA`'s `generateSW` read `workbox: {...}` out
 * of `vite.config.ts` and emitted the whole file. That works exactly as long
 * as every URL worth caching is known when the build runs — and spec §6 is
 * the case where it is not. A content pack lives at whatever URL a player
 * typed, so the rule that caches it cannot be a `urlPattern` literal. The
 * alternative inside `generateSW` is a regex broad enough to swallow every
 * cross-origin request the page ever makes, which is a worse thing to own
 * than this file.
 *
 * Everything below the pack section is a line-for-line reproduction of what
 * `generateSW` emitted, read off the built `dist/sw.js` rather than
 * remembered: the precache, `cleanupOutdatedCaches`, the navigation fallback,
 * the Font Awesome rule, and the SKIP_WAITING listener that
 * `src/pwa/updates.ts` talks to. `tests/pwa/serviceWorkerSource.test.ts` is
 * the cheap guard on that list; `npm run e2e:pwa` is the real one.
 *
 * **Route order is the API.** Workbox's router is first-match-wins, so the
 * precache route must be registered before anything that could also claim a
 * precached URL, and the Font Awesome rule before any broader cross-origin
 * rule. Append new routes at the bottom.
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

/**
 * `declare let`, not `declare const`, and typed as a module-scope shadow of
 * the global: `lib.webworker.d.ts` already declares `self` as
 * `WorkerGlobalScope`, which has no `skipWaiting`. This file is a module (it
 * imports), so the declaration shadows rather than conflicts. `__WB_MANIFEST`
 * is the plugin's injection point — a literal the plugin replaces after the
 * bundle is built, which is why it is a property rather than an import.
 */
declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[];
};

/**
 * `registerType: 'prompt'` means a new build installs and then waits. The
 * page decides when it takes over — `src/pwa/updates.ts`'s `applyUpdate()`,
 * offered on the menu, which is the one screen where losing the page costs
 * nothing. This listener is the other half of that conversation.
 */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

/** Any navigation is answered by the precached shell — the app is one page. */
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

/**
 * Font Awesome is the one thing still on a CDN, deliberately: a missing icon
 * is a missing icon, not a blank screen. Cached on first sight so the second
 * launch has it offline. An opaque cross-origin response carries status 0,
 * hence the explicit allowance.
 */
registerRoute(
  /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
  new CacheFirst({
    cacheName: 'cdn-fontawesome',
    plugins: [
      new ExpirationPlugin({ maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 90 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);
```

- [ ] **Step 5: Give it its own TypeScript program**

Create `tsconfig.sw.json`:

```json
{
  // The service worker cannot share `tsconfig.json`'s program: that one
  // resolves the DOM lib (ESNext's default), where `self` is a `Window`, and
  // this file needs `self` to be a `ServiceWorkerGlobalScope`. The two lib
  // sets are mutually exclusive by design, which is why every service-worker
  // setup ends up with a second config rather than a clever cast.
  //
  // `strict` on, unlike root `tsconfig.json`: this is 60 lines of new code
  // with no legacy to accommodate, and it runs where nobody can see it fail.
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "strict": true,
    "lib": ["ESNext", "WebWorker"],
    "types": []
  },
  "include": ["src/sw.ts"]
}
```

Modify `tsconfig.json` so `vue-tsc` stops trying to compile the worker against the DOM lib:

```json
  "exclude": ["node_modules", "testzone", "tools", "dist", "src/sw.ts"]
```

- [ ] **Step 6: Switch `vite.config.ts` to injectManifest**

In the `VitePWA({...})` call, immediately after `injectRegister: null,` add:

```ts
      /**
       * The worker is `src/sw.ts`, not a generated file — see its own header.
       * In this mode the `workbox` key is *ignored*; the glob options move
       * to `injectManifest` below, and every runtime-caching rule moves into
       * the worker itself.
       */
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
```

Then rename the `workbox: { ... }` block to `injectManifest: { ... }` and **delete its `runtimeCaching` array** (it now lives in `src/sw.ts`). Keep `globPatterns`, `globIgnores` and `maximumFileSizeToCacheInBytes` and every comment attached to them, verbatim.

- [ ] **Step 7: Add the typecheck and wire it into `verify`**

In `package.json`'s `scripts`, after `"typecheck:core"`:

```json
    "typecheck:sw": "tsc -p tsconfig.sw.json",
```

and in `verify`, insert `npm run typecheck:sw && ` immediately after `npm run typecheck:core && `.

- [ ] **Step 8: Fix the precache counter in the offline e2e**

`tests/e2e/verify-pwa-offline.mjs`'s `declaredPrecacheCount()` reads the built worker with `/\{url:"([^"]+)"/g`. That matches `generateSW`'s minified output. In `injectManifest` mode the manifest is `JSON.stringify`'d into the already-bundled file, so the keys are **quoted**: `{"url":"index.html","revision":"..."}`. Left alone, the count is 0, the check compares `cached === 0`, and it fails for a reason that has nothing to do with the PWA.

**Measure the real shape first, do not trust this paragraph:**

```bash
npm run build && node -e "
const s=require('fs').readFileSync('dist/sw.js','utf8');
const i=s.indexOf('revision'); console.log(JSON.stringify(s.slice(i-120,i+60)));
"
```

Then widen the regex to accept both forms:

```js
  const urls = [...source.matchAll(/\{"?url"?:\s*"([^"]+)"/g)].map(match => match[1]);
```

and add a guard beneath it, because a regex that silently matches nothing is exactly the shape of check this repository has shipped before:

```js
  if (urls.length === 0) {
    throw new Error('no precache entries found in dist/sw.js — the manifest shape changed');
  }
```

- [ ] **Step 9: Run the tests**

```bash
npx vitest run tests/pwa/serviceWorkerSource.test.ts 2>&1 | tail -20
```

Expected: PASS, 6 cases.

- [ ] **Step 10: Prove the source scan can fail**

Delete the `self.addEventListener('message', ...)` block from `src/sw.ts`, re-run the test, confirm "still honours the SKIP_WAITING message" fails, restore it. Report the failure message in the task report.

- [ ] **Step 11: The real gate**

```bash
npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"
npm run e2e:pwa 2>&1 | tail -20
```

Expected: `verify` green. `e2e:pwa` green with the **same** `precache is populated` count as before the change (record the before-number by running it on `git stash`-free clean HEAD first if you did not; if it moved, say by how much and why — a moved count is a real finding, not noise).

- [ ] **Step 12: Commit**

```bash
git add src/sw.ts tsconfig.sw.json tsconfig.json vite.config.ts package.json package-lock.json \
        tests/pwa/serviceWorkerSource.test.ts tests/e2e/verify-pwa-offline.mjs
git commit -m "feat(pwa): hand-write the service worker via injectManifest"
```

---

## Task 2: The pack manifest lists its own files

A background prefetch needs to know what to fetch, and a static host offers no directory listing. `manifest.json` gains `files` — every path the build emitted, relative to the manifest.

Optional by design: a pack without it installs and plays exactly as today, and simply has nothing prefetched.

**Repo: `moba2d-content-riot`.**

**Files:**
- Modify: `scripts/write-manifest.mjs`
- Modify: `tests/build/runtimeBundle.test.ts`
- Modify (core repo): `docs/superpowers/specs/2026-08-24-runtime-pack-loading-design.md` — add §3.1

**Interfaces:**
- Produces: `manifest.files: string[]` — POSIX-separated paths relative to the manifest's own URL, sorted, excluding `manifest.json` itself. Task 3's `prefetchPackFiles(baseUrl, files)` and Task 4's caller consume it.

- [ ] **Step 1: Write the failing test**

Append to `tests/build/runtimeBundle.test.ts`:

```ts
describe('the manifest lists what the build emitted', () => {
  /** Every file under `dist/`, relative and POSIX-separated. */
  const walk = (dir: string, prefix = ''): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
      else out.push(rel);
    }
    return out;
  };

  it('names every emitted file except the manifest itself', () => {
    const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
    const onDisk = walk(DIST).filter(name => name !== 'manifest.json').sort();

    expect(Array.isArray(manifest.files)).toBe(true);
    // Set equality both ways, not a length check: a `files` that lists 590
    // paths of which one is wrong has the right length and caches a 404.
    expect([...manifest.files].sort()).toEqual(onDisk);
  });

  it('lists the entry and at least one chunk and one asset', () => {
    const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
    expect(manifest.files).toContain(manifest.entry);
    expect(manifest.files.some((f: string) => f.startsWith('chunks/'))).toBe(true);
    expect(manifest.files.some((f: string) => f.startsWith('assets/'))).toBe(true);
  });

  it('uses forward slashes, so a Windows build does not emit unfetchable paths', () => {
    const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
    expect(manifest.files.some((f: string) => f.includes('\\'))).toBe(false);
  });
});
```

Add `readdirSync` to the existing `node:fs` import if it is not there, and confirm the file already defines `DIST` (or define it the way the neighbouring cases do).

- [ ] **Step 2: Run it and read the failure**

```bash
npm run build && npx vitest run tests/build/runtimeBundle.test.ts 2>&1 | tail -30
```

Expected: `expected undefined to be true` on `Array.isArray(manifest.files)`.

- [ ] **Step 3: Emit `files`**

In `scripts/write-manifest.mjs`, above the `writeFileSync` call:

```js
/**
 * Every file this build emitted, relative to the manifest and POSIX-separated
 * — what core's background prefetch walks to fill the offline cache (core's
 * spec §3.1 and §6).
 *
 * A static host offers no directory listing, so a prefetch that is not handed
 * a list can only cache what a match happens to ask for; and what a match
 * asks for is exactly the champion the player already picked, which is the
 * champion they already have. The unplayed 237 are the ones the offline case
 * is about.
 *
 * `manifest.json` excludes itself: core already has it — fetching it is what
 * produced this list.
 */
function emittedFiles(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...emittedFiles(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

const files = emittedFiles(dist)
  .filter(name => name !== 'manifest.json')
  .sort();
```

and add `files,` to the object literal, after `champions: championCount,`. Then extend the final `console.log` so the build says what it published:

```js
console.log(
  `manifest written: riot@${pkg.version}, ${championCount} champions, ${chunks} chunks, ${files.length} files`
);
```

- [ ] **Step 4: Run the tests**

```bash
npm run build && npx vitest run tests/build/runtimeBundle.test.ts 2>&1 | tail -20
```

Expected: PASS. The build log should read `590 files` (238 chunks + 351 assets + `pack.js`) — report the real number.

- [ ] **Step 5: Prove the set-equality check can fail**

Add a bogus entry (`files.push('nope.js')`) before the write, rebuild, re-run, confirm the first case fails and names `nope.js`. Remove it.

- [ ] **Step 6: Gate and commit (pack repo)**

```bash
npm run verify 2>&1 | tail -20
git add scripts/write-manifest.mjs tests/build/runtimeBundle.test.ts
git commit -m "feat(manifest): list every emitted file so core can prefetch them"
```

- [ ] **Step 7: Write the amendment into the spec (core repo)**

In `docs/superpowers/specs/2026-08-24-runtime-pack-loading-design.md`, immediately after §3's manifest JSON block and its paragraph, insert:

```markdown
### 3.1 `files` — cái GĐ2 thêm vào

`manifest.json` có thêm một trường **tuỳ chọn**:

```json
"files": ["pack.js", "chunks/Ahri_Q-abc123.js", "assets/ahri-def456.png", "…"]
```

Mọi đường dẫn tương đối so với chính manifest, dấu `/`, đã sắp xếp, không kể
`manifest.json`.

Vì sao cần: §6 nói prefetch nền "kéo hết chunk vào cache", mà một host tĩnh
không có listing thư mục — không có danh sách thì prefetch chỉ cache được đúng
những gì trận đấu vừa hỏi, tức đúng tướng người chơi đã có. 237 tướng chưa chơi
mới là chỗ offline hỏng.

Tuỳ chọn, không bắt buộc: pack không khai `files` vẫn cài, vẫn chơi online bình
thường, chỉ là không có gì được kéo trước. Đo trên pack thật: 238 chunk, 351
asset, 1 entry — 590 mục, ~21KB JSON trước gzip.
```

```bash
git add docs/superpowers/specs/2026-08-24-runtime-pack-loading-design.md
git commit -m "docs(spec): record the manifest's optional files list as §3.1"
```

---

## Task 3: The pack cache — the worker's route and the page's writer

Two halves of one store, and the split is deliberate: **the page decides what is a pack file, the worker only serves.** The page is the side that knows — it fetched the manifest, it resolved the base, it holds the installed list. The worker gets told, in one message, and keeps a copy so it survives a restart.

The alternative — a route matching every cross-origin request — is the one spec §6 rules out by name ("luật quá rộng sẽ nuốt cả những thứ không định cache"), and it is worse than it looks here: core and the pack are served from the **same origin** in production (`hoangtran99.is-a.dev/moba2d-core/` and `/moba2d-content-riot/`), so an origin test is not even correct. The match is on **base URL prefix**.

**Files:**
- Create: `src/content/packCache.ts`
- Create: `tests/content/packCache.test.ts`
- Modify: `src/sw.ts`
- Modify: `src/content/packSource.ts` (the `files` field)

**Interfaces:**
- Consumes: `manifest.files` (Task 2).
- Produces:
  - `PACK_CACHE_NAME = 'lol2d-packs-v1'` — exported from `packCache.ts`, and **duplicated as a literal in `src/sw.ts`** (the worker is a separate TypeScript program and cannot import from `src/content/`; the test in Step 4 is what keeps the two equal).
  - `packBaseFor(manifestUrl: string): string`
  - `announcePackBases(bases: readonly string[]): void`
  - `prefetchPackFiles(baseUrl: string, files: readonly string[]): Promise<PrefetchReport>`
  - `interface PrefetchReport { base: string; requested: number; added: number; skipped: number; failed: number }`
  - `packCacheUsage(baseUrl: string): Promise<{ entries: number; bytes: number }>`
  - `forgetPack(baseUrl: string): Promise<number>`

- [ ] **Step 1: Write the failing test**

Create `tests/content/packCache.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PACK_CACHE_NAME,
  announcePackBases,
  forgetPack,
  packBaseFor,
  packCacheUsage,
  prefetchPackFiles,
} from '@/content/packCache';

/**
 * A `CacheStorage` small enough to assert against. `caches` does not exist in
 * a Node test run, and the parts of it this module uses are four methods.
 */
function fakeCaches() {
  const store = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (key: string | Request) => store.get(String(key))),
    put: vi.fn(async (key: string | Request, value: Response) => {
      store.set(String(key), value);
    }),
    delete: vi.fn(async (key: string | Request) => store.delete(String(key))),
    keys: vi.fn(async () => [...store.keys()].map(url => ({ url }))),
  };
  return { store, cache, open: vi.fn(async () => cache) };
}

const BASE = 'https://packs.example/riot/';

let caches: ReturnType<typeof fakeCaches>;

beforeEach(() => {
  caches = fakeCaches();
  (globalThis as Record<string, unknown>).caches = caches;
  (globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string) =>
    new Response('x', { status: 200, headers: { 'content-length': '100' } })
  );
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).caches;
  delete (globalThis as Record<string, unknown>).fetch;
  vi.restoreAllMocks();
});

describe('packBaseFor', () => {
  it('is the manifest\'s own directory', () => {
    expect(packBaseFor('https://packs.example/riot/manifest.json')).toBe(BASE);
  });

  it('keeps the trailing slash so a prefix test cannot match a sibling', () => {
    // Without it, base `https://h/riot` matches `https://h/riot-evil/x.js`.
    expect(packBaseFor('https://h/riot/manifest.json').endsWith('/')).toBe(true);
  });

  it('answers empty for something that is not a URL, rather than throwing', () => {
    expect(packBaseFor('not a url')).toBe('');
  });
});

describe('prefetchPackFiles', () => {
  it('fetches and stores each file under the base', async () => {
    const report = await prefetchPackFiles(BASE, ['pack.js', 'chunks/a.js']);
    expect(report.added).toBe(2);
    expect(caches.store.has(`${BASE}pack.js`)).toBe(true);
    expect(caches.store.has(`${BASE}chunks/a.js`)).toBe(true);
  });

  it('skips a file the cache already holds', async () => {
    caches.store.set(`${BASE}pack.js`, new Response('cached'));
    const report = await prefetchPackFiles(BASE, ['pack.js', 'chunks/a.js']);
    expect(report.skipped).toBe(1);
    expect(report.added).toBe(1);
  });

  it('counts a dead file instead of rejecting', async () => {
    (globalThis as Record<string, unknown>).fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const report = await prefetchPackFiles(BASE, ['gone.js']);
    expect(report.failed).toBe(1);
    expect(report.added).toBe(0);
  });

  it('refuses a path that escapes the base', async () => {
    // `new URL('../../evil.js', base)` is a perfectly valid resolve, and a
    // hostile manifest is exactly where it would come from. The whole point
    // of the base is that the worker will later serve anything under it.
    const report = await prefetchPackFiles(BASE, ['../../evil.js']);
    expect(report.failed).toBe(1);
    expect(caches.store.size).toBe(0);
  });

  it('does not throw when there is no CacheStorage at all', async () => {
    delete (globalThis as Record<string, unknown>).caches;
    await expect(prefetchPackFiles(BASE, ['pack.js'])).resolves.toMatchObject({ added: 0 });
  });
});

describe('packCacheUsage', () => {
  it('counts only entries under the base', async () => {
    caches.store.set(`${BASE}pack.js`, new Response('x', { headers: { 'content-length': '100' } }));
    caches.store.set('https://other.example/x.js', new Response('y'));
    const usage = await packCacheUsage(BASE);
    expect(usage.entries).toBe(1);
    expect(usage.bytes).toBe(100);
  });
});

describe('forgetPack', () => {
  it('deletes every entry under the base and nothing else', async () => {
    caches.store.set(`${BASE}pack.js`, new Response('x'));
    caches.store.set(`${BASE}chunks/a.js`, new Response('x'));
    caches.store.set('https://other.example/x.js', new Response('y'));
    const removed = await forgetPack(BASE);
    expect(removed).toBe(2);
    expect(caches.store.has('https://other.example/x.js')).toBe(true);
  });
});

describe('announcePackBases', () => {
  it('posts to the controlling worker', () => {
    const postMessage = vi.fn();
    (globalThis as Record<string, unknown>).navigator = {
      serviceWorker: { controller: { postMessage }, ready: Promise.resolve({ active: null }) },
    };
    announcePackBases([BASE]);
    expect(postMessage).toHaveBeenCalledWith({ type: 'PACK_BASES', bases: [BASE] });
    delete (globalThis as Record<string, unknown>).navigator;
  });

  it('is a no-op with no service worker, rather than a throw on the boot path', () => {
    expect(() => announcePackBases([BASE])).not.toThrow();
  });
});

describe('the cache name', () => {
  it('matches the literal the worker uses', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sw = readFileSync(join(__dirname, '../../src/sw.ts'), 'utf8');
    // The worker is a separate TypeScript program (`tsconfig.sw.json`) and
    // cannot import from `src/content/`. Two literals, one meaning — a
    // mismatch is a cache the page fills and the worker never reads, which is
    // silent and offline-only.
    expect(sw).toContain(`'${PACK_CACHE_NAME}'`);
  });
});
```

- [ ] **Step 2: Run it and read the failure**

```bash
npx vitest run tests/content/packCache.test.ts 2>&1 | tail -30
```

Expected: `Failed to load url @/content/packCache`.

- [ ] **Step 3: Write `src/content/packCache.ts`**

```ts
/**
 * The page's half of the pack cache. The worker's half is `src/sw.ts`.
 *
 * The split is the design: **the page decides what is a pack file, the worker
 * only serves.** The page is the side that knows — it fetched the manifest,
 * resolved the base, and holds the installed list — and the worker is the
 * side that has to answer a request with the network off. Sending the bases
 * one way, in one message, is the whole protocol.
 *
 * The rejected alternative is the one spec §6 names: a `CacheFirst` rule
 * matching every cross-origin request. Beyond being broader than anything
 * anyone intended, it is not even correct here — core and the pack are served
 * from the *same origin* in production
 * (`hoangtran99.is-a.dev/moba2d-core/` and `/moba2d-content-riot/`), so
 * "cross-origin" identifies neither. The match is on base-URL prefix.
 *
 * Nothing in this module throws. It is reached from `LoadingScene.boot()`,
 * where a rejection is an unhandled one and the menu never opens, and from a
 * UI that must survive a browser with `CacheStorage` disabled. Every failure
 * is counted and returned.
 */

/**
 * Where a pack's bytes live. Versioned in the name so a future change of
 * layout can be a new cache rather than a migration.
 *
 * **Also a literal in `src/sw.ts`.** The worker is a separate TypeScript
 * program (`tsconfig.sw.json`, WebWorker lib) and cannot import from here;
 * `tests/content/packCache.test.ts` asserts the two agree.
 */
export const PACK_CACHE_NAME = 'lol2d-packs-v1';

/** How many files are fetched at once. */
export const PREFETCH_CONCURRENCY = 4;

/** What one prefetch did. Every field is a count, so a caller can report it. */
export interface PrefetchReport {
  base: string;
  requested: number;
  added: number;
  skipped: number;
  failed: number;
}

/**
 * A pack's base URL: the directory its manifest sits in, trailing slash kept.
 *
 * The slash is load-bearing. The worker's route is a prefix test, so a base of
 * `https://host/riot` would also claim `https://host/riot-anything/`.
 *
 * Answers `''` for anything that is not an absolute URL, rather than throwing:
 * this is called with whatever was in `localStorage`.
 */
export function packBaseFor(manifestUrl: string): string {
  try {
    return new URL('./', manifestUrl).href;
  } catch {
    return '';
  }
}

/**
 * Tells the service worker which base URLs belong to packs.
 *
 * Fire-and-forget by design — there is nothing to await and nothing a caller
 * could do about a failure. A page with no worker (dev, or a browser without
 * one) simply has no offline story, which is the same as today.
 */
export function announcePackBases(bases: readonly string[]): void {
  const message = { type: 'PACK_BASES', bases: [...bases] };
  try {
    const container = navigator?.serviceWorker;
    if (!container) return;
    if (container.controller) {
      container.controller.postMessage(message);
      return;
    }
    // No controller yet — first load, before the worker has taken over. The
    // registration's active worker still receives messages, and this is the
    // launch where a first install most needs them.
    void container.ready.then(registration => registration.active?.postMessage(message)).catch(() => {});
  } catch {
    // No `navigator`, no worker, a blocked API. Costs offline, nothing else.
  }
}

/** `caches.open(PACK_CACHE_NAME)`, or null wherever `CacheStorage` is not a thing. */
async function openPackCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(PACK_CACHE_NAME);
  } catch {
    return null;
  }
}

/**
 * Pulls every file a pack declared into the cache, in the background.
 *
 * The point is the *unplayed* champion. What a match fetches on its own is the
 * champion the player already picked; the other 237 chunks have never been
 * requested, so they have never been cached, so the first offline match can
 * only field what has already been played. Spec §6 calls that the hole that
 * the 17× saving from code-splitting opens, and this is the price paid behind
 * the player's back rather than in front of them.
 *
 * Deliberately not `cache.addAll`: that is all-or-nothing, and one 404 in 590
 * files would discard the other 589.
 */
export async function prefetchPackFiles(
  base: string,
  files: readonly string[]
): Promise<PrefetchReport> {
  const report: PrefetchReport = { base, requested: files.length, added: 0, skipped: 0, failed: 0 };
  const cache = await openPackCache();
  if (!cache || !base) {
    report.failed = files.length;
    return report;
  }

  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= files.length) return;
      const relative = files[index];

      let url: string;
      try {
        url = new URL(relative, base).href;
      } catch {
        report.failed++;
        continue;
      }
      // A manifest is a stranger's file, and `new URL('../../x', base)` is a
      // perfectly ordinary resolve. The base is what the worker will later
      // serve from cache without asking anything else, so nothing outside it
      // is allowed in.
      if (!url.startsWith(base)) {
        report.failed++;
        continue;
      }

      try {
        if (await cache.match(url)) {
          report.skipped++;
          continue;
        }
        const response = await fetch(url, { credentials: 'omit' });
        // An opaque response cannot be `put` (it throws), and would be
        // useless anyway — the pack hosts send `access-control-allow-origin`,
        // so anything opaque here is a misconfigured host worth counting.
        if (!response.ok || response.type === 'opaque') {
          report.failed++;
          continue;
        }
        await cache.put(url, response);
        report.added++;
      } catch {
        report.failed++;
      }
    }
  };

  await Promise.all(Array.from({ length: PREFETCH_CONCURRENCY }, worker));
  return report;
}

/**
 * How much of the cache one pack occupies — the "dung lượng" column of spec
 * §7's list.
 *
 * Read off `content-length` rather than by reading each body: 590 entries
 * decoded to blobs is real work for a number rendered in megabytes. A host
 * that omits the header contributes 0, so this is a floor, and the screen
 * says so.
 */
export async function packCacheUsage(base: string): Promise<{ entries: number; bytes: number }> {
  const cache = await openPackCache();
  if (!cache || !base) return { entries: 0, bytes: 0 };
  let entries = 0;
  let bytes = 0;
  try {
    for (const request of await cache.keys()) {
      if (!request.url.startsWith(base)) continue;
      entries++;
      const response = await cache.match(request);
      const length = Number(response?.headers.get('content-length') ?? 0);
      if (Number.isFinite(length)) bytes += length;
    }
  } catch {
    // A partial count is still worth showing.
  }
  return { entries, bytes };
}

/** Drops every cached byte of one pack. Returns how many entries went. */
export async function forgetPack(base: string): Promise<number> {
  const cache = await openPackCache();
  if (!cache || !base) return 0;
  let removed = 0;
  try {
    for (const request of await cache.keys()) {
      if (!request.url.startsWith(base)) continue;
      if (await cache.delete(request)) removed++;
    }
  } catch {
    // Nothing to do about it; the store is the player's disk.
  }
  return removed;
}
```

- [ ] **Step 4: Add the worker's route**

Append to `src/sw.ts`, **below** the Font Awesome rule (first match wins, and the CDN keeps its own cache):

```ts
/* ------------------------------------------------------------------ packs */

/**
 * A content pack's bytes. See `src/content/packCache.ts` for the other half
 * of this — the page fills this cache, and this route is what serves it back
 * with the network off.
 *
 * **The name is a literal here and a constant there**, because this file is
 * its own TypeScript program (`tsconfig.sw.json`) and cannot import from
 * `src/content/`. `tests/content/packCache.test.ts` asserts the two agree.
 */
const PACK_CACHE_NAME = 'lol2d-packs-v1';

/**
 * The base URLs the page has told us belong to packs, and where that list is
 * kept so a restarted worker still knows.
 *
 * A prefix test, not an origin test: in production core and the pack are
 * served from the *same* origin under different paths, so an origin test
 * would claim core's own un-precached requests. And spec §6 rules out the
 * broad shape outright.
 */
const PACK_BASES_KEY = new URL('__lol2d_pack_bases__', self.registration.scope).href;
const packBases: string[] = [];

function rememberBases(bases: unknown): void {
  packBases.length = 0;
  if (!Array.isArray(bases)) return;
  for (const base of bases) {
    if (typeof base === 'string' && base.length > 0) packBases.push(base);
  }
}

/**
 * Reads the stored list at module scope, so a worker the browser restarted —
 * which does not re-run `activate` — still matches pack requests.
 *
 * There is a race and it is bounded: a fetch that arrives before this
 * resolves does not match, so it goes to the network, which is exactly the
 * behaviour before this feature existed. In practice the first event a
 * restarted worker sees is a navigation, and a pack chunk is asked for
 * seconds later.
 */
const basesLoaded = (async () => {
  try {
    const cache = await caches.open(PACK_CACHE_NAME);
    const stored = await cache.match(PACK_BASES_KEY);
    if (stored) rememberBases(await stored.json());
  } catch {
    // An unreadable list costs offline packs, never the app.
  }
})();

self.addEventListener('install', event => event.waitUntil(basesLoaded));
self.addEventListener('activate', event => event.waitUntil(basesLoaded));

self.addEventListener('message', event => {
  const data = event.data as { type?: string; bases?: unknown } | null;
  if (!data || data.type !== 'PACK_BASES') return;
  rememberBases(data.bases);
  event.waitUntil(
    caches
      .open(PACK_CACHE_NAME)
      .then(cache =>
        cache.put(
          PACK_BASES_KEY,
          new Response(JSON.stringify(packBases), {
            headers: { 'content-type': 'application/json' },
          })
        )
      )
      .catch(() => {})
  );
});

/**
 * `CacheFirst`, and with no `ExpirationPlugin` on purpose. Every file under a
 * base is content-hashed by the pack's own build, so a stale entry is not a
 * thing that can happen — and an entry cap would evict the very chunks the
 * prefetch just spent a megabyte fetching. Removal is the player's, through
 * the packs screen.
 */
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' && packBases.some(base => url.href.startsWith(base)),
  new CacheFirst({
    cacheName: PACK_CACHE_NAME,
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
  })
);
```

- [ ] **Step 5: Accept `files` in the manifest**

In `src/content/packSource.ts`, add to `RuntimePackManifest` after `champions?: number;`:

```ts
  /**
   * Every file the pack published, relative to this manifest — spec §3.1.
   * Optional: a pack without it installs and plays, and simply has nothing
   * prefetched for offline.
   */
  files?: string[];
```

and in `fetchPackManifest`, beside the `champions` check:

```ts
    if (candidate.files !== undefined && !Array.isArray(candidate.files)) {
      throw new PackLoadError('manifest', 'manifest.files must be an array when present');
    }
```

Then, immediately before `return manifest;`, narrow the list rather than trusting it — a non-string in the array would reach `new URL(…)` as a `[object Object]` path:

```ts
    if (Array.isArray(manifest.files)) {
      // A plain loop, not `.filter`: `Array.prototype.filter` is polyfilled in
      // this project and cannot narrow a type (CLAUDE.md).
      const paths: string[] = [];
      for (const entry of manifest.files) {
        if (typeof entry === 'string' && entry.length > 0) paths.push(entry);
      }
      manifest.files = paths;
    }
```

Add a case to `tests/content/packSource.test.ts` covering both: a manifest with `files: 'nope'` is refused with stage `manifest`, and one with `files: ['a.js', 42]` keeps only `'a.js'`.

- [ ] **Step 6: Run the tests**

```bash
npx vitest run tests/content/packCache.test.ts tests/content/packSource.test.ts 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 7: Prove two of them can fail**

Both of these have already shipped as checks that could not fail in this repository, so prove these two specifically:

1. Change `PACK_CACHE_NAME` in `src/sw.ts` to `'lol2d-packs-v2'`. Re-run — "matches the literal the worker uses" must fail. Restore.
2. Delete the `if (!url.startsWith(base))` guard in `prefetchPackFiles`. Re-run — "refuses a path that escapes the base" must fail. Restore.

Report both messages.

- [ ] **Step 8: Gate and commit**

```bash
npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"
git add src/content/packCache.ts src/content/packSource.ts src/sw.ts \
        tests/content/packCache.test.ts tests/content/packSource.test.ts
git commit -m "feat(packs): cache a pack's bytes for offline, page-written and worker-served"
```

---

## Task 4: Prefetch after install

The wiring. After the install loop, `runtimePacks.ts` tells the worker which bases exist and starts pulling. Fire-and-forget: the menu handover must not wait for 4.7MB.

**Files:**
- Modify: `src/content/runtimePacks.ts`
- Modify: `tests/content/runtimePacks.test.ts`

**Interfaces:**
- Consumes: `packCache.ts`'s four functions, `manifest.files`.
- Produces: `window.__lol2dPackPrefetch` — an array of `PrefetchReport`, set when every prefetch has settled. Task 5's offline e2e waits on it; nothing in the app reads it.

- [ ] **Step 1: Write the failing test**

Append to `tests/content/runtimePacks.test.ts` (follow the file's existing mocking shape for `packSource`/`install`/`registry`):

```ts
describe('the offline prefetch', () => {
  it('announces every installed pack\'s base to the worker', async () => {
    // ...seed one stored pack whose manifest carries `files`, install it...
    expect(announcePackBases).toHaveBeenCalledWith(['https://packs.example/riot/']);
  });

  it('prefetches the files the manifest listed', async () => {
    expect(prefetchPackFiles).toHaveBeenCalledWith('https://packs.example/riot/', ['pack.js']);
  });

  it('does not prefetch a pack that listed nothing', async () => {
    expect(prefetchPackFiles).not.toHaveBeenCalled();
  });

  it('does not prefetch a pack that failed to install', async () => {
    expect(prefetchPackFiles).not.toHaveBeenCalled();
  });

  it('resolves before the prefetch does — the menu does not wait for 4.7MB', async () => {
    // The one that matters. `prefetchPackFiles` is made to hang; the whole
    // point is that `installRuntimePacks()` still resolves.
    let release: () => void = () => {};
    vi.mocked(prefetchPackFiles).mockImplementation(
      () => new Promise(resolve => { release = () => resolve(EMPTY_REPORT); })
    );
    await expect(installRuntimePacks()).resolves.toBeInstanceOf(Array);
    release();
  });

  it('a prefetch that rejects does not become an unhandled rejection', async () => {
    vi.mocked(prefetchPackFiles).mockRejectedValue(new Error('disk full'));
    await expect(installRuntimePacks()).resolves.toBeInstanceOf(Array);
    // and nothing thrown out of band — the suite fails on one if it happens
  });
});
```

Fill in the seeding to match the file's existing helpers; the assertions above are the contract.

- [ ] **Step 2: Run it and read the failure**

```bash
npx vitest run tests/content/runtimePacks.test.ts 2>&1 | tail -30
```

Expected: the `announcePackBases` cases fail on "number of calls: 0".

- [ ] **Step 3: Wire it in**

In `src/content/runtimePacks.ts`, add to the imports:

```ts
import {
  announcePackBases,
  packBaseFor,
  prefetchPackFiles,
  type PrefetchReport,
} from './packCache';
```

Track the bases and file lists inside the existing loop — beside the `installed.push(...)` in **both** the skip branch and the install branch:

```ts
      const base = packBaseFor(manifestUrl);
      if (base) {
        bases.push(base);
        if (manifest.files && manifest.files.length > 0) toPrefetch.push({ base, files: manifest.files });
      }
```

declaring `const bases: string[] = [];` and `const toPrefetch: { base: string; files: string[] }[] = [];` beside `installed`.

Then, after `if (anyInstalled) writeInstalledPacks(installed);` and before `return outcomes;`:

```ts
  // The worker needs the bases whether or not anything is prefetched: a chunk
  // fetched mid-match is cached by that route too, which is what makes the
  // prefetch a completeness measure rather than the only path.
  if (bases.length > 0) announcePackBases(bases);

  // **Not awaited, deliberately.** This is 4.7MB on the real pack, and the
  // menu handover is the statement after the caller's `await` on this
  // function. Spec §6: "trả sau lưng người chơi thay vì trước mặt". The
  // `catch` is what keeps a rejected prefetch from becoming an unhandled
  // rejection on the boot path — `prefetchPackFiles` counts its own failures
  // and should never reject, and this is the belt that makes that a fact
  // rather than a comment.
  if (toPrefetch.length > 0) {
    void Promise.all(toPrefetch.map(pack => prefetchPackFiles(pack.base, pack.files)))
      .then(reports => publishPrefetchReports(reports))
      .catch(thrown => console.error('[packs] prefetch threw', thrown));
  }
```

and beneath the file's other exports:

```ts
/**
 * What the background prefetch did, on a global.
 *
 * Same reasoning as `packBanner.ts`'s `__lol2dPackInstall`, and the same bill
 * already paid once: an install whose only voice was `console.warn` reported
 * itself green through a Playwright run that had no way to hear it. An
 * offline check in particular cannot be written at all without a signal for
 * "the prefetch has finished" — the alternative is a sleep, which is a check
 * that passes on a slow machine by accident.
 */
const PACK_PREFETCH_GLOBAL = '__lol2dPackPrefetch';

function publishPrefetchReports(reports: PrefetchReport[]): void {
  (globalThis as Record<string, unknown>)[PACK_PREFETCH_GLOBAL] = reports;
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/content/runtimePacks.test.ts 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Prove the "does not wait" case can fail**

Change the wiring to `await Promise.all(...)`, re-run, confirm "resolves before the prefetch does" times out. Restore. Report the message.

- [ ] **Step 6: Gate and commit**

```bash
npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"
git add src/content/runtimePacks.ts tests/content/runtimePacks.test.ts
git commit -m "feat(packs): prefetch a pack's files in the background after install"
```

---

## Task 5: Prove it offline, in a real browser

Everything above is invisible to Vitest by construction — it needs a real service worker, a real `CacheStorage`, and a real offline toggle. This is spec §10's row "Offline lần hai vẫn chơi được tướng đã tải", and it is the only check in this plan that can see the feature actually work.

**Files:**
- Modify: `tests/e2e/verify-pwa-offline.mjs`
- Modify: `tests/e2e/verify-runtime-pack.mjs` (the hard-coded pack path)
- Modify: `package.json` (nothing new — `e2e:pwa` already covers it)

**Interfaces:**
- Consumes: `window.__lol2dPackPrefetch` (Task 4), `manifest.files` (Task 2), the pack's built `dist/`.

- [ ] **Step 1: Stop hard-coding the pack's path**

`tests/e2e/verify-runtime-pack.mjs:47` reads:

```js
const PACK_DIST = '/Users/hoangtran/Desktop/Github/moba2d-content-riot/dist';
```

Replace, in that file and in the new code below, with:

```js
/**
 * The pack repository's built output. An absolute path in one developer's
 * home directory was fine while this was the only script that needed it and
 * it ran on one machine; two scripts and a second machine is where it stops
 * being fine. `LOL2D_PACK_DIST` overrides; the default is the sibling
 * checkout, which is how both repositories are actually laid out.
 */
const PACK_DIST =
  process.env.LOL2D_PACK_DIST ??
  join(process.cwd(), '..', 'moba2d-content-riot', 'dist');
```

- [ ] **Step 2: Write the failing check**

In `tests/e2e/verify-pwa-offline.mjs`, add a static pack server (same shape as `verify-runtime-pack.mjs`'s, including the query-strip-then-`extname` fix and `access-control-allow-origin: *`), seed the store and the match config before the first navigation, and add these checks after the existing offline block:

```js
  // ------------------------------------------------- a pack, with no network
  //
  // The existing offline checks above prove the *app* opens. This proves the
  // part Plan 2 exists for: a champion whose code arrived over the network,
  // in a match, with the network cut. The distinction matters because the two
  // fail separately — core precaches itself and would keep passing every
  // check above with the pack cache entirely empty.
  check(
    'the prefetch reported itself',
    Array.isArray(prefetch) && prefetch.length === 1,
    JSON.stringify(prefetch)
  );
  check(
    'and it pulled the pack in whole',
    prefetch?.[0]?.failed === 0 && prefetch?.[0]?.added > 500,
    `added=${prefetch?.[0]?.added} failed=${prefetch?.[0]?.failed}`
  );

  check('the pack roster is there offline', offlineChampions > 50, `${offlineChampions}`);
  check(
    'a pack champion takes the field offline',
    offlineMatch.name === 'Ahri',
    JSON.stringify(offlineMatch.name)
  );
  check(
    "and her four slots hold her own abilities, not core's fallback",
    offlineMatch.casts.length === 4 &&
      offlineMatch.casts.every(cast => cast.name && cast.name !== BASIC_ATTACK_NAME),
    offlineMatch.casts.map(cast => cast.name).join(' / ')
  );
```

The seed, before the first `page.goto`:

```js
await page.addInitScript(
  ([packKey, packUrl, cfgKey, cfg]) => {
    window.localStorage.setItem(
      packKey,
      JSON.stringify([{ manifestUrl: packUrl, id: 'riot', version: '1.0.0' }])
    );
    window.localStorage.setItem(cfgKey, JSON.stringify(cfg));
  },
  ['lol2d:packs:v1', PACK_URL, 'lol2d:pregameConfig:v1', CFG_SEED]
);
```

with

```js
/**
 * `mode: 'champion'` + a named `championName` is the whole configuration —
 * `PregameConfig.ts:88` — so the match opens on Ahri's own avatar and Q/W/E/R
 * with no pregame-screen interaction at all. `verify-runtime-pack.mjs` drives
 * the kit modal instead because it is also testing that screen; here the
 * modal is not the subject and every click is one more thing to go wrong with
 * the network off.
 */
const CFG_SEED = {
  player: {
    mode: 'champion',
    championName: 'Ahri',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  },
  ai: { count: 0, autoMove: false, autoAttack: false, autoCast: false, bots: [] },
  rules: { cooldownReductionPercent: 0, manaFree: true },
  world: { jungle: false, minions: false },
};
```

And, **while still online**, wait for the prefetch rather than sleeping:

```js
  const prefetch = await page.waitForFunction(() => window.__lol2dPackPrefetch ?? null, null, {
    timeout: 180_000,
  }).then(handle => handle.jsonValue());
```

- [ ] **Step 3: Run it and read the failure**

```bash
npm run build && node tests/e2e/verify-pwa-offline.mjs 2>&1 | tail -30
```

Expected: the new checks fail — most usefully, `a pack champion takes the field offline` — because at this point the dist under test is core-only *and* the pack was still compiled in by CI, so exactly which of the new checks fails first is information. Record it.

- [ ] **Step 4: Make it pass**

No new source is expected here; Tasks 1–4 are the implementation. What this step covers is the debugging that a first real-browser run always produces. Two failures to expect and their causes:

- **The pack's own asset URLs are absolute to the pack host.** The pack builds with `base: ''` so Vite emits `new URL('./assets/x.png', import.meta.url)`; that resolves against the pack's origin at runtime, which is what the base-prefix route is built for. If art is missing offline, check the base the page announced (`window.__lol2dPackPrefetch[0].base`) against a real asset URL from `AssetManager`.
- **The worker is not in control on the first load.** The existing script already reloads once for exactly this reason. The prefetch runs on the *first* load, when the page may be uncontrolled — which is fine, because `packCache.ts` writes the cache itself rather than relying on the route.

- [ ] **Step 5: Prove the offline check can fail**

The single most valuable thing this task can produce. Comment out the `void Promise.all(...)` prefetch call in `runtimePacks.ts`, rebuild, re-run: `and it pulled the pack in whole` and `a pack champion takes the field offline` must both fail. Restore, rebuild, re-run green. **Paste both outputs into the task report** — this is the evidence that the offline claim is checked rather than asserted.

- [ ] **Step 6: Gate and commit**

```bash
npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"
git add tests/e2e/verify-pwa-offline.mjs tests/e2e/verify-runtime-pack.mjs
git commit -m "test(e2e): play a URL-fetched champion with the network cut"
```

---

## Task 6: The packs screen — list and remove

Spec §7's first and third jobs, plus the scene plumbing the fourth needs. Adding by URL is Task 7, so this task ships a screen that shows what a player already has and lets them get rid of it.

Its own scene, not a config tab: `.pregame-tab` is `flex: 1` and 390px holds three tabs plus the close button.

**Files:**
- Create: `src/scenes/PacksScene.ts`
- Create: `src/scenes/PacksScene.vue`
- Create: `styles/packs-scene.css`
- Create: `tests/scenes/packsBootPath.test.ts`
- Modify: `index.html`
- Modify: `src/scenes/MenuScene.ts`, `src/scenes/MenuScene.vue`
- Modify: `scripts/check-chunks.mjs`

**Interfaces:**
- Consumes: `readInstalledPacks`/`writeInstalledPacks` (`installedPackStore.ts`), `packBaseFor`/`packCacheUsage`/`forgetPack` (`packCache.ts`).
- Produces: `PacksScene` (default export, a `Scene`), reached from `MenuScene.ts` by `import('./PacksScene')`. Task 7 adds the add-by-URL flow to `PacksScene.vue`.

- [ ] **Step 1: Write the failing test**

Create `tests/scenes/packsBootPath.test.ts`, modelled on `tests/scenes/aboutBootPath.test.ts` (read it first — the `scanImports`/`stripComments` helpers and the "the scan can see a violation it is meant to catch" case are the shape to copy):

```ts
/**
 * The packs screen is reached from the menu, before any match exists, so
 * nothing under it may statically import a `src/game/` runtime value — one
 * such import puts the whole match in the chunk a player downloads to read a
 * list of installed packs.
 *
 * It is a real risk here rather than a theoretical one, and more so than for
 * the About screen: installing a pack for real needs `buildContentApi()` and
 * `rebuildContentRegistry()`, which live in `runtimePacks.ts` — pinned to the
 * `game` chunk in `vite.config.ts` precisely because they do. The sanctioned
 * crossing is a dynamic `import()` at the moment a player presses install,
 * and this test plus `chunks:check`'s `PacksScene` rule are the two things
 * that keep it dynamic.
 */
```

Cases:
1. finds the files it claims to check (`scenes/PacksScene.ts`, `scenes/PacksScene.vue`, plus every `.ts`/`.vue` under `scenes/packs/`, asserting that directory contributed at least one once Task 7 lands — until then assert the two named files read).
2. no packs-screen module statically imports `@/game/` or `/game/`.
3. no packs-screen module statically imports `@/content/runtimePacks` (the `game`-pinned one) — dynamic only.
4. `MenuScene.ts` reaches it only through `import('./PacksScene')`.
5. the scan can see a violation it is meant to catch.

- [ ] **Step 2: Run it and read the failure**

```bash
npx vitest run tests/scenes/packsBootPath.test.ts 2>&1 | tail -20
```

Expected: `ENOENT ... src/scenes/PacksScene.ts`.

- [ ] **Step 3: Add the host and the stylesheet**

In `index.html`, after the `#about-scene` div:

```html
        <!-- Mount host for PacksScene.vue, which renders the contents. -->
        <div id="packs-scene"></div>
```

and beside the other scene stylesheets in `<head>`:

```html
    <link rel="stylesheet" href="styles/packs-scene.css">
```

- [ ] **Step 4: Write the scene**

Create `src/scenes/PacksScene.ts`, modelled on `AboutScene.ts` — mount in `enter()`, unmount in `exit()`, `onClose` returns to the menu by dynamic import. Its doc comment must state the constraint the boot-path test enforces and why (copy the reasoning from Step 1's comment).

- [ ] **Step 5: Write the list**

Create `src/scenes/PacksScene.vue`. State it needs, all local to the component except where noted:

```ts
interface PackRow {
  manifestUrl: string;
  id: string;
  version: string;
  /** The origin, unabbreviated. The whole reason this screen exists. */
  origin: string;
  base: string;
  entries: number;
  bytes: number;
}
```

Behaviour:
- `onMounted`: read `readInstalledPacks()`, derive `base`/`origin` for each with `packBaseFor` + `new URL(...).origin`, then fill `entries`/`bytes` from `packCacheUsage(base)` (async, per row, so one slow read does not hold the list).
- Render each row: pack id and version, then the **origin on its own line, full, never truncated** (`word-break: break-all` in the CSS rather than an ellipsis — an elided origin is the one thing this screen may not do), then `n tệp · ~X MB` with the tilde, because `content-length` is a floor.
- A "Gỡ" button per row, behind a two-step confirm (the second press is the destructive one), matching the exit-match control's shape in the Trận đấu tab.
- Removing: `forgetPack(base)`, `writeInstalledPacks(remaining)`, then `location.reload()`.

The reload is not laziness and the comment must say so:

```ts
/**
 * Removal reloads; adding (Task 7) does not.
 *
 * `rebuildContentRegistry()` discards the registry and reinstalls the bundled
 * halves — so after a removal it would leave the *other* still-installed
 * runtime packs out until something reinstalled them, and the thing that
 * reinstalls them is the boot path. Adding is additive and has no such
 * problem: the new pack installs into the live registry beside everything
 * already there, which is what spec §5.2 asks for.
 */
```

- Empty state: "Chưa cài pack nào." plus, once Task 7 lands, the add field beneath it. Until then, a line pointing at the default pack URL.
- A back button (`#packs-close`) emitting `close`.
- Every button carries `@touchend.prevent` beside `@click`.

- [ ] **Step 6: Write `styles/packs-scene.css`**

Model on `styles/about-scene.css`: the same panel/header/body shape, `overflow-y: auto` on the body (no hand-rolled touch scrolling — this scene is a sibling of `#game-scene`, never mounted inside it, so no `touch-action: none` ancestor is in play; `AboutScene.vue`'s header explains the distinction). Add `word-break: break-all` on the origin line.

- [ ] **Step 7: Put it on the menu**

`MenuScene.ts`: add an `onOpenPacks` prop mapping to `void import('./PacksScene').then(module => this.sceneManager.showScene(module.default))`.

`MenuScene.vue`: add `openPacks: []` to the emits, and a button beside `#about-btn`:

```html
  <button id="packs-btn" title="Nội dung / Pack" @click="emit('openPacks')" @touchend.prevent="emit('openPacks')">
    <i class="fas fa-cubes" aria-hidden="true"></i>
  </button>
```

Position it in `styles/menu-scene.css` beside the about and fullscreen buttons.

**Not gated behind `ready`** — like Giới thiệu, it opens no game code, and a player whose pack failed to load is exactly the player who needs this screen before the warm-up finishes.

- [ ] **Step 8: Add the chunk rule**

In `scripts/check-chunks.mjs`'s `RULES`:

```js
  {
    chunk: 'PacksScene',
    forbidden: /^game-/,
    why:
      'the packs screen lists what is installed and needs no spell classes — and the one thing ' +
      'on it that does need `buildContentApi()` (installing a pack) reaches `runtimePacks.ts` ' +
      'through a dynamic import for exactly this reason',
  },
```

- [ ] **Step 9: Run the tests**

```bash
npx vitest run tests/scenes/packsBootPath.test.ts 2>&1 | tail -20
npm run build && npm run chunks:check
```

Expected: PASS, and `chunks:check` prints ok with the new rule finding exactly one `PacksScene-*.js`.

- [ ] **Step 10: Prove both checks can fail**

1. Add `import Champion from '@/game/gameObject/attackableUnits/Champion';` to `PacksScene.vue`'s script block. Re-run the Vitest — case 2 must fail and name the file. Then `npm run build && npm run chunks:check` — the `PacksScene` rule must fail too. Remove.
2. Report both messages. (The second is the one that matters: a source scan and a build check disagreeing is how the `__vitePreload` regression got in.)

- [ ] **Step 11: Look at it once**

```bash
npm run dev
```

Open the menu, press the new button, read the screen. One screenshot at most — a 1280x900 PNG costs about what 600 lines of source costs, and the numeric checks above are what this task is graded on. Confirm by eye only: the origin is not elided, the two-step remove reads as two steps, and the back button returns to the menu.

- [ ] **Step 12: Gate and commit**

```bash
npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"
git add src/scenes/PacksScene.ts src/scenes/PacksScene.vue styles/packs-scene.css index.html \
        src/scenes/MenuScene.ts src/scenes/MenuScene.vue styles/menu-scene.css \
        scripts/check-chunks.mjs tests/scenes/packsBootPath.test.ts
git commit -m "feat(packs): a screen listing what is installed, and removing one"
```

---

## Task 7: Add by URL, behind the origin disclosure

The part that pays for decision 2. A player types a URL; the game fetches the manifest — **plain JSON, no code has run** — and shows them who they are about to trust. Only after they press through does `import()` happen.

Spec §3's three steps are the structure, and the boundary between step 2 and step 3 is the only security boundary in the design. Do not collapse them.

**Files:**
- Create: `src/scenes/packs/PackInstallConfirm.vue`
- Create: `tests/e2e/verify-pack-management.mjs`
- Modify: `src/scenes/PacksScene.vue`
- Modify: `src/content/runtimePacks.ts`
- Modify: `package.json` (`e2e:packs`)
- Modify: `styles/packs-scene.css`

**Interfaces:**
- Consumes: `fetchPackManifest`, `loadPackFromManifest`, `PackLoadError` (`packSource.ts`); `installRuntimePack` (`install.ts`); `rebuildContentRegistry` (`registry.ts`); `announcePackBases`, `prefetchPackFiles`, `packBaseFor` (`packCache.ts`).
- Produces: `installPackNow(manifestUrl: string, manifest: RuntimePackManifest): Promise<PackInstallOutcome>` in `runtimePacks.ts` — the single-pack, no-reload install. Reached from the UI by `await import('@/content/runtimePacks')`.

- [ ] **Step 1: Write the failing e2e**

Create `tests/e2e/verify-pack-management.mjs`, using `startHarness()` and the same static pack server as `verify-runtime-pack.mjs`. One `guard()` call wrapping everything — `guard` ends in `finish()`, which calls `process.exit()`, so a second `await guard(...)` never runs.

Checks, in order:

```js
check('the packs screen opens from the menu', ...);
check('it starts empty when nothing is installed', ...);

// Paste the URL and press Cài đặt.
check('pasting a URL shows a confirmation before anything runs', confirmVisible);
check('the confirmation states the origin, in full', confirmOrigin === 'http://localhost:4399');
check('and the pack name and version', ...);
check('and the core compatibility result', ...);
check('and says plainly that the pack runs with full authority', /toàn quyền/.test(confirmText));

// The boundary: nothing has run yet.
check(
  'no pack code has run at the point of asking',
  rosterBefore === 1,
  `roster = ${rosterBefore}`
);

// Press through.
check('confirming installs it', ...);
check('the roster grows without a reload', rosterAfter > 50, `${rosterBefore} -> ${rosterAfter}`);
check('and the screen now lists it with its origin', ...);

// Cancel path, on a second attempt.
check('cancelling installs nothing', ...);

// Remove.
check('removing it empties the list', ...);
check('and the roster is back to core alone', rosterAfterRemove === 1);

check('nothing went wrong on the page', errors.length === 0, errors.join(' | '));
```

`rosterBefore`/`rosterAfter` come from the pregame screen's kit shelves, the same way `verify-runtime-pack.mjs` reads them (`.kit-shelf[data-champion]`).

Add to `package.json`: `"e2e:packs": "node tests/e2e/verify-pack-management.mjs"`.

- [ ] **Step 2: Run it and read the failure**

```bash
npm run e2e:packs 2>&1 | tail -30
```

Expected: fails at `pasting a URL shows a confirmation` — there is no add field yet.

- [ ] **Step 3: The single-pack install**

Add to `src/content/runtimePacks.ts`:

```ts
/**
 * Installs one pack into the live registry, without a reload — spec §5.2.
 *
 * Takes the manifest rather than fetching it, because the caller has already
 * fetched it: spec §3 splits the fetch from the import precisely so a player
 * can be shown the origin in between, and a function that did both would put
 * that screen back inside the same call it exists to interrupt.
 *
 * Everything after this point is what `installRuntimePacks` does per pack,
 * minus the loop: the same duplicate-id skip, the same registry, the same
 * store write, the same base announcement and prefetch.
 */
export async function installPackNow(
  manifestUrl: string,
  manifest: RuntimePackManifest
): Promise<PackInstallOutcome> {
  try {
    const registry = contentRegistry();
    if (registry.hasPack(manifest.id)) {
      return { manifestUrl, ok: true, id: manifest.id, skipped: true };
    }
    const pack = await loadPackFromManifest(manifest, manifestUrl);
    installRuntimePack(registry, buildContentApi(), pack);

    const stored = readInstalledPacks();
    // A plain loop, not `.filter` — see CLAUDE.md.
    const next: InstalledPackRecord[] = [];
    for (const record of stored) {
      if (record.manifestUrl !== manifestUrl) next.push(record);
    }
    next.push({ manifestUrl, id: manifest.id, version: manifest.version });
    writeInstalledPacks(next);

    const base = packBaseFor(manifestUrl);
    if (base) {
      // Every base, not just this one: the message replaces the worker's whole
      // list, so sending one would drop the packs installed at boot.
      const bases: string[] = [];
      for (const record of next) {
        const recordBase = packBaseFor(record.manifestUrl);
        if (recordBase) bases.push(recordBase);
      }
      announcePackBases(bases);
      if (manifest.files && manifest.files.length > 0) {
        void prefetchPackFiles(base, manifest.files).catch(() => {});
      }
    }
    return { manifestUrl, ok: true, id: manifest.id };
  } catch (thrown) {
    const error = thrown as PackLoadError;
    return { manifestUrl, ok: false, stage: error.stage ?? 'import', message: error.message };
  }
}
```

Note `contentRegistry()` rather than `rebuildContentRegistry()`: the live registry already holds core, the reference pack and every boot-time pack, and installing into it is exactly additive. Rebuilding would discard and reinstall all of them for no gain.

Add unit cases to `tests/content/runtimePacks.test.ts`: it installs into the existing registry, it appends to the store without duplicating an existing URL, it announces **every** base rather than only the new one, and a rejected `loadPackFromManifest` comes back as `ok: false` with its stage rather than throwing.

- [ ] **Step 4: Write the confirmation**

Create `src/scenes/packs/PackInstallConfirm.vue`. Props: `{ manifestUrl: string; manifest: RuntimePackManifest; coreVersion: string }`. Emits `confirm` and `cancel`.

Its header comment carries the reason it is its own file:

```
/**
 * The screen that pays for "any URL may be installed".
 *
 * Spec §2.1 is explicit that `validate.ts` stops a pack that is the wrong
 * *shape*, and stops nothing that is deliberately hostile: a pack is
 * JavaScript running in the player's page, on the page's origin, with the
 * page's `localStorage` and the page's DOM. A real sandbox was considered and
 * ruled out — spells draw with p5 globals and a Worker cannot draw — so the
 * mitigation is not defence, it is disclosure: the player is told whose code
 * they are about to run, before it runs.
 *
 * Which makes the *order* of what is on screen part of the contract, not
 * styling. The origin is first, largest, and never elided; a shortened origin
 * is precisely the trick this screen exists to defeat.
 *
 * Its own component rather than a block inside `PacksScene.vue` so that
 * editing the list, the empty state or the remove button cannot quietly
 * reword this.
 */
```

Layout, in this order:
1. The **origin**, largest type on the screen, `word-break: break-all`, no ellipsis, no `text-overflow`.
2. Name and version.
3. `coreRange` result — "Tương thích với core X" or a refusal (the button is disabled in that case; `satisfiesCoreRange` has already been applied by `fetchPackManifest`, so reaching this component with an incompatible pack should be impossible — render the refusal anyway rather than assuming).
4. Champion count, when the manifest declared one.
5. The sentence, verbatim: *"Pack sẽ chạy với toàn quyền trên trang này — đọc và sửa được cấu hình, giao diện và dữ liệu của bạn. Chỉ cài từ nguồn bạn tin."*
6. Two buttons: "Huỷ" (default-looking) and "Cài đặt" (destructive-looking, and the one that runs code).

The full manifest URL goes beneath, dimmed — the origin is the security-relevant part, the path is context.

- [ ] **Step 5: Wire the add flow into `PacksScene.vue`**

- An `<input type="url">` (`#pack-url-input`) plus a "Kiểm tra" button (`#pack-url-check`).
- On press: `const { fetchPackManifest } = await import('@/content/packSource');` — dynamic, so `packSource.ts`'s chunk is not on the menu's path — then `await fetchPackManifest(url)`. On a `PackLoadError`, show its `stage` and message inline and do not open the confirmation.
- On success, open `PackInstallConfirm`.
- On `confirm`: `const { installPackNow } = await import('@/content/runtimePacks');` — **dynamic, and the boot-path test forbids the static form** — then apply the outcome to the list and clear the input.
- On `cancel`: close, change nothing.

A busy flag disables both buttons while a fetch is in flight; `PACK_LOAD_TIMEOUT_MS` is 15s and a second press would start a second install.

- [ ] **Step 6: Run the e2e**

```bash
npm run e2e:packs 2>&1 | tail -30
```

Expected: PASS, every check.

- [ ] **Step 7: Prove the boundary check can fail**

This is the one that matters in this task. Change `PacksScene.vue` so pressing "Kiểm tra" calls `installPackNow` directly, skipping the confirmation. Re-run: `no pack code has run at the point of asking` must fail with a roster already > 50. Restore, re-run green, and **paste both outputs into the report**.

- [ ] **Step 8: Gate and commit**

```bash
npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"
npx vitest run tests/scenes/packsBootPath.test.ts 2>&1 | tail -10
git add src/scenes/packs/PackInstallConfirm.vue src/scenes/PacksScene.vue \
        src/content/runtimePacks.ts tests/content/runtimePacks.test.ts \
        tests/e2e/verify-pack-management.mjs styles/packs-scene.css package.json
git commit -m "feat(packs): install from a URL, behind an origin disclosure"
```

---

## Task 8: Retire the compose step

Spec §11 step 8 — where GĐ1 formally stops. Core's CI stops installing a pack into the build, and the deployed game becomes what decision 1 said it would be: an engine that fetches its content at runtime, like everyone else's browser.

The default pack URL already points at the pack's own Pages deployment (`DEFAULT_PACK_URL`, set in Plan 1 after measuring the redirect chain — do not re-litigate that choice; `runtimePacks.ts`'s own header carries the `curl -sI` evidence).

**Files:**
- Modify: `.github/workflows/build.yml`
- Modify: `CLAUDE.md`
- Modify: `README.md` (if it names the compose step)

**Interfaces:** none produced.

- [ ] **Step 1: Establish the before-state, honestly**

Before deleting anything, run the whole e2e surface and write down what is green:

```bash
npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"
npm run e2e:core-alone 2>&1 | tail -5
npm run e2e:runtime-pack 2>&1 | tail -5
npm run e2e:packs 2>&1 | tail -5
npm run e2e:pwa 2>&1 | tail -5
npm run e2e:pack 2>&1 | tail -5
```

`e2e:pack` had one failing check at the Plan 1 merge (`no page errors`, branch-caused, expected to clear now that the pack is published). If it is still red, that is a finding for this task's report, not something to fix here.

- [ ] **Step 2: Delete the compose step**

Remove the whole `- name: Build the published game — core plus the content pack` step from `.github/workflows/build.yml`.

Then rewrite the long comment block beneath it (the one beginning "`npm run verify:all` runs core's own `verify`…"). It currently explains that the compose step *overwrites* the verified dist and that the composed build is what ships. That stops being true, and a stale comment here is worse than none — it is the file a future reader consults to learn how the game is published. The replacement must say:

- the dist that `verify:all` gated is now the dist that ships, with no second build
- core ships **no** content, by design (spec §2, decision 1), and installs `DEFAULT_PACK_URL` on a browser's first boot
- the composition that used to be checked here is now checked by `npm run e2e:runtime-pack` and `npm run e2e:pwa`, both of which serve the pack's real `dist/` from a second origin — and neither runs in CI, because CI has no pack checkout. **Say that out loud**: the one thing neither repository's CI can see is still the join, and it is now covered by two scripts a human runs locally. That is a real reduction in coverage and the honest place to record it is here.

- [ ] **Step 3: Update `CLAUDE.md`**

The `## Running` and CI sections describe a build that compiles a pack in. Update them to describe the runtime path: what `lol2d:packs:v1` is, that `e2e:runtime-pack`/`e2e:packs`/`e2e:pwa` need a pack checkout beside core (or `LOL2D_PACK_DIST`), and that `src/sw.ts` is hand-written with route order as its API.

- [ ] **Step 4: Prove the deployed shape is right**

```bash
npm run build
grep -c "@moba2d/content-riot" src/generated/installedPacks.ts || echo "0 — correct, core ships empty"
npm run chunks:check
node tests/e2e/verify-pwa-offline.mjs 2>&1 | tail -20
```

Expected: the barrel names no pack; `chunks:check` ok; the offline run green, including the pack-offline phase — which now runs against a genuinely pack-free dist, i.e. the real shipping artifact for the first time.

- [ ] **Step 5: Confirm the double-install is gone**

Boot the built app and read the install report:

```bash
npm run preview
# in the browser console: window.__lol2dPackInstall
```

Expected: exactly one outcome, `ok: true`, **no `skipped: true`**. Before this task the compose step put `riot` in the bundle and the runtime install found it already present, so the outcome was a skip and the pack was fetched twice — once by the build, once by the browser. Report the actual value.

`PackRegistry.hasPack` and the skip branch **stay**: two packs declaring the same id is a thing a player can now do from the UI, which is what that branch is for.

- [ ] **Step 6: The whole sweep**

Re-run everything from Step 1 and diff against what you wrote down. Any check that moved from green to red is this task's to explain.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/build.yml CLAUDE.md README.md
git commit -m "chore(ci): stop compiling the content pack into core"
```

- [ ] **Step 8: Stop and report — do not push**

The user's network cannot reach GitHub this session. Report: the branch name, the commit list, every e2e result with its numbers, and the two things that need a push to become true — core's CI running without the compose step, and (if Task 2's `files` has not been published) the live manifest still lacking `files`, which means **a browser hitting the deployed pack today prefetches nothing**. Until the pack repo's Pages deployment carries the new manifest, offline is exactly as good as it was before this plan.

---

## Self-Review

**Spec coverage.** §6 (storage and offline) → Tasks 1, 3, 4, 5. §6.1 (no CSP) → nothing added; the Global Constraints forbid it. §7 (management screen), job 1 (list) → Task 6; job 2 (add by URL) → Task 7; job 3 (remove, cache included) → Task 6; job 4 (confirm before running) → Task 7. §7's banner paragraph → already shipped in Plan 1, unchanged. §9's core file table → `vite.config.ts` (`injectManifest`) Task 1, `src/sw.ts` Task 1+3, `src/scenes/packs/*` Tasks 6–7, the CI deletion Task 8. §9's "bỏ `optimizeDeps.exclude` khi pack không còn là dependency" → **deliberately not done**: the exclusion is keyed off `installedContentPackages()`, which is already empty in this checkout, so the option is inert and deleting it would break the local compose used by `verify:pack-standalone`. Recorded here rather than silently skipped. §10's testing table → `e2e:pwa` (offline row) Task 5, and the two rows already covered by Plan 1 are untouched. §11 steps 6, 7, 8 → Tasks 1–5, 6–7, 8.

**Placeholder scan.** No "TBD"/"handle errors appropriately"/"similar to Task N". Two places name a shape rather than paste the whole file — Task 4's Vitest cases (the assertions are exact; the seeding follows the existing file's helpers, which the implementer will be reading anyway) and Task 6's `packsBootPath.test.ts` (five numbered cases against a named model file, `aboutBootPath.test.ts`). Both are deliberate: pasting a 120-line copy of a file the implementer must read regardless is the "seven agents read `Fizz_E.ts` seven times" failure in written form.

**Type consistency.** `PACK_CACHE_NAME` is one string in two places by necessity and has a test asserting they agree. `packBaseFor` returns `''` on bad input, and every consumer checks for it (`prefetchPackFiles`, `packCacheUsage`, `forgetPack`, `installPackNow`). `PrefetchReport` is defined once in `packCache.ts` and imported by `runtimePacks.ts`. `RuntimePackManifest.files` is `string[] | undefined`, narrowed in `fetchPackManifest`, and every read checks `.length > 0`. `installPackNow` takes `(manifestUrl, manifest)` in Tasks 3, 7 and the e2e alike. The worker's message type is `'PACK_BASES'` in `packCache.ts` and `src/sw.ts` and in the test.

**Ordering.** Task 1 changes no behaviour and is provable against the existing `e2e:pwa`, so the risky infrastructure move lands before anything depends on it. Task 2 (the pack repo) precedes Tasks 3–4, which consume `files`. Task 5 needs 1–4. Task 7 needs 6. Task 8 is last because it removes the fallback that has kept the deployed game working through all of it.

**The gap this plan does not close.** After Task 8 there is no automated check, in either repository's CI, that core and a pack actually compose — `e2e:runtime-pack`, `e2e:packs` and `e2e:pwa` all need a pack checkout on disk. That was true before this plan too (the compose step proved a *build*, never a boot), but Task 8 removes even the build-level one. Task 8 Step 2 requires it be written into the workflow's own comment rather than left for someone to discover.
