import { describe, expect, it } from 'vitest';
import { randomMatchSeed, seededRandom, seededShuffle } from '../../src/game/matchSeed';

/**
 * **One number both ends of a LAN match agree on.**
 *
 * A client does not receive the jungle, it builds it — `ClientSession` matches
 * the two sides "by construction order" — so content that calls `Math.random()`
 * gives the host one drake and the client another, with nothing in the protocol
 * able to notice. A shuffled drake rotation shipped exactly that once and was
 * reverted for it.
 *
 * So what has to hold is not "the order is random" but "the order is a pure
 * function of the seed", and the seed travels.
 */
describe('a seeded stream', () => {
  it('gives the same numbers for the same seed, on any machine', () => {
    const a = seededRandom(12_345);
    const b = seededRandom(12_345);
    const first = [a(), a(), a(), a()];
    const second = [b(), b(), b(), b()];
    expect(first).toEqual(second);
  });

  it('gives different numbers for different seeds', () => {
    expect(seededRandom(1)()).not.toBe(seededRandom(2)());
  });

  it('stays inside [0, 1)', () => {
    const random = seededRandom(7);
    for (let draw = 0; draw < 500; draw++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('a seeded shuffle', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

  it('is the same permutation for the same seed', () => {
    expect(seededShuffle(items, 99)).toEqual(seededShuffle(items, 99));
  });

  it('keeps every item, exactly once', () => {
    const shuffled = seededShuffle(items, 4_242);
    expect([...shuffled].sort()).toEqual([...items].sort());
  });

  it('leaves the caller’s array alone', () => {
    const source = [...items];
    seededShuffle(source, 3);
    expect(source).toEqual([...items]);
  });

  /**
   * The property `sort(() => Math.random() - 0.5)` does not have, and the
   * reason the first attempt at a random drake order was reverted rather than
   * reseeded: that comparator is not a comparator, and the permutations it
   * produces are neither uniform nor reproducible.
   */
  it('actually reaches the whole space, not a handful of orders', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 400; seed++) seen.add(seededShuffle(items, seed).join(''));
    // 6! = 720; 400 draws cannot cover it, but a shuffle stuck on a few
    // rotations would show up here as a handful.
    expect(seen.size).toBeGreaterThan(200);
  });

  it('puts the first item somewhere other than first, given the right seed', () => {
    const moved = [...Array(50).keys()].some(seed => seededShuffle(items, seed)[0] !== items[0]);
    expect(moved).toBe(true);
  });
});

describe('a fresh seed', () => {
  it('is a whole number that survives JSON', () => {
    for (let draw = 0; draw < 50; draw++) {
      const seed = randomMatchSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(JSON.parse(JSON.stringify({ seed })).seed).toBe(seed);
    }
  });

  it('is not the same number twice in a row', () => {
    const seeds = new Set([...Array(20)].map(() => randomMatchSeed()));
    expect(seeds.size).toBeGreaterThan(1);
  });
});
