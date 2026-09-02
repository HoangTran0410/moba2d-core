import { describe, expect, it, vi } from 'vitest';
import FogOfWar, {
  FOG_SIGHT_TICK_INTERVAL,
} from '../../../src/game/gameObject/map/FogOfWar';

describe('FogOfWar render caching', () => {
  /**
   * The pass is held for a fixed number of ticks, and for nothing else.
   *
   * It used to be keyed on the tick **and** the camera box, which reads as the
   * safer of the two and measured at a 19% hit rate on a real board: the camera
   * moves every frame while the player is walking, and a player who is walking
   * is precisely when the fog is the most expensive thing on screen. The camera
   * is no longer part of the key at all — the polygons are world space, so a
   * moving camera does not make them wrong, and `SIGHT_CAMERA_MARGIN_PX` is
   * what covers the one thing it does affect (which revealers are worth
   * painting).
   */
  it('holds one sight pass for a fixed number of ticks, whatever the camera does', () => {
    const queryObjects = vi.fn(() => []);
    const cameraBox = { x: 0, y: 0, w: 800, h: 400 };
    const fog = Object.create(FogOfWar.prototype) as FogOfWar;
    fog.game = {
      camera: { getBoundingBox: () => cameraBox },
      player: { teamId: 'blue' },
      objectManager: { revision: 1, objects: [], queryObjects },
    };

    const first = fog.calculateSight();
    const second = fog.calculateSight();

    expect(second).toBe(first);
    expect(queryObjects).toHaveBeenCalledOnce();

    // A camera that has moved is not a reason to recompute.
    cameraBox.x += 400;
    expect(fog.calculateSight()).toBe(first);
    expect(queryObjects).toHaveBeenCalledOnce();

    // One tick short of the interval: still the same answer.
    fog.game.objectManager.revision += FOG_SIGHT_TICK_INTERVAL - 1;
    expect(fog.calculateSight()).toBe(first);
    expect(queryObjects).toHaveBeenCalledOnce();

    fog.game.objectManager.revision += 1;
    expect(fog.calculateSight()).not.toBe(first);
    expect(queryObjects).toHaveBeenCalledTimes(2);
  });

  /**
   * A second match counts its ticks from zero again, and would otherwise read
   * the finished match's fog until its revision climbed back past it.
   */
  it('does not read a previous match’s answer when the tick count restarts', () => {
    const queryObjects = vi.fn(() => []);
    const fog = Object.create(FogOfWar.prototype) as FogOfWar;
    fog.game = {
      camera: { getBoundingBox: () => ({ x: 0, y: 0, w: 800, h: 400 }) },
      player: { teamId: 'blue' },
      objectManager: { revision: 5_000, objects: [], queryObjects },
    };

    const stale = fog.calculateSight();
    fog.game.objectManager.revision = 0;

    expect(fog.calculateSight()).not.toBe(stale);
    expect(queryObjects).toHaveBeenCalledTimes(2);
  });

  it('reuses obstacle segments when only the radius changes', () => {
    const fog = Object.create(FogOfWar.prototype) as FogOfWar;
    const obstacles = [{ id: 'wall-a' }, { id: 'bush-b' }];
    const signature = fog.buildObstacleSignature as any;

    expect(signature.call(fog, obstacles, 500)).toBe(signature.call(fog, obstacles, 501));
  });
});

/**
 * The gradient cache is a cache of **context-bound objects**, and the context
 * does not survive a resize.
 *
 * `resizeCanvas` writes `canvas.width`/`height`, which resets the 2D context
 * outright — p5 knows it and snapshots the context around the call, but read
 * what it snapshots: strings and numbers, never objects. So every
 * `CanvasGradient` handed to `fillStyle` belongs to a context that is gone,
 * and `getRadialGradient` buckets by `(innerR, radius)` with nothing to evict
 * it.
 *
 * A rejected `fillStyle` assignment is silent and leaves the previous fill
 * standing — inside `erase()` that is p5's own opaque erase colour, so the
 * polygon clears at full strength with a hard edge instead of fading out, on
 * exactly the radii cached before the resize and no others. Reported from an
 * iPad, where Safari fires resizes all day (URL bar, rotation, Split View)
 * and a desktop window never does.
 */
describe('FogOfWar gradient cache', () => {
  const fogWithFakeOverlay = () => {
    const fog = Object.create(FogOfWar.prototype) as FogOfWar;
    let made = 0;
    fog.gradientCache = new Map();
    fog.colorStops = [{ stop: 0, color: '#fff' }];
    fog.overlay = {
      drawingContext: {
        createRadialGradient: () => ({ addColorStop() {}, id: ++made }),
      },
      resizeCanvas() {},
    } as never;
    return fog;
  };

  it('reuses a gradient for the same radii, which is why it exists', () => {
    const fog = fogWithFakeOverlay();
    expect(fog.getRadialGradient(10, 40)).toBe(fog.getRadialGradient(10, 40));
  });

  it('throws it all away when the canvas underneath it is reset', () => {
    const fog = fogWithFakeOverlay();
    const before = fog.getRadialGradient(10, 40);

    fog.resize(800, 600);

    expect(fog.getRadialGradient(10, 40)).not.toBe(before);
  });
});
