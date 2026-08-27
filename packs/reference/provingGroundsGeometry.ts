import type { MapGeometry } from '@moba2d/core/content/ContentPack';

/**
 * Proving Grounds' heavy half — terrain, slots and its one lane. Lazy behind
 * `packs/reference/map.ts`'s `geometry`, the same split Summoner's Rift
 * uses, so this array of polygons never rides along in the `pregame` chunk.
 *
 * ## Point-symmetric, like a MOBA map
 *
 * Every feature here — walls, bushes, slots, the lane — maps onto a feature
 * of the other side under a 180° rotation about the map's centre:
 * `mirror(p) = (size - p.x, size - p.y)`. That is the symmetry Summoner's
 * Rift has across its diagonal, and it is what makes the two sides a fair
 * fight rather than a fixture. The map *used* to be deliberately asymmetric
 * (one amber turret against two jade ones) as a tripwire for a muster rule
 * that derived the wave's forming-up point from the two turrets nearest the
 * fountain — that rule is gone (`MinionSpawner.musterPointFor`, deleted;
 * muster points are declared `slots.minion` entries now, validated at
 * install), so the asymmetry stopped guarding anything and only read as a
 * lopsided map. `tests/content/referenceMap.test.ts` now asserts the
 * symmetry instead, with the same mirror function written out.
 *
 * ## Why the map is 2416 and not a rounder 2400
 *
 * `NAV_CELL_SIZE` is 16 and `NavGrid` samples cell *centres*, at 16k+8 — so
 * a map whose half-size is a multiple of 16 (1200) puts its centre exactly
 * between two cell centres (1192, 1208), and no centred corridor can then
 * satisfy both fixtures below at once: 4 free centres rasterise as a 64px
 * gap whose widest column clears the walls by only 32px — under the 35.5
 * `refineNearWalls` demands, a corridor no body can cross — and 6 free
 * centres rasterise as 96px, outside the hostile 60-90 band. At 2416 the
 * centre (1208) *is* a cell centre, and an 80px gap centred on it holds 5
 * free centres whose middle column clears 40px each side. The pre-symmetry
 * gap threaded the same needle by accident of its off-centre placement; the
 * size is how the symmetric map threads it on purpose.
 *
 * ## The boundary
 *
 * A 60px wall band on all four edges, so the playable field is visibly an
 * arena rather than terrain that trails off into the void. The side bands
 * run y:[60,2356] so no two bands overlap; the corner squares belong to the
 * top and bottom bands, which span the full width.
 *
 * ## The corridor
 *
 * A single wall band runs the full width of the map at y:[1158,1258],
 * splitting it into a north half (jade's) and a south half (amber's), except
 * for an 80px-wide gap at x:[1168,1248] — dead centre, per the symmetry.
 * That gap is the only way across: both blocks span from the map edge to the
 * gap, so nothing routes around the ends. 80px sits inside the 60-90px band
 * the design spec calls out: narrow enough that a champion's ~55px body
 * (radius 27.5, `NavGrid.requiredClearance` demanding 35.5px of clearance
 * either side of centre) barely fits, wide enough that the corridor is not
 * merely a doorway nothing could ever fail to path through.
 * `tests/content/referenceMap.test.ts`'s `wallGapWidths` measures this the
 * way `NavGrid.fromPolygons` rasterises, not the way the polygon reads on
 * paper — 5 free 16px cells, i.e. 80px, confirmed against the actual grid —
 * and the end-to-end navigation test is what proves the refined grid then
 * actually lets a champion through. This corridor is the half of the old
 * fixture that still earns its keep (the `NavGrid` clearance bug only ever
 * surfaced in gaps this size), so it survives the symmetry pass at the same
 * hostile width.
 *
 * ## The rest
 *
 * Two turrets per faction, mirrored. Two neutral camps (`role: 'warden'`),
 * one per half, each framed by two short wall "wings" so it reads as a place
 * rather than a bare circle — both filled by `packs/reference/pack.ts`'s own
 * `warden` monster, the same one-definition-many-slots reuse Summoner's
 * Rift's wolf pits established. One waystone pillar near each base is pure
 * flavour. Two bushes flank the corridor mouths, one per side.
 */
