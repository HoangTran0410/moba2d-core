/**
 * The minimap: a fog-respecting map of the whole world, drawn on the canvas in
 * screen space beside the touch controls.
 *
 * **A tap on the expanded map teleports the player there.** That makes this a
 * practice tool, not a neutral HUD element — say so plainly, because a reader
 * who assumes "minimap" means "the LoL minimap" will expect a move order. A
 * move order from the minimap is a different gesture on the same surface and
 * can be added later without redesigning anything here.
 *
 * Geometry and hit-testing live at module level, free of p5 globals, so they
 * run in a plain node test with no canvas — the shape `TouchControls` already
 * uses. Only `draw()` and the buffer builder may touch p5.
 */
import { removeGraphics } from '@/utils/graphics.utils';
import AssetManager from '@/managers/AssetManager';

export interface MinimapRect {
  x: number;
  y: number;
  size: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Collapsed edge length in screen pixels, and its inset from the corner. */
export const MINIMAP_SIZE = 150;
export const MINIMAP_MARGIN = 12;
/** Expanded edge length, as a fraction of the viewport's shorter side. */
export const EXPANDED_FRACTION = 0.8;

/**
 * One transform, parameterised by the rect: the expanded and collapsed maps
 * differ only in that rect, so the teleport tap and the dot placement cannot
 * disagree with each other.
 */
export const worldToMinimap = (world: Point, rect: MinimapRect, mapSize: number): Point => ({
  x: rect.x + (world.x / mapSize) * rect.size,
  y: rect.y + (world.y / mapSize) * rect.size,
});

export const minimapToWorld = (screen: Point, rect: MinimapRect, mapSize: number): Point => ({
  x: ((screen.x - rect.x) / rect.size) * mapSize,
  y: ((screen.y - rect.y) / rect.size) * mapSize,
});

export const hitTest = (point: Point, rect: MinimapRect): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.size &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.size;

/**
 * Where the map sits for a given state and viewport. Collapsed it is pinned to
 * the top-left corner — both bottom corners are where two thumbs sit for the
 * whole match. Expanded it is centred, at a fraction of the shorter side, so a
 * tall phone and a wide desktop both get a square that fits.
 */
export const minimapRect = (expanded: boolean, viewport: MinimapViewport): MinimapRect => {
  if (!expanded) return { x: MINIMAP_MARGIN, y: MINIMAP_MARGIN, size: MINIMAP_SIZE };
  const size = Math.min(viewport.width, viewport.height) * EXPANDED_FRACTION;
  return { x: (viewport.width - size) / 2, y: (viewport.height - size) / 2, size };
};

export interface MinimapViewport {
  width: number;
  height: number;
}

/**
 * Everything the minimap reads from the match. An interface rather than a
 * `Game` reference for the same reason `TouchControlsHost` is one: it is the
 * whole coupling, and a plain object satisfies it in a node test.
 */
export interface MinimapHost {
  viewport(): MinimapViewport;
  mapSize(): number;
  /** World-space wall polygons; read once per buffer build, never per frame. */
  wallPolygons(): Point[][];
  /** Everything worth a dot this frame, fog already applied. See `MinimapBlip`. */
  blips(): readonly MinimapBlip[];
  /** Where the player is, always drawn — you can always see yourself. */
  playerPosition(): Point;
  /** `Camera.getBoundingBox()`: the one element that answers "where am I looking". */
  cameraBox(): { x: number; y: number; w: number; h: number };
}

/** What a press on the screen means to the minimap. See `Minimap.route`. */
export type MinimapAction = 'expand' | 'collapse' | 'teleport' | 'pass';

/** What a dot is, which decides its shape and size — never its world size. */
export type BlipKind = 'champion' | 'unit' | 'structure';

/**
 * One dot. The host resolves the colour because the host is the one that knows
 * the game's team palette (`teamBodyColor` in `Minion.ts`); the minimap only
 * knows where to put it.
 */
export interface MinimapBlip {
  x: number;
  y: number;
  kind: BlipKind;
  color: readonly number[];
}

/** Ground under the walls, and the walls themselves. */
const GROUND_COLOR = [16, 20, 28, 242] as const;
const WALL_COLOR = [72, 82, 100, 255] as const;
const BORDER_COLOR = [190, 205, 230, 200] as const;
/** The player, in a colour no team can be. */
export const PLAYER_COLOR = [255, 236, 140] as const;
const CAMERA_BOX_COLOR = [235, 240, 250, 190] as const;

/**
 * Dot diameters in minimap pixels at the collapsed size, by kind.
 *
 * Deliberately not derived from `stats.size`: a dot is an icon, not a scale
 * model, and a 165-unit fully-stacked champion must not become a blob covering four other
 * units. The expanded map multiplies these by its rect ratio only so the same
 * icons stay the same *apparent* size — that ratio is a property of the rect,
 * never of the unit.
 */
const BLIP_DIAMETER: Record<BlipKind | 'player', number> = {
  player: 7,
  champion: 6,
  unit: 3.5,
  structure: 5,
};
/** Past this the expanded map's icons would be blobs of their own. */
const BLIP_SCALE_MAX = 2.2;

/**
 * How often the moving layer — dots, camera box, player — is repainted.
 *
 * It used to be repainted onto the main canvas every frame, which measured at
 * 0.80ms of a 4.36ms frame on a throttled machine: the single most expensive
 * thing on screen after the fog, for a picture whose dots move a fraction of
 * one minimap pixel per frame. The cost is not the dots themselves — building
 * the blip list was 0.20ms of it — it is issuing the p5 calls sixty times a
 * second.
 *
 * 50ms is a considered number rather than a round one: it is under the ~100ms
 * at which a moving dot starts to read as stepping rather than sliding, and it
 * is slower than one simulation step so a dot never repaints twice for the same
 * position. The layer is held in a buffer between repaints, so the map is drawn
 * every frame either way — a skipped *repaint* is invisible, a skipped *draw*
 * would flicker, because `Game.draw` clears the whole canvas first.
 */
export const MINIMAP_LIVE_INTERVAL_MS = 50;

/**
 * Whether the moving layer is due a repaint. Pure, and deliberately written so
 * that a first frame (`paintedAtMs` of `-Infinity`) and a clock that has gone
 * backwards both repaint rather than freeze.
 */
export const liveLayerIsStale = (nowMs: number, paintedAtMs: number): boolean =>
  !(nowMs - paintedAtMs >= 0 && nowMs - paintedAtMs < MINIMAP_LIVE_INTERVAL_MS);

/**
 * Pixel density of the moving layer's buffer.
 *
 * The wall layer under it is pinned to 1 — it is a static trace nobody can see
 * the resolution of. The dots are different: a 3.5px "unit" dot rendered at
 * density 1 and scaled up on a 3x phone would lose the thing that makes it
 * readable. 2 keeps it crisp on the ordinary case and costs a quarter of the
 * fill area a full-density buffer would, at a fifth of the repaints the main
 * canvas was doing.
 */
const LIVE_BUFFER_DENSITY = 2;

export class Minimap {
  /** Collapsed until tapped. */
  expanded = false;

