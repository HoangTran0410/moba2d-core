import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Minimap,
  MINIMAP_LIVE_INTERVAL_MS,
  liveLayerIsStale,
  type MinimapHost,
  type VisionCircle,
} from '../../../src/game/gameObject/map/Minimap';

/**
 * **The map is drawn every frame; its moving layer is not repainted every
 * frame.**
 *
 * Those are two different statements and the whole change lives in the gap
 * between them. `Game.draw` clears the canvas first, so skipping the *draw*
 * would flicker the minimap out of existence — measured, this was 0.80ms of a
 * 4.36ms frame on a throttled machine, and the cost was issuing the p5 calls
 * rather than deciding what to draw (the blip walk was 0.20ms of it).
 *
 * So the two cases that matter pull in opposite directions: the repaint must
 * be rationed, and the blit must not be.
 */

/** A p5.Graphics stand-in that counts what was painted into it. */
const fakeGraphics = () => {
  const calls: Record<string, number> = {};
  const count =
    (name: string) =>
    (...__args: unknown[]) => {
      calls[name] = (calls[name] ?? 0) + 1;
    };
  // The fog punches its holes with the same `circle` the dots are drawn with,
  // so the two are counted apart by what mode the buffer is in.
  let erasing = false;
  return {
    calls,
    CLOSE: 'close',
    CORNER: 'corner',
    // `removeGraphics` is the only sanctioned way to free one of these, and it
    // calls `remove()` — see `utils/graphics.utils.ts`.
    remove: count('remove'),
    pixelDensity: count('pixelDensity'),
    clear: count('clear'),
    rectMode: count('rectMode'),
    noStroke: count('noStroke'),
    noFill: count('noFill'),
    fill: count('fill'),
    stroke: count('stroke'),
    strokeWeight: count('strokeWeight'),
    rect: count('rect'),
    erase: (...__args: unknown[]) => {
      erasing = true;
      count('erase')();
    },
    noErase: () => {
      erasing = false;
      count('noErase')();
    },
    circle: (...__args: unknown[]) => count(erasing ? 'litCircle' : 'circle')(),
    beginShape: count('beginShape'),
    vertex: count('vertex'),
    endShape: count('endShape'),
  };
};

const hostWith = (
  blipCount: number,
  vision: readonly VisionCircle[] | null = [{ x: 3200, y: 3200, r: 600 }]
) => {
  let blipCalls = 0;
  const blips = Array.from({ length: blipCount }, (_unused, i) => ({
    x: i * 10,
    y: i * 10,
    kind: 'unit' as const,
    color: [255, 0, 0] as const,
  }));
  const host: MinimapHost = {
    viewport: () => ({ width: 1280, height: 800 }),
    mapSize: () => 6400,
    wallPolygons: () => [],
    blips: () => {
      blipCalls++;
      return blips;
    },
    visionCircles: () => vision,
    playerPosition: () => ({ x: 100, y: 100 }),
    cameraBox: () => ({ x: 0, y: 0, w: 800, h: 600 }),
  };
  return { host, blipCalls: () => blipCalls };
};

describe('when the moving layer is due a repaint', () => {
  it('repaints on the very first frame', () => {
    expect(liveLayerIsStale(0, -Infinity)).toBe(true);
  });

  it('holds the painted layer inside the interval', () => {
    expect(liveLayerIsStale(1000, 1000)).toBe(false);
    expect(liveLayerIsStale(1000 + MINIMAP_LIVE_INTERVAL_MS - 1, 1000)).toBe(false);
  });

  it('repaints once the interval has passed', () => {
    expect(liveLayerIsStale(1000 + MINIMAP_LIVE_INTERVAL_MS, 1000)).toBe(true);
  });

  /** A clock that has gone backwards repaints rather than freezing forever. */
  it('repaints when the clock is not ahead of the last paint', () => {
    expect(liveLayerIsStale(900, 1000)).toBe(true);
  });
});

