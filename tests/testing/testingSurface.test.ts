import { describe, expect, it } from 'vitest';
import * as testing from '../../src/testing';
import * as spellTesting from '../../src/testing/spellWorld';
import * as spellRegistryTesting from '../../src/testing/spellRegistry';

/**
 * `@moba2d/core/testing` is a designed entry point, not a hole in the wall.
 * If it becomes the place core internals leak out of, then changing
 * `AttackableUnit` is a breaking change for every pack again — through the
 * back door, with none of the review that closing the front door bought.
 * Widening this list is allowed and is meant to be a visible act: add the
 * name here, in the same commit, with a sentence saying what an observer
 * needs it for.
 *
 * Shrinking it is exactly as deliberate. `spellGroups` left this list
 * (`src/testing/engine.ts` no longer re-exports it) because it resolves
 * and then answers nothing for a genuinely separated pack: it reads
 * `contentRegistry()`, which core fills solely from its own generated
 * `installedPacks.ts`, correctly empty once a pack is no longer in core's
 * own tree. A surface that resolves and answers empty fails quietly — worse
 * than one that fails to resolve at all, because nothing tells the caller
 * to look here rather than in their own code. See `engine.ts`'s own header
 * for the full account, found by running a pack's tests from outside this
 * checkout (`npm run verify:pack-standalone`).
 */
describe('@moba2d/core/testing', () => {
  it('exports exactly this list', () => {
    expect(Object.keys(testing).sort()).toEqual(
      [
        'BasicAttack',
        'BasicAttackSwing',
        'EventManager',
        'FogOfWar',
        'HotKeys',
        'LANES',
        'Lane',
        'MAX_ATTACK_SPEED',
        'MELEE_RANGE_THRESHOLD',
        'MELEE_WINDUP_MS',
        'Minion',
        'PackRegistry',
        'SpellHotKeys',
        'SpellInputController',
        'Stats',
        'TEST_AVATAR_KEY',
        'TeamId',
        'TestVector',
        'buildTestApi',
        'createGame',
        'getLaneWaypoints',
        'indexObjects',
        'installEngineGlobalsForTests',
        'installPackForTests',
        'setActiveLanes',
        'stubGameGlobals',
        'validatePack',
        'withWalls',
      ].sort()
    );
  });
});

/**
 * `@moba2d/core/testing/spell` is the second door — driving a single spell
 * the way a keypress does. Pinned the same way and for the same reason.
 */
describe('@moba2d/core/testing/spell', () => {
  it('exports exactly this list', () => {
    expect(Object.keys(spellTesting).sort()).toEqual(
      [
        'TestVector',
        'installSpellObjectGlobals',
        'installSketchMathGlobals',
        'createGame',
        'createUnit',
        'castContextFor',
        'pressSpell',
        'releaseSpell',
        'withCastTime',
        'withWalls',
      ].sort()
    );
  });
});

/**
 * `@moba2d/core/testing/spells` is the third door, and deliberately not part
 * of the `@moba2d/core/testing` barrel above — not because filling core's
 * whole spell registry is unresolvable for a separated pack (it is not:
 * `src/game/spellRegistry.ts`, which it drags in, reaches core's
 * content-install graph, and that graph regenerates with no pack reference
 * at all the moment a pack is not physically installed, which is how core
 * actually ships), but because `export *` evaluates the whole module a
 * barrel line names regardless of which binding a caller destructures. Left
 * in the barrel, every pack test file that imports anything at all from
 * `@moba2d/core/testing` would evaluate that whole graph, whether or not it
 * ever calls `loadSpellsForTests` — the same eager-loading cost `./setup`'s
 * own split from this barrel was measured against. A pack that wants the
 * whole registry filled says so explicitly, at this subpath, and a pack
 * that only wants to build a world never pays for it. Pinned the same way
 * and for the same reason as the other two doors.
 */
describe('@moba2d/core/testing/spells', () => {
  it('exports exactly this list', () => {
    expect(Object.keys(spellRegistryTesting).sort()).toEqual(
      ['loadSpellsForTests', 'resolveSpellBarrel'].sort()
    );
  });
});
