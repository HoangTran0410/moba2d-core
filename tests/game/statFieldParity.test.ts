import { describe, expect, it } from 'vitest';
import Stats, { Stat, StatModifier, StatsModifier } from '@/game/gameObject/Stats';

/**
 * Every stat has to appear in six places, and a stat in five of them is worse
 * than a stat in none.
 *
 * `Stats` declares the live values; `StatsModifier` declares the parallel
 * modifiers; and four hand-written `add`/`remove` bodies enumerate the fields
 * one line each. Nothing connected those lists — a new stat added to the
 * declarations but missed in `Stats.removeModifier` produces a buff that grants
 * the stat and then *never gives it back*, and the failure surfaces minutes
 * later as a champion who is permanently faster than she should be, with
 * nothing in the file that added the stat to look wrong.
 *
 * This is the connection. It reflects over the real objects rather than
 * scanning the source, so it also catches a field enumerated under a typo'd
 * name — which a text scan would happily read as present.
 */
const statFields = (subject: object, kind: typeof Stat | typeof StatModifier): string[] =>
  Object.entries(subject)
    .filter(([, value]) => value instanceof kind)
    .map(([name]) => name)
    .sort();

/** Applies a modifier whose every field is a recognisable non-zero, and reports what moved. */
const fieldsThatMoved = (apply: (stats: Stats, modifier: StatsModifier) => void): Set<string> => {
  const stats = new Stats();
  const modifier = new StatsModifier();
  for (const name of statFields(modifier, StatModifier)) {
    (modifier as unknown as Record<string, StatModifier>)[name].flatBonus = 7;
  }

  const before = new Map(
    statFields(stats, Stat).map(name => [
      name,
      (stats as unknown as Record<string, Stat>)[name].value,
    ])
  );
  apply(stats, modifier);

  const moved = new Set<string>();
  for (const [name, was] of before) {
    if ((stats as unknown as Record<string, Stat>)[name].value !== was) moved.add(name);
  }
  return moved;
};

describe('the stat field lists', () => {
  const live = statFields(new Stats(), Stat);
  const modifiable = statFields(new StatsModifier(), StatModifier);

  it('declares the same stats on Stats and StatsModifier', () => {
    expect(live).toEqual(modifiable);
  });

  it('is not empty, so the comparison above means something', () => {
    expect(live.length).toBeGreaterThan(10);
  });

  it('carries armor and magicResist', () => {
    // Named rather than counted: these two are the newest, they are the two a
    // damage type reads, and a rename that quietly dropped one would otherwise
    // only be caught by the parity check above — which stays green if the
    // rename is made in both places.
    expect(live).toContain('armor');
    expect(live).toContain('magicResist');
  });
});

describe('every declared stat is actually wired through addModifier/removeModifier', () => {
  const modifiable = statFields(new StatsModifier(), StatModifier);

  it('moves every one of them when a modifier is added', () => {
    const moved = fieldsThatMoved((stats, modifier) => stats.addModifier(modifier));
    const missing = modifiable.filter(name => !moved.has(name));
    expect(missing, `${missing.join(', ')} are declared but never added`).toEqual([]);
  });

  it('puts every one of them back when it is removed', () => {
    const stats = new Stats();
    const modifier = new StatsModifier();
    for (const name of modifiable) {
      (modifier as unknown as Record<string, StatModifier>)[name].flatBonus = 7;
    }
    const before = modifiable.map(
      name => (stats as unknown as Record<string, Stat>)[name].value
    );

    stats.addModifier(modifier);
    stats.removeModifier(modifier);

    const after = modifiable.map(name => (stats as unknown as Record<string, Stat>)[name].value);
    const stuck = modifiable.filter((name, index) => after[index] !== before[index]);
    expect(stuck, `${stuck.join(', ')} were granted and never returned`).toEqual([]);
  });

  it('can see the omission it is meant to catch', () => {
    // The guard on the guard: a modifier whose field is deliberately left at
    // zero must read as "did not move", or the two cases above would pass
    // against an `addModifier` that does nothing at all.
    const stats = new Stats();
    const modifier = new StatsModifier();
    const speedBefore = stats.speed.value;
    stats.addModifier(modifier);
    expect(stats.speed.value).toBe(speedBefore);
  });
});
