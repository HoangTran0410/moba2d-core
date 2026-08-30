import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import { DEFAULT_CHAMPION_SCALE, resolveChampionScale } from '@/game/config/mapTuning';
import { mapRuleGroups } from '@/game/hud/config/mapRuleLines';
import type { MapTuning } from '@/content/ContentPack';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * A map scaling the champions who play on it.
 *
 * Multipliers rather than absolutes, for `MonsterScale`'s reason: the base is
 * whatever pack fills the roster and a map cannot know it. Sixty champions each
 * declare their own health, so "everyone has 400 health" is a statement a map
 * has no business making — while "everybody is twice as durable here" is one it
 * can make about itself, and one that changes how a map plays more than any
 * other single number.
 *
 * The half a pure resolver test cannot see is that the numbers are *applied*.
 * A multiplier resolved and never multiplied is a knob that does nothing and
 * looks correct in the schema, in the editor and in the resolver.
 */

const PRESET = {
  name: 'Thử',
  spells: [],
  attack: { damage: 60, attacksPerSecond: 1, range: 300 },
  defence: { health: 500, healthRegen: 1, armor: 20, magicResist: 20 },
};

describe('resolving the scale', () => {
  it('is one across the board when a map says nothing', () => {
    expect(resolveChampionScale(undefined)).toEqual(DEFAULT_CHAMPION_SCALE);
    expect(resolveChampionScale({})).toEqual(DEFAULT_CHAMPION_SCALE);
  });

  it('takes the map’s number where it has one, and leaves the rest at one', () => {
    expect(resolveChampionScale({ champions: { healthMult: 2 } })).toEqual({
      healthMult: 2,
      damageMult: 1,
      speedMult: 1,
    });
  });

  it('refuses a negative multiplier rather than making an unkillable corpse', () => {
    // `validate.ts` catches this at install and that does not help a
    // locally-built map — which is exactly the kind somebody is holding when
    // they type a minus sign by accident.
    expect(resolveChampionScale({ champions: { healthMult: -3 } }).healthMult).toBe(0);
  });
});

describe('the scale reaching a champion', () => {
  let game: TestGame;

  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  const championOn = (tuning?: MapTuning) => {
    game = createGame() as TestGame & { mapTuning?: MapTuning };
    (game as { mapTuning?: MapTuning }).mapTuning = tuning;
    return new Champion({ game, teamId: 'blue', preset: PRESET });
  };

  it('leaves every number alone on a map that declares nothing', () => {
    // The control, and it is the case that matters most: every map that has
    // ever shipped is this one.
    const plain = championOn();
    expect(plain.stats.maxHealth.baseValue).toBe(500);
    expect(plain.stats.attackDamage.baseValue).toBe(60);
  });

  it('multiplies the pack’s health, and starts the champion full', () => {
    const tanky = championOn({ champions: { healthMult: 2 } });
    expect(tanky.stats.maxHealth.baseValue).toBe(1_000);
    expect(tanky.stats.health.baseValue).toBe(1_000);
  });

  it('multiplies the pack’s attack damage', () => {
    expect(championOn({ champions: { damageMult: 1.5 } }).stats.attackDamage.baseValue).toBe(90);
  });

  it('multiplies movement speed, which no pack declares', () => {
    const base = championOn().stats.speed.baseValue;
    expect(championOn({ champions: { speedMult: 2 } }).stats.speed.baseValue).toBe(base * 2);
  });

  it('leaves armour and magic resist to the pack', () => {
    // A deliberate boundary, not an omission: durability is `healthMult`'s
    // job, and a second durability axis is another interaction to reason about
    // when a map turns out to play badly.
    const tanky = championOn({ champions: { healthMult: 3 } });
    expect(tanky.stats.armor.baseValue).toBe(20);
    expect(tanky.stats.magicResist.baseValue).toBe(20);
  });

  it('re-applies when a champion is given a different preset', () => {
    // `applyPreset` runs again when a bot respawns as somebody else. Scaling
    // only in the constructor would leave that bot on the pack's raw numbers
    // for the rest of the match.
    const champion = championOn({ champions: { healthMult: 2 } });
    champion.applyPreset({
      ...PRESET,
      name: 'Khác',
      defence: { health: 300, healthRegen: 1, armor: 10, magicResist: 10 },
    });
    expect(champion.stats.maxHealth.baseValue).toBe(600);
  });
});

describe('what the picker says about it', () => {
  it('reports each multiplier that moved, against ×1', () => {
    const lines = mapRuleGroups({ champions: { healthMult: 2, speedMult: 1 } }).find(
      group => group.title === 'Tướng'
    )!.lines;

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ label: 'Máu tướng', value: '×2', standard: '×1' });
  });
});
