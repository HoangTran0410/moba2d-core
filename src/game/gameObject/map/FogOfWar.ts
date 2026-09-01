import PolyVisibility from '@/libs/poly-visibility';
import TerrainType from '@/game/enums/TerrainType';
import CollideUtils from '@/utils/collide.utils';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import { Circle } from '@/libs/quadtree';
import { removeGraphics } from '@/utils/graphics.utils';
import { hasLineOfSight } from '@/game/combat/Vision';
import { revealedTo } from '@/game/combat/AttackReveal';
import { resolveVisionTuning } from '@/game/config/mapTuning';

// The fog polygon is recomputed at the unit's live position every frame — no
// throttle, no interpolation — so the gradient (drawn every frame at the
// unit's live screen position, see drawVisions/prepareRadialGradient) and the
// polygon never drift apart. That's affordable because computeSightPoly's
// cost splits cleanly in two:
//   1. which obstacles are in vision range, and the broken (non-intersecting)
//      segment list built from them — this is the O(n^2) part
//      (PolyVisibility.breakIntersections) — only changes when the unit
//      crosses into a new neighbourhood of walls/bushes, so it's cached per
//      unit (see SightCacheEntry.segments/obstacleSignature) and reused
//      across frames until that set turns over;
//   2. the radial sweep against the exact source point
//      (PolyVisibility.computeViewport) depends on the unit's live position
//      and must run every frame for the fog to track it smoothly — it's the
//      O(n) part, and it's what actually runs unconditionally below.
// A unit that hasn't moved at all since last frame (exact position/radius
// equality) skips both and returns last frame's polygon outright, so a
// standing unit — every turret, all match long — still costs nothing.
//
// Every revealer casts one of these polygons, champion or not. Minions and
// turrets were painted as plain discs for a long time on the grounds that an
// ally swarm should cost a fill each rather than a raycast each — and the disc
// reached straight through walls and bushes, so a lane's fog looked as if the
// wave could see into the jungle while `combat/Vision.ts` had already decided
// it could not. Two things pay for the polygons instead: only revealers *near
// the camera* get one at all (see calculateSight), and a granted revealer's
// "hasn't moved" test carries a tolerance rather than demanding exact equality
// (GRANTED_SIGHT_TOLERANCE_PX), because nobody is steering a minion's fog.
type SightSegment = [number, number][];

/**
 * Soft-edge width, in world px, of the fade at the rim of a revealer's hole.
 *
 * A champion's own sight ends sharply; a granted circle — what a minion or a
 * turret lends the team — fades over twice the distance, which is what has
 * always made an ally swarm read as a soft wash rather than as a row of discs.
 * Both numbers predate the polygons and are kept exactly as they were.
 */
const OWN_SIGHT_RING_PX = 50;
const GRANTED_SIGHT_RING_PX = 100;

/**
 * How far a *granted* revealer may drift from the position its polygon was
 * cast at before the polygon is recast.
 *
 * The player's own champions recast every frame (tolerance 0) because the fog
 * has to track the thing the player is steering. A minion's circle is
 * peripheral: it walks ~2.6px per frame, so 12px is one recast every five
 * frames and cuts the sweep cost of a full wave by the same factor. Nothing
 * shows, because the drift lands inside a 100px fade — but only as long as
 * `computeSightPoly` widens its clip box by the same amount, or the box's
 * straight edge would slide in under the gradient and draw a faint seam. It
 * does; see the `boxRadius` line there.
 */
const GRANTED_SIGHT_TOLERANCE_PX = 12;

/**
 * How many simulation ticks one sight pass is allowed to stand for.
 *
 * `ObjectManager.revision` is bumped once per tick, so the pass used to run
 * once per tick — and since a machine draws at roughly its tick rate, that
 * meant once per frame. Measured at 10x CPU throttle with 200 minions on the
 * board, `calculateSight` was 2.1ms of an 8.0ms frame: after the fog's own
 * painting, the most expensive thing the renderer did.
 *
 * Two, i.e. 30Hz, is the whole change. It is not a guess about what is
 * imperceptible — the *painting* still runs every frame, and the polygons it
 * paints are in world space, so nothing on screen goes stale when the camera
 * moves. What is held for one extra tick is where the revealers were, and one
 * tick of champion movement is under 8px on a 6400px map, drawn through a
 * gradient rim over a hundred pixels wide.
 *
 * Raising it further is not free in the way this step was: past about four
 * ticks a dash starts to visibly drag its own fog behind it.
 */
