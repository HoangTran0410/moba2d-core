import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Stasis from '../../../src/game/gameObject/buffs/Stasis';
import ActionState from '../../../src/game/enums/ActionState';
import StatusFlags from '../../../src/game/enums/StatusFlags';
import { hasFlag } from '../../../src/utils/index';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  installSketchMathGlobals,
  type TestGame,
} from '../spell/fixtures';

/**
 * Zhonya's-style stasis is "hoá tượng vàng": the unit is *gone* from the fight
 * while remaining on the ground. That is five denials at once, and shipping
 * with any one missing reads as a bug in a real match — the report that
 * produced this file was a statue that bodies still piled up against:
 *
 *  - untargetable (nothing may pick it, and skillshots pass through — both
 *    read `targetable`);
 *  - invulnerable (`modifyIncomingDamage` eats everything);
 *  - unable to move, cast or attack (`Stunned` — which is also what makes
 *    `Spell.observeInterrupts` cancel whatever it was casting or channelling);
 *  - immovable (a hostile dash must not drag the statue);
 *  - and *not a body* (`PhasesUnits` — `collidesWithUnits` goes false, so the
 *    separation pass neither pushes it nor lets it block anyone).
 */
describe('Stasis locks the unit out of the fight in both directions', () => {
  let game: TestGame;
  let unit: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    unit = createUnit(game, 0, 'blue');
    game.setPlayer(unit);
  });

  afterEach(() => vi.unstubAllGlobals());

  function apply(buff: Stasis) {
    unit.addBuff(buff);
    unit.updateBuffs();
  }

  it('makes the unit untargetable and non-colliding, and takes move/cast/attack away', () => {
    apply(new Stasis(2_500, unit, unit));

    expect(unit.targetable).toBe(false);
    expect(unit.collidesWithUnits).toBe(false);
    expect(hasFlag(unit.stats.actionState, ActionState.CAN_MOVE)).toBe(false);
    expect(hasFlag(unit.stats.actionState, ActionState.CAN_CAST)).toBe(false);
    expect(hasFlag(unit.stats.actionState, ActionState.CAN_ATTACK)).toBe(false);
  });

  it('raises Immovable, so a displacement finds nothing to move', () => {
    apply(new Stasis(2_500, unit, unit));

    expect(hasFlag(unit.status, StatusFlags.Immovable)).toBe(true);
    // `Dash.canApplyTo` reads `canMove`, which Immovable/Stunned both clear
    expect(unit.canMove).toBe(false);
  });

  it('keeps terrain honest: a statue is not a ghost', () => {
    apply(new Stasis(2_500, unit, unit));

    // PhasesUnits clears bodies only; IS_GHOSTED (bodies *and* walls) stays off
    expect(hasFlag(unit.stats.actionState, ActionState.IS_GHOSTED)).toBe(false);
  });

  it('eats all incoming damage', () => {
    const stasis = new Stasis(2_500, unit, unit);
    expect(stasis.modifyIncomingDamage()).toBe(0);
  });

  it('hands everything back when it ends', () => {
    const stasis = new Stasis(2_500, unit, unit);
    apply(stasis);

    stasis.deactivateBuff();
    unit.updateBuffs();

    expect(unit.targetable).toBe(true);
    expect(unit.collidesWithUnits).toBe(true);
    expect(hasFlag(unit.stats.actionState, ActionState.CAN_MOVE)).toBe(true);
    expect(hasFlag(unit.stats.actionState, ActionState.CAN_CAST)).toBe(true);
    expect(hasFlag(unit.status, StatusFlags.Immovable)).toBe(false);
  });
});
