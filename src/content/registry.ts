import { PackRegistry } from './PackRegistry';
import { buildContentApi } from './ContentApi';
import { contentCatalog, resetContentCatalogForTests } from './catalog';
import { installBundledPackCode } from './install';

/**
 * The process's content, data *and* code — the one place a match, or
 * anything that needs a real spell class, asks for it.
 *
 * `contentCatalog()` (`./catalog.ts`) builds the shared `PackRegistry` and
 * installs the data half; this module calls it, then installs the code half
 * on top exactly once, memoised on its own `codeInstalled` flag rather than
 * on the registry's identity — the registry itself is already memoised one
 * level down, in `catalog.ts`, and re-deriving that here would be the two
 * stores this split is built to avoid (see `catalog.ts`'s own header).
 *
 * In the running game the first read is `main.ts`'s own warm call, the first
 * statement of `setup()` — so installation happens during the loading
 * screen, not on the pregame screen's first paint. Laziness is not what
 * schedules it there; the warm call is. What laziness buys is that a
 * **test** pays for the install only if it asks, and that no import order
 * can make this run too early.
 */
let codeInstalled = false;

export function contentRegistry(): PackRegistry {
  const registry = contentCatalog();
  if (!codeInstalled) {
    installBundledPackCode(registry, buildContentApi());
    codeInstalled = true;
  }
  return registry;
}

/**
 * Forget the registry so the next read builds and installs a fresh one —
 * and hand that fresh one back immediately, both halves installed.
 *
 * A newly installed runtime pack has to become visible without a page
 * reload, and the registry is memoised in two places (here and
 * `catalog.ts`). This is the one call that clears both and forces the
 * rebuild right away, rather than leaving it for whatever reads the
 * registry next. `resetContentRegistryForTests` below predates this by
 * name only — it clears the same two stores — but stays lazy on purpose;
 * see its own doc comment for the test that needs that.
 */
export function rebuildContentRegistry(): PackRegistry {
  resetContentCatalogForTests();
  codeInstalled = false;
  return contentRegistry();
}

/**
 * Forget the registry, so the next read builds and installs a fresh one —
 * both halves. Discards the instance (via `catalog.ts`'s own reset) rather
 * than calling `PackRegistry.reset()` on it: a test that has already
 * captured the old registry keeps a coherent object instead of one silently
 * emptied under it, and nothing outside these two modules holds the
 * reference, so the orphan is collected.
 *
 * Kept as its own body rather than delegating to `rebuildContentRegistry`:
 * that function eagerly rebuilds *and reinstalls the code half* before
 * returning, which several tests deliberately reset ahead of — see
 * `registry.test.ts`'s "contentCatalog() alone installs the data half and
 * nothing more", which needs the reset to stay lazy so it can observe
 * `spellIds()` still empty. Same reset, evaluated at the same two call
 * sites `rebuildContentRegistry` clears, just without forcing the rebuild
 * this instant.
 */
export function resetContentRegistryForTests(): void {
  resetContentCatalogForTests();
  codeInstalled = false;
}