export const FOG_SIGHT_TICK_INTERVAL = 2;

/**
 * Slack on the "is this revealer worth painting" camera test, in world px.
 *
 * The pass used to re-run whenever the camera box changed by any amount, so
 * "on camera" could be answered exactly. It no longer does, so the answer has
 * to hold for `FOG_SIGHT_TICK_INTERVAL` ticks of panning.
 *
 * Sized to what a camera can actually travel in that time and no further. The
 * first attempt at this used 256px on the reasoning that slack is cheap, and it
 * measured the whole point of the change away: minions queue in lanes just off
 * screen, so a margin that generous nearly tripled the polygons cast per pass —
 * from about ten to about twenty-eight — and the fog cost exactly what it had
 * before. A camera follows a champion, the fastest of whom covers well under
 * 10px in a tick, so 48 is already several times the worst case.
 */
const SIGHT_CAMERA_MARGIN_PX = 48;

/**
 * How far an object lights fog. AttackableUnits carry the `fogRevealRadius`
 * getter (minions and turrets have no combat sight — visionRadius 0 — but
 * still light a circle for the team). A spell-made eye — a pack's ward, a
 * plain SpellObject with a bare `visionRadius` — carries no such getter, and
 * `undefined > 0` silently dropped it from the whole sight pass: the one seam
 * `combat/Vision.ts` promises works for wards lit nothing on screen.
 */
const fogRevealOf = (o: any): number =>
  typeof o.fogRevealRadius === 'number' ? o.fogRevealRadius : (o.visionRadius ?? 0);

interface SightCacheEntry {
  sightPoly: { x: number; y: number }[];
  x: number;
  y: number;
  /** The reveal radius the polygon was cast at — not necessarily combat sight. */
  radius: number;
  // Broken segment list for the obstacles currently in range. Obstacle
  // vertices are static world coordinates, so this depends only on *which*
  // obstacles are selected, never on the unit's exact position — see
  // buildSegments/obstacleSignature.
  segments: SightSegment[];
  // Fingerprint of the obstacle set `segments` was built from: sorted
  // obstacle ids, after the "bush I'm standing in" filter. A bush
  // entering/leaving containment changes which ids survive that filter, so
  // it doesn't need its own field here — it already changes this string.
  obstacleSignature: string;
}

type SightResult = {
  object: any;
  sightPoly: { x: number; y: number }[];
  /** What the gradient is sized to: the reveal radius, never combat sight. */
  radius: number;
  /** Width of the soft rim, in world px. */
  ring: number;
};

/** A granted eye — a minion, a turret — and the circle it lends the team. */
type RevealCircle = { source: any; x: number; y: number; r: number };

export default class FogOfWar {
  game: any;
  overlay: any;
  outOfViewColor: string;
  colorStops: { stop: number; color: string }[];

  // Keyed by the unit object itself (position is mutated in place, never
  // reassigned, so identity is a stable cache key). A WeakMap means dead units
  // that get dereferenced elsewhere (removed from ObjectManager.objects) fall
  // out of this cache for free once GC'd — nothing here can leak.
  sightCache: WeakMap<any, SightCacheEntry>;
  // CanvasGradient objects are reused across units/frames by bucketing on the
  // (innerR, radius) pair that defines their stops; screen position is applied
  // separately via context translate (see prepareRadialGradient).
  gradientCache: Map<string, CanvasGradient>;
  lastSightCalculation?: {
    /** The tick this answer was computed on — see `FOG_SIGHT_TICK_INTERVAL`. */
    revision: number;
    result: SightResult[];
  };

