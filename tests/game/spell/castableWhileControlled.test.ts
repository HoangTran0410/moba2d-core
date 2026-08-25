import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Spell from '@/game/gameObject/Spell';
import Stun from '@/game/gameObject/buffs/Stun';
import Silence from '@/game/gameObject/buffs/Silence';
import type { CastSpec } from '@/game/spell/runtime/types';

/**
 * The one spell that has to work while its caster cannot act.
 *
 * Every gate in `Spell` reads `owner.canCast`, which `Stats.updateActionState`
 * clears for Stunned, Silenced, Charmed, Feared, Taunted and Suppressed. That
 * is right for every ability — a stun that did not stop casting would not be a
 * stun — and exactly wrong for the one effect whose *purpose* is getting out of
 * one. A Quicksilver-style cleanse that refuses while you are stunned is an
 * item that does nothing on the only occasion anybody buys it.
 *
 * So the opt-out is narrow and it is the spell's own: `castableWhileControlled`
 * defaults to false and a pack overrides it on the handful of spells that
 * genuinely are a way out. It buys past crowd control and nothing else — death,
 * cooldown, mana, health cost and `checkCastCondition` all still apply, because
 * none of those is what a cleanse is for.
 */
class Cleanse extends Spell {
  name = 'Cleanse';
  coolDown = 0;
  manaCost = 0;
  targetingMode = 'SELF' as const;
  castableWhileControlled = true;
  cast_count = 0;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: 0 },
    };
  }

  onSpellCast(): void {
    this.cast_count += 1;
  }
}

class Ordinary extends Cleanse {
  name = 'Ordinary';
  castableWhileControlled = false;
}

describe('castableWhileControlled', () => {
  let game: TestGame;
  let champion: Champion;
  let enemy: Champion;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    enemy = new Champion({ game, position: createVector(200, 0), teamId: 'red' });
    game.setPlayer(champion);
    indexObjects(game, [champion, enemy]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stun = (): void => {
    champion.addBuff(new Stun(3_000, enemy, champion));
    // Status flags are rebuilt in `update`, not on `addBuff`.
    champion.update();
    expect(champion.canCast, 'the stun never took hold').toBe(false);
  };

  it('is false by default, which is every spell that is not a way out', () => {
    expect(new Ordinary(champion).castableWhileControlled).toBe(false);
  });

  it('lets a marked spell be pressed through a stun', () => {
    const spell = new Cleanse(champion);
    stun();

    expect(spell.isCastableNow, 'refused before it was even pressed').toBe(true);
    expect(spell.castCancelCheck(), 'the cast path cancelled it').toBe(false);
  });

  it('still refuses an ordinary spell through the same stun', () => {
    const spell = new Ordinary(champion);
    stun();

    expect(spell.isCastableNow).toBe(false);
    expect(spell.castCancelCheck()).toBe(true);
  });

  it('works through a silence too, not only a stun', () => {
    const spell = new Cleanse(champion);
    champion.addBuff(new Silence(3_000, enemy, champion));
    champion.update();
    expect(champion.canCast).toBe(false);

    expect(spell.isCastableNow).toBe(true);
  });

  it('buys past crowd control and nothing else', () => {
    // The boundary that keeps this from being "this spell ignores the rules".
    // A cleanse is not a resurrection, and it is not free.
    const spell = new Cleanse(champion);
    spell.manaCost = 40;
    champion.stats.mana.baseValue = 10;
    stun();
    expect(spell.isCastableNow, 'it cast without paying').toBe(false);

    champion.stats.mana.baseValue = 500;
    expect(spell.isCastableNow).toBe(true);

    champion.takeDamage(99_999, enemy, 'TRUE');
    expect(spell.isCastableNow, 'a corpse cleansed itself').toBe(false);
  });
});