  private viewportWidth: number;
  private viewportHeight: number;

  /**
   * The wall layer, pre-rendered once per size. Two buffers rather than one
   * scaled to the other: scaling a 150px trace up to 600px is what makes a
   * minimap look muddy.
   *
   * Built lazily, on the first `draw()`, so that constructing a `Minimap` — and
   * with it every geometry method below — needs no canvas.
   */
  private collapsedBuffer: any = null;
  private expandedBuffer: any = null;
  private expandedBufferSize = 0;
  /** The restore generation these buffers were painted under — see `bufferFor`. */
  private bufferEpoch = AssetManager.purgeEpoch;

  /**
   * The moving layer, held between repaints. See `MINIMAP_LIVE_INTERVAL_MS`:
   * this is painted at 20Hz and blitted at whatever the frame rate is.
   */
  private liveBuffer: any = null;
  private liveBufferSize = 0;
  private liveDrawnAtMs = -Infinity;
  /**
   * Its own epoch, not `bufferEpoch`. `bufferFor` runs first in `draw()` and
   * clears that field as it repaints the wall layer, so sharing it would mean
   * the moving layer never heard about a purge at all — it would blit a blank
   * canvas for the rest of the match.
   */
  private liveBufferEpoch = AssetManager.purgeEpoch;

  constructor(private readonly host: MinimapHost) {
    const viewport = host.viewport();
    this.viewportWidth = viewport.width;
    this.viewportHeight = viewport.height;
  }