  constructor(game: any) {
    this.game = game;
    this.overlay = createGraphics(windowWidth, windowHeight);
    // Pinned, not inherited. The overlay is a full-viewport buffer that is
    // cleared and repainted every frame, so its backing store is the single
    // largest per-frame cost in the fog. p5.Graphics takes its density from the
    // sketch, and the sketch's own `pixelDensity(1)` is set in GameScene.enter
    // — one line away from here, in another file, and nothing fails loudly if
    // it moves. On a 3x phone an inherited density would be a 9x buffer: a
    // 900x400 viewport becomes 2700x1200, ten million pixels cleared and
    // composited per frame for a translucent black shape with soft edges that
    // nobody can see the resolution of.
    // 1 is also the floor, which is not obvious: going *below* screen
    // resolution is slower, not faster. A CPU profile charges 82% of every
    // drawImage in the game to the `image()` call at the end of draw(), so a
    // quarter-area buffer looks like an easy win — but it turns that blit from
    // a 1:1 copy into a scaled resample of every destination pixel, and a
    // 422x195 overlay measured 4.61ms per frame against 2.09ms at 844x390.
    // (Measured under software rasterisation; a GPU-composited canvas may
    // trade differently, so re-measure on a device before revisiting.)
    this.overlay.pixelDensity(1);
    this.outOfViewColor = '#0007';

    this.colorStops = [
      { stop: 0, color: '#fff' },
      { stop: 1, color: '#0000' },
    ];

    this.sightCache = new WeakMap();
    this.gradientCache = new Map();
  }

  draw(): void {
    // clear() (clearRect) followed by background() (a normal-blend fillRect)
    // is two full-canvas passes to reach the same result as one: painting with
    // 'copy' compositing discards the destination outright, same as clearing
    // to transparent first — but in a single fillRect.
    const ctx = this.overlay.drawingContext;
    ctx.save();
    this.overlay.resetMatrix();
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = this.outOfViewColor;
    ctx.fillRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.restore();

    this.overlay.erase();
    this.overlay.noStroke();
    this.drawVisions();
    this.overlay.noErase();

    image(this.overlay, width / 2, height / 2, width, height);
  }

