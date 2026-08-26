import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MinionSpawner, {
  FIRST_WAVE_DELAY_MS,
  WAVE_INTERVAL_MS,
} from '../../../src/game/managers/MinionSpawner';
import type { MinionSpawnerContext } from '../../../src/game/managers/MinionSpawner';
import { resetLanesForTests, setActiveLanes } from '../../../src/game/lanes';
import TeamId from '../../../src/game/enums/TeamId';

/**
 * The panel's off/on flip, on the clock alone.
 *
 * The reported bug — "tắt lính rồi bật lại, không thấy con nào spawn nữa" —
 * was `setEnabled(true)` restarting a *full* wave interval: 30 quiet seconds
 * after a toggle that had cleared the field on the spot, with every re-open of
 * the paused panel freezing the countdown and every off/on flip restarting it.
 * Switching back on now answers within `FIRST_WAVE_DELAY_MS`, the same promise
 * match start makes.
 *
 * `spawn` is stubbed out: building a real `Minion` drags in a real map's
 * waypoints and muster slots, which is `tests/game/minions/helpers.ts`'s job —
 * and that helper reaches the departed content pack, which is why the suite
 * beside this one no longer runs in a core-alone checkout. The clock is the
 * thing under test, and the clock never looks at a minion.
 */

const FRAME_MS = 16;

const fakeContext = (): MinionSpawnerContext =>
  ({
    fountains: [{ teamId: TeamId.BLUE }, { teamId: TeamId.RED }],
    minionMuster: [],
    objectManager: { addObject: () => undefined },
  }) as unknown as MinionSpawnerContext;

let spawner: MinionSpawner;
let spawned: number;

const advance = (ms: number) => {
  for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) spawner.update();
};

describe('MinionSpawner re-enable clock', () => {
  beforeEach(() => {
    vi.stubGlobal('deltaTime', FRAME_MS);
    // `tests/setup.ts` installs an ambient lane set per test file; release it
    // before installing this suite's own synthetic lane, or the guard throws.
    resetLanesForTests();
    setActiveLanes([
      {
        id: 'MID',
        waypoints: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
      },
    ]);
    spawner = new MinionSpawner(fakeContext());
    spawned = 0;
    vi.spyOn(spawner, 'spawn').mockImplementation(() => {
      spawned++;
      return null;
    });
  });

  afterEach(() => {
    resetLanesForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('answers an off/on flip within the opening delay, not a full interval', () => {
    advance(FIRST_WAVE_DELAY_MS + 2 * FRAME_MS);
    expect(spawner.waveCount).toBe(1);
    expect(spawned).toBeGreaterThan(0);

    spawner.setEnabled(false);
    spawner.update();
    spawned = 0;

    spawner.setEnabled(true);
    expect(spawner.nextWaveIn).toBe(FIRST_WAVE_DELAY_MS);
    advance(FIRST_WAVE_DELAY_MS + 2 * FRAME_MS);
    expect(spawner.waveCount).toBe(2);
    expect(spawned).toBeGreaterThan(0);
  });

  it('still queues exactly one wave on re-enable, never a backdated burst', () => {
    // A long dark stretch while off must not bank waves for later.
    spawner.setEnabled(false);
    advance(3 * WAVE_INTERVAL_MS);
    expect(spawner.waveCount).toBe(0);

    spawner.setEnabled(true);
    advance(FIRST_WAVE_DELAY_MS + 2 * FRAME_MS);
    expect(spawner.waveCount).toBe(1);

    // and the next one arrives on the ordinary cadence, not immediately
    advance(WAVE_INTERVAL_MS - FIRST_WAVE_DELAY_MS - 6 * FRAME_MS);
    expect(spawner.waveCount).toBe(1);
  });
});
