import { describe, expect, it } from 'vitest';
import { computeHudState } from '../../../src/game/hud/hudState';

const player = (overrides: Record<string, unknown> = {}) => ({
  avatar: { path: 'avatar.png', key: 'champ_x', status: 'ready' },
  position: { x: 0, y: 0 },
  teamId: 'blue',
  isDead: false,
  deathData: null,
  canCast: true,
  shieldAmount: 0,
  stats: {
    health: { value: 60 },
    maxHealth: { value: 100 },
    mana: { value: 40 },
    maxMana: { value: 100 },
  },
  spells: [],
  buffs: [],
  ...overrides,
});

describe('HudState.spectating', () => {
  it('names the ally the death camera is on, while dead', () => {
    const game = {
      player: player({ isDead: true, deathData: { reviveAfter: 4200 } }),
      deathCamera: { watching: { name: 'Vera' } },
    };
    const state = computeHudState(game as any)!;
    expect(state.isDead).toBe(true);
    expect(state.reviveAfter).toBe(4);
    expect(state.spectating).toBe('Vera');
  });

  it('is null on the corpse and while alive, whatever the camera says', () => {
    const dead = { player: player({ isDead: true, deathData: { reviveAfter: 900 } }), deathCamera: { watching: null } };
    expect(computeHudState(dead as any)!.spectating).toBeNull();
    const alive = { player: player(), deathCamera: { watching: { name: 'Vera' } } };
    expect(computeHudState(alive as any)!.spectating).toBeNull();
  });

  it('survives a game with no death camera at all', () => {
    const game = { player: player({ isDead: true, deathData: { reviveAfter: 900 } }) };
    expect(computeHudState(game as any)!.spectating).toBeNull();
  });
});

describe('HudState.recall under the recall rule', () => {
  const recall = { name: 'Hồi Thành', description: '', castSpec: { channel: { durationMs: 4000 } }, state: 'READY', channelProgress: 0, disabled: false };

  it('has no recall button in a match without recall', () => {
    const off = { player: player({ recall, game: { matchRules: { recall: false } } }) };
    expect(computeHudState(off as any)!.recall).toBeNull();
    const on = { player: player({ recall, game: { matchRules: { recall: true } } }) };
    expect(computeHudState(on as any)!.recall?.name).toBe('Hồi Thành');
    const bare = { player: player({ recall }) };
    expect(computeHudState(bare as any)!.recall?.name).toBe('Hồi Thành');
  });
});
