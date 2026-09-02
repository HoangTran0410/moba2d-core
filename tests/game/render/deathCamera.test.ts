import { describe, expect, it } from 'vitest';
import {
  DEATH_CAMERA_LINGER_MS,
  DeathCamera,
  SPECTATE_COMBAT_WINDOW_MS,
  nextSpectateTarget,
  pickSpectateTarget,
  type SpectateCandidate,
} from '../../../src/game/render/deathCamera';

const ally = (
  unit: string,
  x: number,
  y: number,
  extra: Partial<SpectateCandidate<string>> = {}
): SpectateCandidate<string> => ({ unit, x, y, alive: true, lastCombatMs: -Infinity, ...extra });

const ORIGIN = { x: 0, y: 0 };

describe('pickSpectateTarget', () => {
  it('takes the nearest living ally when nobody is fighting', () => {
    const picked = pickSpectateTarget([ally('far', 900, 0), ally('near', 100, 0)], ORIGIN, 10_000);
    expect(picked).toBe('near');
  });

  it('prefers an ally in a fight over a nearer idle one, the most recent fight first', () => {
    const now = 10_000;
    const picked = pickSpectateTarget(
      [
        ally('idle', 50, 0),
        ally('fought-a-while-ago', 800, 0, { lastCombatMs: now - 3000 }),
        ally('fighting', 2000, 0, { lastCombatMs: now - 200 }),
      ],
      ORIGIN,
      now
    );
    expect(picked).toBe('fighting');
  });

  it('forgets a fight older than the window', () => {
    const now = 10_000;
    const picked = pickSpectateTarget(
      [ally('near', 50, 0), ally('old-fight', 800, 0, { lastCombatMs: now - SPECTATE_COMBAT_WINDOW_MS - 1 })],
      ORIGIN,
      now
    );
    expect(picked).toBe('near');
  });

  it('never picks the dead, and answers null with nobody alive', () => {
    expect(pickSpectateTarget([ally('dead', 10, 0, { alive: false }), ally('far', 500, 0)], ORIGIN, 0)).toBe('far');
    expect(pickSpectateTarget([ally('dead', 10, 0, { alive: false })], ORIGIN, 0)).toBeNull();
    expect(pickSpectateTarget([], ORIGIN, 0)).toBeNull();
  });
});

describe('nextSpectateTarget', () => {
  const roster = [ally('a', 0, 0), ally('b', 0, 0, { alive: false }), ally('c', 0, 0), ally('d', 0, 0)];

  it('walks the living in roster order and wraps', () => {
    expect(nextSpectateTarget(roster, 'a')).toBe('c');
    expect(nextSpectateTarget(roster, 'c')).toBe('d');
    expect(nextSpectateTarget(roster, 'd')).toBe('a');
  });

  it('starts from the first living ally when the current one is unknown or dead', () => {
    expect(nextSpectateTarget(roster, null)).toBe('a');
    expect(nextSpectateTarget(roster, 'b')).toBe('a');
  });

  it('answers null when nobody is alive', () => {
    expect(nextSpectateTarget([ally('b', 0, 0, { alive: false })], null)).toBeNull();
  });
});

describe('DeathCamera', () => {
  const bench = (allies: SpectateCandidate<string>[]) => {
    const state = { dead: false, now: 0, allies };
    const follows: (string | null)[] = [];
    const camera = new DeathCamera<string>({
      isDead: () => state.dead,
      deathPoint: () => ORIGIN,
      allies: () => state.allies,
      nowMs: () => state.now,
      follow: target => follows.push(target),
    });
    return { state, follows, camera };
  };

  it('does nothing while alive', () => {
    const { camera, follows, state } = bench([ally('a', 10, 0)]);
    state.now = 5000;
    camera.tick();
    expect(follows).toEqual([]);
    expect(camera.watching).toBeNull();
  });

  it('lingers on the corpse, then follows the picked ally once', () => {
    const { camera, follows, state } = bench([ally('a', 10, 0)]);
    state.dead = true;
    state.now = 1000;
    camera.tick();
    state.now = 1000 + DEATH_CAMERA_LINGER_MS - 1;
    camera.tick();
    expect(follows).toEqual([]);
    state.now = 1000 + DEATH_CAMERA_LINGER_MS;
    camera.tick();
    camera.tick();
    expect(follows).toEqual(['a']);
    expect(camera.watching).toBe('a');
  });

  it('moves on when the watched ally dies, and comes home on respawn', () => {
    const allies = [ally('a', 10, 0), ally('b', 500, 0)];
    const { camera, follows, state } = bench(allies);
    state.dead = true;
    camera.tick();
    state.now = DEATH_CAMERA_LINGER_MS;
    camera.tick();
    expect(follows).toEqual(['a']);

    state.allies = [{ ...allies[0], alive: false }, allies[1]];
    camera.tick();
    expect(follows).toEqual(['a', 'b']);

    state.dead = false;
    camera.tick();
    expect(follows).toEqual(['a', 'b', null]);
    expect(camera.watching).toBeNull();
  });

  it('with nobody to watch, leaves the corpse on screen and never calls follow', () => {
    const { camera, follows, state } = bench([ally('dead', 10, 0, { alive: false })]);
    state.dead = true;
    camera.tick();
    state.now = DEATH_CAMERA_LINGER_MS * 3;
    camera.tick();
    camera.tick();
    expect(follows).toEqual([]);
    state.dead = false;
    camera.tick();
    expect(follows).toEqual([]);
  });

  it('next() cycles the living allies, and skips the linger when pressed early', () => {
    const { camera, follows, state } = bench([ally('a', 10, 0), ally('b', 20, 0)]);
    state.dead = true;
    state.now = 100;
    camera.tick();
    expect(follows).toEqual([]);
    camera.next();
    expect(follows).toEqual(['a']);
    camera.next();
    expect(follows).toEqual(['a', 'b']);
    camera.next();
    expect(follows).toEqual(['a', 'b', 'a']);
    // A later tick keeps the player's choice rather than re-picking.
    state.now = 5000;
    camera.tick();
    expect(follows).toEqual(['a', 'b', 'a']);
  });

  it('next() is a no-op while alive', () => {
    const { camera, follows } = bench([ally('a', 10, 0)]);
    camera.next();
    expect(follows).toEqual([]);
  });
});
