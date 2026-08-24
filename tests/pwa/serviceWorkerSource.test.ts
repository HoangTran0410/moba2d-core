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
const viteConfig = (): string => stripComments(readFileSync(join(ROOT, 'vite.config.ts'), 'utf8'));

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

  it('reports precache progress to pages that are not yet controlled', () => {
    // The installing worker controls nothing by definition — the page waiting
    // on the number is still being served by the *old* worker. Without
    // `includeUncontrolled` the plugin fires, posts to nobody, and the menu
    // shows a spinner that never moves for the whole download.
    expect(sw()).toMatch(/addPlugins\(\s*\[/);
    expect(sw()).toContain('PRECACHE_PROGRESS');
    expect(sw()).toMatch(/matchAll\(\{[^}]*includeUncontrolled:\s*true/);
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

/**
 * `rememberBases` and `prefetchPackFiles` (`src/content/packCache.ts`) each
 * run their own copy of the same check, because a worker cannot import from
 * `src/content/` and neither side can typecheck across the `postMessage`
 * between them (`tests/content/packCache.test.ts` covers the page's half).
 * A behavioural test would need a real service worker; this is the cheap
 * half, same as the rest of this file.
 */
describe('the pack route only trusts a base worth trusting', () => {
  it('requires the trailing slash before remembering a base', () => {
    const source = sw();
    expect(source).toContain('function isValidPackBase(base: string): boolean {');
    expect(source).toContain("if (!base.endsWith('/')) return false;");
    // The check has to actually gate `rememberBases`, not merely exist.
    expect(source).toMatch(/typeof base === 'string' && isValidPackBase\(base\)/);
  });

  it('requires an http(s) protocol before remembering a base', () => {
    const source = sw();
    expect(source).toMatch(/url\.protocol === 'http:'\s*\|\|\s*url\.protocol === 'https:'/);
  });

  it('routes a request whose Vary header the page-side write never carried', () => {
    // `packCache.ts` writes with `cache.put(urlString, …)`, an implicit
    // Request with no headers; this route matches the browser's real
    // request. Without `ignoreVary`, a pack host sending so much as
    // `Vary: Accept` makes every prefetched entry unmatchable offline.
    expect(sw()).toMatch(/matchOptions:\s*\{\s*ignoreVary:\s*true\s*\}/);
  });
});
