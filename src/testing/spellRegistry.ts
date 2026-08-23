import * as CoreSpells from '../game/gameObject/coreSpells/index';
import { buildContentApi, type ContentApi } from '../content/ContentApi';
import { registerSpellForTests, resetSpellRegistryForTests } from '../game/spellRegistry';

/**
 * Every pack spell's `default` export is now `(api: ContentApi) => SpellClass`
 * (batch 4 task 3), not the class itself — resolved here, against one shared
 * `buildContentApi()` singleton, so a barrel's entries come back as plain
 * constructible classes for every caller, exactly like they were before that
 * move. Exported on its own, distinct from `loadSpellsForTests` below,
 * because a test may want the resolved classes without touching the
 * registry — reading a barrel's own entries straight off the return value,
 * the way its members used to read directly, before they were factories.
 */
export function resolveSpellBarrel(barrel: Record<string, unknown>): Record<string, unknown> {
  const api = buildContentApi();
  return Object.fromEntries(
    Object.entries(barrel).map(([id, factory]) => [
      id,
      typeof factory === 'function' ? (factory as (api: ContentApi) => unknown)(api) : factory,
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
