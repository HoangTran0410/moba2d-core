/**
 * The wave, measured against the champion who has to walk through it.
 *
 * `MinionPresets` was tuned against itself — the numbers were picked so that
 * one wave kills another in about ten seconds — and never once against
 * `DEFAULT_CHAMPION_ATTACK` or `DEFAULT_CHAMPION_DEFENCE`. Three things were
 * true of the result, all three reported by a player before any of them was
 * measured here, and every one of them is arithmetic over constants that were
 * already exported:
 *
 *   - a melee minion had more health than a champion;
 *   - the opening wave could not be cleared in the time before the next one
 *     arrived, by anybody, at any point in a match;
 *   - and it dealt more damage per second than the champion it was walking at.
 *
 * These cases are those three sentences. They are deliberately written against
 * the *default* champion rather than any pack's, because that default is the
 * body core promises a pack that declares nothing, and a rule that only holds
 * for one pack's roster is not core's rule. A pack whose champions are
 * squishier than core's default has a harder lane than this file describes,
 * which is the pack's decision to make; a pack cannot make the *default* body
 * lose to the wave, because that body is core's own.
 *
 * No fixtures, no globals, no game: every number below is a module constant.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHAMPION_ATTACK,
  DEFAULT_CHAMPION_DEFENCE,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import { MinionPresets } from '../../../src/game/gameObject/attackableUnits/Minion';
import { WAVE_INTERVAL_MS, waveComposition } from '../../../src/game/managers/MinionSpawner';
import { MINION_BOUNTY } from '../../../src/game/economy/Wallet';

/** What the default champion does to an unarmoured body, per second. */
const CHAMPION_DPS = DEFAULT_CHAMPION_ATTACK.damage * DEFAULT_CHAMPION_ATTACK.attacksPerSecond;

/** The wave that opens every match: `waveComposition(1)` at minute zero. */
const OPENING_WAVE = waveComposition(1, 0).map(kind => MinionPresets[kind]);

const sum = (amounts: number[]): number => amounts.reduce((total, n) => total + n, 0);

describe('a minion against a champion', () => {
  it('is never the tougher of the two, for the bodies that come in threes', () => {
    // The sentence `Champion.ts` and `content/ContentPack.ts` both use to
    // explain what was wrong with the champion — "100 health is less than a
    // minion's 140" — was equally a statement about the minion, and only one
    // of the two numbers had anyone looking at it.
    //
    // The cannon is deliberately not in this list; it is the wave's siege
    // piece, arrives once every third wave and is allowed to outlast a
    // champion the way its source-game counterpart does. Its own bound is two
    // cases down.
    for (const preset of [MinionPresets.melee, MinionPresets.ranged]) {
      expect(
        preset.health,
        `${preset.kind} has ${preset.health} health against a champion's ${DEFAULT_CHAMPION_DEFENCE.health}`
      ).toBeLessThan(DEFAULT_CHAMPION_DEFENCE.health);
    }
  });

  it('never out-damages the champion it is walking at, even as a whole wave', () => {
    // Every body in the wave hitting the same champion at once. The casters
    // reach 280 and the champion is one target, so this is a state a lane
    // actually reaches rather than a worst case invented to fail.
    const waveDps = sum(
      OPENING_WAVE.map(preset => (preset.damage * 1_000) / preset.attackInterval)
    );

    expect(
      waveDps,
      `the opening wave deals ${waveDps.toFixed(1)}/s against the champion's ${CHAMPION_DPS.toFixed(1)}/s`
    ).toBeLessThan(CHAMPION_DPS);
  });
});

describe('a wave against the clock it arrives on', () => {
  it('can be cleared in less than the time before the next one', () => {
    // The whole of "farming is exhausting". A wave that outlives its own
    // interval cannot be cleared by anyone at any point in the match: the
    // lane fills faster than the strongest thing in it empties.
    const waveHealth = sum(OPENING_WAVE.map(preset => preset.health));
    const secondsToClear = waveHealth / CHAMPION_DPS;
    const secondsBetweenWaves = WAVE_INTERVAL_MS / 1_000;

    expect(
      secondsToClear,
      `${waveHealth} health takes ${secondsToClear.toFixed(1)}s to clear, ${secondsBetweenWaves}s between waves`
    ).toBeLessThan(secondsBetweenWaves);
  });

  it('still takes long enough that clearing one is a thing a player did', () => {
    // The other wall. Health that a champion deletes on contact makes the lane
    // scenery, and takes the last-hit — the one decision a lane is made of —
    // out of the game along with it. A third of the interval is the floor.
    const waveHealth = sum(OPENING_WAVE.map(preset => preset.health));
    const secondsToClear = waveHealth / CHAMPION_DPS;

    expect(secondsToClear).toBeGreaterThan(WAVE_INTERVAL_MS / 1_000 / 3);
  });
});

describe('a wave against itself', () => {
  it('still resolves in about the ten seconds the presets promise', () => {
    // The clock the numbers were originally picked against, held while both
    // sides of it moved. Three melee bodies focusing one of the other side's:
    // if health had come down without damage following it, a wave would now
    // evaporate on contact and the lane would never sit still anywhere.
    const melee = MinionPresets.melee;
    const focusedDps = (3 * melee.damage * 1_000) / melee.attackInterval;
    const seconds = melee.health / focusedDps;

    expect(seconds, `${seconds.toFixed(1)}s`).toBeGreaterThan(6);
    expect(seconds, `${seconds.toFixed(1)}s`).toBeLessThan(14);
  });
});

describe('the cannon', () => {
  it('is the body in the wave worth stopping for', () => {
    // It is the wave's siege piece and the one a player is meant to want the
    // last hit on. It was worth exactly what the caster beside it was worth,
    // which is the same as saying the wave had no payday in it at all.
    expect(MinionPresets.cannon.goldBounty).toBeDefined();
    expect(MinionPresets.cannon.goldBounty!).toBeGreaterThan(2 * MINION_BOUNTY);
    // and the other two deliberately name none, so a map's own
    // `economy.minionBounty` still prices them — see `MinionSpawner`.
    expect(MinionPresets.melee.goldBounty).toBeUndefined();
    expect(MinionPresets.ranged.goldBounty).toBeUndefined();
  });

  it('is the wave’s tank, and the one body allowed to outlast a champion', () => {
    // Allowed, and bounded: past twice the champion pool it stops being a
    // payday and becomes a wall a lane cannot get through without help, which
    // is the failure the other three cases in this file exist about.
    expect(MinionPresets.cannon.health).toBeGreaterThan(DEFAULT_CHAMPION_DEFENCE.health);
    expect(MinionPresets.cannon.health).toBeLessThan(2 * DEFAULT_CHAMPION_DEFENCE.health);
  });
});
