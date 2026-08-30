import { describe, expect, it } from 'vitest';
import { makeTerrain, mergeTerrains } from '@/mapEditor/state';
import { installEditorVendorGlobals } from './editorVendor';
import { provingGroundsGeometry } from '../../packs/reference/provingGroundsGeometry';

/**
 * `mergeTerrains` — the half of the editor's "gộp polygon" command that has no
 * screen in it, run for real in a `vm` the way `localMaps.test.ts` runs the
 * publisher.
 *
 * `Geom.union` (see `mapEditorMerge.test.ts`) answers the geometry question.
 * This answers the editing one, and the rule that makes it safe lives here
 * rather than there: **a type never merges into another type.** A bush sitting
 * against a wall shares that wall's edge exactly as two wall pieces do, so
 * geometry alone would happily weld them and quietly turn cover into terrain.
 * Grouping by `type` before the union is the whole guard.
 *
 * The command is deliberately not automatic. A map that arrives carrying an
 * `authoring` block is already in its drawn form and must be left alone; one
 * that does not is the cut form, and whether to rebuild it is the author's
 * call, not something that happens to their map on open.
 */


interface Terrain {
  id: string;
  type: string;
  position: [number, number];
  polygon: [number, number][];
  props: Record<string, unknown>;
}

/** The real `geom.js` + `state.js`, with the globals they expect. */
// `mergeTerrains` and `makeTerrain` are exports now — this used to be a `vm`
// sandbox with a stubbed `UI`, because `state.js` was a classic script and the
// only way to reach either function was to run the whole editor into a fake
// global object.
installEditorVendorGlobals();

const editor = { merge: mergeTerrains, make: makeTerrain };

/** A terrain's polygon in world coordinates, as a sorted corner set. */
const worldCorners = (t: Terrain): string[] =>
  t.polygon.map(p => `${p[0] + t.position[0]},${p[1] + t.position[1]}`).sort();

const square = (x: number, y: number, w: number, h = w): number[][] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

describe('mergeTerrains', () => {
  it('welds two walls that share an edge into one', () => {
    const merged = editor.merge([
      editor.make('wall', [0, 0], square(0, 0, 100)),
      editor.make('wall', [0, 0], square(100, 0, 100)),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].type).toBe('wall');
    expect(worldCorners(merged[0])).toEqual(['0,0', '0,100', '200,0', '200,100']);
  });

  it('never welds a bush into the wall it is touching', () => {
    const merged = editor.merge([
      editor.make('wall', [0, 0], square(0, 0, 100)),
      editor.make('bush', [0, 0], square(100, 0, 100)),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.map(t => t.type).sort()).toEqual(['bush', 'wall']);
  });

  it('leaves slots and lanes untouched', () => {
    const merged = editor.merge([
      editor.make('spawn', [500, 500], []),
      editor.make(
        'lane',
        [0, 0],
        [
          [0, 0],
          [100, 100],
        ]
      ),
    ]);

    expect(merged.map(t => t.type).sort()).toEqual(['lane', 'spawn']);
  });

  it('leaves walls around a courtyard as they were, rather than filling it in', () => {
    // A terrain carries one ring, so welding these four into a single polygon
    // would lose the middle — the courtyard would come back as solid wall.
    const pieces = [
      editor.make('wall', [0, 0], square(0, 0, 300, 100)),
      editor.make('wall', [0, 0], square(0, 200, 300, 100)),
      editor.make('wall', [0, 0], square(0, 100, 100)),
      editor.make('wall', [0, 0], square(200, 100, 100)),
    ];

    const merged = editor.merge(pieces);

    expect(merged.map(t => t.id).sort()).toEqual(pieces.map(t => t.id).sort());
  });

  it('still merges the rest of the map when one group has a courtyard', () => {
    const courtyard = [
      editor.make('wall', [0, 0], square(0, 0, 300, 100)),
      editor.make('wall', [0, 0], square(0, 200, 300, 100)),
      editor.make('wall', [0, 0], square(0, 100, 100)),
      editor.make('wall', [0, 0], square(200, 100, 100)),
    ];
    const elsewhere = [
      editor.make('wall', [0, 0], square(1000, 0, 100)),
      editor.make('wall', [0, 0], square(1100, 0, 100)),
    ];

    const merged = editor.merge([...courtyard, ...elsewhere]);

    expect(merged).toHaveLength(5);
    const welded = merged.filter(t => !courtyard.some(c => c.id === t.id));
    expect(welded).toHaveLength(1);
    expect(worldCorners(welded[0])).toEqual(['1000,0', '1000,100', '1200,0', '1200,100']);
  });

  it('never returns more shapes than it was given', () => {
    // Outer rings nest. Proving Grounds' boundary band and the corridor across
    // it union into a ring *with a hole* whose outline covers nearly the whole
    // map — so "the first outer ring containing this piece" claimed all six
    // jungle blocks too. Those got merged into new shapes *and* handed back
    // untouched as part of the holed group: twelve pieces in, eighteen out.
    // A merge that grows the map is never right, whatever else it got right.
    const walls = provingGroundsGeometry.terrain.wall.map(poly => {
      const cx = Math.round(poly.reduce((sum, p) => sum + p.x, 0) / poly.length);
      const cy = Math.round(poly.reduce((sum, p) => sum + p.y, 0) / poly.length);
      return editor.make(
        'wall',
        [cx, cy],
        poly.map(p => [p.x - cx, p.y - cy])
      );
    });

    const merged = editor.merge(walls);

    expect(merged.length).toBeLessThanOrEqual(walls.length);
  });

  it('keeps the props of the pieces it welds together', () => {
    const a = editor.make('wall', [0, 0], square(0, 0, 100));
    const b = editor.make('wall', [0, 0], square(100, 0, 100));

    const merged = editor.merge([a, b]);

    expect(merged[0].props).toEqual(a.props);
  });
});
