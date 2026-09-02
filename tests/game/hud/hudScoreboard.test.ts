import { describe, expect, it } from 'vitest';
import { computeHudState, formatClock } from '../../../src/game/hud/hudState';
import { INVENTORY_SIZE } from '../../../src/game/items/Item';
import TeamId from '../../../src/game/enums/TeamId';

/**
 * `HudState.scoreboard`: every champion on the board, by side, the player's
 * side first, read off the live objects so a LAN client sees the host's
 * board. Fakes shaped like the fields read.
 */
const champion = (name: string, teamId: string, tally: Partial<Record<string, number>> = {}, extra: Record<string, unknown> = {}) => ({
  id: name.toLowerCase(),
  name,
  teamId,
  killCredit: 'champion',
  avatar: { path: `${name}.png`, key: name, status: 'ready' },
  isDead: false,
  tally: { kills: 0, deaths: 0, assists: 0, minionsKilled: 0, damageDealt: 0, ...tally },
  wallet: { balance: 500 },
  items: [],
  position: { x: 0, y: 0 },
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
  ...extra,
});

describe('HudState.scoreboard', () => {
  it('groups champions by side, the player first, and sorts a side by kills', () => {
    const me = champion('Me', TeamId.RED, { kills: 1 });
    const ally = champion('Ally', TeamId.RED, { kills: 4, deaths: 1 });
    const foe = champion('Foe', TeamId.BLUE, { kills: 2 }, { isDead: true });
    const pet = { ...champion('Pet', TeamId.RED), killCredit: 'none' };
    const minion = { name: 'Lính', teamId: TeamId.BLUE, killCredit: 'minion', tally: {} };
    const game = { player: me, objectManager: { objects: [foe, minion, me, pet, ally] } };

    const { scoreboard } = computeHudState(game as any)!;
    expect(scoreboard.teams.map(t => [t.label, t.mine, t.kills])).toEqual([
      ['Đội Đỏ', true, 5],
      ['Đội Xanh', false, 2],
    ]);
    expect(scoreboard.teams[0].rows.map(r => r.name)).toEqual(['Ally', 'Me']);
    expect(scoreboard.teams[0].rows[1].isPlayer).toBe(true);
    expect(scoreboard.teams[1].rows[0].isDead).toBe(true);
  });

  it('carries K/D/A, CS, gold, damage and a full row of item slots', () => {
    const me = champion(
      'Me',
      TeamId.BLUE,
      { kills: 3, deaths: 2, assists: 7, minionsKilled: 41, damageDealt: 1234.6 },
      { wallet: { balance: 1287.9 }, items: [{ icon: { path: 'boots.png', key: 'boots', status: 'ready' } }, null] }
    );
    const game = { player: me, objectManager: { objects: [me] } };
    const [row] = computeHudState(game as any)!.scoreboard.teams[0].rows;
    expect([row.kills, row.deaths, row.assists, row.cs]).toEqual([3, 2, 7, 41]);
    expect(row.gold).toBe(1287);
    expect(row.damage).toBe(1235);
    expect(row.items).toHaveLength(INVENTORY_SIZE);
    expect(row.items[0].filled).toBe(true);
    expect(row.items[0].image).toBe('boots.png');
    expect(row.items[1].filled).toBe(false);
    expect(row.streak).toBe(0);
    expect(row.reviveAfter).toBe(0);
  });

  it('carries the item card the owner would see, and the respawn count for a corpse', () => {
    const me = champion(
      'Me',
      TeamId.BLUE,
      {},
      {
        isDead: true,
        deathData: { reviveAfter: 7_400 },
        items: [
          {
            icon: { path: 'sword.png', key: 'sword', status: 'ready' },
            def: { name: 'Kiếm', description: 'Chém <span class="damage">40</span>', stats: { attackDamage: 40 } },
          },
        ],
      }
    );
    const [row] = computeHudState({ player: me, objectManager: { objects: [me] } } as any)!.scoreboard.teams[0].rows;
    expect(row.reviveAfter).toBe(8);
    expect(row.items[0].name).toBe('Kiếm');
    expect(row.items[0].description).toContain('40');
    expect(row.items[0].stats.length).toBeGreaterThan(0);
  });

  it('is empty, not broken, for a context with no objects', () => {
    const me = champion('Me', TeamId.BLUE);
    expect(computeHudState({ player: me } as any)!.scoreboard).toEqual({ teams: [] });
  });
});

describe('the score strip clock', () => {
  it('prints m:ss and keeps counting past the hour', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59_999)).toBe('0:59');
    expect(formatClock(754_000)).toBe('12:34');
    expect(formatClock(3_725_000)).toBe('62:05');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });

  it('reads the match time off the game', () => {
    const me = champion('Me', TeamId.BLUE);
    expect(computeHudState({ player: me, matchTimeMs: 61_000 } as any)!.clock).toBe('1:01');
  });
});
