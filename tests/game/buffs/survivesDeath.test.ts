import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Buff from '@/game/gameObject/Buff';

/**
 * Death's sweep, and the one thing allowed to ride through it.
 *
 * A permanent growth stack — a Feast, an eaten heart — promises "vĩnh viễn",
 * and the first version let `clearBuffs` eat every one of them with the rest
 * of the corpse's state. `Buff.survivesDeath` is the opt-out, and this pins
 * both halves: the survivor stays live, and everything else is still unwound
 * exactly as before.
 */
describe('a buff that survives its wearer death', () => {
  let game: TestGame;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rides through the sweep while everything else is cleared', () => {
    const champion = new Champion({ game, teamId: 'blue' });
    champion.stats.maxHealth.baseValue = 100;
    champion.stats.health.baseValue = 100;
    const killer = new Champion({ game, teamId: 'red' });
    game.setPlayer(champion);
    indexObjects(game, [champion, killer]);

    const growth = new Buff(0, champion, champion);
    growth.stackId = 'test_growth';
    growth.survivesDeath = true;
    const ordinary = new Buff(5_000, champion, champion);
    ordinary.stackId = 'test_ordinary';
    champion.addBuff(growth);
    champion.addBuff(ordinary);

    champion.takeDamage(1_000, killer, 'TRUE');

    expect(champion.isDead).toBe(true);
    expect(ordinary.toRemove).toBe(true);
    expect(growth.toRemove).toBe(false);
    expect(champion.buffs).toContain(growth);
    expect(champion.buffs).not.toContain(ordinary);
  });
});
