import * as CoreSpells from '../game/gameObject/coreSpells/index';
import { buildContentApi, type ContentApi } from '../content/ContentApi';
import { registerSpellForTests, resetSpellRegistryForTests } from '../game/spellRegistry';

/**
 * A barrel's entries, as constructible classes, whichever shape the pack uses.
 *
 * Two shapes exist and both are legitimate. A pack may export the class
 * directly — the engine having arrived through its own `packApi` module before
 * the barrel loaded — or it may export `(api: ContentApi) => SpellClass`, the
 * factory form that came in when packs first stopped importing core. This
 * resolves the second against one shared `buildContentApi()` singleton and
 * passes the first through untouched.
 *
 * Telling them apart is `class` in the function's own source, which is what
 * the language gives us: both are `typeof === 'function'`, and calling a class
 * without `new` is a `TypeError` rather than anything a caller could recover
 * from. That failure is exactly how this was found — `loadSpellsForTests`
 * invoking a migrated pack's class and reporting "Class constructor … cannot
 * be invoked without 'new'" from inside core, four frames from any file the
 * pack author wrote.
 *
 * Exported on its own, distinct from `loadSpellsForTests` below, because a
 * test may want the resolved classes without touching the registry.
 */
function isClass(value: unknown): boolean {
  return typeof value === 'function' && /^\s*class\s/.test(Function.prototype.toString.call(value));
}

export function resolveSpellBarrel(barrel: Record<string, unknown>): Record<string, unknown> {
  const api = buildContentApi();
  return Object.fromEntries(
    Object.entries(barrel).map(([id, entry]) => [
      id,
      typeof entry === 'function' && !isClass(entry)
        ? (entry as (api: ContentApi) => unknown)(api)
        : entry,
    ])
  );
}

/**
 * Fill the spell registry, synchronously, for tests that need the whole
 * catalogue resolvable.
 *
 * In the game the registry is filled by dynamic import, one chunk per champion
 * (`src/game/spellRegistry.ts`). A test that wants to walk every champion's kit
 * does not want 238 `await import()`s and the transform cost that comes with
 * them, and it does not need them: `spells/index.ts` and `coreSpells/index.ts`
 * are still the two barrels the generator reads to build `spellModules.ts`, so
 * importing both here registers exactly the same set the browser would end up
 * with.
 *
 * That equivalence is the thing to protect, and `spellRegistry.test.ts` asserts
 * it — barrel keys and generated module keys must be the same set, or this
 * helper is quietly testing a different game than the one that ships.
 *
 * The barrels arrive as arguments because core does not get to know which
 * packs exist. That is the same rule `TeamBlackboard` learned and the same
 * one `src/generated/installedPacks.ts` exists to serve: a list of installed
 * content is derived at build time, never written into engine source. The old
 * version of this file imported `packs/riot/spells/index` by relative path,
 * which is a specifier that resolves to nothing the day that directory is a
 * repository of its own.
 */
export function loadSpellsForTests(...barrels: Record<string, unknown>[]): void {
  resetSpellRegistryForTests();
  const resolved: Record<string, unknown> = {};
  for (const barrel of barrels) {
    Object.assign(resolved, resolveSpellBarrel(barrel));
  }
  Object.assign(resolved, CoreSpells);
  for (const [id, spellClass] of Object.entries(resolved)) {
    if (typeof spellClass === 'function') registerSpellForTests(id, spellClass);
  }
}