  /** Pure: the current rect for the current state. No p5, no canvas. */
  get rect(): MinimapRect {
    return minimapRect(this.expanded, {
      width: this.viewportWidth,
      height: this.viewportHeight,
    });
  }

  /**
   * What a press at this screen point means, given the current state. The whole
   * decision, and it needs no canvas — which is what lets the ordering that
   * `Game.syncTouches` depends on be checked in a plain node test.
   *
   * `'collapse'` deliberately does *not* claim the press: a tap outside the
   * expanded map dismisses it **and** still reaches the controls underneath,
   * so an accidental expand costs nothing. `'pass'` is "not mine at all".
   */
  route(point: Point): MinimapAction {
    if (!this.expanded) return hitTest(point, this.rect) ? 'expand' : 'pass';
    return hitTest(point, this.rect) ? 'teleport' : 'collapse';
  }

  /**
   * The world point a press lands on. Read *before* collapsing: the rect is
   * what the transform is parameterised by, and collapsing changes it.
   */
  worldAt(point: Point): Point {
    return minimapToWorld(point, this.rect, this.host.mapSize());
  }

  resize(width: number, height: number): void {
    if (width === this.viewportWidth && height === this.viewportHeight) return;
    this.viewportWidth = width;
    this.viewportHeight = height;
    // The expanded buffer is sized off the viewport, so it is now the wrong
    // pixel size. Dropped rather than resized: rebuilding is one trace of a
    // static layer, and it happens on the next frame that needs it.
    removeGraphics(this.expandedBuffer);
    this.expandedBuffer = null;
    removeGraphics(this.liveBuffer);
    this.liveBuffer = null;
  }

  // -------------------------------------------------------------------- draw

  /**
   * Screen space. Called from `Game.draw()` after `fogOfWar.draw()` and outside
   * `camera.makeDraw` — an overlay you cannot see is not an overlay.
   */
  draw(): void {
    const bounds = this.rect;
    const buffer = this.bufferFor(bounds.size);
    const live = this.liveLayerFor(bounds);

    push();
    imageMode(CORNER);
    rectMode(CORNER);
    image(buffer, bounds.x, bounds.y, bounds.size, bounds.size);
    image(live, bounds.x, bounds.y, bounds.size, bounds.size);
    noFill();
    stroke(BORDER_COLOR[0], BORDER_COLOR[1], BORDER_COLOR[2], BORDER_COLOR[3]);
    strokeWeight(2);
    rect(bounds.x, bounds.y, bounds.size, bounds.size);
    pop();
  }

  /**
   * The moving layer's buffer, repainted only when it is due.
   *
   * Same lazy/epoch shape as `bufferFor`, and the same reason for it: a
   * background purge blanks every canvas the page holds, and this one is not
   * something `AssetManager` ever saw.
   */
  private liveLayerFor(bounds: MinimapRect): any {
    const pixels = Math.max(1, Math.round(bounds.size));
    if (this.liveBufferEpochStale() || !this.liveBuffer || this.liveBufferSize !== pixels) {
      removeGraphics(this.liveBuffer);
      const graphics: any = createGraphics(pixels, pixels);
      graphics.pixelDensity(LIVE_BUFFER_DENSITY);
      this.liveBuffer = graphics;
      this.liveBufferSize = pixels;
      this.liveDrawnAtMs = -Infinity;
    }
    const now = performance.now();
    if (liveLayerIsStale(now, this.liveDrawnAtMs)) {
      this.liveDrawnAtMs = now;
      this.paintLiveLayer(this.liveBuffer, bounds.size);
    }
    return this.liveBuffer;
  }

  /** The same check `bufferFor` makes, against this layer's own generation. */
  private liveBufferEpochStale(): boolean {
    if (this.liveBufferEpoch === AssetManager.purgeEpoch) return false;
    this.liveBufferEpoch = AssetManager.purgeEpoch;
    return true;
  }

