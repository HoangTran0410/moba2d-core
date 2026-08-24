import { describe, expect, it } from 'vitest';
import { packMonogram } from '@/scenes/packs/packMonogram';

/**
 * The stand-in mark core draws for a pack it has no icon for.
 *
 * Two properties matter. It must produce *something* for any name a manifest
 * can carry — this is a stranger's string, and a blank tile is worse than no
 * tile. And the colour must be stable for an id, because the whole point is
 * that a player recognises a pack by it: a colour that moved between reloads
 * would be worse than one grey tile for everything.
 */
describe('packMonogram', () => {
  it('takes the initials of the first two words', () => {
    expect(packMonogram('Tướng Liên Minh Huyền Thoại', 'riot').text).toBe('TL');
    expect(packMonogram('Dota heroes', 'dota').text).toBe('DH');
  });

  /** A single letter rattling around in a square tile looks like a bug. */
  it('takes two letters from a one-word name', () => {
    expect(packMonogram('Reference', 'reference').text).toBe('RE');
    expect(packMonogram('riot', 'riot').text).toBe('RI');
  });

  /** Vietnamese copy, so the boundary is `\p{L}` and not `[A-Za-z]`. */
  it('reads a Vietnamese initial as a letter', () => {
    expect(packMonogram('Đấu trường', 'arena').text).toBe('ĐT');
  });

  it('falls back to the id when the name yields no letters', () => {
    expect(packMonogram('   ', 'valorant').text).toBe('VA');
    expect(packMonogram('!!! ???', 'x').text).toBe('X');
  });

  it('never comes back blank, whatever it is handed', () => {
    for (const [name, id] of [
      ['', ''],
      ['   ', ''],
      ['!!!', '!!!'],
    ]) {
      expect(packMonogram(name, id).text.length).toBeGreaterThan(0);
    }
  });

  it('gives one id one colour, every time', () => {
    expect(packMonogram('anything', 'riot').background).toBe(
      packMonogram('other', 'riot').background
    );
  });

  it('gives different ids different colours', () => {
    const hues = new Set(
      ['riot', 'reference', 'dota', 'valorant', 'arena'].map(id => packMonogram('x', id).background)
    );
    expect(hues.size).toBeGreaterThan(3);
  });

  /**
   * A bare `<<`/`*` on a 32-bit int goes negative in JavaScript, and a
   * negative hue is an invalid colour that renders as nothing. Long ids are
   * where that showed up, so the check runs over one.
   */
  it('stays a valid hue for a long id', () => {
    const long = 'a-really-long-pack-identifier-'.repeat(12);
    const match = packMonogram('x', long).background.match(/hsl\((\d+),/);
    expect(match, 'background is not an hsl() colour').not.toBeNull();
    const hue = Number(match![1]);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });
});
