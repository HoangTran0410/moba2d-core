/**
 * Which requests belong to a pack — the rule the page and the worker have to
 * agree on exactly.
 *
 * It lived twice: `packCache.ts` checked a base on the way out and `sw.ts`
 * checked it again on the way in, each with its own copy and a comment saying
 * neither could import the other's. That was true of `src/content/` (the
 * worker is a separate TypeScript program, `lib: WebWorker` against the root
 * program's DOM) and not true of a module that touches neither lib. This is
 * that module, and it is in both `include` lists.
 *
 * The rule gained a second half, which is why it stopped being worth
 * duplicating: **the manifest is not a pack file.** Serving it `CacheFirst`
 * froze it on first fetch, so a pack that had ever been installed could never
 * see a newer build of itself — the update path did not fail, it did not
 * exist.
 */
import { describe, expect, it } from 'vitest';
import { isPackRequest, isValidPackBase } from '@/seams/packRoute';

const BASE = 'https://packs.example/riot/';
const MANIFEST = 'https://packs.example/riot/manifest.json';

describe('isValidPackBase', () => {
  it('accepts an absolute http(s) URL ending in a slash', () => {
    expect(isValidPackBase(BASE)).toBe(true);
    expect(isValidPackBase('http://localhost:5173/p/')).toBe(true);
  });

  /**
   * The route is a prefix test, so an unslashed base would also claim
   * `https://h/riot-evil/anything` — the pack cache filled from one host and
   * served to a sibling path.
   */
  it('refuses a base with no trailing slash', () => {
    expect(isValidPackBase('https://packs.example/riot')).toBe(false);
  });

  it('refuses a non-http scheme and a non-URL', () => {
    expect(isValidPackBase('file:///riot/')).toBe(false);
    expect(isValidPackBase('not a url')).toBe(false);
  });
});

describe('isPackRequest', () => {
  it('claims a file under an announced base', () => {
    expect(isPackRequest(`${BASE}chunks/Alpha_Q-abc.js`, [BASE], [])).toBe(true);
  });

  it('does not claim a sibling path that merely shares the prefix', () => {
    expect(isPackRequest('https://packs.example/riot-evil/x.js', [BASE], [])).toBe(false);
  });

  it('does not claim anything when no base is announced', () => {
    expect(isPackRequest(`${BASE}pack.js`, [], [])).toBe(false);
  });

  /**
   * The whole reason this function exists rather than a bare `startsWith`.
   * The manifest is how core learns a pack has a new build; answering it from
   * a cache that is never revalidated is answering "no, it does not" for ever.
   */
  it('refuses the manifest itself, even though it sits under the base', () => {
    expect(isPackRequest(MANIFEST, [BASE], [MANIFEST])).toBe(false);
  });

  it('still claims everything else under a base whose manifest is excluded', () => {
    expect(isPackRequest(`${BASE}pack.js`, [BASE], [MANIFEST])).toBe(true);
  });

  /**
   * `pack.js?b=<buildId>` is one URL per build (`packSource.ts`'s
   * `pinEntryToBuild`). The route has to claim it, or every entry load skips
   * the cache and the offline case loses its root.
   */
  it('claims an entry carrying its build id', () => {
    expect(isPackRequest(`${BASE}pack.js?b=a1b2c3`, [BASE], [MANIFEST])).toBe(true);
  });

  it('excludes a manifest asked for with a cache-busting query too', () => {
    // The update check fetches the manifest fresh. If a query were enough to
    // dodge the exclusion, the check would populate the cache with the very
    // answer it exists to bypass.
    expect(isPackRequest(`${MANIFEST}?t=123`, [BASE], [MANIFEST])).toBe(false);
  });
});
