/**
 * Where a frame goes on a machine that is struggling.
 *
 * Builds a crowded board out of the live spawner, throttles the CPU the way a
 * cheap laptop is throttled, and then *measures* — per subsystem and per object
 * class — how many milliseconds each frame actually spends. Nothing here is a
 * guess: every row is a wrapped function timing itself.
 *
 * ## Self time, not total
 *
 * The first version of this used an outermost-wins depth guard, which is the
 * obvious way to stop a `super()` call being counted twice — and it made every
 * nested row *vanish*: `fog.draw` swallowed `calculateSight` whole, and every
 * per-object draw disappeared inside `objectManager.draw`. So each wrapper
 * keeps a stack frame and subtracts the time its children claimed. `selfMs` is
 * what that row itself cost; `totalMs` is what it cost with everything it
 * called. Sort on the first, read the second to see where it went.
 *
 * ## What it found
 *
 * At 10x throttle with 200 minions, an 8.0ms frame: fog 4.3ms of it (half
 * painting the sight polygons, half recomputing them), the minimap 0.8ms
 * redrawing every dot every frame, and two Fountains 0.43ms retracing eight
 * `arc()` paths each. Those three are what `FOG_SIGHT_TICK_INTERVAL`,
 * `MINIMAP_LIVE_INTERVAL_MS` and `Fountain.bakeArt` were written for.
 *
 *   node tests/e2e/measure-frame-cost.mjs
 *   MOBA2D_CPU_THROTTLE=6 MOBA2D_TARGET_MINIONS=150 node tests/e2e/measure-frame-cost.mjs
 */
import { startHarness, startMatch } from './harness.mjs';

const THROTTLE = Number(process.env.MOBA2D_CPU_THROTTLE ?? 10);
const TARGET_MINIONS = Number(process.env.MOBA2D_TARGET_MINIONS ?? 200);
const WINDOW_MS = Number(process.env.MOBA2D_WINDOW_MS ?? 6_000);

const { url, page, report, check, guard } = await startHarness();