export const provingGroundsGeometry: MapGeometry = {
  terrain: {
    wall: [
      // The outer boundary, four 60px bands.
      [
        { x: 0, y: 0 },
        { x: 2416, y: 0 },
        { x: 2416, y: 60 },
        { x: 0, y: 60 },
      ],
      [
        { x: 0, y: 2356 },
        { x: 2416, y: 2356 },
        { x: 2416, y: 2416 },
        { x: 0, y: 2416 },
      ],
      [
        { x: 0, y: 60 },
        { x: 60, y: 60 },
        { x: 60, y: 2356 },
        { x: 0, y: 2356 },
      ],
      [
        { x: 2356, y: 60 },
        { x: 2416, y: 60 },
        { x: 2416, y: 2356 },
        { x: 2356, y: 2356 },
      ],
      // The corridor's south block: x:[0,1168], y:[1158,1258].
      [
        { x: 0, y: 1158 },
        { x: 1168, y: 1158 },
        { x: 1168, y: 1258 },
        { x: 0, y: 1258 },
      ],
      // The corridor's north block: x:[1248,2416], y:[1158,1258]. The 80px
      // gap between the two is the only crossing — see this file's header.
      [
        { x: 1248, y: 1158 },
        { x: 2416, y: 1158 },
        { x: 2416, y: 1258 },
        { x: 1248, y: 1258 },
      ],
      // Wings framing the north camp at (1208, 708), clear of the corridor
      // band and 100px either side of the camp's centre.
      [
        { x: 1058, y: 608 },
        { x: 1108, y: 608 },
        { x: 1108, y: 808 },
        { x: 1058, y: 808 },
      ],
      [
        { x: 1308, y: 608 },
        { x: 1358, y: 608 },
        { x: 1358, y: 808 },
        { x: 1308, y: 808 },
      ],
      // Wings framing the south camp at (1208, 1708) — the north pair,
      // mirrored.
      [
        { x: 1058, y: 1608 },
        { x: 1108, y: 1608 },
        { x: 1108, y: 1808 },
        { x: 1058, y: 1808 },
      ],
      [
        { x: 1308, y: 1608 },
        { x: 1358, y: 1608 },
        { x: 1358, y: 1808 },
        { x: 1308, y: 1808 },
      ],
      // A waystone near each base — flavour, not a chokepoint. Mirrors.
      [
        { x: 608, y: 1908 },
        { x: 688, y: 1908 },
        { x: 688, y: 1988 },
        { x: 608, y: 1988 },
      ],
      [
        { x: 1728, y: 428 },
        { x: 1808, y: 428 },
        { x: 1808, y: 508 },
        { x: 1728, y: 508 },
      ],
    ],
    bush: [
      // One bush at each corridor mouth, brushing the lane the way
      // Summoner's Rift's lane bushes do. Mirrors of each other.
      [
        { x: 988, y: 1298 },
        { x: 1148, y: 1298 },
        { x: 1148, y: 1368 },
        { x: 988, y: 1368 },
      ],
      [
        { x: 1268, y: 1048 },
        { x: 1428, y: 1048 },
        { x: 1428, y: 1118 },
        { x: 1268, y: 1118 },
      ],
    ],
    water: [],
  },
  slots: {
    spawn: [
      { faction: 'amber', x: 308, y: 2108, r: 150 },
      { faction: 'jade', x: 2108, y: 308, r: 150 },
    ],
    minion: [
      { faction: 'amber', lane: 'mid', x: 658, y: 1758, scatter: 40 },
      { faction: 'jade', lane: 'mid', x: 1758, y: 658, scatter: 40 },
    ],
    structure: [
      { faction: 'amber', kind: 'turret', x: 708, y: 1708 },
      { faction: 'amber', kind: 'turret', x: 458, y: 1988 },
      { faction: 'jade', kind: 'turret', x: 1708, y: 708 },
      { faction: 'jade', kind: 'turret', x: 1958, y: 428 },
    ],
    neutral: [
      { role: 'warden', x: 1208, y: 708, r: 150 },
      { role: 'warden', x: 1208, y: 1708, r: 150 },
    ],
  },
  lanes: [
    {
      id: 'mid',
      from: 'amber',
      to: 'jade',
      // Waypoint 0 is the amber fountain, the same convention
      // `src/game/lanes.ts` documents for Summoner's Rift. The list is a
      // palindrome under the mirror — waypoint k from one end is waypoint k
      // from the other, rotated 180° — so both teams walk the identical
      // path. The two x:1208 waypoints thread the corridor gap
      // (x:[1168,1248]); the L-bends either side route around each half's
      // camp wings, the shape the pre-symmetry path only had on jade's side.
      //
      // A first cut of the original path put turret centres in this list
      // verbatim — the bug `src/game/lanes.ts`'s own header and
      // `tests/content/laneTurretClearance.test.ts` exist to catch: a
      // straight-line `moveTo` walk drives into the turret's body, is
      // shoved around it by `UnitCollisionSystem`, and re-acquires the same
      // line on the far side. Every waypoint here clears every turret by
      // ≥190px and every straight run between two of them by ≥130px —
      // `laneTurretClearance.test.ts`'s floors are 100px for a run and 70px
      // for a single point, and Summoner's Rift's real paths hold 118-256px,
      // so this sits at the tight end of that same band on purpose (a
      // 2416px map has far less room than a 6400px one) rather than by
      // accident.
      waypoints: [
        { x: 308, y: 2108 },
        { x: 308, y: 1858 },
        { x: 958, y: 1858 }, // passes 150px south of the inner amber turret
        { x: 958, y: 1408 },
        { x: 1208, y: 1308 },
        { x: 1208, y: 1108 },
        { x: 1458, y: 1008 },
        { x: 1458, y: 558 }, // passes 250px west of the inner jade turret
        { x: 2108, y: 558 },
        { x: 2108, y: 308 },
      ],
    },
  ],
};
