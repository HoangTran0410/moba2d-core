/**
 * The three-layer merge, on plain objects.
 *
 * The first case in every block is the one that matters most: **absent tuning
 * reproduces today's numbers exactly**. That is the whole compatibility
 * promise of `MapTuning`, and it is the assertion that would catch a default
 * quietly moving — a suite that only covered the new values would pass just
 * as happily with `DEFAULT_TURRET_PRESET` rewritten underneath it.
 */
import { describe, expect, it } from 'vitest';
import type { MapTuning } from '../../../src/content/ContentPack';
import {
  DEFAULT_CHAMPION_REVIVE_MS,
  DEFAULT_ECONOMY,
  DEFAULT_FOUNTAIN_STATS,
  resolveChampionRevive,
  resolveEconomy,
  resolveFountainStats,
  resolveMonsterPreset,
  resolveTerrainTuning,
  resolveTurretPreset,
} from '../../../src/game/config/mapTuning';
import { DEFAULT_TURRET_PRESET } from '../../../src/game/gameObject/structures/Turret';
import {
  MONSTER_CHASE_MARGIN,
  MONSTER_GIVE_UP_DELAY_MS,
  type MonsterPresetData,
} from '../../../src/game/gameObject/attackableUnits/Monster';

const packBody = (): MonsterPresetData => ({
  name: 'Wolf',
  avatar: 'monster_wolf',
  camp: { x: 0, y: 0, r: 300 },
  speed: 2,
  size: 40,
  attackRange: 50,
  reviveTime: 3_000,
  health: 100,
  damage: 10,
  attackInterval: 1_500,
  aggroRange: 200,
});

describe('champion respawn', () => {
  it('is a flat 5000 with no tuning — what the engine always did', () => {
    expect(resolveChampionRevive(undefined, 0)).toBe(DEFAULT_CHAMPION_REVIVE_MS);
    expect(resolveChampionRevive(undefined, 30 * 60_000)).toBe(DEFAULT_CHAMPION_REVIVE_MS);
  });

  it('takes a flat override', () => {
    const tuning: MapTuning = { champions: { reviveTime: 12_000 } };
    expect(resolveChampionRevive(tuning, 0)).toBe(12_000);
    expect(resolveChampionRevive(tuning, 20 * 60_000)).toBe(12_000);
  });

  it('grows along a curve and stops at its ceiling', () => {
    const tuning: MapTuning = {
      champions: { reviveCurve: { base: 8_000, perMinute: 2_500, max: 60_000 } },
    };
    expect(resolveChampionRevive(tuning, 0)).toBe(8_000);
    expect(resolveChampionRevive(tuning, 4 * 60_000)).toBe(18_000);
    // 8000 + 2500 * 20.8 = 60000 exactly; anything later is clamped.
    expect(resolveChampionRevive(tuning, 40 * 60_000)).toBe(60_000);
    expect(resolveChampionRevive(tuning, 90 * 60_000)).toBe(60_000);
  });

  it('lets the curve win when a map states both', () => {
    // The more specific statement, rather than an average nobody wrote.
    const tuning: MapTuning = {
      champions: { reviveTime: 999, reviveCurve: { base: 5_000, perMinute: 0, max: 60_000 } },
    };
    expect(resolveChampionRevive(tuning, 0)).toBe(5_000);
  });
});

describe('economy', () => {
  it('with no tuning is exactly what Wallet.ts declares', () => {
    expect(resolveEconomy(undefined)).toEqual({ ...DEFAULT_ECONOMY });
  });

  it('takes a map\'s own numbers', () => {
    const economy = resolveEconomy({
      economy: { startingGold: 1_500, passiveGoldPerSecond: 8, turretBounty: 40 },
    });
    expect(economy.startingGold).toBe(1_500);
    expect(economy.passiveGoldPerSecond).toBe(8);
    expect(economy.turretBounty).toBe(40);
    // Untouched fields still come from core, which is what makes a map able to
    // move one number without restating the other five.
    expect(economy.minionBounty).toBe(DEFAULT_ECONOMY.minionBounty);
  });

  it('refuses a negative purse rather than paying out debt', () => {
    expect(resolveEconomy({ economy: { startingGold: -100 } }).startingGold).toBe(0);
  });

  it('ignores a non-finite number rather than propagating it', () => {
    expect(resolveEconomy({ economy: { minionBounty: NaN } }).minionBounty).toBe(
      DEFAULT_ECONOMY.minionBounty
    );
  });
});

