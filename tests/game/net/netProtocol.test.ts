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
          // The crit flag: present only on a crit, so the client can draw the
          // crit it has no dice to roll.
          { k: 'dmg', id: 'u3', a: 90, ty: 'PHYSICAL', c: 1 },
          { k: 'atk', id: 'u1', tid: 'u2' },
          {
            k: 'ann',
            a: {
              seq: 3,
              atMs: 61_000,
              killer: { name: 'Vera', avatar: 'a.png', team: 'BLUE' },
              victim: { name: 'Bot', avatar: 'b.png', team: 'RED' },
              firstBlood: true,
              multi: 1,
              streak: 1,
              shutdown: 0,
              kid: 'u1',
              vid: 'u2',
            },
          },
        ],
      },
      { t: 'move', x: 123, y: 456 },
      { t: 'cast', slot: 4, x: 1, y: 2 },
      // The other half of a charge: without 'rel' on the wire, the host can
      // only ever fire a held spell at minimum charge, at press time.
      { t: 'rel', slot: 4, x: 3, y: 4 },
      { t: 'stop', slot: 1 },
      { t: 'tp', x: 2000, y: 2000 },
      { t: 'team', team: 'team-red' },
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

  it('carries the joystick as a push and a release, not as a move', () => {
    // A steer is its own message because the host must not run it through
    // `issuePointerOrder` — see `protocol.ts`. Written out rather than
    // round-tripped alone, so the field names are pinned too.
    expect(encodeMessage({ t: 'steer', to: { x: 120, y: -40 } })).toBe(
      '{"t":"steer","to":{"x":120,"y":-40}}'
    );
    expect(encodeMessage({ t: 'steer', to: null })).toBe('{"t":"steer","to":null}');

    expect(decodeMessage('{"t":"steer","to":{"x":120,"y":-40}}')).toEqual({
      t: 'steer',
      to: { x: 120, y: -40 },
    });
    // The release is a value, not an absence: `to: null` decodes, a missing
    // `to` does not, so a truncated frame can never read as "thumb lifted"
    // and stop a champion nobody stopped.
    expect(decodeMessage('{"t":"steer","to":null}')).toEqual({ t: 'steer', to: null });
    expect(decodeMessage(JSON.stringify({ t: 'steer' }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ t: 'steer', to: { x: 1 } }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ t: 'steer', to: { x: '1', y: '2' } }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ t: 'steer', to: 5 }))).toBeNull();
  });

  it('packs gold and cooldowns as one tail, for the champions that get either', () => {
    // The tail is the whole "this is a client's own champion" signal, so the
    // two travel together and are read back positionally: gold first.
    const withTail: NetMessage = {
      t: 'snap',
      tm: 1,
      units: [unit({ gold: 1275, cds: [0, 4200, 0, 9000] })],
    };
    expect(encodeMessage(withTail)).toBe(
      '{"t":"snap","tm":1,"u":[["u1",100,200,50,100,30,0,3,1275,0,4200,0,9000]]}'
    );
    const back = decodeMessage(encodeMessage(withTail));
    if (back?.t !== 'snap') throw new Error('wrong type');
    expect(back.units[0].gold).toBe(1275);
    expect(back.units[0].cds).toEqual([0, 4200, 0, 9000]);

    // A minion has neither, and pays for neither: the row stops at 8.
    expect(encodeMessage({ t: 'snap', tm: 1, units: [unit()] })).toBe(
      '{"t":"snap","tm":1,"u":[["u1",100,200,50,100,30,0,3]]}'
    );
    const bare = decodeMessage(encodeMessage({ t: 'snap', tm: 1, units: [unit()] }));
    if (bare?.t !== 'snap') throw new Error('wrong type');
    expect(bare.units[0].gold).toBeUndefined();
    expect(bare.units[0].cds).toBeUndefined();
  });

  it('carries a bag by id per slot, and the shop orders that change one', () => {
    const messages: NetMessage[] = [
      { t: 'ev', ev: [{ k: 'bag', id: 'c1', items: ['lol:dorans-blade', null, 'lol:boots'] }] },
      { t: 'buy', itemId: 'lol:bf-sword' },
      { t: 'sell', slot: 2 },
      { t: 'swap', a: 0, b: 5 },
      // An item active is the kit's message with the other bar named.
      { t: 'cast', slot: 1, x: 10, y: 20, row: 'item' },
      { t: 'rel', slot: 1, x: 11, y: 21, row: 'item' },
      { t: 'stop', slot: 1, row: 'item' },
      // …and without `row` it is still the kit, unchanged.
      { t: 'stop', slot: 1 },
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
    expect(decodeMessage(JSON.stringify({ t: 'team' }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ t: 'team', team: 9 }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ t: 'buy' }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ t: 'buy', itemId: 7 }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ t: 'sell' }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ t: 'swap', a: 1 }))).toBeNull();
  });
});
