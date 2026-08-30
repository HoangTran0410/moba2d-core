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

/** Every stylesheet `index.html` loads, concatenated — they are all global. */
const stylesheets = (): string => {
  const dir = join(__dirname, '../../../styles');
  const html = readFileSync(join(__dirname, '../../../index.html'), 'utf8');
  const names = [...html.matchAll(/href="styles\/([A-Za-z0-9_.-]+\.css)"/g)].map(m => m[1]);
  expect(names.length, 'no stylesheet links found in index.html').toBeGreaterThan(3);
  return names.map(name => readFileSync(join(dir, name), 'utf8')).join('\n');
};

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

  /**
   * The button that writes the choice wore `class="btn primary"` — and no
   * stylesheet in this project has ever defined `.btn` or `.primary`, so the
   * one control the whole modal exists to reach rendered as the browser's
   * default grey box in the corner of a hextech panel. Nothing caught it:
   * a class name that matches no rule is not an error anywhere in the
   * toolchain, it is just a button that looks wrong.
   *
   * So the check is the general one rather than a ban on two words: every
   * class this modal's own markup names must exist in some stylesheet the
   * page loads.
   */
  it.each([
    ['MapPickerModal.vue', modal],
    ['MatchTab.vue', tab],
  ])('names no class the stylesheets do not define (%s)', (_name, source) => {
    const css = stylesheets();
    const classes = new Set(
      [...source().matchAll(/\bclass="([^"{}]+)"/g)].flatMap(match => match[1].split(/\s+/))
    );
    classes.delete('');
    expect(classes.size, 'the class scan matched nothing').toBeGreaterThan(5);

    const undefinedClasses = [...classes].filter(name => {
      // Font Awesome is the one family the sheets cannot answer for: it is a
      // CDN `<link>` in `index.html`, not a file in `styles/`.
      if (/^fa[srlbd]?(-|$)/.test(name)) return false;
      // Matched to a boundary, not as a substring: `.map-picker` reads as
      // defined inside `.map-picker-modal`, which would let a truncated name
      // through — the exact failure mode this test exists for.
      return !new RegExp(`\\.${name}(?![\\w-])`).test(css);
    });

    expect(undefinedClasses).toEqual([]);
  });

  /**
   * The report this came from: "đổi map bấm ok rồi ra vẫn thấy map cũ". A live
   * `Game` reads its geometry once in its constructor, so choosing a map
   * mid-match changes nothing a player can see — and the only place that said
   * so was a one-line note on the tab *behind* the modal, which is the last
   * place anyone looks after pressing a button in front of it.
   */
  it('asks about the running match instead of closing over it', () => {
    const source = modal();
    // The pick still goes through first: the choice is true for the next
    // match either way, and the question is only about *this* one.
    expect(source).toMatch(/emit\('pick', map\.id\);/);
    expect(source).toContain("if (!props.liveMapId || map.id === props.liveMapId) return emit('close');");
    expect(source).toContain('map-picker-applying');
  });

  it('says the current match ends before offering the button that ends it', () => {
    const source = modal();
    expect(source).toContain('Tạo trận mới sẽ kết thúc trận hiện tại.');
    expect(
      source.indexOf('Tạo trận mới sẽ kết thúc trận hiện tại.'),
      'the consequence is stated after the button that causes it'
    ).toBeLessThan(source.indexOf('map-picker-restart'));
  });

  /**
   * A LAN match is remade by its room, not by one player's map pick — the
   * reboot would close the socket and host a fresh room. The modal still
   * *says* what happened; it just has no button to offer.
   */
  it('offers the new match only where one can be started', () => {
    expect(modal()).toContain('v-if="canRestart"');
  });

  /**
   * The watcher runs `immediate: true`, so its body executes *during*
   * `setup()` — before any `const` written below it exists. A ref it clears
   * that is declared later is in its temporal dead zone at that moment, and
   * the modal throws on open rather than misbehaving somewhere subtle. That is
   * not hypothetical: adding the confirm state put `chosen` below the watch
   * that resets it, and `vue-tsc` is perfectly happy with it.
   */
  it('declares every ref the immediate watcher touches before the watcher', () => {
    const source = modal();
    const watchAt = source.indexOf('watch(');
    const body = source.slice(watchAt, source.indexOf('{ immediate: true }'));
    expect(body, 'the watcher is no longer immediate — retire this test').toContain('async id =>');

    const touched = [...body.matchAll(/\b(\w+)\.value = /g)].map(match => match[1]);
    expect(touched.length, 'the watcher assigns nothing — the scan missed it').toBeGreaterThan(0);

    const late = [...new Set(touched)].filter(name => {
      const declaredAt = source.indexOf(`const ${name} = ref`);
      return declaredAt === -1 || declaredAt > watchAt;
    });

    expect(late).toEqual([]);
  });

  it('draws the walls over the lanes, not under them', () => {
    // A lane drawn on top of a wall is a route nobody can walk — and the map
    // rules refuse that anyway, so the wall wins the pixel.
    const source = modal();
    expect(source.indexOf('mp-lane')).toBeLessThan(source.indexOf('mp-wall'));
  });
});