  calculateSight(): SightResult[] {
    const { x, y, w, h } = this.game.camera.getBoundingBox();
    const revision = this.game.objectManager.revision;
    const cached = this.lastSightCalculation;
    // Held for a fixed number of ticks (`FOG_SIGHT_TICK_INTERVAL`), never for a
    // camera that happens not to have moved. The camera used to be half the
    // key, which sounds right and measured at a 19% hit rate: a player who is
    // walking moves the camera every frame, and a player who is walking is
    // exactly when the fog costs the most. `>= 0` so a new match — whose
    // revision counts from zero again — does not read the old one's answer.
    if (
      typeof revision === 'number' &&
      cached !== undefined &&
      revision - cached.revision >= 0 &&
      revision - cached.revision < FOG_SIGHT_TICK_INTERVAL
    ) {
      return cached.result;
    }

    // Deliberately NOT narrowed to the camera.
    //
    // What the team can see and what is worth painting are two questions, and
    // this pass answers both. The overlay only ever needs revealers near the
    // camera — there is no point erasing fog off screen — but this is also the
    // only writer of `visibleToPlayerTeam`, which `Game.minimapBlips` reads to
    // decide whether a unit gets a dot, and the minimap draws the whole map. So
    // the camera test used to delete allied minions, wards and champions from
    // the minimap the moment the player walked away from them, along with
    // everything they were lighting: the team held the vision and the map would
    // not show it. Turrets and fountains hid the bug, being structures that
    // `minimapBlips` draws without consulting the flag at all.
    //
    // The narrowing moved down to the two lists below, where it belongs.
    const allyObjects = this.game.objectManager.queryObjects({
      queryByDisplayBoundingBox: true,
      filters: [
        PredefinedFilters.teamId(this.game.player.teamId),
        (o: any) => {
          if (o === this.game.player) return true;
          if (PredefinedFilters.includeDead(o)) return false;
          return fogRevealOf(o) > 0;
        },
      ],
    });

    const allSightPoly: SightResult[] = [];
    const visiblePlayers: any[] = [];
    /** Every allied granted circle on the map — what `visibleToPlayerTeam` is computed from. */
    const revealCircles: RevealCircle[] = [];
    // Widened: this answer now stands for more than one tick. See
    // `SIGHT_CAMERA_MARGIN_PX`.
    const nearCamera = (ox: number, oy: number, r: number) =>
      CollideUtils.circleRect(
        ox,
        oy,
        r,
        x - SIGHT_CAMERA_MARGIN_PX,
        y - SIGHT_CAMERA_MARGIN_PX,
        w + SIGHT_CAMERA_MARGIN_PX * 2,
        h + SIGHT_CAMERA_MARGIN_PX * 2
      );

    allyObjects.forEach((obj: any) => {
      const radius = fogRevealOf(obj);
      if (obj.visionRadius > 0) {
        // Player and allied champions: the real, wall-aware sight polygon. Run
        // for all of them rather than the on-camera ones — a team fields at most
        // a handful of champions, and an ally's sight has to keep revealing for
        // the minimap while the player is looking somewhere else.
        const { sightPoly, playersInSight } = this.calculateSightForObject(obj);
        visiblePlayers.push(...playersInSight);
        if (nearCamera(obj.position.x, obj.position.y, radius)) {
          allSightPoly.push({ object: obj, sightPoly, radius, ring: OWN_SIGHT_RING_PX });
        }
      } else {
        // A minion or turret. Its circle is *granted* sight — the unit has no
        // combat sight of its own — but it obeys the same walls a champion's
        // does. It was painted as a plain disc for a long time, and the disc
        // reached straight through walls and bushes: the fog on a lane read as
        // if the wave could see into the jungle, while `combat/Vision.ts` had
        // already decided (correctly) that it could not, so an enemy sitting
        // in that lit-through wall was on screen and unclickable.
        //
        // `revealer`, not `circle`: `circle` is a p5 global. See CLAUDE.md.
        const revealer: RevealCircle = {
          source: obj,
          x: obj.position.x,
          y: obj.position.y,
          r: radius,
        };
        revealCircles.push(revealer);
        // The polygon is what costs, so only what is on screen pays for one.
        // Off camera there is no fog to erase, and the visibility half below
        // answers walls with a line-of-sight test that needs no polygon.
        //
        // `radius > 0` is not redundant with the ally filter: the player is
        // force-included there whatever it lights, and its `visionRadius` is
        // the *animated* one — 0 until `draw()` has lerped it up, and 0 for
        // every champion in a headless test. A zero-radius revealer paints
        // nothing, so casting a polygon for it is pure cost.
        if (radius > 0 && nearCamera(revealer.x, revealer.y, revealer.r)) {
          allSightPoly.push({
            object: obj,
            sightPoly: this.getSightPoly(obj, radius, GRANTED_SIGHT_TOLERANCE_PX),
            radius,
            ring: GRANTED_SIGHT_RING_PX,
          });
        }
      }
    });

    // Reset the player's-eye visibility flag on every AttackableUnit, then
    // re-light the ones in sight. Structures opt out — once built they stay on
    // the map, and the update loop is not in lockstep with draw, so re-enabling
    // them from their own update() would flicker.
    //
    // This flag is the *only* thing the sight pass writes outside itself, and
    // it feeds rendering alone — see `AttackableUnit.visibleToPlayerTeam`. That
    // is what keeps the painting side of the fog separable from the game: what
    // a unit may target is `combat/Vision.ts`'s answer, per observer, never
    // this one.
    //
    // The reset is not to `false` but to "unless it just gave itself away".
    // An enemy who unit-targeted somebody out of a brush is lit for two
    // seconds wherever they are standing — that is the whole of the reported
    // bug ("đứng trong bụi, đánh vào kẻ địch, expect là phải bị lộ"), and
    // folding it into the reset that already walks every object is what keeps
    // it from being a third full pass. `combat/AttackReveal.ts` has the rule.
    const viewer = { teamId: this.game.player?.teamId };
    /** Attackers lit this frame — each one lights a circle around itself too. */
    const revealedEnemies: any[] = [];
    this.game.objectManager.objects.forEach((o: any) => {
      if (!(o instanceof AttackableUnit) || o.alwaysVisible) return;
      const gaveItselfAway = revealedTo(viewer, o);
      o.visibleToPlayerTeam = gaveItselfAway;
      if (gaveItselfAway) revealedEnemies.push(o);
    });
    visiblePlayers.forEach((p: any) => (p.visibleToPlayerTeam = true));

    // A revealed attacker is a *revealer*, on the enemy's behalf.
    //
    // Two things follow from that and both are needed. League reveals a
    // **radius**, not a body, and that is the half that matters in a brush
    // fight: two enemies waiting in one bush, one swings, and both are seen —
    // revealing only the swinger leaves their partner invisible beside a body
    // you can see. And the fog is *painted after the world*, so a unit flagged
    // visible with no hole burned around it is a unit drawn and then covered
    // over: targetable, on the minimap, and not on screen. Pushing a sight
    // polygon here is what makes the reveal something a player can see.
    //
    // Wall-aware, like every other granted circle in this pass and for the
    // reason recorded there: a plain disc reaches through walls, and then what
    // is drawn and what may be targeted stop agreeing.
    if (revealedEnemies.length) {
      const reach = resolveVisionTuning(this.game.mapTuning).attackRevealRadius;
      for (const attacker of revealedEnemies) {
        revealCircles.push({
          source: attacker,
          x: attacker.position.x,
          y: attacker.position.y,
          r: reach,
        });
        if (nearCamera(attacker.position.x, attacker.position.y, reach)) {
          allSightPoly.push({
            object: attacker,
            sightPoly: this.getSightPoly(attacker, reach, GRANTED_SIGHT_TOLERANCE_PX),
            radius: reach,
            ring: GRANTED_SIGHT_RING_PX,
          });
        }
      }
    }

    // Granted circles light any body standing in them — distance first, because
    // it rejects almost everything for two multiplies, then the wall test.
    //
    // This flag decides what is *drawn*; `combat/Vision.ts`'s `canSee` decides
    // what may be *targeted*, and the whole reason both exist is that they have
    // to give the same answer. The distance test used to be the whole rule
    // here, so an enemy behind a wall from an allied minion was drawn on the
    // player's screen and refused as a target in the same frame.
    //
    // The raycast only runs for a pair that already passed the distance test,
    // and the loop breaks on the first eye that sees — so a unit standing in
    // its own wave pays one, and a unit nothing is lighting pays none.
    if (revealCircles.length) {
      this.game.objectManager.objects.forEach((o: any) => {
        if (!(o instanceof AttackableUnit) || o.visibleToPlayerTeam || o.alwaysVisible) return;
        const { x: ox, y: oy } = o.position;
        for (const c of revealCircles) {
          const dx = ox - c.x;
          const dy = oy - c.y;
          if (dx * dx + dy * dy > c.r * c.r) continue;
          if (!this.grantedEyeSees(c.source, o)) continue;
          o.visibleToPlayerTeam = true;
          break;
        }
      });
    }

    if (typeof revision === 'number') {
      this.lastSightCalculation = { revision, result: allSightPoly };
    }
    return allSightPoly;
  }

