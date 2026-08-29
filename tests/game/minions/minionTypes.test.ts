/**
 * A map may declare its own minion roster.
 *
 * Two things had to come apart before that was safe. `kind` was carrying both
 * the minion's identity and its behaviour — `launchAttack` branched on
 * `!== 'melee'`, `draw` on `'cannon'`/`'ranged'` — so a map declaring `siege`
 * would have got a body that fights and paints like a melee minion with
 * nothing anywhere saying so. `style` is now the behavioural half, and the
 * cases below are mostly about proving those two are actually separate.
 *
 * Deliberately not under `tests/game/minions/helpers.ts`, which reaches a
 * content pack this checkout may not have.
 */
import { describe, expect, it } from 'vitest';
import type { MapTuning } from '../../../src/content/ContentPack';
import { MinionPresets } from '../../../src/game/gameObject/attackableUnits/Minion';
import { resolveMinionTypes } from '../../../src/game/config/mapTuning';
import {
  FIRST_WAVE_DELAY_MS,
  MINION_LIVE_CAP,
  MINION_RELEASE_INTERVAL_MS,
  resolveWavePlan,
  waveComposition,
  waveIntervalAt,
} from '../../../src/game/managers/MinionSpawner';

const siegeMap: MapTuning = {
  minions: {
    types: {
      grunt: {
        name: 'Grunt',
        speed: 3,
        size: 30,
        health: 200,
        damage: 7,
        attackInterval: 1_000,
        attackRange: 40,
        aggroRange: 300,
      },
      siege: {
        name: 'Siege',
        style: 'cannon',
        goldBounty: 90,
        speed: 2,
        size: 44,
        health: 500,
        damage: 20,
        attackInterval: 2_000,
        attackRange: 400,
        aggroRange: 420,
      },
    },
    waves: { composition: ['grunt', 'grunt', 'siege'], intervalMs: 10_000 },
  },
};

describe('the minion roster', () => {
  it("is core's three when a map declares none", () => {
    expect(resolveMinionTypes(undefined)).toBe(MinionPresets);
    expect(resolveMinionTypes({ minions: {} })).toBe(MinionPresets);
    expect(resolveMinionTypes({ minions: { types: {} } })).toBe(MinionPresets);
  });

  it('is replaced outright by a map that declares one', () => {
    const types = resolveMinionTypes(siegeMap);
    expect(Object.keys(types).sort()).toEqual(['grunt', 'siege']);
    // Not merged: core's three are gone, which is what all-or-nothing means.
    expect(types.melee).toBeUndefined();
  });

  it('carries the id as kind and keeps style separate from it', () => {
    const types = resolveMinionTypes(siegeMap);
    expect(types.siege.kind).toBe('siege');
    expect(types.siege.style).toBe('cannon');
    expect(types.siege.goldBounty).toBe(90);
  });

  it('defaults a type that named no style to melee', () => {
    // The safe default rather than the common one: a body with no projectile
    // and no special art is visible in play, a caster that swings is not.
    expect(resolveMinionTypes(siegeMap).grunt.style).toBe('melee');
  });

  it("keeps core's own three tagged with their own style", () => {
    expect(MinionPresets.melee.style).toBe('melee');
    expect(MinionPresets.ranged.style).toBe('ranged');
    expect(MinionPresets.cannon.style).toBe('cannon');
  });
});

describe('the wave plan', () => {
  it("with no tuning is core's own functions, not a copy of them", () => {
    const plan = resolveWavePlan(undefined);
    expect(plan.firstDelayMs).toBe(FIRST_WAVE_DELAY_MS);
    expect(plan.releaseIntervalMs).toBe(MINION_RELEASE_INTERVAL_MS);
    expect(plan.liveCap).toBe(MINION_LIVE_CAP);
    // Same answers as the functions the rift cadence has always used, at the
    // three times that cadence actually changes.
    for (const at of [0, 14 * 60_000, 30 * 60_000]) {
      expect(plan.intervalMs(at)).toBe(waveIntervalAt(at));
      expect(plan.composition(3, at)).toEqual(waveComposition(3, at));
    }
  });

  it('takes a declared formation and interval', () => {
    const plan = resolveWavePlan(siegeMap);
    expect(plan.composition(1, 0)).toEqual(['grunt', 'grunt', 'siege']);
    expect(plan.intervalMs(0)).toBe(10_000);
    // Cadence no longer changes at 14:00, because the map replaced it.
    expect(plan.intervalMs(20 * 60_000)).toBe(10_000);
  });

  it('applies stages from their own time onward', () => {
    const plan = resolveWavePlan({
      minions: {
        types: siegeMap.minions!.types,
        waves: {
          composition: ['grunt'],
          intervalMs: 30_000,
          stages: [
            { atMs: 600_000, composition: ['grunt', 'siege'] },
            { atMs: 1_200_000, intervalMs: 15_000 },
          ],
        },
      },
    });

    expect(plan.composition(1, 0)).toEqual(['grunt']);
    expect(plan.composition(1, 700_000)).toEqual(['grunt', 'siege']);
    // The second stage names only an interval, so the first stage's
    // composition still stands — a map should not have to restate what it
    // already said to change one other thing.
    expect(plan.composition(1, 1_300_000)).toEqual(['grunt', 'siege']);
    expect(plan.intervalMs(0)).toBe(30_000);
    expect(plan.intervalMs(700_000)).toBe(30_000);
    expect(plan.intervalMs(1_300_000)).toBe(15_000);
  });

  it('sorts stages rather than trusting the order they were written in', () => {
    const plan = resolveWavePlan({
      minions: {
        waves: {
          composition: ['melee'],
          stages: [
            { atMs: 1_200_000, composition: ['cannon'] },
            { atMs: 600_000, composition: ['ranged'] },
          ],
        },
      },
    });
    expect(plan.composition(1, 700_000)).toEqual(['ranged']);
    expect(plan.composition(1, 1_300_000)).toEqual(['cannon']);
  });

  it('drops a composition entry no type supplies rather than substituting one', () => {
    // `validate.ts` refuses such a map at install, so this is a hand-edited
    // or locally-drawn one. A wave one body short is honest; a wave with a
    // different body in its place is a lie about what the map declared.
    const plan = resolveWavePlan({
      minions: { types: siegeMap.minions!.types, waves: { composition: ['grunt', 'ghost'] } },
    });
    expect(plan.composition(1, 0)).toEqual(['grunt']);
  });

  it('takes pacing numbers on their own without touching the formation', () => {
    const plan = resolveWavePlan({ minions: { waves: { liveCap: 20, firstDelayMs: 5_000 } } });
    expect(plan.liveCap).toBe(20);
    expect(plan.firstDelayMs).toBe(5_000);
    // No formation declared, so core's cannon cadence still runs.
    expect(plan.composition(3, 0)).toEqual(waveComposition(3, 0));
  });
});
