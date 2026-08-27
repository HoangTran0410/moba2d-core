import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  DEFAULT_CHAMPION_DEFENCE,
  type ChampionPresetData,
} from '@/game/gameObject/attackableUnits/Champion';
import Spell from '@/game/gameObject/Spell';
import { createGame, stubGameGlobals } from '../fixtures';

/**
 * How much punishment a champion takes before it dies — a question a pack
 * could not answer until this profile existed.
 *
 * `ChampionAttack` had been tunable per champion for a long time: damage,
 * rate, reach. Durability had not, so every champion in every pack was 100
 * health with no resistances — **less health than a minion's 140** — and a
 * bruiser and a marksman were, physically, the same body. Meanwhile the shop
 * grew: a full attack build reaches about 298 damage a second, against a pool
 * whose own doc comment says it was sized for roughly 15.
 *
 * The two halves this file holds are the migration guarantee (a pack that
 * declares nothing plays exactly as it did) and the resource rule (applying a
 * profile is tuning, never a heal).
 */
class Nothing extends Spell {
  name = 'Nothing';
  targetingMode = 'SELF' as const;
}

const preset = (defence?: ChampionPresetData['defence']): ChampionPresetData => ({
  name: 'Test',
  spells: [Nothing],
  ...(defence ? { defence } : {}),
});

const makeChampion = (defence?: ChampionPresetData['defence']) => {
  const game = createGame();
  const champion = new Champion({ game, position: createVector(0, 0), preset: preset(defence) });
  game.setPlayer(champion);
  return champion;
};

const TANK = { health: 220, healthRegen: 0.08, armor: 55, magicResist: 45 };

describe('a champion’s durability profile', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  describe('a pack that declares nothing', () => {
    it('gets exactly the champion it had before this field existed', () => {
      // The whole migration argument. If any of these four moves, a pack that
      // never opted in was retuned without being asked.
      const champion = makeChampion();

      expect(champion.stats.maxHealth.baseValue).toBe(100);
      expect(champion.stats.health.baseValue).toBe(100);
      expect(champion.stats.healthRegen.baseValue).toBe(DEFAULT_CHAMPION_DEFENCE.healthRegen);
      expect(champion.stats.armor.baseValue).toBe(0);
      expect(champion.stats.magicResist.baseValue).toBe(0);
    });

    it('records the numbers that were the problem', () => {
      // Not a tautology: 100 is *less than a minion's 140*, and it is here so
      // that raising it is a deliberate edit to this line rather than a
      // side-effect of a tuning pass somewhere else.
      expect(DEFAULT_CHAMPION_DEFENCE).toEqual({
        health: 100,
        healthRegen: 0.06,
        armor: 0,
        magicResist: 0,
      });
    });
  });

  describe('a pack that declares one', () => {
    it('lands all four on the champion’s stats', () => {
      const champion = makeChampion(TANK);

      expect(champion.stats.maxHealth.baseValue).toBe(220);
      expect(champion.stats.healthRegen.baseValue).toBe(0.08);
      expect(champion.stats.armor.baseValue).toBe(55);
      expect(champion.stats.magicResist.baseValue).toBe(45);
    });

    it('spawns the champion full, not on the old pool’s worth of health', () => {
      // A champion built with 220 health standing at 100 would be at 45% on
      // the frame it spawns, which reads as a bug and is one.
      expect(makeChampion(TANK).stats.health.baseValue).toBe(220);
    });

    it('makes the resistances mean something against a real hit', () => {
      // End to end rather than on the stat: 55 armour is 100/155, so a 100
      // physical hit lands for 65 — the whole reason to prefer resistances to
      // a bigger pool. See `combat/Mitigation.ts`.
      const champion = makeChampion(TANK);
      const before = champion.stats.health.baseValue;

      champion.takeDamage(100, undefined, 'PHYSICAL');
      expect(before - champion.stats.health.baseValue).toBe(65);

      const magic = makeChampion(TANK);
      magic.takeDamage(100, undefined, 'MAGIC');
      expect(220 - magic.stats.health.baseValue).toBe(69); // 100/145
    });
  });

  describe('applying a profile is tuning, never a heal', () => {
    it('leaves a wounded champion exactly as wounded when the pool is unchanged', () => {
      // The practice panel's loadout editor commits a whole loadout on every
      // edit. If this refilled, the editor would be a full heal on tap.
      const champion = makeChampion(TANK);
      champion.stats.health.baseValue = 7;

      champion.applyPreset(preset(TANK));

      // Exactly 7, not 7.000000000000001: a ratio round-trip through binary
      // floating point drifts, and the editor runs this on every keystroke.
      expect(champion.stats.health.baseValue).toBe(7);
    });

    it('keeps the fraction, not the amount, when the pool does change', () => {
      const champion = makeChampion(TANK);
      champion.stats.health.baseValue = 110; // half of 220

      champion.applyPreset(preset({ ...TANK, health: 400 }));

      expect(champion.stats.health.baseValue, 'still half').toBe(200);
    });

    it('never overfills, whatever the fraction was', () => {
      const champion = makeChampion(TANK);
      champion.stats.health.baseValue = 220;

      champion.applyPreset(preset({ ...TANK, health: 120 }));

      expect(champion.stats.health.baseValue).toBe(120);
    });

    it('does not resurrect a champion whose bar was empty', () => {
      const champion = makeChampion(TANK);
      champion.stats.health.baseValue = 0;

      champion.applyPreset(preset({ ...TANK, health: 400 }));

      expect(champion.stats.health.baseValue).toBe(0);
    });
  });
});