  /**
   * Whether a granted eye — an allied minion or turret — actually has `target`
   * in view, distance already established by the caller.
   *
   * **This is `combat/Vision.ts`'s `viewIsClear`, line for line, and must stay
   * that way**: that module answers what may be *targeted*, this answers what
   * is *drawn*, and the fog is only a promise while the two agree. It is
   * copied rather than imported because `ContentApi` re-exports the whole of
   * `Vision` (`import * as Vision`), so a fourth exported name there widens the
   * published pack contract — a `contract:bump` and a core minor — for a
   * three-line predicate no pack has any use for. The geometry itself is *not*
   * copied: both call the same public `hasLineOfSight`.
   *
   * The `revealedTo` line is the newer of the two non-geometry rules and
   * outranks everything under it: a unit that unit-targeted somebody is lit for
   * its enemies through a wall as readily as out of a brush
   * (`combat/AttackReveal.ts`).
   *
   * The `isInsideBush` line is the half that is not geometry. `TerrainMap`
   * maintains that boolean for champions only, so for a minion eye it reads
   * false always, and the rule it states is "a champion in a bush is not lit by
   * a wave standing in the same bush" — which is what `borrowedEyeSees` already
   * decides on the targeting side. Dropping it here would light a body the
   * player then could not click.
   */
  grantedEyeSees(eye: any, target: any): boolean {
    if (!eye?.position || !target?.position) return false;
    if (revealedTo(eye, target)) return true;
    if (target.isInsideBush && !eye.isInsideBush) return false;
    return hasLineOfSight(this.game, eye.position, target.position);
  }