describe('Minimap.draw', () => {
  let images: number;
  let graphics: ReturnType<typeof fakeGraphics>[];
  let now: number;

  beforeEach(() => {
    images = 0;
    graphics = [];
    now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('createGraphics', () => {
      const g = fakeGraphics();
      graphics.push(g);
      return g;
    });
    vi.stubGlobal('image', () => {
      images++;
    });
    for (const name of [
      'push',
      'pop',
      'imageMode',
      'rectMode',
      'noFill',
      'stroke',
      'strokeWeight',
      'rect',
    ]) {
      vi.stubGlobal(name, () => {});
    }
    vi.stubGlobal('CORNER', 'corner');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('paints the moving layer once across a burst of frames inside the interval', () => {
    const { host, blipCalls } = hostWith(40);
    const minimap = new Minimap(host);

    for (let frame = 0; frame < 5; frame++) {
      now += 8;
      minimap.draw();
    }

    // Five frames, one repaint — and the repaint is where the dots are.
    expect(blipCalls()).toBe(1);
  });

  it('still blits both layers on every one of those frames', () => {
    const { host } = hostWith(40);
    const minimap = new Minimap(host);

    for (let frame = 0; frame < 5; frame++) {
      now += 8;
      minimap.draw();
    }

    // Two images a frame: the wall layer and the moving layer. A frame that
    // blits neither is a frame the minimap is not on screen at all, because
    // `Game.draw` has already cleared the canvas.
    expect(images).toBe(10);
  });

  it('repaints again once the interval has elapsed', () => {
    const { host, blipCalls } = hostWith(40);
    const minimap = new Minimap(host);

    minimap.draw();
    now += MINIMAP_LIVE_INTERVAL_MS + 1;
    minimap.draw();

    expect(blipCalls()).toBe(2);
  });

  /**
   * Expanding changes the rect, which changes the buffer's pixel size — the
   * dots must not be left at the collapsed map's scale for up to 50ms.
   */
  it('repaints immediately when the map is expanded under it', () => {
    const { host, blipCalls } = hostWith(40);
    const minimap = new Minimap(host);

    minimap.draw();
    expect(blipCalls()).toBe(1);

    minimap.expanded = true;
    now += 1;
    minimap.draw();

    expect(blipCalls()).toBe(2);
  });
});

/**
 * **The minimap's fog.**
 *
 * The dots were already fog-correct — `Game.minimapBlips` consults
 * `visibleToPlayerTeam` — but the ground under them was not, so an empty
 * jungle read as an empty jungle rather than as an unwatched one, which is
 * most of what a minimap is for.
 *
 * It rides the moving layer rather than the wall layer under it, for the
 * reason the layers are split in the first place: walls do not move and vision
 * does, so the veil is repainted on the 20Hz beat and the static trace is
 * still built once per size.
 */
describe('the fog on the minimap', () => {
  let graphics: ReturnType<typeof fakeGraphics>[];
  let now: number;

  beforeEach(() => {
    graphics = [];
    now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('createGraphics', () => {
      const g = fakeGraphics();
      graphics.push(g);
      return g;
    });
    vi.stubGlobal('image', () => {});
    for (const name of [
      'push',
      'pop',
      'imageMode',
      'rectMode',
      'noFill',
      'stroke',
      'strokeWeight',
      'rect',
    ]) {
      vi.stubGlobal(name, () => {});
    }
    vi.stubGlobal('CORNER', 'corner');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** The moving layer is the second buffer built — the wall layer is first. */
  const live = () => graphics[1];

  it('punches one hole per lit disc, and closes the erase afterwards', () => {
    const { host } = hostWith(0, [
      { x: 1_000, y: 1_000, r: 600 },
      { x: 3_200, y: 3_200, r: 300 },
      { x: 5_000, y: 900, r: 450 },
    ]);
    new Minimap(host).draw();

    expect(live().calls.erase).toBe(1);
    expect(live().calls.litCircle).toBe(3);
    // Or every dot after it would be erased too — the player's own dot is
    // painted last, and it is the one dot that is never allowed to vanish.
    expect(live().calls.noErase).toBe(1);
  });

  it('veils a map the team is not looking at, with no holes at all', () => {
    const { host } = hostWith(0, []);
    new Minimap(host).draw();

    // The veil is still painted — that is the whole point of seeing nothing —
    // but nothing is erased out of it.
    expect(live().calls.rect).toBe(2); // the veil, and the camera box
    expect(live().calls.erase).toBeUndefined();
  });

  it('paints no veil at all under the reveal cheat', () => {
    const { host } = hostWith(0, null);
    new Minimap(host).draw();

    // `null` is "this map has no fog", which is not the same answer as "the
    // team can see nothing" — one is a clear map, the other a black one.
    expect(live().calls.rect).toBe(1); // the camera box alone
    expect(live().calls.erase).toBeUndefined();
  });
});