await guard(async () => {
  await page.goto(url, { waitUntil: 'load' });
  await startMatch(page);
  await page.waitForFunction(() => window.__moba2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  // At least one real wave out of each fountain, so there is a (team, lane)
  // pair to spawn the rest of the crowd on.
  await page.waitForFunction(
    () => window.__moba2d.scene.oScene.game.minionSpawner.minions.length >= 6,
    null,
    { timeout: 20_000 }
  );

  const cdp = await page.context().newCDPSession(page);
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

  const result = await page.evaluate(
    async ({ targetMinions, windowMs }) => {
      const game = window.__moba2d.scene.oScene.game;
      const manager = game.objectManager;
      const spawner = game.minionSpawner;

      // ------------------------------------------------------------ the board
      const pairs = [];
      const seen = new Set();
      for (const minion of spawner.minions) {
        const key = minion.teamId + '|' + minion.lane;
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push({ teamId: minion.teamId, lane: minion.lane });
        }
      }
      let attempts = 0;
      while (spawner.minions.length < targetMinions && attempts < targetMinions * 3) {
        const pair = pairs[attempts % pairs.length];
        spawner.spawn({
          teamId: pair.teamId,
          lane: pair.lane,
          kind: attempts % 3 === 0 ? 'caster' : 'melee',
        });
        attempts++;
      }
      // Health pinned so the crowd cannot thin out mid-window and make two
      // runs incomparable for a reason that has nothing to do with the code.
      for (const minion of spawner.minions) {
        minion.stats.maxHealth.baseValue = 1e9;
        minion.stats.health.baseValue = 1e9;
      }

      // ----------------------------------------------------------- the timers
      const buckets = new Map();
      const bucketFor = name => {
        let bucket = buckets.get(name);
        if (!bucket) {
          bucket = { calls: 0, total: 0, self: 0 };
          buckets.set(name, bucket);
        }
        return bucket;
      };
      const restores = [];
      const stack = [];
      const enter = () => {
        const frame = { child: 0 };
        stack.push(frame);
        return frame;
      };
      const leave = (frame, startedAt, name) => {
        const elapsed = performance.now() - startedAt;
        stack.pop();
        if (stack.length) stack[stack.length - 1].child += elapsed;
        const bucket = bucketFor(name);
        bucket.calls++;
        bucket.total += elapsed;
        bucket.self += elapsed - frame.child;
      };

      /**
       * Wrap `owner[key]`, charging it to `name` or to the receiver's class.
       *
       * The call is not guarded, the same choice `ObjectManager.draw` makes and
       * for a stronger reason here: a throw out of a wrapped frame has already
       * invalidated the measurement, and the harness fails the run on the page
       * error either way. `tests/scripts/e2eHarness.test.ts` also refuses a
       * hand-rolled guard block anywhere in a driver, because that is the shape
       * that used to let a script exit 0 after running a prefix of its checks.
       */
      const wrap = (owner, key, name) => {
        const real = owner?.[key];
        if (typeof real !== 'function' || real.__profiled) return;
        const wrapped = function (...args) {
          const frame = enter();
          const startedAt = performance.now();
          const out = real.apply(this, args);
          leave(frame, startedAt, name ?? this?.constructor?.name ?? 'unknown');
          return out;
        };
        wrapped.__profiled = true;
        owner[key] = wrapped;
        restores.push(() => {
          owner[key] = real;
        });
      };

      // The whole frame and the whole tick, above the stack so nothing inside
      // them is subtracted from these two.
      let frames = 0;
      let ticks = 0;
      let drawMs = 0;
      let updateMs = 0;
      const gameProto = Object.getPrototypeOf(game);
      const realDraw = gameProto.draw;
      const realTick = gameProto.fixedUpdate;
      gameProto.draw = function (...args) {
        const startedAt = performance.now();
        const out = realDraw.apply(this, args);
        frames++;
        drawMs += performance.now() - startedAt;
        return out;
      };
      gameProto.fixedUpdate = function (...args) {
        const startedAt = performance.now();
        const out = realTick.apply(this, args);
        ticks++;
        updateMs += performance.now() - startedAt;
        return out;
      };
      restores.push(() => {
        gameProto.draw = realDraw;
        gameProto.fixedUpdate = realTick;
      });

      const proto = value => Object.getPrototypeOf(value);
      wrap(proto(manager), 'draw', 'draw/objectManager');
      wrap(proto(manager), 'update', 'update/objectManager');
      wrap(proto(manager), 'queryObjects', 'om/queryObjects');
      wrap(proto(game.terrainMap), 'draw', 'draw/terrain');
      wrap(proto(game.terrainMap), 'update', 'update/terrain');
      wrap(proto(game.terrainMap), 'getObstaclesInArea', 'terrain/getObstaclesInArea');
      wrap(proto(game.fogOfWar), 'draw', 'draw/fog');
      wrap(proto(game.fogOfWar), 'calculateSight', 'fog/calculateSight');
      wrap(proto(game.fogOfWar), 'drawVisions', 'fog/drawVisions');
      wrap(proto(game.fogOfWar), 'getSightPoly', 'fog/getSightPoly');
      wrap(proto(game.fogOfWar), 'computeSightPoly', 'fog/computeSightPoly');
      wrap(proto(game.minimap), 'draw', 'draw/minimap');
      wrap(proto(game.minimap), 'paintLiveLayer', 'minimap/paintLiveLayer');
      wrap(proto(game), 'minimapBlips', 'minimap/blips');
      wrap(proto(game.navigation), 'update', 'update/navigation');
      wrap(proto(spawner), 'update', 'update/minionSpawner');
      wrap(proto(manager.unitCollision), 'resolve', 'update/unitCollision');
      if (game.inGameHUD) wrap(proto(game.inGameHUD), 'update', 'hud/computeState');

      // Both quadtrees, split by which one was asked.
      const treeProto = proto(manager._objectsTree);
      const realRetrieve = treeProto.retrieve;
      treeProto.retrieve = function (...args) {
        const name =
          this === manager._objectsTree
            ? 'qt/objectsTree'
            : this === manager._decorTree
              ? 'qt/decorTree'
              : 'qt/other';
        const frame = enter();
        const startedAt = performance.now();
        const out = realRetrieve.apply(this, args);
        leave(frame, startedAt, name);
        return out;
      };
      restores.push(() => {
        treeProto.retrieve = realRetrieve;
      });

      // Per-class draw/update, resolved off the live objects. One wrap per
      // distinct function, bucketed by the receiver — so an inherited
      // `AttackableUnit.draw` still reports Minion and Champion separately.
      const wrapped = new Set();
      const wrapMember = (object, key, prefix) => {
        let owner = Object.getPrototypeOf(object);
        while (owner && !Object.prototype.hasOwnProperty.call(owner, key)) {
          owner = Object.getPrototypeOf(owner);
        }
        const real = owner?.[key];
        if (typeof real !== 'function' || wrapped.has(real) || real.__profiled) return;
        wrapped.add(real);
        const fn = function (...args) {
          const frame = enter();
          const startedAt = performance.now();
          const out = real.apply(this, args);
          leave(frame, startedAt, prefix + (this?.constructor?.name ?? '?'));
          return out;
        };
        fn.__profiled = true;
        owner[key] = fn;
        restores.push(() => {
          owner[key] = real;
        });
      };
      for (const object of [...manager.objects]) {
        wrapMember(object, 'draw', 'obj.draw/');
        wrapMember(object, 'update', 'obj.update/');
      }

      // ---------------------------------------------------------- the window
      const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
      await settle(500);
      frames = 0;
      ticks = 0;
      drawMs = 0;
      updateMs = 0;
      for (const bucket of buckets.values()) {
        bucket.calls = 0;
        bucket.total = 0;
        bucket.self = 0;
      }
      stack.length = 0;

      const startedAt = performance.now();
      await settle(windowMs);
      const wall = performance.now() - startedAt;

      for (const restore of restores.reverse()) restore();

      const census = {};
      for (const object of manager.objects) {
        const name = object.constructor?.name ?? '?';
        census[name] = (census[name] ?? 0) + 1;
      }

      const rows = [...buckets.entries()]
        .filter(([, bucket]) => bucket.calls > 0)
        .map(([name, bucket]) => ({
          name,
          selfMs: Number(bucket.self.toFixed(1)),
          totalMs: Number(bucket.total.toFixed(1)),
          calls: bucket.calls,
          selfPerFrame: Number((bucket.self / Math.max(1, frames)).toFixed(3)),
          pctCpu: Number(((bucket.self / wall) * 100).toFixed(1)),
        }))
        .sort((a, b) => b.selfMs - a.selfMs);

      return {
        windowMs: Number(wall.toFixed(0)),
        fps: Number(((frames * 1000) / wall).toFixed(1)),
        tickRate: Number(((ticks * 1000) / wall).toFixed(1)),
        drawMsPerFrame: Number((drawMs / Math.max(1, frames)).toFixed(2)),
        updateMsPerTick: Number((updateMs / Math.max(1, ticks)).toFixed(2)),
        objects: manager.objects.length,
        census,
        rows: rows.slice(0, 40),
      };
    },
    { targetMinions: TARGET_MINIONS, windowMs: WINDOW_MS }
  );

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  console.log(`\n=== frame profile (CPU throttle ${THROTTLE}x) ===`);
  console.log(
    `fps ${result.fps}  tick ${result.tickRate}  draw ${result.drawMsPerFrame}ms/frame  ` +
      `update ${result.updateMsPerTick}ms/tick  objects ${result.objects}`
  );
  console.log(
    '\n' +
      'name'.padEnd(34) +
      'selfMs'.padStart(9) +
      'totalMs'.padStart(9) +
      'calls'.padStart(9) +
      'self/frame'.padStart(12) +
      '%cpu'.padStart(7)
  );
  for (const row of result.rows) {
    console.log(
      row.name.padEnd(34) +
        String(row.selfMs).padStart(9) +
        String(row.totalMs).padStart(9) +
        String(row.calls).padStart(9) +
        String(row.selfPerFrame).padStart(12) +
        String(row.pctCpu).padStart(7)
    );
  }
  console.log('\ncensus: ' + JSON.stringify(result.census));

  Object.assign(report, { throttle: THROTTLE, ...result });
  // The board has to be crowded or the profile is of an empty map, and the
  // simulation has to still be keeping real time or the rows are of a
  // different game than the one anyone plays.
  check('the board was actually crowded', result.objects > 100, `${result.objects} objects`);
  check(
    'the simulation held its own clock under load',
    result.tickRate > 55,
    `${result.tickRate} ticks/sec`
  );
});
