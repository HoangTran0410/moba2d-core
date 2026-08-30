import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cam, E, pickR, turretBodyR } from '@/mapEditor/state';
import { DEFAULT_TURRET_PRESET } from '@/game/gameObject/structures/Turret';

/**
 * What the editor draws for a slot, and what it lets you grab.
 *
 * A turret used to draw two things: a **screen-fixed 12px square** and, under
 * it, a circle at the turret's real body radius. The square was the only thing
 * `pickR` knew about, so the thing on screen and the thing under the cursor
 * were different objects — dragging a turret meant aiming at the dot in the
 * middle while the big circle around it sat inert. The square is gone and the
 * circle is the target, which makes "does the pick radius still agree with the
 * drawn radius" a thing worth holding.
 *
 * Run in a `vm` for the reason `localMaps.test.ts` gives: the editor is plain
 * browser globals with no build, so this is the only way to call its real
 * functions rather than a re-implementation of them.
 */


/**
 * A turret slot as the editor holds one. A real object now: this used to be a
 * *string* of JavaScript, spliced into an expression and run inside a `vm`
 * context, because `state.js` was a classic script with no way in. The
 * functions under test are ordinary imports, so the fixture is an ordinary
 * value and the assertions call them directly.
 */
const turret = (stats?: Record<string, number>) =>
  ({ type: 'structure', position: [0, 0], props: stats ? { stats } : {} }) as never;

/** Each case starts from a clean camera and no map tuning. */
function reset(): void {
  Cam.scale = 1;
  E.meta.tuning = undefined;
}

describe('a turret in the map editor', () => {
  it('can be grabbed anywhere on the circle it draws', () => {
    reset();
    Cam.scale = 1;

    // One function behind both, which is the whole rule: `render.js` draws
    // `turretBodyR` and `pickR` returns it. Two copies of the formula would
    // drift, and the drift is invisible — the circle simply stops being the
    // thing you clicked.
    expect(pickR(turret({ size: 200 }))).toBe(100);
    expect(turretBodyR(turret({ size: 200 }))).toBe(100);
  });

  it('is that big by default, which is why the square was a lie', () => {
    reset();
    Cam.scale = 1;

    // Read off core rather than restated: the editor cannot import `src/`, so
    // this number is copied into `state.js` by hand and this is the only thing
    // that notices when core moves it.
    expect(turretBodyR(turret())).toBe(DEFAULT_TURRET_PRESET.size / 2);
  });

  it('takes its size from the map’s own tuning, then from the slot', () => {
    reset();
    Cam.scale = 1;
    E.meta.tuning = { turrets: { size: 300 } };

    // The same three layers core merges — core default, map tuning, slot
    // `stats` — so a map that made every turret huge is huge in the editor too.
    expect(turretBodyR(turret())).toBe(150);
    expect(turretBodyR(turret({ size: 40 }))).toBe(20);
  });

  /**
   * The one place the pick radius is still allowed to disagree with the
   * drawing, and it disagrees in the safe direction: zoomed far enough out a
   * turret is a couple of pixels across, and an object you cannot hit is worse
   * than a grab area larger than the ink.
   */
  it('stays grabbable when zoomed out past the point of being visible', () => {
    reset();
    Cam.scale = 0.02;

    const pick = pickR(turret({ size: 20 }));
    expect(pick).toBeGreaterThan(10);
    expect(pick * 0.02).toBeCloseTo(12, 5);
  });
});

describe('what the editor draws around a slot', () => {
  const render = (): string =>
    readFileSync(resolve(__dirname, '../../src/mapEditor/render.ts'), 'utf8');

  it('draws no square for a turret any more', () => {
    // `ctx.rect` inside the marker was the square. The diamond for a muster
    // point is drawn with `moveTo`/`lineTo` and is not this.
    expect(render()).not.toContain('// hình vuông đứng — trụ');
    expect(render()).toContain('function drawTurret(');
  });

  it('reads the body radius from state.js rather than recomputing it', () => {
    // The formula lives in one place because `pickR` has to agree with it.
    // Comments stripped first — the doc comment right above `drawTurret`
    // *explains* the formula as `size / 2`, and a scan that cannot tell prose
    // from code flags the documentation that makes the rule findable.
    const body = render().slice(render().indexOf('function drawTurret('));
    const code = body
      .slice(0, body.indexOf('\n  }'))
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/.*$/gm, ' ');

    expect(code).toContain('turretBodyR(t)');
    expect(code, 'drawTurret is deriving the radius itself again').not.toMatch(/size\s*\/\s*2/);
  });

  /**
   * A fountain's `shopRange` was the one field of a spawn slot with nothing on
   * screen: the platform's radius *is* the circle, heal and mana are numbers in
   * the panel, and "how close do I have to stand to open the shop" only showed
   * up by starting a match and walking around. That is the field maps like
   * "mua đồ ở giữa đường" are built out of.
   */
  it('draws the fountain’s shop range', () => {
    const source = render();
    expect(source).toContain('slotNumber(t, "shopRange", "fountain", 0)');
  });

  /**
   * And every ring says what it is when its slot is selected. The report this
   * came from was a question — "vòng tròn màu cam nét đứt bên ngoài là gì
   * nhỉ?" — which is an editor missing a word, not a reader missing a clue.
   */
  it('names each ring when the slot is selected', () => {
    const source = render();
    expect(source).toContain('function queueRingLabel(');
    for (const ring of ['lính không vào gần hơn', 'tầm bắn', 'tầm mua đồ', 'tầm đuổi']) {
      expect(source, `${ring} has no label`).toContain(ring);
    }
  });
});
