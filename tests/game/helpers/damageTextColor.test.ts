import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';
import CombatText, { DAMAGE_TEXT_COLOR } from '../../../src/game/gameObject/helpers/CombatText';
import type { DamageType } from '../../../src/game/combat/Mitigation';

const combatTexts = (game: ReturnType<typeof createGame>): CombatText[] =>
  [...game.objectManager.objects, ...game.objectManager._objectToBeAdd].filter(
    (object): object is CombatText => object instanceof CombatText
  );

/**
 * Damage got a type and every number on screen stayed the same red, so a
 * player who bought armour had no way to tell whether the hit that went
 * through it was one armour was ever going to stop.
 *
 * Colour is the whole signal, and the merge key is what makes it hold: the
 * key is `(victim, kind, colour)`, so giving the three types three colours
 * *also* stops a physical hit and a magic hit on one victim blending into a
 * single number that hides which of them was which.
 */
describe('a damage number carries its type', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('gives the three types three different colours', () => {
    const seen = new Set(
      (['PHYSICAL', 'MAGIC', 'TRUE'] as DamageType[]).map(type => DAMAGE_TEXT_COLOR[type].join(','))
    );
    expect(seen.size, 'two damage types share a colour').toBe(3);
  });

  it('keeps the three far enough apart to tell apart at a glance', () => {
    // Written out as a distance rather than three inequalities on purpose: the
    // failure this guards is a retune that nudges two of them together, and
    // "they are different values" would still pass that.
    const types = ['PHYSICAL', 'MAGIC', 'TRUE'] as DamageType[];
    for (const a of types) {
      for (const b of types) {
        if (a === b) continue;
        const distance = Math.hypot(
          ...DAMAGE_TEXT_COLOR[a].map((channel, i) => channel - DAMAGE_TEXT_COLOR[b][i])
        );
        expect(distance, `${a} and ${b} are near-identical on screen`).toBeGreaterThan(90);
      }
    }
  });

  it('keeps every one of them clear of the heal green', () => {
    // Green is already on screen and already means the opposite thing. A
    // damage colour that lands near it is a number a player reads as a heal.
    for (const type of ['PHYSICAL', 'MAGIC', 'TRUE'] as DamageType[]) {
      const distance = Math.hypot(...DAMAGE_TEXT_COLOR[type].map((c, i) => c - [0, 255, 0][i]));
      expect(distance, `${type} sits on top of the heal green`).toBeGreaterThan(120);
    }
  });

  it('does not merge a physical hit into a magic one on the same victim', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    unit.takeDamage(15, undefined, 'PHYSICAL');
    unit.takeDamage(10, undefined, 'MAGIC');

    const texts = combatTexts(game);
    expect(texts, 'two damage types blended into one number').toHaveLength(2);
    expect(texts.map(t => t.text).sort()).toEqual(['-10', '-15']);
  });

  it('still merges repeated hits of the same type', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    unit.takeDamage(15, undefined, 'PHYSICAL');
    unit.takeDamage(10, undefined, 'PHYSICAL');

    const texts = combatTexts(game);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe('-25');
  });

  it('paints a hit in its own type’s colour, not a single red for all of them', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    unit.takeDamage(15, undefined, 'MAGIC');

    expect(combatTexts(game)[0].textColor).toEqual(DAMAGE_TEXT_COLOR.MAGIC);
  });
});
