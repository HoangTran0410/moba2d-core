import { describe, expect, it } from 'vitest';
import { parsePinnedLine, pinnedLedger } from '../../src/seams/shared';

/**
 * A line-level seam exemption, and why it counts occurrences instead of naming
 * a line number.
 *
 * The entry used to be `"<file>:<line>:<code>"`, and every edit *above* a
 * licensed line made the licence stale — a failing run whose only fix was to
 * hand-copy a new number into a debt file. Eight such repairs happened in one
 * afternoon's work across this repository and its two packs, none of them
 * saying anything about the code.
 *
 * The number was never doing the work the code text does. All it bought was a
 * cap: the same line can appear twice in a file, and licensing one occurrence
 * must not license a third somebody adds tomorrow. A count states that
 * directly, cannot drift, and — measured on the real debt files — loses
 * nothing: 104 of 104 (file, code) groups licensed every occurrence, and none
 * licensed a subset.
 *
 * The three behaviours below are the whole contract, and the middle one is the
 * one that has to be right: an exemption may never grow to cover code nobody
 * has looked at.
 */
describe('a pinned-line ledger', () => {
  const pins = (...entries: string[]) => pinnedLedger(new Set(entries));

  describe('the entry format', () => {
    it('reads file, count and code', () => {
      expect(parsePinnedLine('spells/Foo.ts:x2:doThing();')).toEqual({
        file: 'spells/Foo.ts',
        count: 2,
        code: 'doThing();',
      });
    });

    it('refuses the old line-numbered form rather than guessing at it', () => {
      // A silent reinterpretation would turn "line 26" into "26 occurrences",
      // which is a licence for code nobody has read. Unparseable is reported
      // stale by the seam, which is the loud, correct outcome.
      expect(parsePinnedLine('spells/Foo.ts:26:doThing();')).toBeNull();
    });

    it('refuses a count that licenses nothing', () => {
      expect(parsePinnedLine('spells/Foo.ts:x0:doThing();')).toBeNull();
    });
  });

  it('licenses the line wherever it has moved to', () => {
    // The whole point. Position is not part of the licence any more, so an
    // edit anywhere above it costs nobody a repair.
    const ledger = pins('spells/Foo.ts:x1:doThing();');

    expect(ledger.claim('spells/Foo.ts', '    doThing();')).toBe(true);
    expect(ledger.unspent()).toEqual([]);
  });

  it('runs out, so a further occurrence is a violation nobody licensed', () => {
    const ledger = pins('spells/Foo.ts:x2:doThing();');

    expect(ledger.claim('spells/Foo.ts', 'doThing();')).toBe(true);
    expect(ledger.claim('spells/Foo.ts', 'doThing();')).toBe(true);
    expect(
      ledger.claim('spells/Foo.ts', 'doThing();'),
      'a third occurrence rode in on a licence written for two'
    ).toBe(false);
  });

  it('reports a licence it could not spend', () => {
    const ledger = pins('spells/Foo.ts:x2:doThing();');
    ledger.claim('spells/Foo.ts', 'doThing();');

    expect(ledger.unspent()).toEqual([{ entry: 'spells/Foo.ts:x2:doThing();', reason: 'unspent' }]);
  });

  it('reports an entry nothing could ever match', () => {
    expect(pins('not an entry at all').unspent()).toEqual([
      { entry: 'not an entry at all', reason: 'malformed' },
    ]);
  });

  it('keeps one file out of another file"s budget', () => {
    const ledger = pins('spells/Foo.ts:x1:doThing();');

    expect(ledger.claim('spells/Bar.ts', 'doThing();')).toBe(false);
    expect(ledger.claim('spells/Foo.ts', 'doThing();')).toBe(true);
  });

  it('matches a bare basename, the way every other exemption field does', () => {
    // `pathMatches` — a debt file sitting inside the tree it licenses names
    // files relative to that tree, and some entries are written as basenames.
    expect(pins('Foo.ts:x1:doThing();').claim('spells/Foo.ts', 'doThing();')).toBe(true);
  });

  it('does not let one line spend another line"s licence', () => {
    const ledger = pins('spells/Foo.ts:x1:doThing();');

    expect(ledger.claim('spells/Foo.ts', 'doSomethingElse();')).toBe(false);
  });
});
