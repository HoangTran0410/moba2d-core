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
