import type { MapGeometry } from '@/content/ContentPack';

/**
 * A map's shape, as flat data an `<svg>` can render.
 *
 * ## Why not the minimap
 *
 * `game/gameObject/map/Minimap.ts` already draws this map — with p5, into a
 * `createGraphics` buffer, from a live `TerrainMap`, inside the match chunk.
 * None of those four is available here: the config panel runs on the menu with
 * no match, no p5 canvas and no `game` chunk (`chunks:check`), and it is handed
 * a `MapGeometry` — plain arrays of points — rather than a world.
 *
 * ## Why SVG rather than a canvas
 *
 * Roughly four hundred polygons for Summoner's Rift, drawn once and never
 * animated. A canvas would need a ref, a resize observer, a redraw when the
 * chosen map changes, and a device-pixel-ratio dance to not look soft. An
 * `<svg>` with a `viewBox` is one element, scales to whatever box the modal
 * gives it, stays crisp at any size, takes its colours from CSS like the rest
 * of the panel, and re-renders because Vue re-rendered.
 *
 * ## Coordinates
 *
 * Untouched. The `viewBox` is `0 0 size size`, so every point below is in the
 * map's own world units and no scaling happens here at all — a preview whose
 * arithmetic could disagree with the map is a preview that lies quietly. The
 * one exception is `lane`, which is a stroked polyline rather than a filled
 * shape and needs a width the viewer will actually see; that number is a
 * fraction of the map's own size, so it looks the same on a 4200 map and a
 * 6400 one.
 */

/** A filled area — one `<polygon points="…">`. */
export type PreviewPolygon = string;

/** A circular slot: a fountain, a jungle camp, a muster point. */
export interface PreviewCircle {
  x: number;
  y: number;
  r: number;
  /** The map's own faction id, or a camp's role — for a colour and a title. */
  label: string;
}

/** A turret. Square, in the map editor's own vocabulary, and small. */
export interface PreviewMarker {
  x: number;
  y: number;
  label: string;
}

export interface MapPreview {
  size: number;
  walls: PreviewPolygon[];
  bushes: PreviewPolygon[];
  water: PreviewPolygon[];
  lanes: PreviewPolygon[];
  /** Stroke width for a lane, in world units — see the header. */
  laneWidth: number;
  spawns: PreviewCircle[];
  camps: PreviewCircle[];
  musters: PreviewCircle[];
  turrets: PreviewMarker[];
  /** The first two factions, in declaration order: the only two a match seats. */
  seated: readonly string[];
}

/** `[{x,y}, …]` to the `points` attribute, at two decimals. */
const points = (polygon: readonly { x: number; y: number }[]): PreviewPolygon =>
  polygon.map(({ x, y }) => `${round(x)},${round(y)}`).join(' ');

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * A lane reads as a line and not as a hairline. 1/300th of the map's edge is
 * ~21px on Summoner's Rift, which is about a minion's width — the right thing
 * for it to look like.
 */
const LANE_WIDTH_FRACTION = 1 / 300;

/** A turret has no radius in the data; the marker is sized off the map instead. */
export const TURRET_MARKER_FRACTION = 1 / 160;

/**
 * Everything a preview draws, in one pass over the geometry.
 *
 * A polygon with fewer than three points is dropped rather than emitted as a
 * degenerate `<polygon>`: the map editor can leave one behind mid-draw, and a
 * two-point "area" renders as an invisible sliver that still costs an element.
 */
export function buildMapPreview(
  geometry: MapGeometry,
  size: number,
  factions: readonly { id: string }[] = []
): MapPreview {
  const area = (list: readonly { x: number; y: number }[][]): PreviewPolygon[] => {
    const out: PreviewPolygon[] = [];
    for (const polygon of list ?? []) {
      if (polygon && polygon.length >= 3) out.push(points(polygon));
    }
    return out;
  };

  const lanes: PreviewPolygon[] = [];
  for (const lane of geometry.lanes ?? []) {
    if (lane.waypoints && lane.waypoints.length >= 2) lanes.push(points(lane.waypoints));
  }

  return {
    size,
    walls: area(geometry.terrain?.wall ?? []),
    bushes: area(geometry.terrain?.bush ?? []),
    water: area(geometry.terrain?.water ?? []),
    lanes,
    laneWidth: round(size * LANE_WIDTH_FRACTION),
    spawns: (geometry.slots?.spawn ?? []).map(slot => ({
      x: round(slot.x),
      y: round(slot.y),
      r: round(slot.r),
      label: slot.faction,
    })),
    camps: (geometry.slots?.neutral ?? []).map(slot => ({
      x: round(slot.x),
      y: round(slot.y),
      r: round(slot.r ?? 0),
      label: slot.role,
    })),
    musters: (geometry.slots?.minion ?? []).map(slot => ({
      x: round(slot.x),
      y: round(slot.y),
      r: round(slot.scatter ?? 0),
      label: `${slot.faction} · ${slot.lane}`,
    })),
    turrets: (geometry.slots?.structure ?? []).map(slot => ({
      x: round(slot.x),
      y: round(slot.y),
      label: slot.faction,
    })),
    // Which side of the preview is "blue" is not a colour choice, it is
    // `preset.ts`'s positional bridge: the first declared faction is the blue
    // team and the second is red, whatever a map spells them. Anything after
    // is seated nowhere, and the preview colours it as neither rather than
    // inventing a third team the match will not have.
    seated: factions.slice(0, 2).map(faction => faction.id),
  };
}
