import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapTuning } from '../../../src/content/ContentPack';
import { DEFAULT_FOUNTAIN_STATS, resolveFountainStats } from '../../../src/game/config/mapTuning';
import { atOwnFountain } from '../../../src/game/economy/ItemShop';
import { fountainsFromSlots } from '../../../src/game/preset';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Fountain from '../../../src/game/gameObject/structures/Fountain';
import TeamId from '../../../src/game/enums/TeamId';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * How far from home a champion may still shop, and why it is not the fountain's
 * own radius.
 *
 * Every map used to answer "stand on the platform", because `atOwnFountain`
 * measured against `radius` and `radius` is one number doing two jobs: where a
 * body is restored, and how big the floor is drawn. A map that wanted people
 * shopping without walking home had exactly one lever — widen the platform —
 * which also hands out a healing pad and a floor covering a quarter of the map.
 *
 * `FountainStats.shopRange` is the half a map may move. Left alone it is the
 * platform, so no shipped map changes; set large it is "buy anywhere"; and the
 * settings in between are the interesting ones, because the number is a
 * distance from *your own base*.
 */

const FACTIONS = [{ id: 'blue' }, { id: 'red' }];

describe('resolving the shop range', () => {
  it('is the platform when nothing asks otherwise', () => {
    // The sentinel, and the reason no shipped map changes: 0 means "whatever
    // the platform is", resolved where the slot is in scope.
    expect(DEFAULT_FOUNTAIN_STATS.shopRange).toBe(0);
    expect(resolveFountainStats(undefined).shopRange).toBe(0);
  });

  it('takes the map’s number, then the slot’s over it', () => {
    // The three-layer merge every other tuning field keeps: core default, then
    // `map.tuning.fountain`, then this slot's own `stats`.
    const tuning: MapTuning = { fountain: { shopRange: 1_200 } };
    expect(resolveFountainStats(tuning).shopRange).toBe(1_200);
    expect(resolveFountainStats(tuning, { stats: { shopRange: 400 } }).shopRange).toBe(400);
  });

  it('carries it from the slot to the built platform', () => {
    // The gap a pure resolver test cannot see: a number resolved and never
    // assigned is a knob that does nothing and looks right in both the schema
    // and the resolver.
    const [preset] = fountainsFromSlots(
      [{ faction: 'blue', x: 0, y: 0, r: 150 }],
      FACTIONS,
      { fountain: { shopRange: 900 } }
    );
    expect(preset.shopRange).toBe(900);
  });
});

describe('a fountain’s two radii', () => {
  let game: TestGame;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
  });
  afterEach(() => vi.unstubAllGlobals());

  const platform = (shopRange?: number) =>
    new Fountain({
      game,
      preset: { name: 'A', x: 0, y: 0, r: 150, teamId: TeamId.BLUE, shopRange },
    });

  it('falls back to the platform, never to nothing', () => {
    // A map that asked for no shop range must not get a shop radius of zero —
    // that is a fountain nobody can buy at, produced by saying nothing at all.
    expect(platform().shopRadius).toBe(150);
    expect(platform(0).shopRadius).toBe(150);
  });

  it('keeps the healing pad where it was when the shop reaches further', () => {
    // The whole point of two numbers. Widening the shop must not widen the
    // restore, or a map that wanted convenient shopping has accidentally made
    // half of itself a fountain.
    const wide = platform(4_000);
    expect(wide.shopRadius).toBe(4_000);
    expect(wide.radius).toBe(150);
  });
});

describe('where the shop will actually serve you', () => {
  let game: TestGame;
  let champion: Champion;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    champion = new Champion({ game, teamId: TeamId.BLUE, position: createVector(600, 0) });
  });
  afterEach(() => vi.unstubAllGlobals());

  const host = (shopRadius?: number) => ({
    fountains: [{ teamId: TeamId.BLUE, position: { x: 0, y: 0 }, radius: 150, shopRadius }],
  });

  it('refuses a champion 600px out of a 150px platform', () => {
    // The rule as it stood, restated so the cases below are a change and not
    // an accident.
    expect(atOwnFountain(champion, host())).toBe(false);
  });

  it('serves the same champion once the map pushes the shop out', () => {
    expect(atOwnFountain(champion, host(1_000))).toBe(true);
  });

  it('still refuses past the range the map actually set', () => {
    // Not a boolean wearing a number: a range of 500 is a real edge, and a
    // champion at 600 is outside it.
    expect(atOwnFountain(champion, host(500))).toBe(false);
  });

  it('never serves the enemy’s platform, however far it reaches', () => {
    // The team check comes first and has to: a map that lets everyone buy from
    // anywhere must not let them buy from the other base's shop.
    const theirs = {
      fountains: [{ teamId: TeamId.RED, position: { x: 0, y: 0 }, radius: 150, shopRadius: 9_000 }],
    };
    expect(atOwnFountain(champion, theirs)).toBe(false);
  });

  it('reads the platform when a host was built without the field', () => {
    // The LAN client and several fixtures build this shape by hand. The answer
    // without it is the rule every map had before the field existed.
    const near = new Champion({ game, teamId: TeamId.BLUE, position: createVector(100, 0) });
    expect(atOwnFountain(near, { fountains: [{ teamId: TeamId.BLUE, position: { x: 0, y: 0 }, radius: 150 }] })).toBe(true);
  });
});