  calculateSightForObject(obj: any): {
    sightPoly: { x: number; y: number }[];
    playersInSight: any[];
  } {
    // getSightPoly recomputes the polygon at obj's live position every frame
    // (reusing the cached segment list whenever it can — see the file header
    // and computeSightPoly), so it's always frame-accurate. playersInSight is
    // a separate, cheap-enough-to-always-run quadtree lookup that gates
    // visibility (visibleToPlayerTeam); it was already frame-accurate and stays so.
    const sightPoly = this.getSightPoly(obj);

    // Decomposed once for the whole scan rather than inside the predicate: the
    // polygon is the same for every candidate, and `pointPolygonConcave` would
    // otherwise re-run the full convex decomposition per candidate, per
    // observer, per frame.
    const sightParts = CollideUtils.prepareConcave(sightPoly);

    const playersInSight = this.game.objectManager.queryObjects({
      area: new Circle({
        x: obj.position.x,
        y: obj.position.y,
        r: obj.visionRadius,
      }),
      filters: [
        PredefinedFilters.type(AttackableUnit),
        (o: any) => CollideUtils.pointPreparedConcave(o.position.x, o.position.y, sightParts),
      ],
    });

    return {
      sightPoly,
      playersInSight,
    };
  }

  // Returns the sight polygon for `obj`, always at its current position. A
  // unit whose position and radius are bit-for-bit identical to last frame's
  // (i.e. it hasn't moved) casts the exact same polygon, so this
  // short-circuits straight to the cached result without even querying
  // obstacles. Anything else — the unit moved, its radius changed, or this is
  // the first time we've seen it — goes through computeSightPoly.
  //
  // `radius` defaults to whatever the object lights, which for a champion is
  // its own sight and for a minion or turret the circle it grants; pass it
  // explicitly only to override. `tolerancePx` widens the "hasn't moved" test
  // for revealers whose fog nobody is steering — see
  // GRANTED_SIGHT_TOLERANCE_PX. At the default 0 the test is exact equality,
  // which is what it has always been.
  getSightPoly(
    obj: any,
    radius: number = fogRevealOf(obj),
    tolerancePx = 0
  ): { x: number; y: number }[] {
    const entry = this.sightCache.get(obj);

    if (entry && entry.radius === radius) {
      const dx = obj.position.x - entry.x;
      const dy = obj.position.y - entry.y;
      if (dx * dx + dy * dy <= tolerancePx * tolerancePx) return entry.sightPoly;
    }

    return this.computeSightPoly(obj, radius, entry, tolerancePx);
  }

  // The actual visibility-polygon computation, run every frame a unit moves.
  // The obstacle lookup and the "bush I'm standing in" filter are
  // position-dependent and cheap, so they always run; segment breaking (the
  // O(n^2) part) only reruns when the obstacle set they produce differs from
  // what `entry` was built from (see buildObstacleSignature); the viewport
  // sweep always runs against obj's live position/radius so the returned
  // polygon is frame-accurate.
  computeSightPoly(
    obj: any,
    radius: number = fogRevealOf(obj),
    entry?: SightCacheEntry,
    tolerancePx = 0
  ): { x: number; y: number }[] {
    let obstaclesInSight = this.game.terrainMap.getObstaclesInChampionSight(
      obj,
      [TerrainType.WALL, TerrainType.BUSH],
      radius
    );

    // remove bushes that player is inside => player can see through that bush
    obstaclesInSight = obstaclesInSight.filter(
      (o: any) => !CollideUtils.pointPolygon(obj.position.x, obj.position.y, o.vertices)
    );

    const obstacleSignature = this.buildObstacleSignature(obstaclesInSight);
    const segments =
      entry && entry.obstacleSignature === obstacleSignature
        ? entry.segments
        : this.buildSegments(obstaclesInSight);

    // The clip box carries the move tolerance as slack. The gradient is drawn
    // at the unit's *live* position while a tolerated polygon was cast up to
    // `tolerancePx` away, so a box of exactly `radius` would sit that far
    // inside the gradient on one side — and the box's edge is straight while
    // the gradient's rim is round, so it would show as a faint straight cut
    // through the fade. Widening puts the whole box back outside the rim,
    // where the gradient is already fully transparent and nothing is drawn.
    const boxRadius = radius + tolerancePx;
    const sightPoly = PolyVisibility.computeViewport(
      [obj.position.x, obj.position.y],
      segments,
      [obj.position.x - boxRadius, obj.position.y - boxRadius],
      [obj.position.x + boxRadius, obj.position.y + boxRadius]
    ).map((v: number[]) => ({ x: v[0], y: v[1] }));

    this.sightCache.set(obj, {
      sightPoly,
      x: obj.position.x,
      y: obj.position.y,
      radius,
      segments,
      obstacleSignature,
    });

    return sightPoly;
  }

