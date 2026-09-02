import { describe, expect, it } from 'vitest';
import { computeHudState } from '../../../src/game/hud/hudState';
import MatchAnnouncer from '../../../src/game/combat/Announcer';
import EventManager from '../../../src/managers/EventManager';
import EventType from '../../../src/game/enums/EventType';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';

/**
 * `HudState.feed`: the announcer's rows and banner, re-told from the
 * player's side — ally/enemy by the player's team, "mine" by reference.
 */
const fakePlayer = (teamId: string) =>
  ({
    avatar: { path: 'me.png', key: 'me', status: 'ready' },
    name: 'Me',
    teamId,
    killCredit: 'champion',
    position: { x: 0, y: 0 },
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
  }) as unknown as AttackableUnit & Record<string, unknown>;

const fakeEnemy = (name: string) =>
  ({ name, teamId: 'RED', killCredit: 'champion', avatar: { path: `${name}.png` } }) as unknown as AttackableUnit;

describe('HudState.feed', () => {
  it('is empty for a context with no announcer', () => {
    const state = computeHudState({ player: fakePlayer('BLUE') } as any)!;
    expect(state.feed).toEqual({ rows: [], banner: null });
  });

  it("retells the feed from the player's side", () => {
    const events = new EventManager();
    let now = 10_000;
    const announcer = new MatchAnnouncer(events, () => now);
    announcer.attach();
    const player = fakePlayer('BLUE');
    const enemy = fakeEnemy('Bot');
    events.emit(EventType.ON_DIE, { unit: enemy, killer: player, credit: 'champion' });
    now += 500;
    events.emit(EventType.ON_DIE, { unit: player, killer: enemy, credit: 'champion' });

    const state = computeHudState({ player, announcer, matchTimeMs: now } as any)!;
    expect(state.feed.rows).toHaveLength(2);
    // Newest first: the death that just happened is the top row.
    const [death, mine] = state.feed.rows;
    expect(death.seq).toBe(2);
    expect(mine.killer?.side).toBe('ally');
    expect(mine.victim.side).toBe('enemy');
    expect(mine.victim.avatar).toBe('Bot.png');
    expect(mine.mine).toBe(true);
    expect(mine.fade).toBe(1);
    expect(mine.tags).toEqual([{ kind: 'first', label: 'First Blood' }]);
    expect(mine.accent).toBe('first');
    expect(death.tags).toEqual([]);
    expect(death.accent).toBeNull();
    expect(state.feed.banner).toEqual({
      seq: 2,
      kind: 'death',
      title: 'Bạn đã bị hạ',
      subtitle: 'bởi Bot',
    });
  });

  it('paints a run in its own family, over anything else the row carries', () => {
    const events = new EventManager();
    const announcer = new MatchAnnouncer(events, () => 1_000);
    announcer.attach();
    const player = fakePlayer('BLUE');
    const enemy = fakeEnemy('Bot');
    for (let i = 0; i < 3; i++) {
      events.emit(EventType.ON_DIE, { unit: enemy, killer: player, credit: 'champion' });
    }
    const state = computeHudState({ player, announcer, matchTimeMs: 1_000 } as any)!;
    expect(state.feed.rows[0].accent).toBe('streak');
    expect(state.feed.rows[0].tags.map(t => t.kind)).toEqual(['multi', 'streak']);
  });
});
