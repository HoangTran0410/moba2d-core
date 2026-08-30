import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The map picker's shape, scanned rather than mounted.
 *
 * There is no DOM in this suite and the panel is a Vue SFC, so what can be
 * checked here is the source: that the control moved, that the selectors the
 * e2e drives came with it, and that the two gestures stayed two. The behaviour
 * halves are `mapPreview.test.ts` and `mapRuleLines.test.ts`, which are pure
 * functions precisely so that most of this feature is testable without a
 * browser.
 */

const read = (name: string): string =>
  readFileSync(join(__dirname, '../../../src/game/hud/config', name), 'utf8');

const tab = (): string => read('MatchTab.vue');
const modal = (): string => read('MapPickerModal.vue');

describe('the picker moved out of the tab', () => {
  it('leaves a summary row that opens it, not a grid of cards', () => {
    const source = tab();
    expect(source).toContain('id="practice-map-open"');
    expect(source, 'the grid is still inline on the tab').not.toContain('id="practice-map"');
  });

  it('mounts the modal behind a v-if, so a closed picker fetches nothing', () => {
    // The preview asks for a map's polygons — the heavy half `MapSummary`
    // deliberately does not carry. A modal kept mounted would pay for that on
    // every panel open.
    expect(tab()).toMatch(/v-if="showMapPicker"[\s\S]{0,400}<\/MapPickerModal>|<MapPickerModal\s+v-if="showMapPicker"/);
  });

  it('says on the row how many rules the map bends', () => {
    // The hook for the whole feature: a map's rules were shipped, enforced and
    // only readable by opening the map editor. A map that changes nothing says
    // nothing; one that changes nine things says so before it is opened.
    expect(tab()).toContain('selectedMapRuleCount');
  });
});

describe('the modal', () => {
  it('keeps the selectors the map-picker e2e drives', () => {
    // Moving a control is not a reason to rename it. `verify-map-picker.mjs`
    // reads `#practice-map`, `.map-option[data-map]` and `.map-option-name`.
    const source = modal();
    expect(source).toContain('id="practice-map"');
    expect(source).toContain(':data-map="map.id"');
    expect(source).toContain('map-option-name');
  });

  it('separates highlighting from choosing', () => {
    // The shop's rule, restated: a tile opens the detail, a labelled button
    // transacts. A player comparing four maps must not silently change the one
    // they are about to play, and on a locked tab they may browse every map
    // and commit none.
    const source = modal();
    expect(source).toContain('viewingId = map.id');
    expect(source).toMatch(/@click="commit\(\)"/);
    expect(source).toContain(':disabled="!canCommit"');
  });

  it('drops a stale preview when a faster load lands second', () => {
    // Flicking down the list starts one load per row and they finish in
    // whatever order the bundler and the network agree on. Without the token
    // the picture settles on a map nobody is looking at any more.
    const source = modal();
    expect(source).toContain('loadToken');
    expect(source).toContain('if (token !== loadToken) return;');
  });

  it('draws the walls over the lanes, not under them', () => {
    // A lane drawn on top of a wall is a route nobody can walk — and the map
    // rules refuse that anyway, so the wall wins the pixel.
    const source = modal();
    expect(source.indexOf('mp-lane')).toBeLessThan(source.indexOf('mp-wall'));
  });
});
