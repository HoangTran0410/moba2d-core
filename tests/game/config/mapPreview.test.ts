import { describe, expect, it } from 'vitest';
import { buildMapPreview } from '@/game/hud/config/mapPreview';
import type { MapGeometry } from '@/content/ContentPack';

/**
 * A map's shape as data an `<svg>` can render.
 *
 * The in-game minimap already draws this — with p5, into a `createGraphics`
 * buffer, from a live `TerrainMap`, inside the match chunk. None of those four
 * exists on the menu, which is where a player chooses a map, so this is the
 * other implementation and it is deliberately dumber: points in, `points`
 * attributes out, no scaling and no canvas.
 *
 * **No scaling** is the part worth pinning. The `viewBox` is the map's own
 * size, so every coordinate below is untouched world space — a preview whose
 * arithmetic could disagree with the map is a preview that lies quietly.
 */

const point = (x: number, y: number) => ({ x, y });

const geometry = (over: Partial<MapGeometry> = {}): MapGeometry => ({
  terrain: {
    wall: [[point(0, 0), point(100, 0), point(100, 100)]],
    bush: [],
    water: [],
  },
  slots: { spawn: [], minion: [], structure: [], neutral: [] },
  ...over,
});

describe('turning geometry into svg', () => {
  it('keeps world coordinates exactly, so the viewBox can be the map', () => {
    const preview = buildMapPreview(geometry(), 4_000);
    expect(preview.size).toBe(4_000);
    expect(preview.walls).toEqual(['0,0 100,0 100,100']);
  });

  it('drops a polygon with too few points instead of emitting a sliver', () => {
    // The map editor can leave a two-point "area" behind mid-draw. It renders
    // as nothing and still costs an element.
    const preview = buildMapPreview(
      geometry({
        terrain: {
          wall: [[point(0, 0), point(10, 10)], [point(0, 0), point(9, 0), point(9, 9)]],
          bush: [],
          water: [],
        },
      }),
      1_000
    );
    expect(preview.walls).toHaveLength(1);
  });

  it('carries each terrain layer separately, so they can be coloured apart', () => {
    const preview = buildMapPreview(
      geometry({
        terrain: {
          wall: [[point(0, 0), point(1, 0), point(1, 1)]],
          bush: [[point(2, 2), point(3, 2), point(3, 3)]],
          water: [[point(4, 4), point(5, 4), point(5, 5)]],
        },
      }),
      100
    );
    expect(preview.bushes).toEqual(['2,2 3,2 3,3']);
    expect(preview.water).toEqual(['4,4 5,4 5,5']);
  });

  it('draws a lane as a polyline and gives it a width the map’s own scale', () => {
    // A hairline on a 6400-unit viewBox is invisible. The width is a fraction
    // of the map, so it looks the same on a 4200 map and a 6400 one.
    const preview = buildMapPreview(
      geometry({
        lanes: [{ id: 'mid', waypoints: [point(0, 0), point(500, 500)] }],
      } as Partial<MapGeometry>),
      6_000
    );
    expect(preview.lanes).toEqual(['0,0 500,500']);
    expect(preview.laneWidth).toBe(20);
  });

  it('ignores a lane with a single waypoint', () => {
    const preview = buildMapPreview(
      geometry({ lanes: [{ id: 'mid', waypoints: [point(0, 0)] }] } as Partial<MapGeometry>),
      1_000
    );
    expect(preview.lanes).toEqual([]);
  });
});

describe('the slots', () => {
  const withSlots = () =>
    buildMapPreview(
      geometry({
        slots: {
          spawn: [
            { faction: 'lam', x: 100, y: 100, r: 150 },
            { faction: 'do', x: 900, y: 900, r: 150 },
          ],
          minion: [{ faction: 'lam', lane: 'mid', x: 200, y: 200, scatter: 55 }],
          structure: [{ faction: 'lam', kind: 'turret', x: 300, y: 300 }],
          neutral: [{ role: 'baron', x: 500, y: 500, r: 200 }],
        },
      } as Partial<MapGeometry>),
      1_000,
      [{ id: 'lam' }, { id: 'do' }]
    );

  it('carries every kind with the label the tooltip needs', () => {
    const preview = withSlots();
    expect(preview.spawns).toEqual([
      { x: 100, y: 100, r: 150, label: 'lam' },
      { x: 900, y: 900, r: 150, label: 'do' },
    ]);
    expect(preview.camps).toEqual([{ x: 500, y: 500, r: 200, label: 'baron' }]);
    expect(preview.musters).toEqual([{ x: 200, y: 200, r: 55, label: 'lam · mid' }]);
    expect(preview.turrets).toEqual([{ x: 300, y: 300, label: 'lam' }]);
  });

  it('names only the two factions a match will actually seat', () => {
    // Blue and red are not a colour choice: `preset.ts` bridges positionally,
    // `factions[0]` to blue and `factions[1]` to red, and everything after is
    // seated nowhere. The preview colours a third faction as neither rather
    // than inventing a team the match will not have.
    expect(withSlots().seated).toEqual(['lam', 'do']);

    const three = buildMapPreview(geometry(), 1_000, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(three.seated).toEqual(['a', 'b']);
  });

  it('survives a camp or a muster point with no radius declared', () => {
    const preview = buildMapPreview(
      geometry({
        slots: {
          spawn: [],
          minion: [{ faction: 'lam', lane: 'mid', x: 10, y: 10 }],
          structure: [],
          neutral: [{ role: 'crab', x: 20, y: 20 }],
        },
      } as Partial<MapGeometry>),
      1_000
    );
    expect(preview.musters[0].r).toBe(0);
    expect(preview.camps[0].r).toBe(0);
  });
});
