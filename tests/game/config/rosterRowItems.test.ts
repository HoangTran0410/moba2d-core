import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/seams/importScan';

/**
 * **The bag is on the row, not behind it.**
 *
 * The Đội tab could hand a champion an item and then show no sign it had:
 * `MatchLiveControls` had `giveItem`, `openShopFor` and `itemStock` and no way
 * to read a bag back, so the only proof a purchase landed was the gold going
 * down. `itemsOf` is that read (`matchConfigSource.contract.test.ts` owns its
 * shape); this file owns where the answer is *drawn*.
 *
 * Which matters because the row already has a drawer, and a drawer is where
 * this would naturally end up — it is where the gold cheat and the shop button
 * live. Putting the six squares there would technically show the bag while
 * answering none of what it is for: comparing two champions' builds at a
 * glance, without opening anything, is the whole gesture.
 *
 * Position, not just presence, is therefore what these assert. Sizes are not
 * here — that a spell icon outranks an item square is a CSS decision no scan
 * can read honestly, and `drive-match-config.mjs` is what looks at it.
 *
 * Comments are stripped before matching, or the paragraph above trips the scan
 * on the word "drawer".
 */

const SRC = join(process.cwd(), 'src');
/** `.vue` template comments are `<!-- -->`, which `stripComments` leaves alone. */
const stripAll = (source: string): string => stripComments(source).replace(/<!--[\s\S]*?-->/g, '');

const roster = (): string =>
  stripAll(readFileSync(join(SRC, 'game/hud/config/RosterTab.vue'), 'utf8'));

/** Where the collapsed row ends and the expandable sheet begins. */
const drawerAt = (source: string): number => {
  const at = source.indexOf('v-if="isExpanded(row)"');
  expect(at, 'the drawer’s v-if was renamed; this whole file measures against it').toBeGreaterThan(
    -1
  );
  return at;
};

describe('a roster row shows what its champion is holding', () => {
  it('reads the bag through the config seam, never off a unit', () => {
    // The tab may not import a `src/game/` runtime value at all
    // (`matchConfigChunk.test.ts`), so `unit.items` is not available to it even
    // if someone wanted it. This is the positive half of that rule.
    expect(roster()).toMatch(/live\.value\?\.itemsOf\(row\.id\)/);
  });

  it('draws the six squares on the collapsed row, not inside the drawer', () => {
    const source = roster();
    const strip = source.indexOf('practice-roster-items');

    expect(strip, 'no item strip on the row at all').toBeGreaterThan(-1);
    expect(strip, 'the bag is only visible after opening the row').toBeLessThan(drawerAt(source));
  });

  it('keeps the empty slots, so the strip is always six wide', () => {
    // A `v-if` on `filled` inside the loop is the tempting version and it is
    // the bug: the strip would then be as wide as the champion is fed, and the
    // numbers beside it would shift every time anyone bought anything.
    const source = roster();

    // The binding form is the template's business — `(item, slot)` for a key
    // is as correct as `item`. What must not appear is a filter.
    expect(source).toMatch(/v-for="[^"]*of itemsOf\(row\)"/);
    expect(source, 'empty slots are filtered out of the strip').not.toMatch(/v-if="item\.filled"/);
  });

  it('draws no squares at all when no installed pack sells anything', () => {
    // The same guard the shop button in the drawer already carries. A pack
    // that predates items has nothing that could ever land in those six
    // frames, so a permanently dashed strip under every name would be the row
    // explaining a feature this build does not have. An *empty* bag is worth
    // drawing; an empty shelf is not.
    expect(roster()).toMatch(/v-if="live && itemStock\.length"[\s\S]{0,120}practice-roster-items/);
  });

  it('draws the wallet on the collapsed row too, not only in the cheat drawer', () => {
    const source = roster();
    const wallet = source.indexOf('practice-roster-gold');

    expect(wallet, 'no gold on the row at all').toBeGreaterThan(-1);
    expect(wallet, 'gold still needs the drawer opened to read').toBeLessThan(drawerAt(source));
  });
});
