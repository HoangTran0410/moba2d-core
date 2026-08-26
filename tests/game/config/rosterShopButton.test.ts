import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/seams/importScan';

/**
 * The roster hands a unit **the shop**, rather than a dropdown of item names.
 *
 * Two things were wrong with the `<select>` and only one of them was that it
 * was a dropdown. An item chosen from a list of names is chosen without its
 * stats, its description or its build path — all of which the shop already
 * draws, and none of which fits in a `<option>`. And it handed the item over
 * free, which quietly made the roster's own `+200 / +1000 vàng` buttons
 * decorative: there was nothing in the panel to spend gold on.
 *
 * So the button opens the real shop, aimed at that champion. `hudInteractions`
 * owns whose shop it is (`shopSubjectId`); this file only checks that the
 * roster asks for it by **id**, and — the part that matters for the chunking —
 * that it does so through the config seam rather than by reaching into the
 * shop itself.
 *
 * Comments are stripped before matching, or this test flags the paragraph you
 * are reading.
 */

const SRC = join(process.cwd(), 'src');
/**
 * `stripComments` handles `//` and block comments; a `.vue` file's *template*
 * comments are `<!-- -->`, and this file's own explanation of what it replaced
 * contains the word it bans. Caught on the first run — the scan flagged its own
 * documentation, which is the failure `CLAUDE.md` names by name.
 */
const stripAll = (source: string): string => stripComments(source).replace(/<!--[\s\S]*?-->/g, '');

const roster = () => stripAll(readFileSync(join(SRC, 'game/hud/config/RosterTab.vue'), 'utf8'));

describe('the roster’s way into the shop', () => {
  it('opens the shop for the row’s own unit', () => {
    expect(roster()).toMatch(/openShopFor\(row\.id\)/);
  });

  it('has no item dropdown left beside it', () => {
    // Two ways to put an item on a bot is how one of them stops being
    // maintained, and the `<select>` was the one that could not show a recipe.
    const source = roster();
    expect(source).not.toContain('practice-cheat-item-picker');
    expect(source, 'a <select> survived in the roster tab').not.toMatch(/<select/);
  });

  it('goes through the config seam, never at the shop directly', () => {
    // `matchConfigChunk.test.ts` owns this rule in general. Repeated here
    // because *this* change is the one most likely to break it: the tempting
    // version calls `hud.openShopFor` from the tab, and `hud` is the game's.
    const source = roster();
    expect(source).not.toMatch(/from ['"].*shop\/shopState['"]/);
    expect(source).not.toMatch(/from ['"].*economy\/ItemShop['"]/);
    expect(source).not.toMatch(/inject.*HudInteractions/);
  });
});