  // Converts obstacle polygons into a broken (non-self-intersecting) segment
  // list — the O(n^2) step (PolyVisibility.breakIntersections) that
  // computeSightPoly caches by obstacleSignature instead of paying every frame.
  buildSegments(obstacles: { vertices: { x: number; y: number }[] }[]): SightSegment[] {
    const polygons = obstacles.map(o => o.vertices.map(v => [v.x, v.y] as [number, number]));
    const segments = PolyVisibility.convertToSegments(polygons);
    return PolyVisibility.breakIntersections(segments);
  }

  // Cheap fingerprint for "which obstacles are in range right now": sorted
  // obstacle ids. The radius is deliberately absent: the range query already
  // expresses a radius change by returning a different obstacle set, while the
  // same set always produces the same static segments. Obstacle
  // counts in range are small (a handful of walls/bushes at most), so
  // sorting/joining every frame is far cheaper than the segment break it
  // guards, and a plain string compare is enough to detect any change in the
  // obstacle set — new obstacle entering range, one leaving, or a bush
  // flipping in/out of the containment filter.
  buildObstacleSignature(obstacles: { id: string }[]): string {
    const ids = obstacles.map(o => o.id).sort();
    return ids.join(',');
  }

  drawVisions(): void {
    const allSightPoly = this.calculateSight();

    allSightPoly.forEach(({ object, sightPoly, radius, ring }: SightResult) => {
      const { x, y, gradient } = this.prepareRadialGradient(
        object.position.x,
        object.position.y,
        radius,
        ring
      );

      // The gradient is defined around the origin (see prepareRadialGradient) so it
      // can be shared across units/frames; translate the canvas to the unit's screen
      // position and draw the polygon relative to that origin to line the two up.
      // Canvas gradients paint using the CTM at fill time, not at creation time, so
      // this reproduces exactly what passing absolute coordinates would have drawn.
      this.overlay.push();
      this.overlay.translate(x, y);
      this.overlay.drawingContext.fillStyle = gradient;
      this.overlay.beginShape();
      sightPoly.forEach((v: { x: number; y: number }) => {
        const pos = this.game.camera.worldToScreen(v.x, v.y);
        this.overlay.vertex(pos.x - x, pos.y - y);
      });
      this.overlay.endShape(this.overlay.CLOSE);
      this.overlay.pop();
    });
  }

  prepareRadialGradient(
    x: number,
    y: number,
    r: number,
    rRing: number
  ): { x: number; y: number; r: number; gradient: CanvasGradient } {
    const pos = this.game.camera.worldToScreen(x, y);
    // `currentScale`, not `scale`: the latter is the target the camera is
    // lerping toward, so reading it makes the fog snap to a new zoom while the
    // world is still sliding into it.
    const radius = r * this.game.camera.currentScale;
    const innerR = max(0, radius - rRing * this.game.camera.currentScale);
    const gradient = this.getRadialGradient(innerR, radius);

    return { x: pos.x, y: pos.y, r: radius, gradient };
  }

  // createRadialGradient() is a relatively costly context call and was being made
  // once per visible ally per frame; a gradient only depends on its stop radii, so
  // bucket-cache by (innerR, radius) — rounded to the pixel, since sub-pixel radius
  // differences are visually meaningless — and reuse across units and frames.
  getRadialGradient(innerR: number, radius: number): CanvasGradient {
    const key = `${Math.round(innerR)}:${Math.round(radius)}`;
    let gradient = this.gradientCache.get(key);
    if (!gradient) {
      gradient = this.overlay.drawingContext.createRadialGradient(0, 0, innerR, 0, 0, radius);
      this.colorStops.forEach(cs => gradient!.addColorStop(cs.stop, cs.color));
      this.gradientCache.set(key, gradient!);
    }
    return gradient!;
  }

  resize(w: number, h: number): void {
    this.overlay.resizeCanvas(w, h, true);
  }

  destroy(): void {
    // Never `overlay.remove()` — p5 1.11's own Graphics.remove throws on a 2D
    // buffer, and this is the second line of Game.destroy(). See
    // `utils/graphics.utils.ts`.
    removeGraphics(this.overlay);
  }
}
