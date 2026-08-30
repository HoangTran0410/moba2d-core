import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MinionSpawner, { FIRST_WAVE_DELAY_MS } from '@/game/managers/MinionSpawner';
import type { MinionSpawnerContext } from '@/game/managers/MinionSpawner';
import type { MinionMusterPoint } from '@/game/preset';
import { resetLanesForTests, setActiveLanes } from '@/game/lanes';
import TeamId from '@/game/enums/TeamId';

/**
 * A muster point that fields its own wave.
 *
 * `tuning.minions.waves.composition` is one formation for the whole map: every
 * lane of every team sends the same six bodies. That is the right default and
 * it was the only thing a map could say, so "top pushes with siege, bot
 * trickles two melee" was not a map anybody could build.
 *
 * `spawn` is stubbed for the reason `MinionSpawnerReenable.test.ts` gives —
 * building a real `Minion` needs a real map's waypoints — and what is asserted
 * is what was *queued*, which is the whole of this decision.
 */

const FRAME_MS = 16;

const muster = (over: Partial<MinionMusterPoint>): MinionMusterPoint => ({
  teamId: TeamId.BLUE,
  lane: 'MID',
  x: 0,
  y: 0,
  scatter: 0,
  ...over,
});

const contextWith = (minionMuster: MinionMusterPoint[]): MinionSpawnerContext =>
  ({
    fountains: [{ teamId: TeamId.BLUE }, { teamId: TeamId.RED }],
    minionMuster,
    objectManager: { addObject: () => undefined },
  }) as unknown as MinionSpawnerContext;

/**
 * Every `kind` the opening wave queued, keyed by team.
 *
 * Both sides in **one** run, deliberately: a wave is queued once, and reading
 * the two teams with two passes leaves the second reading an empty queue and
 * reporting "this side fields nothing" for every map ever written.
 */
const openingWave = (spawner: MinionSpawner): Record<string, string[]> => {
  const byTeam: Record<string, string[]> = { [TeamId.BLUE]: [], [TeamId.RED]: [] };
  vi.spyOn(spawner, 'spawn').mockImplementation(entry => {
    (byTeam[entry.teamId] ??= []).push(entry.kind);
    return null;
  });
  for (let elapsed = 0; elapsed < FIRST_WAVE_DELAY_MS + 4 * FRAME_MS; elapsed += FRAME_MS) {
    spawner.update();
  }
  // The queue releases over `releaseIntervalMs`, so run it out.
  for (let i = 0; i < 400; i++) spawner.update();
  return byTeam;
};

describe('a muster point with its own composition', () => {
  beforeEach(() => {
    vi.stubGlobal('deltaTime', FRAME_MS);
    resetLanesForTests();
    setActiveLanes([
      { id: 'MID', waypoints: [{ x: 0, y: 0 }, { x: 100, y: 100 }] },
    ]);
  });

  afterEach(() => {
    resetLanesForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fields what it declares, while the other side keeps the map’s wave', () => {
    const spawner = new MinionSpawner(
      contextWith([
        muster({ teamId: TeamId.BLUE, composition: ['cannon', 'cannon'] }),
        muster({ teamId: TeamId.RED }),
      ])
    );

    const wave = openingWave(spawner);

    expect(wave[TeamId.BLUE]).toEqual(['cannon', 'cannon']);
    // Core's opening wave, untouched — the point of the feature is that one
    // point changing says nothing about any other.
    expect(wave[TeamId.RED].length).toBeGreaterThan(2);
  });

  /**
   * An empty array is a declaration, not an absence: a lane the bots walk that
   * ships no minions is a legitimate map. `??` rather than `||` in
   * `compositionAt` is the whole of what makes this true, and `||` would read
   * as "not declared" and hand back the map's wave.
   */
  it('fields nothing when it declares an empty formation', () => {
    const spawner = new MinionSpawner(
      contextWith([
        muster({ teamId: TeamId.BLUE, composition: [] }),
        muster({ teamId: TeamId.RED }),
      ])
    );

    const wave = openingWave(spawner);

    expect(wave[TeamId.BLUE]).toEqual([]);
    expect(wave[TeamId.RED].length).toBeGreaterThan(0);
  });

  /**
   * A name the roster does not hold is dropped rather than spawned as
   * something else — the same rule the map-wide formation follows
   * (`resolveWavePlan`). A substituted body is a lie about what the map said;
   * a smaller wave is only smaller.
   */
  it('drops a type the roster does not hold instead of substituting one', () => {
    const spawner = new MinionSpawner(
      contextWith([muster({ teamId: TeamId.BLUE, composition: ['cannon', 'siege', 'melee'] })])
    );

    expect(openingWave(spawner)[TeamId.BLUE]).toEqual(['cannon', 'melee']);
  });

  it('leaves every point on the map’s wave when none declares one', () => {
    const declared = new MinionSpawner(contextWith([muster({ teamId: TeamId.BLUE })]));
    const undeclared = new MinionSpawner(contextWith([]));

    expect(openingWave(declared)[TeamId.BLUE]).toEqual(openingWave(undeclared)[TeamId.BLUE]);
  });
});
