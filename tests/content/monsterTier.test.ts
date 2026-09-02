import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validatePack, MONSTER_TIERS } from '@/content/validate';
import { monsterBodyPreset } from '@/game/preset';
import Monster from '@/game/gameObject/attackableUnits/Monster';
import { createGame, stubGameGlobals } from '../game/fixtures';

/**
 * `MonsterDef.tier`: core's own word for "this camp is an objective". Two
 * values, validated; carried from the pack's declaration onto every body via
 * `monsterBodyPreset`, so the bot brain can read it off a `Monster`.
 */
const manifest = { id: 'ref', version: '1.0.0', coreRange: '^1' };
const body = {
  name: 'Boss',
  avatar: 'monster_boss',
  speed: 0,
  size: 100,
  attackRange: 300,
  reviveTime: 60_000,
  health: 1000,
  offset: { x: 0, y: 0 },
};
const monster = (over: Record<string, unknown> = {}) => ({
  id: 'boss',
  name: 'Boss',
  fills: ['pit'],
  members: [body],
  ...over,
});

describe('MonsterDef.tier', () => {
  it('accepts both tiers and a pack that names none', () => {
    expect(MONSTER_TIERS).toEqual(['camp', 'epic']);
    expect(validatePack({ manifest, monsters: { boss: monster() } }).ok).toBe(true);
    expect(validatePack({ manifest, monsters: { boss: monster({ tier: 'epic' }) } }).ok).toBe(true);
    expect(validatePack({ manifest, monsters: { boss: monster({ tier: 'camp' }) } }).ok).toBe(true);
  });

  it('refuses a tier that is not one of the two, and names it', () => {
    const result = validatePack({ manifest, monsters: { boss: monster({ tier: 'legendary' }) } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/boss\.tier/);
  });

  it('rides onto every body the camp spawns, defaulting to camp', () => {
    const slot = { role: 'pit', x: 100, y: 200, r: 250 };
    const epic = monsterBodyPreset({ ...monster({ tier: 'epic' }), id: 'ref:boss', packId: 'ref' } as never, body as never, slot as never);
    const plain = monsterBodyPreset({ ...monster(), id: 'ref:boss', packId: 'ref' } as never, body as never, slot as never);
    expect(epic.tier).toBe('epic');
    expect(plain.tier).toBe('camp');
  });
});

describe('Monster.tier', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('is what the preset said, and camp when it said nothing', () => {
    const game = createGame();
    const preset = {
      name: 'x',
      avatar: null,
      camp: { x: 0, y: 0, r: 100 },
      speed: 0,
      size: 40,
      attackRange: 100,
      reviveTime: 1000,
      health: 100,
    };
    expect(new Monster({ game, preset }).tier).toBe('camp');
    expect(new Monster({ game, preset: { ...preset, tier: 'epic' } }).tier).toBe('epic');
  });
});
