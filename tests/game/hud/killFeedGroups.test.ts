import { describe, expect, it } from 'vitest';
import { groupKillFeed } from '../../../src/game/hud/killFeedGroups';
import type { Announcement } from '../../../src/game/combat/Announcer';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';

/**
 * The fold that turns one announcement per kill into one row per multi-kill.
 *
 * The rule it leans on is the announcer's own: `multi` climbs by one for each
 * kill inside `MULTI_KILL_WINDOW_MS` and resets to 1 outside it. So a chain is
 * a killer whose `multi` is still counting up, and no clock is read here at
 * all — which is why every case below is a plain array.
 */
const unit = (name: string) => ({ name }) as unknown as AttackableUnit;

let seq = 0;
const kill = (
  killer: AttackableUnit | null,
  victim: string,
  extra: Partial<Announcement> = {}
): Announcement => ({
  seq: ++seq,
  atMs: 1_000 * seq,
  killer: killer && { name: (killer as { name: string }).name, avatar: '', team: 'BLUE' },
  victim: { name: victim, avatar: '', team: 'RED' },
  firstBlood: false,
  multi: killer ? 1 : 0,
  streak: killer ? 1 : 0,
  shutdown: 0,
  killerUnit: killer ?? undefined,
  victimUnit: unit(victim),
  ...extra,
});

describe('groupKillFeed', () => {
  it('folds one killer’s run into a single row carrying every victim', () => {
    const vera = unit('Vera');
    const rows = groupKillFeed([
      kill(vera, 'A', { multi: 1, streak: 1 }),
      kill(vera, 'B', { multi: 2, streak: 2 }),
      kill(vera, 'C', { multi: 3, streak: 3 }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].victims.map(v => v.victim.name)).toEqual(['A', 'B', 'C']);
    // The row keeps the first kill's identity, so the DOM node it is drawn as
    // survives the second and third — the whole point of folding.
    expect(rows[0].seq).toBe(1);
    expect(rows[0].tags.map(t => t.label)).toEqual(['Triple Kill', 'Killing Spree']);
    expect(rows[0].accent).toBe('streak');
  });

  it('ages the row by its newest kill, not its first', () => {
    const vera = unit('Vera');
    const [row] = groupKillFeed([
      kill(vera, 'A', { atMs: 1_000, multi: 1 }),
      kill(vera, 'B', { atMs: 4_000, multi: 2 }),
    ]);
    expect(row.latestAtMs).toBe(4_000);
  });

  it('keeps two killers apart even when their kills interleave', () => {
    const vera = unit('Vera');
    const bot = unit('Bot');
    const rows = groupKillFeed([
      kill(vera, 'A', { multi: 1 }),
      kill(bot, 'B', { multi: 1 }),
      kill(vera, 'C', { multi: 2 }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0].victims.map(v => v.victim.name)).toEqual(['A', 'C']);
    expect(rows[1].victims.map(v => v.victim.name)).toEqual(['B']);
  });

  it('starts a new row when the multi-kill window has lapsed', () => {
    const vera = unit('Vera');
    // The announcer resets `multi` to 1 outside the window; that reset is the
    // only signal needed — a second 1 cannot continue a chain sitting at 1.
    const rows = groupKillFeed([kill(vera, 'A', { multi: 1 }), kill(vera, 'B', { multi: 1 })]);
    expect(rows.map(r => r.victims.length)).toEqual([1, 1]);
  });

  it('never folds a death nobody is credited with', () => {
    // A turret's kill carries `multi: 0`. Two of them are two rows, not a double.
    const turret = unit('Trụ');
    const rows = groupKillFeed([
      kill(turret, 'A', { multi: 0, streak: 0 }),
      kill(turret, 'B', { multi: 0, streak: 0 }),
      kill(null, 'C', { multi: 0, streak: 0 }),
    ]);
    expect(rows).toHaveLength(3);
  });

  it('carries a badge earned anywhere in the run onto the folded row', () => {
    const vera = unit('Vera');
    const [row] = groupKillFeed([
      kill(vera, 'A', { multi: 1, streak: 1, firstBlood: true }),
      kill(vera, 'B', { multi: 2, streak: 2, shutdown: 4 }),
    ]);
    // First blood was the first kill's, the shutdown the second's, and the
    // multi is the run's — a row that showed only the newest would lose two.
    expect(row.tags.map(t => t.kind)).toEqual(['first', 'multi', 'shutdown']);
  });

  it('opens a row mid-run when the first kill has already left the buffer', () => {
    const vera = unit('Vera');
    const rows = groupKillFeed([
      kill(vera, 'D', { multi: 4, streak: 4 }),
      kill(vera, 'E', { multi: 5, streak: 5 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].tags.map(t => t.label)).toContain('Penta Kill');
    expect(rows[0].victims.map(v => v.victim.name)).toEqual(['D', 'E']);
  });
});
