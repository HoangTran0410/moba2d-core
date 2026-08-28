# Runtime Pack Loading — Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player pastes a pack URL and the champion roster goes from 1 to 59, with no rebuild of core.

**Architecture:** A pack becomes a directory at a base URL — `manifest.json`, an ESM entry, its split chunks and its art. Core fetches the manifest (plain JSON, no code runs), checks compatibility, then `import()`s the entry straight from its https URL so the pack's 237 relative dynamic imports keep resolving against their own module URL. Installation happens inside `LoadingScene`, which is already an async gate; core plus the reference pack are live synchronously before it, so a failed fetch leaves a playable game rather than a dead screen.

**Tech Stack:** TypeScript, Vite (library mode with code splitting for the pack), Vitest, Playwright, p5 global mode, Vue 3 for HUD.

**Spec:** `docs/superpowers/specs/2026-08-24-runtime-pack-loading-design.md`

**Scope:** This is **Plan 1 of 2**, covering spec §11 steps 1–5. It ends with a pack installing from a URL and the roster growing. **Plan 2** covers §11 steps 6–8: `injectManifest` + a hand-written service worker, background chunk prefetch, the pack-management screen, and retiring the CI compose step. Until Plan 2 lands, the CI compose step in `.github/workflows/build.yml` stays exactly as it is and the deployed game is never worse than today.

## Global Constraints

Copied from the spec. Every task's requirements implicitly include these.

- **Two repositories.** Core is `/Users/hoangtran/Desktop/Github/moba2d-core`; the pack is `/Users/hoangtran/Desktop/Github/moba2d-content-riot`. Never edit one from a task that belongs to the other.
- **`import(blobUrl)` is forbidden.** Spec §4: a blob-loaded module resolves relative specifiers against a URL with no path, so the pack's dynamic imports die. Load the entry from its https URL.
- **A pack is a directory, not a file.** `manifest.json` + `entry` + chunks + `assets/`, all relative to the manifest's own URL.
- **No code runs before the manifest is checked.** `fetch` the manifest, verify `coreRange`, and only then `import()`.
- **Never a dead screen.** Any failure in the runtime path is caught, reported, and the game continues with whatever installed.
- **Do not touch `.github/workflows/build.yml`'s compose step** in this plan.
- **p5 runs in global mode.** `map`, `text`, `fill`, `color`, `pop`, `random`, `line`, `point`, `scale`, `rotate`, `image` are globals; never name a local after one. `tsc` cannot see the shadowing.
- **`Array.prototype.filter` cannot narrow types** (it is polyfilled). Write a plain loop, never a cast.
- **Prettier**: 2 spaces, single quotes, 100 columns. Never run `--write` across files you did not edit.
- **Commit with explicit paths.** Never `git add -A`, never `git add .`, never a bare `git commit`.
- **`npm run verify` is the gate in core** and `npm run verify` in the pack. Run before declaring a task done.

---

### Task 1: Prove the loading mechanism in a real browser

This is a **spike**. Its output is an answer, and the throwaway files it creates are deleted in its last step. Everything below it is built on the claim it tests, so if the claim is false, stop and report — do not proceed to Task 2.

**What is being tested:** that `import(httpsUrl)` of a cross-origin ES module (a) executes, (b) resolves a *relative* dynamic `import()` inside it against the module's own URL rather than the host page's, and (c) gives that module an `import.meta.url` pointing at where it was served from.

**Files:**
- Create (throwaway): `/tmp/pack-spike/fixture/entry.mjs`
- Create (throwaway): `/tmp/pack-spike/fixture/lazy.mjs`
- Create (throwaway): `/tmp/pack-spike/fixture/manifest.json`
- Create (throwaway): `/tmp/pack-spike/spike.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: a yes/no answer recorded in the task report. No code survives.

- [ ] **Step 1: Write the fixture pack — an entry whose only interesting property is that it lazily imports a sibling**

`/tmp/pack-spike/fixture/lazy.mjs`:

```js
export const marker = 'lazy-module-loaded';
export default () => 'lazy-default-called';
```

`/tmp/pack-spike/fixture/entry.mjs`:

```js
// The two things the whole design rests on: a *relative* dynamic import, and
// import.meta.url. Neither is exercised by a bundle loaded from a blob.
export const entryUrl = import.meta.url;
export const loadLazy = () => import('./lazy.mjs');
export default { name: 'spike-pack' };
```

`/tmp/pack-spike/fixture/manifest.json`:

```json
{ "id": "spike", "version": "1.0.0", "coreRange": ">=1.0.0", "entry": "entry.mjs", "assets": "assets/" }
```

- [ ] **Step 2: Write the spike — serve the fixture on one origin, load the page on another**

Two origins matter: same-origin would prove nothing about the cross-origin case, which is the real one.

`/tmp/pack-spike/spike.mjs`:

```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';

const TYPES = { '.mjs': 'text/javascript', '.json': 'application/json', '.html': 'text/html' };

