import type { MapGeometry } from '@moba2d/core/content/ContentPack';

/**
 * A minimal walled arena: one wall band splits the map in two, with a
 * single 200px gap in the middle that is the only way across. One lane
 * connects the two spawns through that gap.
 *
 * This is deliberately small and deliberately undecorated — no turrets, no
 * neutral camp — so it typechecks and loads on day one. A map built to
 * stress the nav grid on purpose (a tighter gap, an asymmetric structure
 * row) is a much bigger undertaking; `packs/reference/
 * provingGroundsGeometry.ts`, in core's own checkout, is the worked
 * example if you want to see one.
 */
export const geometry: MapGeometry = {
  terrain: {
    wall: [
      // The south block: x:[0,500], y:[550,650].
      [
        { x: 0, y: 550 },
        { x: 500, y: 550 },
        { x: 500, y: 650 },
        { x: 0, y: 650 },
      ],
      // The north block: x:[700,1200], y:[550,650]. The 200px gap between
      // the two blocks (x:[500,700]) is the only crossing.
      [
        { x: 700, y: 550 },
        { x: 1200, y: 550 },
        { x: 1200, y: 650 },
        { x: 700, y: 650 },
      ],
    ],
    bush: [],
    water: [],
  },
  slots: {
    spawn: [
      { faction: 'alpha', x: 150, y: 1050, r: 120 },
      { faction: 'beta', x: 1050, y: 150, r: 120 },
    ],
    minion: [
      { faction: 'alpha', lane: 'mid', x: 150, y: 950, scatter: 30 },
      { faction: 'beta', lane: 'mid', x: 1050, y: 250, scatter: 30 },
    ],
    structure: [],
    neutral: [],
  },
  lanes: [
    {
      id: 'mid',
      from: 'alpha',
      to: 'beta',
      // Waypoint 0 is the alpha spawn, the convention `src/game/lanes.ts`
      // (core's own checkout) documents for Summoner's Rift. Every leg
      // between two waypoints stays well clear of both wall blocks: the
      // path moves to x:600 — inside the x:[500,700] gap — before it ever
      // crosses the y:[550,650] band, rather than cutting the corner.
      waypoints: [
        { x: 150, y: 1050 },
        { x: 150, y: 900 },
        { x: 600, y: 900 },
        { x: 600, y: 300 },
        { x: 1050, y: 300 },
        { x: 1050, y: 150 },
      ],
    },
  ],
};
