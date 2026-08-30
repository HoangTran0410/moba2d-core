import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ITEM_STAT_KEYS } from '@/game/items/itemStats';
import { STAT_ICON } from '@/game/hud/statIcons';

/**
 * The stat vocabulary, and the drift it exists to prevent.
 *
 * The icons were literals inside `participantStats.ts` while one panel drew
 * stats. The shop's filter chips are the second, and the failure that shape
 * invites is not a crash: it is `fa-shield` on a chip beside `fa-shield-halved`
 * on the sheet, two pictures for one stat, which no compiler, linter or
 * renderer objects to. Nothing here checks that an icon is *good*; what it
 * checks is that there is exactly one of them per stat and that every surface
 * reads it from the same place.
 */

const source = (path: string): string =>
  readFileSync(join(__dirname, '../../..', path), 'utf8');

describe('the shared stat icons', () => {
  it('names a Font Awesome class for every stat an item may grant', () => {
    // `Record<StatIconKey, string>` already makes the compiler refuse a
    // missing key. This is the other half: a key present with a value that is
    // not an icon renders an empty square, which typechecks perfectly.
    for (const key of ITEM_STAT_KEYS) {
      expect(STAT_ICON[key], key).toMatch(/^fa-[a-z0-9-]+$/);
    }
  });

  /**
   * Seventeen chips sit in one scrolling row and a player picks between them.
   * Two wearing the same picture is the row failing at the one job the icons
   * were added for — and it is the likeliest mistake when a stat is added,
   * since the nearest existing icon is always the tempting one to copy.
   */
  it('gives each of those stats an icon no other one wears', () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];

    for (const key of ITEM_STAT_KEYS) {
      const icon = STAT_ICON[key];
      const first = seen.get(icon);
      if (first) collisions.push(`${first} and ${key} both wear ${icon}`);
      else seen.set(icon, key);
    }

    expect(collisions).toEqual([]);
  });

  /**
   * The pools are the deliberate exception, and stating it here is what stops
   * the test above from being read as "every entry is unique". `maxHealth` is
   * the capacity and `health` is what is left of it — one quantity, two
   * readings, never on the same row.
   */
  it('lets a pool and its capacity share one, on purpose', () => {
    expect(STAT_ICON.health).toBe(STAT_ICON.maxHealth);
    expect(STAT_ICON.mana).toBe(STAT_ICON.maxMana);
  });
});

describe('the surfaces that draw stats', () => {
  it.each([
    ['src/game/hud/practice/participantStats.ts'],
    ['src/game/hud/shop/shopFilter.ts'],
  ])('read the table instead of writing their own icons (%s)', path => {
    const text = source(path);
    expect(text).toContain('STAT_ICON');

    // A literal `fa-…` in a file that draws stats is the drift itself: it is
    // one stat whose icon no longer changes when the table does. Comments are
    // stripped first — prose naming an icon as an example is documentation,
    // and a check that cannot tell the two apart is one somebody turns off.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
    const literals = [...code.matchAll(/['"`](fa-[a-z0-9-]+)['"`]/g)].map(match => match[1]);

    expect(literals).toEqual([]);
  });

  /**
   * And the chip actually carries it to the DOM. The table can be perfect and
   * the row still wordless-and-iconless if the markup never renders the field.
   */
  it('put the icon on the chip beside its label, not instead of it', () => {
    const panel = source('src/game/hud/shop/ShopPanel.vue');
    expect(panel).toContain(':class="chip.icon"');
    expect(panel, 'the word is the source of truth — it stays').toContain('{{ chip.label }}');
  });
});