describe('turrets', () => {
  it('with no tuning is exactly DEFAULT_TURRET_PRESET', () => {
    expect(resolveTurretPreset(undefined)).toEqual({ ...DEFAULT_TURRET_PRESET });
  });

  it('takes the map layer', () => {
    const preset = resolveTurretPreset({ turrets: { damage: 40, attackRange: 900 } });
    expect(preset.damage).toBe(40);
    expect(preset.attackRange).toBe(900);
    // Untouched fields still come from core.
    expect(preset.health).toBe(DEFAULT_TURRET_PRESET.health);
  });

  it('lets a slot beat the map — the point of the third layer', () => {
    // An outer turret weaker than a base one, on one map, is most of what
    // makes two maps built from the same parts play differently.
    const tuning: MapTuning = { turrets: { health: 400, damage: 12 } };
    const preset = resolveTurretPreset(tuning, { stats: { health: 1_200 } });
    expect(preset.health).toBe(1_200);
    expect(preset.damage).toBe(12);
  });

  it('ignores a non-finite override rather than propagating it', () => {
    const preset = resolveTurretPreset({ turrets: { damage: NaN } });
    expect(preset.damage).toBe(DEFAULT_TURRET_PRESET.damage);
  });
});

describe('fountain', () => {
  it('with no tuning is the literals fountainsFromSlots used to hardcode', () => {
    expect(resolveFountainStats(undefined)).toEqual({ ...DEFAULT_FOUNTAIN_STATS });
  });

  it('takes map and slot layers, innermost first', () => {
    const tuning: MapTuning = { fountain: { healPercent: 0.3, name: 'Suối' } };
    const stats = resolveFountainStats(tuning, { stats: { healPercent: 0.05 } });
    expect(stats.healPercent).toBe(0.05);
    expect(stats.name).toBe('Suối');
    expect(stats.manaPercent).toBe(DEFAULT_FOUNTAIN_STATS.manaPercent);
  });
});