  /**
   * Everything that moves: the camera's view, the dots, and the player.
   *
   * Painted in the buffer's own coordinates — a rect at the origin — rather
   * than at the map's screen position, so the same picture is correct wherever
   * the map is blitted and an expand/collapse needs no repaint of its own.
   */
  private paintLiveLayer(graphics: any, size: number): void {
    const local: MinimapRect = { x: 0, y: 0, size };
    const mapSize = this.host.mapSize();
    const dotScale = Math.min(BLIP_SCALE_MAX, size / MINIMAP_SIZE);

    graphics.clear();
    graphics.rectMode(graphics.CORNER);

    // The view rectangle first, so no dot is hidden under its outline.
    const box = this.host.cameraBox();
    const topLeft = worldToMinimap({ x: box.x, y: box.y }, local, mapSize);
    const span = { w: (box.w / mapSize) * size, h: (box.h / mapSize) * size };
    graphics.noFill();
    graphics.stroke(
      CAMERA_BOX_COLOR[0],
      CAMERA_BOX_COLOR[1],
      CAMERA_BOX_COLOR[2],
      CAMERA_BOX_COLOR[3]
    );
    graphics.strokeWeight(1);
    graphics.rect(topLeft.x, topLeft.y, span.w, span.h);

    graphics.noStroke();
    for (const blip of this.host.blips()) {
      const at = worldToMinimap(blip, local, mapSize);
      const diameter = BLIP_DIAMETER[blip.kind] * dotScale;
      graphics.fill(blip.color[0], blip.color[1], blip.color[2]);
      if (blip.kind === 'structure') {
        graphics.rect(at.x - diameter / 2, at.y - diameter / 2, diameter, diameter);
      } else {
        graphics.circle(at.x, at.y, diameter);
      }
    }

    // Last, and outlined: the player is the one dot that must never be lost
    // under another, and is drawn whatever the fog says.
    const player = worldToMinimap(this.host.playerPosition(), local, mapSize);
    const playerDiameter = BLIP_DIAMETER.player * dotScale;
    graphics.stroke(20, 24, 32, 220);
    graphics.strokeWeight(1.5);
    graphics.fill(PLAYER_COLOR[0], PLAYER_COLOR[1], PLAYER_COLOR[2]);
    graphics.circle(player.x, player.y, playerDiameter);
  }

  private bufferFor(size: number): any {
    // A background purge blanks these pre-rendered layers along with every
    // image (`AssetManager`'s probe note): the manager repaints what it
    // loaded, but it never saw this picture, so the epoch is how this file
    // hears "your canvases are gone, paint again".
    if (this.bufferEpoch !== AssetManager.purgeEpoch) {
      this.bufferEpoch = AssetManager.purgeEpoch;
      removeGraphics(this.collapsedBuffer);
      removeGraphics(this.expandedBuffer);
      this.collapsedBuffer = null;
      this.expandedBuffer = null;
    }
    if (!this.expanded) {
      if (!this.collapsedBuffer) this.collapsedBuffer = this.buildBuffer(MINIMAP_SIZE);
      return this.collapsedBuffer;
    }
    const pixels = Math.max(1, Math.round(size));
    if (!this.expandedBuffer || this.expandedBufferSize !== pixels) {
      removeGraphics(this.expandedBuffer);
      this.expandedBuffer = this.buildBuffer(pixels);
      this.expandedBufferSize = pixels;
    }
    return this.expandedBuffer;
  }

  /** The one place besides `draw()` that may touch p5. */
  private buildBuffer(size: number): any {
    // `any`, as FogOfWar's overlay is: p5's Graphics type omits most of the
    // drawing surface it actually has.
    const graphics: any = createGraphics(size, size);
    // Pinned for the same reason FogOfWar pins its overlay: p5.Graphics
    // inherits the sketch's density, and a 3x buffer of a static layer is
    // nine times the memory for a picture nobody can see the resolution of.
    graphics.pixelDensity(1);
    graphics.clear();
    graphics.noStroke();
    graphics.fill(GROUND_COLOR[0], GROUND_COLOR[1], GROUND_COLOR[2], GROUND_COLOR[3]);
    graphics.rect(0, 0, size, size);

    const mapSize = this.host.mapSize();
    const scale = size / mapSize;
    graphics.fill(WALL_COLOR[0], WALL_COLOR[1], WALL_COLOR[2], WALL_COLOR[3]);
    for (const polygon of this.host.wallPolygons()) {
      graphics.beginShape();
      for (const vertex of polygon) graphics.vertex(vertex.x * scale, vertex.y * scale);
      graphics.endShape(graphics.CLOSE);
    }
    return graphics;
  }

  destroy(): void {
    removeGraphics(this.collapsedBuffer);
    removeGraphics(this.expandedBuffer);
    removeGraphics(this.liveBuffer);
    this.collapsedBuffer = null;
    this.expandedBuffer = null;
    this.liveBuffer = null;
  }
}

export default Minimap;
