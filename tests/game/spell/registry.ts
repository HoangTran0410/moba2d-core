import makeVeraQ from '../../../packs/reference/spells/Vera_Q';
import makeVeraW from '../../../packs/reference/spells/Vera_W';
import makeVeraE from '../../../packs/reference/spells/Vera_E';
import makeVeraR from '../../../packs/reference/spells/Vera_R';
import { loadSpellsForTests, resolveSpellBarrel } from '../../../src/testing/spellRegistry';
import * as CoreSpells from '../../../src/game/gameObject/coreSpells/index';

/**
 * Content-pack-and-repo-split batch 6 task 10, fix round 1: this file used
 * to import `packs/riot/spells/index` by relative path — a specifier that
 * resolves to nothing now that directory is a repository of its own
 * (`@moba2d/content-riot`, not `packs/riot/`). `loadSpellsForTests` was
 * already written to take its barrels as arguments rather than reach for
 * one by name (see that function's own doc comment — "core does not get to
 * know which packs exist"); this file was the one caller that had not
 * caught up, reaching directly into the pack it had no business naming.
 *
 * Repointed at `packs/reference/` — core's own pack, never optional, always
 * present — rather than deleted or synthesized: `loadEverySpellForTests()`
 * has six dependent test files that walk "every installed spell" to check
 * an engine rule holds across the whole catalogue (`AttackProfiles.test.ts`
 * and others via `spellCatalog.test.ts`, `MatchDirector.loadout.test.ts`,
 * `range-preview.test.ts`), and a smaller real corpus — core's own two
 * spells plus the reference pack's four — is a smaller sample for those,
 * not a broken one. `packs/reference/` has no `spells/index.ts` barrel of
 * its own the way `packs/riot/` did (its four spells are imported
 * individually by `packs/reference/code.ts`), so this barrel object is
 * built the same way, inline, rather than inventing a production file this
 * pack has never needed for its own sake.
 */
const referenceSpellFactories = {
  Vera_Q: makeVeraQ,
  Vera_W: makeVeraW,
  Vera_E: makeVeraE,
  Vera_R: makeVeraR,
};

const AllSpells = resolveSpellBarrel(referenceSpellFactories);

export function loadEverySpellForTests(): void {
  loadSpellsForTests(referenceSpellFactories);
}

export { AllSpells, CoreSpells };