function serve(root, port) {
  const server = createServer(async (req, res) => {
    try {
      const body = await readFile(join(root, req.url === '/' ? 'index.html' : req.url));
      res.writeHead(200, {
        'content-type': TYPES[extname(req.url)] ?? 'application/octet-stream',
        // The pack origin must allow the page origin to read it.
        'access-control-allow-origin': '*',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise(resolve => server.listen(port, () => resolve(server)));
}

// The page lives on 4311; the pack on 4312. Different origins on purpose.
const { mkdir, writeFile } = await import('node:fs/promises');
await mkdir('/tmp/pack-spike/page', { recursive: true });
await writeFile('/tmp/pack-spike/page/index.html', '<!doctype html><title>spike</title>');

const pageServer = await serve('/tmp/pack-spike/page', 4311);
const packServer = await serve('/tmp/pack-spike/fixture', 4312);

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:4311/', { waitUntil: 'load' });

const result = await page.evaluate(async () => {
  const base = 'http://localhost:4312/manifest.json';
  const manifest = await fetch(base).then(r => r.json());
  const entryUrl = new URL(manifest.entry, base).href;
  const mod = await import(/* webpackIgnore: true */ entryUrl);
  const lazy = await mod.loadLazy();
  return {
    entryDefault: mod.default?.name ?? null,
    importMetaUrl: mod.entryUrl ?? null,
    lazyMarker: lazy.marker ?? null,
    lazyDefault: typeof lazy.default === 'function' ? lazy.default() : null,
  };
});

const checks = [
  ['the cross-origin entry executes', result.entryDefault === 'spike-pack'],
  ['import.meta.url points at the pack origin', result.importMetaUrl === 'http://localhost:4312/entry.mjs'],
  ['a relative dynamic import inside it resolves', result.lazyMarker === 'lazy-module-loaded'],
  ['the lazily imported module is usable', result.lazyDefault === 'lazy-default-called'],
  ['no page errors', errors.length === 0],
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log('result:', JSON.stringify(result));
if (errors.length) console.log('errors:', errors);

await browser.close();
pageServer.close();
packServer.close();
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
```

- [ ] **Step 3: Run it and read every line**

```bash
cd /Users/hoangtran/Desktop/Github/moba2d-core
node /tmp/pack-spike/spike.mjs
```

Expected: five `PASS` lines and exit 0.

If `import.meta.url` comes back as the *page's* origin, or `lazyMarker` is `null`, the design's central claim is false. **Stop, and report exactly which check failed and what `result` contained.** Do not start Task 2.

- [ ] **Step 4: Prove the spike can fail, so a pass means something**

Change `loadLazy` in `entry.mjs` to `() => import('./does-not-exist.mjs')` and re-run. Expected: the run throws or `lazyMarker` is `null`, and the script exits non-zero. Then put it back and confirm it passes again.

A check that has never been seen red is not a check.

- [ ] **Step 5: Delete the spike and record the answer**

```bash
rm -rf /tmp/pack-spike
```

Nothing is committed. Write into the task report: the five check results, the literal `result` object, and one sentence on whether Task 2 may begin.

---

### Task 2: The pack builds to a loadable directory

**Repository: `/Users/hoangtran/Desktop/Github/moba2d-content-riot`.**

Today the pack ships raw TypeScript: no `build`, no bundler config, no `main`/`exports`. This task gives it a build whose output a browser can `import()`.

**Files:**
- Create: `vite.config.ts`
- Create: `scripts/write-manifest.mjs`
- Create: `runtime-entry.ts`
- Modify: `package.json` (add `build` and `manifest:write` scripts, add `vite` to devDependencies)
- Test: `tests/build/runtimeBundle.test.ts`

**Interfaces:**
- Consumes: `pack.ts` (existing — re-exports `data`, `BUNDLED_PACK_ID` and a default code factory), `generated/assetManifest.ts` (existing — exports `assetManifest`).
- Produces: `dist/manifest.json` and `dist/pack.js`. `dist/pack.js` has four exports: `default` (the `ContentPackFactory`), `data` (`ContentPackData`), `assetManifest` (`PackAssetManifest`) and `packId` (string).

- [ ] **Step 1: Write the runtime entry**

Core today reaches a pack through two specifiers (`<pkg>/pack` and `<pkg>/generated/assetManifest`). A runtime pack is fetched once, so it exposes both from one module.

`runtime-entry.ts`:

```ts
/**
 * The entry a runtime install imports — the whole pack behind one URL.
 *
 * Core's build-time path reads two specifiers (`<pkg>/pack` for the halves,
 * `<pkg>/generated/assetManifest` for the art). A runtime install has one
 * `import()` to spend, so this module re-exports both. It adds nothing of
 * its own: everything here already existed, and keeping it a pure re-export
 * is what stops the two paths from drifting into two different packs.
 */
export { default } from './pack';
export { data, BUNDLED_PACK_ID as packId } from './pack';
export { assetManifest } from './generated/assetManifest';
```

- [ ] **Step 2: Write the Vite config**

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Library mode, ES output, code splitting left ON.
 *
 * `generated/spellModules.ts` holds 237 dynamic imports and its own comment
 * says why: "a match loads the kits in play rather than all of them". Rollup
 * turns each into its own chunk, and the browser resolves the emitted
 * relative specifiers against the chunk's own URL — which is the property
 * Task 1's spike proved and the reason this pack is published as a
 * directory rather than one file. `inlineDynamicImports` would collapse all
 * 237 into the entry and cost every player 1.2MB up front.
 *
 * Core is `external`: the pack's only crossings into it are `import type`,
 * which the compiler erases, so nothing of core should ever appear in this
 * output. If Rollup ever reports it as bundled, that is a real boundary
 * violation, not a config problem.
 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'runtime-entry.ts'),
      formats: ['es'],
      fileName: () => 'pack.js',
    },
    rollupOptions: {
      external: [/^@moba2d\/core($|\/)/],
      output: {
        entryFileNames: 'pack.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

- [ ] **Step 3: Write the manifest generator**

`coreRange` is derived, never hand-written — a hand-written one drifts the moment the dependency moves.

`scripts/write-manifest.mjs`:

```js
/**
 * Writes `dist/manifest.json` — the file core fetches *before* it runs any
 * of this pack's code.
 *
 * `coreRange` comes from the declared dependency rather than from a literal
 * in this file: a literal is a second place to remember to change, and the
 * only failure it can produce is the silent kind, where a pack claims
 * compatibility it no longer has.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const dist = join(root, 'dist');

const coreSpec = pkg.devDependencies?.['@moba2d/core'] ?? pkg.dependencies?.['@moba2d/core'];
if (!coreSpec) {
  throw new Error('package.json declares no @moba2d/core dependency to derive coreRange from');
}

// A git dependency carries no version, so the range is the floor this pack
// was authored against. Bump it deliberately when core's contract changes.
const coreRange = '>=1.0.0';

const data = JSON.parse(readFileSync(join(root, 'generated', 'spellCatalog.json'), 'utf8'));

writeFileSync(
  join(dist, 'manifest.json'),
  JSON.stringify(
    {
      id: 'riot',
      version: pkg.version,
      coreRange,
      name: 'Riot champions',
      entry: 'pack.js',
      assets: 'assets/',
      champions: data.championCount,
    },
    null,
    2
  ) + '\n'
);

const chunks = readdirSync(join(dist, 'chunks')).filter(f => f.endsWith('.js')).length;
console.log(`manifest written: riot@${pkg.version}, ${data.championCount} champions, ${chunks} chunks`);
```

> **If `generated/spellCatalog.json` does not exist with a `championCount` field**, read the champion count instead from `data.ts`'s own roster the way the pack's `catalogCompleteness.test.ts` already does, and say so in the task report. Do not invent a number.

- [ ] **Step 4: Wire the scripts**

In `package.json`, add to `scripts`:

```json
"build": "vite build && node scripts/write-manifest.mjs",
```

and add `"vite": "^5.2.0"` to `devDependencies`.

- [ ] **Step 5: Write the failing test**

`tests/build/runtimeBundle.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const dist = join(root, 'dist');

/**
 * These assert on the *built* directory, so they need one to exist. The
 * build is not run from here — a test that builds is a test that takes a
 * minute and hides which half broke. `npm run build` first; `verify` runs
 * it before the suite.
 */
describe("the pack's runtime bundle", () => {
  beforeAll(() => {
    if (!existsSync(join(dist, 'pack.js'))) {
      throw new Error('dist/pack.js is missing — run `npm run build` first');
    }
  });

  it('emits an entry plus per-spell chunks, not one flat bundle', () => {
    const chunks = readdirSync(join(dist, 'chunks')).filter(f => f.endsWith('.js'));
    // 237 dynamic imports; Rollup merges some that share every dependency,
    // so this is a floor rather than an equality. One flat bundle is what
    // it is really guarding against.
    expect(chunks.length).toBeGreaterThan(50);
  });

  it('keeps the dynamic imports relative, so they resolve against the pack URL', () => {
    const entry = readFileSync(join(dist, 'pack.js'), 'utf8');
    expect(entry).toMatch(/import\(\s*["']\.\//);
  });

  it('bundles no part of core', () => {
    const entry = readFileSync(join(dist, 'pack.js'), 'utf8');
    // Core is `external`, so its specifier may appear as an import; what may
    // never appear is core's own source. `buildContentApi` is a value only
    // core defines.
    expect(entry).not.toMatch(/buildContentApi/);
  });

  it('writes a manifest core can read before running anything', () => {
    const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
    expect(manifest.id).toBe('riot');
    expect(manifest.entry).toBe('pack.js');
    expect(manifest.assets).toBe('assets/');
    expect(manifest.coreRange).toMatch(/^>=\d+\.\d+\.\d+$/);
    expect(manifest.champions).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 6: Run it and watch it fail for the right reason**

```bash
cd /Users/hoangtran/Desktop/Github/moba2d-content-riot
npx vitest run tests/build/runtimeBundle.test.ts
```

Expected: FAIL with `dist/pack.js is missing — run \`npm run build\` first`. That is the message the `beforeAll` guard exists to give; a bare "cannot find module" would mean the guard is wrong.

- [ ] **Step 7: Build, then run again**

```bash
npm install
npm run build
npx vitest run tests/build/runtimeBundle.test.ts
```

Expected: 4 passed. If "emits an entry plus per-spell chunks" fails with 1 chunk, `inlineDynamicImports` is on somewhere — the config in Step 2 does not set it, so check Vite's lib-mode defaults for the installed version and report what you found.

- [ ] **Step 8: Add the build to `verify` and re-run the whole gate**

In `package.json`, change `verify` so it builds before testing:

```json
"verify": "npm run assets:check && npm run catalog:check && npm run ability:check && npm run typecheck && npm run check-seams && npm run check-seams:monsters && npm run build && npm test",
```

```bash
npm run verify
```

Expected: exit 0, and the test count rises by 4 from 613 to 617.

- [ ] **Step 9: Ignore the build output**

Append to `.gitignore`:

```
dist/
```

- [ ] **Step 10: Commit**

```bash
git add vite.config.ts runtime-entry.ts scripts/write-manifest.mjs package.json .gitignore tests/build/runtimeBundle.test.ts
git commit -m "feat: build the pack into a loadable directory

Library mode, ES output, code splitting deliberately left on: the 237
dynamic imports in generated/spellModules.ts are what make a match load
the kits in play rather than all of them, and inlining them would cost
every player 1.2MB of spell code up front."
```

---

### Task 3: Publish the built pack

**Repository: `/Users/hoangtran/Desktop/Github/moba2d-content-riot`.**

**Files:**
- Create: `.github/workflows/publish.yml`

**Interfaces:**
- Consumes: `npm run build` from Task 2, producing `dist/`.
- Produces: the pack served at `https://hoangtran0410.github.io/moba2d-content-riot/manifest.json` (or the account's custom-domain equivalent). Later tasks use this URL as the default pack.

- [ ] **Step 1: Write the workflow**

`.github/workflows/publish.yml`:

```yaml
name: Publish

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

# One publish at a time; a queued run replaces a pending one rather than
# racing it.
concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # No `cache: npm`: this repository commits no lockfile (see
      # .gitignore), and asking setup-node to cache without one fails the
      # job outright.
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run verify
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v4
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/publish.yml
git commit -m "ci: publish the built pack to GitHub Pages"
git push origin main
```

- [ ] **Step 3: Enable Pages, then watch the run**

```bash
gh api repos/HoangTran0410/moba2d-content-riot/pages -X POST -f build_type=workflow
gh run watch --repo HoangTran0410/moba2d-content-riot
```

- [ ] **Step 4: Prove the published pack is fetchable and shaped right**

```bash
BASE=$(gh api repos/HoangTran0410/moba2d-content-riot/pages --jq .html_url)
curl -sL "${BASE}manifest.json" | tee /tmp/published-manifest.json
curl -s -o /dev/null -w "entry: %{http_code}\n" -L "${BASE}pack.js"
```

Expected: the manifest JSON with `id: "riot"`, and `entry: 200`.

Record the base URL in the task report — Task 7 needs it.

---

### Task 4: Remember which packs are installed

**Repository: core.**

**Files:**
- Create: `src/content/installedPackStore.ts`
- Test: `tests/content/installedPackStore.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type InstalledPackRecord = { manifestUrl: string; id: string; version: string }`
  - `readInstalledPacks(): InstalledPackRecord[]`
  - `writeInstalledPacks(records: InstalledPackRecord[]): void`
  - `PACK_STORE_KEY = 'moba2d:packs:v1'`

- [ ] **Step 1: Write the failing test**

`tests/content/installedPackStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  readInstalledPacks,
  writeInstalledPacks,
  PACK_STORE_KEY,
} from '@/content/installedPackStore';

/**
 * The suite runs on `environment: 'node'`, so there is no localStorage
 * unless a test makes one. That is also the state a real player can be in —
 * storage disabled — and the store has to survive it rather than throw
 * during boot.
 */
const withStorage = () => {
  const map = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  return map;
};

describe('installedPackStore', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('answers an empty list when nothing is stored', () => {
    withStorage();
    expect(readInstalledPacks()).toEqual([]);
  });

  it('answers an empty list when localStorage is absent entirely', () => {
    expect(readInstalledPacks()).toEqual([]);
  });

  it('round-trips a record', () => {
    withStorage();
    const records = [{ manifestUrl: 'https://h/p/manifest.json', id: 'riot', version: '1.0.0' }];
    writeInstalledPacks(records);
    expect(readInstalledPacks()).toEqual(records);
  });

  it('drops entries that are not shaped like a record rather than throwing', () => {
    const map = withStorage();
    map.set(
      PACK_STORE_KEY,
      JSON.stringify([
        { manifestUrl: 'https://h/a/manifest.json', id: 'a', version: '1.0.0' },
        { manifestUrl: 42 },
        null,
        'nonsense',
        { id: 'no-url', version: '1.0.0' },
      ])
    );
    expect(readInstalledPacks()).toEqual([
      { manifestUrl: 'https://h/a/manifest.json', id: 'a', version: '1.0.0' },
    ]);
  });

  it('answers an empty list for a stored blob that is not even JSON', () => {
    const map = withStorage();
    map.set(PACK_STORE_KEY, '{not json');
    expect(readInstalledPacks()).toEqual([]);
  });

  it('never throws out of writeInstalledPacks when storage refuses', () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    expect(() => writeInstalledPacks([])).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it and read the failure**

```bash
cd /Users/hoangtran/Desktop/Github/moba2d-core
npx vitest run tests/content/installedPackStore.test.ts
```

Expected: FAIL — `Cannot find module '@/content/installedPackStore'`.

- [ ] **Step 3: Write the implementation**

`src/content/installedPackStore.ts`:

```ts
/**
 * Which packs this browser has installed — the list, not the bytes.
 *
 * A few hundred bytes in `localStorage`, because `LoadingScene` has to know
 * what to fetch before it has fetched anything, and that read has to be
 * synchronous. The packs' actual code and art are cached by the service
 * worker instead; nothing here is large.
 *
 * Every read is defensive on purpose. This value survives across versions of
 * the game, it can be edited by hand, and a player whose stored list has
 * gone bad must still reach the menu — a store that throws during boot is
 * the dead screen the whole design forbids.
 */

export const PACK_STORE_KEY = 'moba2d:packs:v1';

/** One installed pack, as remembered between sessions. */
export interface InstalledPackRecord {
  /** Where the manifest was fetched from. The identity of the install. */
  manifestUrl: string;
  /** The pack id the manifest declared, kept so a stale list can be shown. */
  id: string;
  /** The version last installed, so an update can be noticed later. */
  version: string;
}

const isRecord = (value: unknown): value is InstalledPackRecord =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as InstalledPackRecord).manifestUrl === 'string' &&
  typeof (value as InstalledPackRecord).id === 'string' &&
  typeof (value as InstalledPackRecord).version === 'string';

export function readInstalledPacks(): InstalledPackRecord[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PACK_STORE_KEY);
  } catch {
    // Storage disabled, or absent (node). Not an error here.
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  // A plain loop, not `.filter`: `Array.prototype.filter` is polyfilled in
  // this project and cannot narrow a type.
  const out: InstalledPackRecord[] = [];
  for (const entry of parsed) {
    if (isRecord(entry)) out.push({ manifestUrl: entry.manifestUrl, id: entry.id, version: entry.version });
  }
  return out;
}

export function writeInstalledPacks(records: InstalledPackRecord[]): void {
  try {
    localStorage.setItem(PACK_STORE_KEY, JSON.stringify(records));
  } catch {
    // A full or blocked storage costs the player this list, nothing more.
  }
}
```

- [ ] **Step 4: Run the test again**

```bash
npx vitest run tests/content/installedPackStore.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/content/installedPackStore.ts tests/content/installedPackStore.test.ts
git commit -m "feat(content): remember which packs are installed

The list, not the bytes. Every read is defensive because this value
outlives game versions and a store that throws during boot is the dead
screen the design forbids."
```

---

### Task 5: Fetch, check and load a pack from a URL

**Repository: core.**

This is the only file that talks to the network, and the only one that runs a stranger's code.

**Files:**
- Create: `src/content/packSource.ts`
- Modify: `vite.config.ts` (add a `__CORE_VERSION__` define)
- Modify: `src/types/global.d.ts` (declare `__CORE_VERSION__`)
- Test: `tests/content/packSource.test.ts`

**Interfaces:**
- Consumes: `validatePackData` / `validatePackCode` from `@/content/validate`; `InstalledPackRecord` from Task 4.
- Produces:
  - `type LoadedPack = { manifest: RuntimePackManifest; data: ContentPackData; code: ContentPackFactory; assetManifest: PackAssetManifest; baseUrl: string }`
  - `type RuntimePackManifest = { id: string; version: string; coreRange: string; name: string; entry: string; assets: string; champions?: number }`
  - `fetchPackManifest(manifestUrl: string): Promise<RuntimePackManifest>` — throws `PackLoadError` on any failure
  - `loadPackFromManifest(manifest: RuntimePackManifest, manifestUrl: string): Promise<LoadedPack>`
  - `class PackLoadError extends Error { readonly stage: 'fetch' | 'manifest' | 'compat' | 'import' | 'shape' }`
  - `satisfiesCoreRange(range: string, version: string): boolean`

- [ ] **Step 1: Add core's own version as a build-time constant**

In `vite.config.ts`, beside the existing `__APP_VERSION__`:

```ts
    /**
     * Core's package version, for a pack manifest's `coreRange` to be
     * checked against. Deliberately not `__APP_VERSION__`, which is the
     * commit's clock (`2026.8.17.15.0`) and is not semver — see
     * `scripts/version.mjs`.
     */
    __CORE_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version
    ),
```

and add `readFileSync` to the existing `node:fs` imports at the top of the file (add `import { readFileSync } from 'node:fs';` if there is none).

In `src/types/global.d.ts`, add:

```ts
/** Core's own package version, injected by `vite.config.ts` for pack compatibility checks. */
declare const __CORE_VERSION__: string;
```

- [ ] **Step 2: Write the failing test**

`tests/content/packSource.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchPackManifest,
  satisfiesCoreRange,
  PackLoadError,
} from '@/content/packSource';

const MANIFEST = {
  id: 'riot',
  version: '1.0.0',
  coreRange: '>=1.0.0',
  name: 'Riot champions',
  entry: 'pack.js',
  assets: 'assets/',
  champions: 58,
};

const respondWith = (body: unknown, ok = true, status = 200) =>
  vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  } as unknown as Response);

describe('satisfiesCoreRange', () => {
  it('accepts a floor the version meets', () => {
    expect(satisfiesCoreRange('>=1.0.0', '1.0.0')).toBe(true);
    expect(satisfiesCoreRange('>=1.0.0', '1.4.2')).toBe(true);
    expect(satisfiesCoreRange('>=1.2.0', '2.0.0')).toBe(true);
  });

  it('refuses a floor the version does not meet', () => {
    expect(satisfiesCoreRange('>=2.0.0', '1.9.9')).toBe(false);
    expect(satisfiesCoreRange('>=1.2.0', '1.1.9')).toBe(false);
  });

  it('accepts the wildcard', () => {
    expect(satisfiesCoreRange('*', '0.0.1')).toBe(true);
  });

  it('refuses a range shape it does not understand, rather than guessing', () => {
    // Deliberately narrow: only `>=x.y.z` and `*` are supported, and
    // anything else is treated as incompatible so a pack cannot be admitted
    // by a range nobody implemented.
    expect(satisfiesCoreRange('^1.0.0', '1.5.0')).toBe(false);
    expect(satisfiesCoreRange('1.x', '1.5.0')).toBe(false);
    expect(satisfiesCoreRange('', '1.5.0')).toBe(false);
  });
});

describe('fetchPackManifest', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__CORE_VERSION__ = '1.0.0';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the manifest when it is well formed and compatible', async () => {
    vi.stubGlobal('fetch', respondWith(MANIFEST));
    await expect(fetchPackManifest('https://h/p/manifest.json')).resolves.toEqual(MANIFEST);
  });

  it('reports the fetch stage when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const error = await fetchPackManifest('https://h/p/manifest.json').catch(e => e);
    expect(error).toBeInstanceOf(PackLoadError);
    expect(error.stage).toBe('fetch');
  });

  it('reports the fetch stage on a non-200', async () => {
    vi.stubGlobal('fetch', respondWith(null, false, 404));
    const error = await fetchPackManifest('https://h/p/manifest.json').catch(e => e);
    expect(error.stage).toBe('fetch');
    expect(error.message).toContain('404');
  });

  it('reports the manifest stage when a required field is missing', async () => {
    const { entry, ...withoutEntry } = MANIFEST;
    vi.stubGlobal('fetch', respondWith(withoutEntry));
    const error = await fetchPackManifest('https://h/p/manifest.json').catch(e => e);
    expect(error.stage).toBe('manifest');
    expect(error.message).toContain('entry');
  });

  it('reports the compat stage when the pack wants a newer core', async () => {
    vi.stubGlobal('fetch', respondWith({ ...MANIFEST, coreRange: '>=9.0.0' }));
    const error = await fetchPackManifest('https://h/p/manifest.json').catch(e => e);
    expect(error.stage).toBe('compat');
    expect(error.message).toContain('9.0.0');
  });
});
```

- [ ] **Step 3: Run it and read the failure**

```bash
npx vitest run tests/content/packSource.test.ts
```

Expected: FAIL — `Cannot find module '@/content/packSource'`.

- [ ] **Step 4: Write the implementation**

`src/content/packSource.ts`:

```ts
import type { ContentPackData, ContentPackFactory } from './ContentPack';
import type { PackAssetManifest } from '@/managers/AssetManager';
import { validatePackData } from './validate';

/**
 * The one file that talks to the network, and the one that runs a stranger's
 * code. Both facts are why it is separate from `install.ts`: everything
 * downstream of here handles a pack that is already in memory and already
 * checked, exactly as the build-time path does.
 *
 * The order of operations is the design's only security boundary. The
 * manifest is plain JSON and is fetched, parsed and checked *before* the
 * entry is imported, so a caller can show the player what they are about to
 * run and who is serving it. Once `import()` is reached, the pack has the
 * same authority as the page — see the spec's §2.1, which records that as a
 * chosen trade, not an oversight.
 *
 * **Never `import(blobUrl)`.** A module loaded from a blob resolves its
 * relative specifiers against a URL with no path, so the pack's 237 lazy
 * spell imports would all fail and a pack would be forced into one flat
 * bundle. The entry is imported from its own https URL.
 */

/** Which step failed, so a caller can say something useful rather than "error". */
export type PackLoadStage = 'fetch' | 'manifest' | 'compat' | 'import' | 'shape';

export class PackLoadError extends Error {
  readonly stage: PackLoadStage;
  constructor(stage: PackLoadStage, message: string) {
    super(message);
    this.name = 'PackLoadError';
    this.stage = stage;
  }
}

/** A pack's manifest, as served beside its entry. */
export interface RuntimePackManifest {
  id: string;
  version: string;
  coreRange: string;
  name: string;
  entry: string;
  assets: string;
  champions?: number;
}

/** Everything one install produced, ready for the registry. */
export interface LoadedPack {
  manifest: RuntimePackManifest;
  data: ContentPackData;
  code: ContentPackFactory;
  assetManifest: PackAssetManifest;
  /** The manifest's own URL — what `entry` and `assets` resolve against. */
  baseUrl: string;
}

/**
 * Deliberately narrow: `>=x.y.z` and `*`, nothing else.
 *
 * A full semver range parser is a dependency and a surface; what a pack
 * actually needs to say is "core must be at least this new". Anything this
 * does not understand is refused rather than guessed at, so a pack can never
 * be admitted by a range nobody implemented.
 */
export function satisfiesCoreRange(range: string, version: string): boolean {
  if (range === '*') return true;
  const floor = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(range);
  const have = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!floor || !have) return false;
  for (let i = 1; i <= 3; i++) {
    const want = Number(floor[i]);
    const got = Number(have[i]);
    if (got > want) return true;
    if (got < want) return false;
  }
  return true;
}

const REQUIRED: (keyof RuntimePackManifest)[] = [
  'id',
  'version',
  'coreRange',
  'name',
  'entry',
  'assets',
];

/**
 * Fetches and checks a manifest. Nothing the pack wrote as *code* has run
 * when this resolves — that is the whole point of it being its own step.
 */
export async function fetchPackManifest(manifestUrl: string): Promise<RuntimePackManifest> {
  let response: Response;
  try {
    response = await fetch(manifestUrl, { credentials: 'omit' });
  } catch (cause) {
    throw new PackLoadError('fetch', `could not reach ${manifestUrl}: ${(cause as Error).message}`);
  }
  if (!response.ok) {
    throw new PackLoadError('fetch', `${manifestUrl} answered ${response.status}`);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new PackLoadError('manifest', `${manifestUrl} is not JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new PackLoadError('manifest', `${manifestUrl} is not an object`);
  }

  const candidate = parsed as Record<string, unknown>;
  const missing: string[] = [];
  for (const field of REQUIRED) {
    if (typeof candidate[field] !== 'string') missing.push(field);
  }
  if (missing.length > 0) {
    throw new PackLoadError('manifest', `manifest is missing: ${missing.join(', ')}`);
  }

  const manifest = candidate as unknown as RuntimePackManifest;
  if (!satisfiesCoreRange(manifest.coreRange, __CORE_VERSION__)) {
    throw new PackLoadError(
      'compat',
      `pack ${manifest.id} needs core ${manifest.coreRange}, this is ${__CORE_VERSION__}`
    );
  }
  return manifest;
}

/**
 * Imports the entry and checks the halves it exported.
 *
 * Only the data half goes through `validatePackData`. The code half's
 * `spells` are lazy thunks by construction (`generated/spellModules.ts`), so
 * `validatePackCode` would have to call every one of them to see anything —
 * 237 network round trips to check a shape. `install.ts` already fails
 * loudly on a code half that is not an object, and a thunk that answers
 * wrongly fails at cast time where the spell id is in hand.
 */
export async function loadPackFromManifest(
  manifest: RuntimePackManifest,
  manifestUrl: string
): Promise<LoadedPack> {
  const entryUrl = new URL(manifest.entry, manifestUrl).href;

  let module: Record<string, unknown>;
  try {
    module = (await import(/* @vite-ignore */ entryUrl)) as Record<string, unknown>;
  } catch (cause) {
    throw new PackLoadError('import', `could not load ${entryUrl}: ${(cause as Error).message}`);
  }

  if (typeof module.default !== 'function') {
    throw new PackLoadError('shape', `${entryUrl} has no default export function`);
  }

  const checked = validatePackData(module.data);
  if (!checked.ok) {
    throw new PackLoadError('shape', `${manifest.id} data half: ${checked.errors.join('; ')}`);
  }
  if (checked.data.manifest.id !== manifest.id) {
    throw new PackLoadError(
      'shape',
      `manifest says id "${manifest.id}" but the pack declares "${checked.data.manifest.id}"`
    );
  }

  return {
    manifest,
    data: checked.data,
    code: module.default as ContentPackFactory,
    assetManifest: (module.assetManifest ?? {}) as PackAssetManifest,
    baseUrl: manifestUrl,
  };
}
```

- [ ] **Step 5: Run the test again**

```bash
npx vitest run tests/content/packSource.test.ts
```

Expected: 9 passed.

- [ ] **Step 6: Run the whole gate**

```bash
npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"
```

Expected: `Tests  1804 passed | 9 skipped` (1795 + 9 new), no errors. If `vue-tsc` complains about `__CORE_VERSION__`, the declaration in Step 1 did not land in a file `tsconfig.json` includes — check `src/types/global.d.ts` is inside `include`.

- [ ] **Step 7: Commit**

```bash
git add src/content/packSource.ts tests/content/packSource.test.ts vite.config.ts src/types/global.d.ts
git commit -m "feat(content): fetch, check and load a pack from a URL

The manifest is fetched and checked before the entry is imported, so a
caller can show the player who they are about to trust. The entry loads
from its own https URL, never a blob: a blob-loaded module resolves
relative specifiers against a URL with no path, which would kill the
pack's 237 lazy spell imports."
```

---

### Task 6: Install a loaded pack into the live registry

**Repository: core.**

**Files:**
- Modify: `src/content/install.ts` (add one exported function; touch nothing above it)
- Modify: `src/content/registry.ts` (add a public rebuild, keep the test-named one as an alias)
- Test: `tests/content/installRuntimePack.test.ts`

**Interfaces:**
- Consumes: `LoadedPack` from Task 5; `PackRegistry`, `ContentApi`.
- Produces:
  - `installRuntimePack(registry: PackRegistry, api: ContentApi, pack: LoadedPack): void`
  - `rebuildContentRegistry(): PackRegistry`

- [ ] **Step 1: Write the failing test**

`tests/content/installRuntimePack.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PackRegistry } from '@/content/PackRegistry';
import { buildContentApi } from '@/content/ContentApi';
import { installRuntimePack } from '@/content/install';
import AssetManager from '@/managers/AssetManager';
import type { LoadedPack } from '@/content/packSource';

const loaded = (id: string): LoadedPack => ({
  manifest: {
    id,
    version: '1.0.0',
    coreRange: '>=1.0.0',
    name: id,
    entry: 'pack.js',
    assets: 'assets/',
  },
  data: {
    manifest: { id, version: '1.0.0', coreRange: '>=1.0.0' },
    champions: [],
    spellDisplay: {},
  } as unknown as LoadedPack['data'],
  code: () => ({ spells: {} }),
  assetManifest: { hero: { kind: 'image', url: 'https://h/p/assets/hero.png', path: 'hero.png' } },
  baseUrl: 'https://h/p/manifest.json',
});

describe('installRuntimePack', () => {
  let registry: PackRegistry;
  beforeEach(() => {
    registry = new PackRegistry();
  });

  it('installs both halves under the manifest id', () => {
    installRuntimePack(registry, buildContentApi(), loaded('probe'));
    expect(registry.hasPack('probe')).toBe(true);
  });

  it("registers the pack's own asset manifest so its art resolves", () => {
    const spy = vi.spyOn(AssetManager, 'registerPackAssets');
    installRuntimePack(registry, buildContentApi(), loaded('probe'));
    expect(spy).toHaveBeenCalledWith('probe', expect.objectContaining({ hero: expect.anything() }));
    spy.mockRestore();
  });

  it('refuses a second install under an id already taken', () => {
    const api = buildContentApi();
    installRuntimePack(registry, api, loaded('probe'));
    expect(() => installRuntimePack(registry, api, loaded('probe'))).toThrow();
  });
});
```

> `registry.hasPack` may not exist under that name. Before writing the test, read `src/content/PackRegistry.ts` and use whatever it really offers to ask "is this pack installed" — `packIds()`, `has()`, or reading `installData`'s own duplicate error. **Use the real name; do not invent one.** Record in the task report which you used.

- [ ] **Step 2: Run it and read the failure**

```bash
npx vitest run tests/content/installRuntimePack.test.ts
```

Expected: FAIL — `installRuntimePack is not a function` (or a TypeScript error naming it).

- [ ] **Step 3: Add the installer to `install.ts`**

Append to `src/content/install.ts`, importing `LoadedPack` as a **type-only** import at the top (`import type { LoadedPack } from './packSource';`):

```ts
/**
 * A pack that arrived over the network, installed the same way a bundled one
 * is.
 *
 * This is spec §9.1's Stage 2, and the point of the whole content-pack
 * design is how little it is: the two halves go into the same registry
 * through the same two calls, and the asset manifest is registered the same
 * way the loop above registers a bundled pack's. What differs is only where
 * the factory came from — a static import there, an `import()` of a URL
 * here — and that difference lives entirely in `packSource.ts`.
 *
 * Order matters and matches the bundled path: data first, then code against
 * it. `PackRegistry` refuses a second install under an id already taken, so
 * a caller that installs the same pack twice gets a throw rather than a
 * half-replaced roster.
 */
export function installRuntimePack(
  registry: PackRegistry,
  api: ContentApi,
  pack: LoadedPack
): void {
  AssetManager.registerPackAssets?.(pack.manifest.id, pack.assetManifest);
  registry.installData(pack.data);
  registry.installCode(pack.data.manifest.id, pack.code(api));
}
```

- [ ] **Step 4: Give `registry.ts` a public rebuild**

In `src/content/registry.ts`, add above `resetContentRegistryForTests`:

```ts
/**
 * Forget the registry so the next read builds and installs a fresh one.
 *
 * A newly installed runtime pack has to become visible without a page
 * reload, and the registry is memoised in two places (here and
 * `catalog.ts`). This is the one call that clears both. It was born as
 * `resetContentRegistryForTests`, which is still exported below as an alias
 * so no test has to change; the behaviour was never test-only, only the
 * name was.
 */
export function rebuildContentRegistry(): PackRegistry {
  resetContentCatalogForTests();
  codeInstalled = false;
  return contentRegistry();
}
```

- [ ] **Step 5: Run the test, then the gate**

```bash
npx vitest run tests/content/installRuntimePack.test.ts
npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"
```

Expected: 3 passed, then `Tests  1807 passed | 9 skipped`.

Watch for `contentApiChunk.test.ts` failing. `install.ts` must keep having **no value import** of `./ContentApi` — the `import type { LoadedPack }` added in Step 3 is type-only and erases, but a value import would pull ~80 modules into every importer's closure and that test exists to catch it.

- [ ] **Step 6: Commit**

```bash
git add src/content/install.ts src/content/registry.ts tests/content/installRuntimePack.test.ts
git commit -m "feat(content): install a pack that arrived over the network

Stage 2's installer, and the point of the content-pack design is how
little it is: same registry, same two calls, same asset registration. The
only difference from a bundled pack is where the factory came from, and
that lives entirely in packSource.ts."
```

---

### Task 7: Install packs during the loading screen

**Repository: core.**

The last task of Plan 1. When it lands, a pack installs from a URL and the roster grows.

**Files:**
- Create: `src/content/runtimePacks.ts`
- Modify: `src/scenes/LoadingScene.ts`
- Modify: `src/scenes/LoadingScene.vue` (the banner)
- Test: `tests/content/runtimePacks.test.ts`
- Test: `tests/e2e/verify-runtime-pack.mjs`
- Modify: `package.json` (add `e2e:runtime-pack`)

**Interfaces:**
- Consumes: everything from Tasks 4–6.
- Produces:
  - `DEFAULT_PACK_URL: string` — the Pages URL recorded in Task 3
  - `installRuntimePacks(): Promise<PackInstallOutcome[]>`
  - `type PackInstallOutcome = { manifestUrl: string; ok: true; id: string } | { manifestUrl: string; ok: false; stage: string; message: string }`

- [ ] **Step 1: Write the failing test**

`tests/content/runtimePacks.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/content/packSource', () => ({
  PackLoadError: class extends Error {
    stage: string;
    constructor(stage: string, message: string) {
      super(message);
      this.stage = stage;
    }
  },
  fetchPackManifest: vi.fn(),
  loadPackFromManifest: vi.fn(),
}));
vi.mock('@/content/install', () => ({ installRuntimePack: vi.fn() }));
vi.mock('@/content/registry', () => ({
  contentRegistry: vi.fn(() => ({})),
  rebuildContentRegistry: vi.fn(() => ({})),
}));
vi.mock('@/content/ContentApi', () => ({ buildContentApi: vi.fn(() => ({})) }));

import { installRuntimePacks, DEFAULT_PACK_URL } from '@/content/runtimePacks';
import { fetchPackManifest, loadPackFromManifest } from '@/content/packSource';
import { installRuntimePack } from '@/content/install';
import { readInstalledPacks, writeInstalledPacks, PACK_STORE_KEY } from '@/content/installedPackStore';

const withStorage = () => {
  const map = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  return map;
};

const manifest = { id: 'riot', version: '1.0.0', coreRange: '>=1.0.0', name: 'Riot', entry: 'pack.js', assets: 'assets/' };

describe('installRuntimePacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withStorage();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('seeds the default pack on a first run with nothing stored', async () => {
    vi.mocked(fetchPackManifest).mockResolvedValue(manifest);
    vi.mocked(loadPackFromManifest).mockResolvedValue({ manifest } as never);

    const outcomes = await installRuntimePacks();

    expect(fetchPackManifest).toHaveBeenCalledWith(DEFAULT_PACK_URL);
    expect(outcomes).toEqual([{ manifestUrl: DEFAULT_PACK_URL, ok: true, id: 'riot' }]);
    expect(readInstalledPacks()).toEqual([
      { manifestUrl: DEFAULT_PACK_URL, id: 'riot', version: '1.0.0' },
    ]);
  });

  it('reports a failure instead of throwing, and stores nothing', async () => {
    const { PackLoadError } = await import('@/content/packSource');
    vi.mocked(fetchPackManifest).mockRejectedValue(new PackLoadError('fetch', 'offline'));

    const outcomes = await installRuntimePacks();

    expect(outcomes).toEqual([
      { manifestUrl: DEFAULT_PACK_URL, ok: false, stage: 'fetch', message: 'offline' },
    ]);
    expect(installRuntimePack).not.toHaveBeenCalled();
    expect(readInstalledPacks()).toEqual([]);
  });

  it('does not re-seed the default once a list exists', async () => {
    writeInstalledPacks([{ manifestUrl: 'https://other/manifest.json', id: 'other', version: '2.0.0' }]);
    vi.mocked(fetchPackManifest).mockResolvedValue({ ...manifest, id: 'other', version: '2.0.0' });
    vi.mocked(loadPackFromManifest).mockResolvedValue({ manifest } as never);

    await installRuntimePacks();

    expect(fetchPackManifest).toHaveBeenCalledTimes(1);
    expect(fetchPackManifest).toHaveBeenCalledWith('https://other/manifest.json');
  });

  it('keeps going after one pack fails, so a bad entry cannot hide a good one', async () => {
    writeInstalledPacks([
      { manifestUrl: 'https://bad/manifest.json', id: 'bad', version: '1.0.0' },
      { manifestUrl: 'https://good/manifest.json', id: 'good', version: '1.0.0' },
    ]);
    const { PackLoadError } = await import('@/content/packSource');
    vi.mocked(fetchPackManifest)
      .mockRejectedValueOnce(new PackLoadError('fetch', 'gone'))
      .mockResolvedValueOnce({ ...manifest, id: 'good' });
    vi.mocked(loadPackFromManifest).mockResolvedValue({ manifest } as never);

    const outcomes = await installRuntimePacks();

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0].ok).toBe(false);
    expect(outcomes[1].ok).toBe(true);
    expect(localStorage.getItem(PACK_STORE_KEY)).toContain('good');
  });
});
```

- [ ] **Step 2: Run it and read the failure**

```bash
npx vitest run tests/content/runtimePacks.test.ts
```

Expected: FAIL — `Cannot find module '@/content/runtimePacks'`.

- [ ] **Step 3: Write the orchestrator**

`src/content/runtimePacks.ts`:

```ts
import { buildContentApi } from './ContentApi';
import { installRuntimePack } from './install';
import { fetchPackManifest, loadPackFromManifest, PackLoadError } from './packSource';
import { rebuildContentRegistry } from './registry';
import {
  readInstalledPacks,
  writeInstalledPacks,
  type InstalledPackRecord,
} from './installedPackStore';

/**
 * Installing every remembered pack, once, during the loading screen.
 *
 * **Nothing here may throw.** The game is already playable when this runs —
 * `main.ts` installed core and the reference pack synchronously before
 * `LoadingScene` ever mounted — so every failure below costs the player
 * content they can retry for, and none of it may cost them the menu. That
 * is why the return is a list of outcomes rather than a promise that
 * rejects: the caller reports what failed and carries on.
 *
 * One pack's failure does not stop the next. A player with two packs and one
 * dead host should lose one roster, not both.
 */

/**
 * Where the game's own content comes from when a player has never installed
 * anything. Seeded into the stored list on first run, after which it is an
 * ordinary entry the player can remove.
 */
export const DEFAULT_PACK_URL = 'https://hoangtran0410.github.io/moba2d-content-riot/manifest.json';

export type PackInstallOutcome =
  | { manifestUrl: string; ok: true; id: string }
  | { manifestUrl: string; ok: false; stage: string; message: string };

export async function installRuntimePacks(): Promise<PackInstallOutcome[]> {
  const stored = readInstalledPacks();
  const wanted: string[] =
    stored.length > 0 ? stored.map(record => record.manifestUrl) : [DEFAULT_PACK_URL];

  const outcomes: PackInstallOutcome[] = [];
  const installed: InstalledPackRecord[] = [];
  const api = buildContentApi();
  let anyInstalled = false;

  for (const manifestUrl of wanted) {
    try {
      const manifest = await fetchPackManifest(manifestUrl);
      const pack = await loadPackFromManifest(manifest, manifestUrl);
      installRuntimePack(rebuildContentRegistry(), api, pack);
      anyInstalled = true;
      installed.push({ manifestUrl, id: manifest.id, version: manifest.version });
      outcomes.push({ manifestUrl, ok: true, id: manifest.id });
    } catch (thrown) {
      const error = thrown as PackLoadError;
      outcomes.push({
        manifestUrl,
        ok: false,
        stage: error.stage ?? 'import',
        message: error.message,
      });
    }
  }

  // Only what actually installed is remembered. A URL that failed is not
  // written, so a first run that could not reach the network retries the
  // default next time instead of remembering a pack it never had.
  if (anyInstalled) writeInstalledPacks(installed);
  return outcomes;
}
```

> **`rebuildContentRegistry()` is called once per pack here, which is one rebuild too many.** Fix it in this step: call it once before the loop, hold the registry in a local, and pass that local to `installRuntimePack`. The test in Step 1 does not catch this because the registry is mocked — say so in the task report, and add a fifth test asserting `rebuildContentRegistry` is called exactly once for two packs.

- [ ] **Step 4: Run the test again**

```bash
npx vitest run tests/content/runtimePacks.test.ts
```

Expected: 5 passed (four from Step 1 plus the one Step 3 asks for).

- [ ] **Step 5: Await the install in `LoadingScene`, and surface failures**

Read `src/scenes/LoadingScene.ts` first — it owns mounting, the asset load and the handover to the menu. Add the install *before* the handover, and hold the outcomes for the banner:

```ts
// Runtime packs install here rather than in `main.ts`'s `setup()` because
// this is where the game is already allowed to be slow: the loading screen
// is on the glass, and `setup()` is synchronous by design (see
// `content/registry.ts` — the warm call there installs core and the
// reference pack, which is what makes the game playable if everything
// below fails).
const outcomes = await installRuntimePacks();
const failures = outcomes.filter(outcome => !outcome.ok);
if (failures.length > 0) {
  // Not thrown, on purpose. See `runtimePacks.ts`'s own header.
  console.warn('[packs] some content did not install', failures);
}
```

Pass `failures` to `LoadingScene.vue`'s state so the banner can render. In `LoadingScene.vue`, add a banner that shows when `failures.length > 0`:

```vue
<div v-if="failures.length" class="pack-banner" role="alert">
  <span>Chưa tải được nội dung ({{ failures[0].stage }}). Đang chơi với tướng mặc định.</span>
  <button type="button" @click="retry" @touchend.prevent="retry">Thử lại</button>
</div>
```

`retry` reloads: `const retry = () => location.reload();`

**Both handlers, always.** `GameScene` calls `preventDefault()` on every touch on the page, so the browser synthesises no trailing `click` — a click-only control is dead under a thumb and perfect under a mouse.

- [ ] **Step 6: Write the end-to-end driver**

`tests/e2e/verify-runtime-pack.mjs`:

```js
/**
 * The claim Plan 1 exists to make: a pack served from a URL installs, and
 * the roster grows from one champion to a full one — with no rebuild of
 * core.
 *
 * The pack is served from a second origin by a plain static server, because
 * the property under test is cross-origin `import()` and same-origin would
 * prove nothing. `dist/` of the pack repository is what is served: the real
 * built artifact, not a fixture, so this also catches a build that emits
 * something a browser will not load.
 *
 *   node tests/e2e/verify-runtime-pack.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { startHarness } from './harness.mjs';

const PACK_DIST = '/Users/hoangtran/Desktop/Github/moba2d-content-riot/dist';
const PACK_PORT = 4399;
const TYPES = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const packServer = createServer(async (req, res) => {
  try {
    const body = await readFile(join(PACK_DIST, decodeURIComponent(req.url.split('?')[0])));
    res.writeHead(200, {
      'content-type': TYPES[extname(req.url)] ?? 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise(resolve => packServer.listen(PACK_PORT, resolve));
const PACK_URL = `http://localhost:${PACK_PORT}/manifest.json`;

const { url, page, report, check, errors, guard } = await startHarness();

await guard(async () => {
  // Seed the store before the first navigation: `runtimePacks` reads it
  // during the loading screen, which is before anything is on the glass.
  await page.addInitScript(
    ([key, packUrl]) =>
      window.localStorage.setItem(
        key,
        JSON.stringify([{ manifestUrl: packUrl, id: 'riot', version: '1.0.0' }])
      ),
    ['moba2d:packs:v1', PACK_URL]
  );
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#play-btn', { timeout: 45_000 });

  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible', timeout: 30_000 });
  await page.click('.practice-roster-main:has(#practice-row-toggle-0) .practice-roster-open');
  await page.waitForSelector('.loadout-modal', { state: 'visible', timeout: 30_000 });

  const champions = await page.evaluate(() =>
    [...document.querySelectorAll('.kit-shelf')].map(shelf => shelf.getAttribute('data-champion'))
  );
  report.champions = champions.length;
  report.sample = champions.slice(0, 6);

  check('the runtime pack installed a full roster', champions.length > 50, `${champions.length}`);
  check("a champion that exists only in the pack is offered", champions.includes('Ahri'));
  check('the reference pack survived alongside it', champions.includes('Vera'));
  check('nothing went wrong on the page', errors.length === 0, errors.join(' | '));
});

packServer.close();
```

Add to `package.json` scripts:

```json
"e2e:runtime-pack": "node tests/e2e/verify-runtime-pack.mjs",
```

- [ ] **Step 7: Prove the driver can fail, then that it passes**

First make it fail on purpose — point `PACK_PORT` at a port nothing is listening on (e.g. `4398`) and run:

```bash
cd /Users/hoangtran/Desktop/Github/moba2d-core
npm run e2e:runtime-pack
```

Expected: `FAIL  the runtime pack installed a full roster — 2` (the two non-champion shelves) and a non-zero exit. This is the falsification step; a driver never seen red is not a check.

Put the port back, build the pack, then run for real:

```bash
cd /Users/hoangtran/Desktop/Github/moba2d-content-riot && npm run build
cd /Users/hoangtran/Desktop/Github/moba2d-core && npm run e2e:runtime-pack
```

Expected: 4 PASS, `champions` above 50, `Ahri` and `Vera` both present.

- [ ] **Step 8: Prove the failure path — the promise Plan 1 makes about never showing a dead screen**

Add to the same driver, after the checks above:

```js
// The other half of the claim: a dead pack host costs the roster, never the
// menu. Same page, same code path, one difference — the pack does not answer.
await guard(async () => {
  await page.route('**/manifest.json', route => route.abort());
  await page.goto(url, { waitUntil: 'load' });
  const reachedMenu = await page
    .waitForSelector('#play-btn', { timeout: 45_000 })
    .then(() => true)
    .catch(() => false);
  check('the menu still opens when the pack host is dead', reachedMenu);
  check('the player is told', (await page.locator('.pack-banner').count()) > 0);
});
```

```bash
npm run e2e:runtime-pack
```

Expected: 6 PASS.

- [ ] **Step 9: Run the full gate**

```bash
npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"
npm run e2e:core-alone
```

Expected: `Tests  1812 passed | 9 skipped`, and `e2e:core-alone` still 13/13 — it is the fallback path's own test and must not have moved.

- [ ] **Step 10: Commit**

```bash
git add src/content/runtimePacks.ts tests/content/runtimePacks.test.ts \
        src/scenes/LoadingScene.ts src/scenes/LoadingScene.vue \
        tests/e2e/verify-runtime-pack.mjs package.json
git commit -m "feat(content): install runtime packs during the loading screen

Nothing in this path may throw. main.ts installs core and the reference
pack synchronously before LoadingScene mounts, so the game is already
playable when this runs and every failure below costs content the player
can retry for, never the menu. e2e:runtime-pack checks both halves: a
roster that grows past 50, and a dead host that still reaches the menu
behind a banner."
```

---

## Self-Review

**Spec coverage.** §3 (pack shape) → Tasks 2, 3. §4 (the `import(blobUrl)` correction) → Task 1 proves it, Task 5 implements it. §5 (boot path) → Tasks 6, 7. §5.1 (the Vera fallback costs nothing) → Task 7 Steps 8–9. §7 (management screen) → **Plan 2**, stated in Scope. §6 (cache/offline) → **Plan 2**. §8 (pack build) → Tasks 2, 3. §9 (file table) → every core row except `vite.config.ts`'s `injectManifest`, `src/sw.ts`, `src/scenes/packs/*` and the CI deletion, all four of which are Plan 2. §10 (testing) → the spike, three Vitest files, one e2e driver; the offline row is Plan 2.

**Gap accepted:** §2.1's install-confirmation screen is the mitigation for the open-URL decision, and it lands in Plan 2 with the management screen. Plan 1 installs only from the stored list, which on a first run holds exactly one URL the project itself chose — no stranger's code runs without the player having pasted a URL, and there is no way to paste one until Plan 2. **Plan 2 must ship before any UI can add an arbitrary URL.**

**Placeholder scan:** three steps carry an explicit instruction to check reality rather than trust the plan — Task 2 Step 3 (the champion-count source), Task 6 Step 1 (`PackRegistry`'s real "is it installed" method), Task 7 Step 3 (the rebuild-per-pack defect). Each names what to do and what to record. They are instructions, not gaps.

**Type consistency:** `LoadedPack`, `RuntimePackManifest`, `PackLoadError.stage`, `InstalledPackRecord`, `PackInstallOutcome`, `installRuntimePack`, `rebuildContentRegistry`, `installRuntimePacks`, `DEFAULT_PACK_URL` and `PACK_STORE_KEY` are each defined once and used under the same name everywhere after.
