import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientSession } from '@/game/net/ClientSession';
import { resetNetRoleForTests } from '@/game/net/netRole';
import type Game from '@/game/Game';
import type { ClientTransport } from '@/game/net/transport';
import type { NetMessage } from '@/game/net/protocol';

/**
 * The joystick's orders on a LAN client.
 *
 * A held stick calls the seam every frame, so the push is sampled — one
 * order per `MOVE_ORDER_INTERVAL_MS`, sharing its window with right-clicks
 * because they are the same order arriving two ways. The *release* is the
 * half that has no equivalent on the mouse and no room to be clever: a
 * dropped one leaves the host walking to a point the thumb abandoned, so it
 * is sent unconditionally.
 *
 * Both intercepts answer `false` — the local seam still runs, which is the
 * prediction. That is asserted here too, because answering `true` would look
 * like it worked while quietly freezing the client's own champion between
 * snapshots.
 */
describe('a net client steering with the joystick', () => {
  let sent: string[];
  let session: ClientSession;
  let now: number;

  const framesOfType = (t: string): NetMessage[] =>
    sent.map(raw => JSON.parse(raw) as NetMessage).filter(message => message.t === t);

  beforeEach(() => {
    // The session installs its dev handle on `window`, which the node test
    // environment does not have.
    vi.stubGlobal('window', {});
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    sent = [];
    const channel = {
      send: (raw: string) => sent.push(raw),
      drain: () => [],
      pushBack: () => {},
      waitFor: () => new Promise(() => {}),
      close: () => {},
      closed: false,
    } as unknown as ClientTransport;
    const game = {
      matchTimeMs: 0,
      matchRules: { cooldownMultiplier: 1, manaFree: false },
      player: { name: 'me' },
      turrets: [],
      monsters: [],
      net: null,
    } as unknown as Game;
    session = new ClientSession(game, channel, {
      t: 'hello',
      tm: 0,
      mapId: 'm',
      rules: { cooldownMultiplier: 1, manaFree: false },
      you: { id: 'u1', team: 'blue', plan: {} },
      roster: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetNetRoleForTests();
  });

  it('sends the push, and lets the local seam steer anyway', () => {
    expect(session.interceptSteer({ x: 300, y: -120 })).toBe(false);
    expect(framesOfType('steer')).toEqual([{ t: 'steer', to: { x: 300, y: -120 } }]);
  });

  it('samples a held stick instead of sending every frame', () => {
    session.interceptSteer({ x: 10, y: 0 });
    now += 20;
    session.interceptSteer({ x: 20, y: 0 });
    now += 20;
    session.interceptSteer({ x: 30, y: 0 });
    // 40ms of holding: one order, the first.
    expect(framesOfType('steer')).toEqual([{ t: 'steer', to: { x: 10, y: 0 } }]);

    now += 20; // 60ms since the first — the window is open again.
    session.interceptSteer({ x: 40, y: 0 });
    expect(framesOfType('steer')).toHaveLength(2);
    expect(framesOfType('steer')[1]).toEqual({ t: 'steer', to: { x: 40, y: 0 } });
  });

  it('samples the stick faster than clicks, on a window of its own', () => {
    // A click is a discrete decision; a held thumb is a direction that keeps
    // changing, and the host — so everyone else — knows only what it is told.
    session.interceptSteer({ x: 10, y: 0 });
    session.interceptPointer({ x: 999, y: 999 });
    now += 60;
    session.interceptSteer({ x: 20, y: 0 });
    session.interceptPointer({ x: 998, y: 998 });

    // 60ms: the stick has sampled twice, the click still once.
    expect(framesOfType('steer')).toHaveLength(2);
    expect(framesOfType('move')).toHaveLength(1);

    now += 60; // 120ms total — the click's window opens now.
    session.interceptPointer({ x: 997, y: 997 });
    expect(framesOfType('move')).toHaveLength(2);
  });

  it('never throttles the release, and reopens the window behind it', () => {
    session.interceptSteer({ x: 10, y: 0 });
    now += 20; // deep inside the sample window

    expect(session.interceptSteer(null)).toBe(false);
    expect(framesOfType('steer')[1]).toEqual({ t: 'steer', to: null });

    // The next push is a new gesture: it must not wait out a window the
    // previous one paid for, or the champion stands still for up to 120ms
    // every time the thumb is re-planted.
    session.interceptSteer({ x: 0, y: 50 });
    expect(framesOfType('steer')[2]).toEqual({ t: 'steer', to: { x: 0, y: 50 } });
  });
});
