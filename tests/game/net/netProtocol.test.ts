import { describe, expect, it } from 'vitest';
import {
  decodeMessage,
  encodeMessage,
  type NetMessage,
  type UnitSnap,
} from '../../../src/game/net/protocol';

/**
 * The wire format, pinned by hand. Every expectation here is written out
 * rather than computed by the code under test — an encoder asked to verify
 * itself agrees with itself however wrong it is (the swept-test lesson in
 * CLAUDE.md), and a format is exactly the kind of thing that drifts silently
 * when only its own round-trip is asserted.
 */

const unit = (over: Partial<UnitSnap> = {}): UnitSnap => ({
  id: 'u1',
  x: 100,
  y: 200,
  hp: 50,
  maxHp: 100,
  mp: 30,
  dead: false,
  actionState: 3,
  ...over,
});

describe('snapshot messages', () => {
  it('round-trips a snapshot, with positions rounded to a tenth of a unit', () => {
    const message: NetMessage = {
      t: 'snap',
      tm: 12345,
      units: [unit({ x: 12.34567, y: 99.99 })],
    };
    const decoded = decodeMessage(encodeMessage(message));
    expect(decoded).not.toBeNull();
    if (decoded?.t !== 'snap') throw new Error('wrong type');
    expect(decoded.tm).toBe(12345);
    expect(decoded.units).toHaveLength(1);
    // 12.34567 -> 12.3: a tenth of a world unit is far below a pixel on
    // screen, and the rounding is what keeps 15Hz × 40 units affordable as
    // JSON.
    expect(decoded.units[0].x).toBe(12.3);
    expect(decoded.units[0].y).toBe(100);
    expect(decoded.units[0].dead).toBe(false);
    expect(decoded.units[0].actionState).toBe(3);
  });

  it('carries champion cooldowns only when present', () => {
    const withCds = decodeMessage(
      encodeMessage({ t: 'snap', tm: 1, units: [unit({ cds: [0, 1500, 0, 0, 60000, 0, 0] })] })
    );
    if (withCds?.t !== 'snap') throw new Error('wrong type');
    expect(withCds.units[0].cds).toEqual([0, 1500, 0, 0, 60000, 0, 0]);

    const without = decodeMessage(encodeMessage({ t: 'snap', tm: 1, units: [unit()] }));
    if (without?.t !== 'snap') throw new Error('wrong type');
    expect(without.units[0].cds).toBeUndefined();
  });

  it('survives a dead flag', () => {
    const decoded = decodeMessage(
      encodeMessage({ t: 'snap', tm: 1, units: [unit({ dead: true })] })
    );
    if (decoded?.t !== 'snap') throw new Error('wrong type');
    expect(decoded.units[0].dead).toBe(true);
  });
});

describe('event and order messages', () => {
  it('round-trips every message kind', () => {
    const messages: NetMessage[] = [
      {
        t: 'ev',
        ev: [
          { k: 'minion', id: 'u9', team: 'BLUE', lane: 'mid', kind: 'melee', x: 10, y: 20 },
          { k: 'gone', id: 'u9' },
          { k: 'cast', id: 'u2', slot: 1, x: 500, y: 600 },
          { k: 'dmg', id: 'u2', a: 44, ty: 'MAGIC' },
          { k: 'atk', id: 'u1', tid: 'u2' },
        ],
      },
      { t: 'move', x: 123, y: 456 },
      { t: 'cast', slot: 4, x: 1, y: 2 },
      // The other half of a charge: without 'rel' on the wire, the host can
      // only ever fire a held spell at minimum charge, at press time.
      { t: 'rel', slot: 4, x: 3, y: 4 },
      { t: 'stop', slot: 1 },
      { t: 'tp', x: 2000, y: 2000 },
      {
        t: 'died',
        recap: {
          seq: 2,
          killerName: 'Vera',
          entries: [{ atMs: 1000, amount: 55, type: 'PHYSICAL', attackerName: 'Vera' }],
        },
      },
      {
        t: 'loadout',
        plan: {
          name: 'Vera',
          avatar: 'champ_vera',
          attack: { range: 300 },
          defence: { health: 100 },
          spellIds: ['BasicAttack', 'reference:Vera_Q'],
        },
      },
      { t: 'recall' },
    ];
    for (const message of messages) {
      expect(decodeMessage(encodeMessage(message))).toEqual(message);
    }
  });

  it('refuses garbage rather than throwing', () => {
    expect(decodeMessage('not json at all {{{')).toBeNull();
    expect(decodeMessage(JSON.stringify({ hello: 'world' }))).toBeNull();
    expect(decodeMessage(JSON.stringify(null))).toBeNull();
    expect(decodeMessage(42)).toBeNull();
    expect(decodeMessage(JSON.stringify({ t: 'rel' }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ t: 'stop', slot: 'Q' }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ t: 'loadout' }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ t: 'loadout', plan: 'Vera' }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ t: 'tp', x: 5 }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ t: 'died' }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ t: 'died', recap: 7 }))).toBeNull();
  });
});