describe('monsters', () => {
  it('with no tuning hands back the pack body untouched', () => {
    const base = packBody();
    const resolved = resolveMonsterPreset(base, undefined);
    expect(resolved.health).toBe(100);
    expect(resolved.speed).toBe(2);
    expect(resolved.damage).toBe(10);
    expect(resolved.attackInterval).toBe(1_500);
    expect(resolved.aggroRange).toBe(200);
    expect(resolved.reviveTime).toBe(3_000);
    expect(resolved.chaseMargin).toBe(MONSTER_CHASE_MARGIN);
    expect(resolved.giveUpDelayMs).toBe(MONSTER_GIVE_UP_DELAY_MS);
  });

  it('scales rather than replaces at the map layer', () => {
    // A map cannot know what fills its slots, so a multiplier is the only
    // thing it can say that stays true across packs.
    const resolved = resolveMonsterPreset(packBody(), {
      monsters: { healthMult: 2, damageMult: 1.5, speedMult: 0.5 },
    });
    expect(resolved.health).toBe(200);
    expect(resolved.damage).toBe(15);
    expect(resolved.speed).toBe(1);
  });

  it('applies a slot absolute after the multipliers, not through them', () => {
    // 400, not 400 × 2. A slot names one camp on one map and means it.
    const resolved = resolveMonsterPreset(
      packBody(),
      { monsters: { healthMult: 2 } },
      { stats: { health: 400 } }
    );
    expect(resolved.health).toBe(400);
  });

  it('compounds a slot multiplier on top of the map one', () => {
    const resolved = resolveMonsterPreset(
      packBody(),
      { monsters: { healthMult: 2 } },
      { stats: { healthMult: 3 } }
    );
    expect(resolved.health).toBe(600);
  });

  it('leaves an absent optional absent so Monster can still derive it', () => {
    // `damage` defaults to a share of the camp's health inside `Monster`.
    // Inventing a number here would silently take that away.
    const base = { ...packBody(), damage: undefined, attackInterval: undefined };
    const resolved = resolveMonsterPreset(base, { monsters: { damageMult: 2 } });
    expect(resolved.damage).toBeUndefined();
    expect(resolved.attackInterval).toBeUndefined();
  });

  it('carries chase margin and give-up delay from the map', () => {
    const resolved = resolveMonsterPreset(packBody(), {
      monsters: { chaseMargin: 50, giveUpDelayMs: 400 },
    });
    expect(resolved.chaseMargin).toBe(50);
    expect(resolved.giveUpDelayMs).toBe(400);
  });

  it('lets a slot override chase margin and temperament', () => {
    const resolved = resolveMonsterPreset(
      packBody(),
      { monsters: { chaseMargin: 50 } },
      { stats: { chaseMargin: 2_000, temperament: 'skittish' } }
    );
    expect(resolved.chaseMargin).toBe(2_000);
    expect(resolved.temperament).toBe('skittish');
  });

  it('lets a slot decide a camp breathes where the pack said it claws', () => {
    // The knob a map author reaches for to change how a pit *plays*: a cone
    // is telegraphed and a claw is not.
    const resolved = resolveMonsterPreset(packBody(), undefined, {
      stats: { attackStyle: 'breath' },
    });
    expect(resolved.attackStyle).toBe('breath');
  });

  it('keeps the pack attack style when no slot overrides it', () => {
    const base = { ...packBody(), attackStyle: 'breath' as const };
    expect(resolveMonsterPreset(base, { monsters: { healthMult: 2 } }).attackStyle).toBe('breath');
  });

  it('leaves the attack style unset when nobody names one, so core derives it', () => {
    // `undefined` here is not a missing value — it is what makes `Monster`'s
    // constructor read `attackRange` and answer for the camp. Writing a
    // literal default in this layer would freeze every pack at `melee`.
    expect(resolveMonsterPreset(packBody(), undefined).attackStyle).toBeUndefined();
  });

  it('keeps a leash the pack declared, instead of replacing it with the default', () => {
    // The merge used to read these three off the map and core only, so a body
    // that stated a tighter leash than the jungle around it had that
    // statement dropped on the floor — invisible to every test that sets a
    // map, because the map layer worked.
    const base = {
      ...packBody(),
      chaseMargin: 150,
      giveUpDelayMs: 700,
      regenDelayMs: 9_000,
    };

    const resolved = resolveMonsterPreset(base, undefined);

    expect(resolved.chaseMargin).toBe(150);
    expect(resolved.giveUpDelayMs).toBe(700);
    expect(resolved.regenDelayMs).toBe(9_000);
  });

  it('but still lets the map speak over the pack, and a slot over the map', () => {
    const base = { ...packBody(), chaseMargin: 150, regenDelayMs: 9_000 };

    const resolved = resolveMonsterPreset(
      base,
      { monsters: { chaseMargin: 400, regenDelayMs: 1_000 } },
      { stats: { chaseMargin: 2_000 } }
    );

    expect(resolved.chaseMargin).toBe(2_000);
    expect(resolved.regenDelayMs).toBe(1_000);
  });

  it('keeps the pack temperament when no slot overrides it', () => {
    const base = { ...packBody(), temperament: 'skittish' as const };
    expect(resolveMonsterPreset(base, { monsters: { healthMult: 2 } }).temperament).toBe(
      'skittish'
    );
  });
});

describe('terrain', () => {
  it('is inert with no tuning — the gate the whole mechanic hangs on', () => {
    expect(resolveTerrainTuning(undefined)).toEqual({ bush: 1, water: 1, affectsSpeed: false });
  });

  it('is inert when a map states 1 explicitly', () => {
    expect(resolveTerrainTuning({ terrain: { water: { speedMultiplier: 1 } } }).affectsSpeed).toBe(
      false
    );
  });

  it('wakes up as soon as either layer is not 1', () => {
    const resolved = resolveTerrainTuning({ terrain: { water: { speedMultiplier: 0.5 } } });
    expect(resolved).toEqual({ bush: 1, water: 0.5, affectsSpeed: true });
  });

  it('refuses a negative multiplier rather than making units walk backwards', () => {
    expect(resolveTerrainTuning({ terrain: { bush: { speedMultiplier: -2 } } }).bush).toBe(0);
  });
});
