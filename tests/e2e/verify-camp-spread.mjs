/**
 * How far apart a camp's bodies actually stand, in a real match.
 *
 * Reported from a real game: the wolf pit and the raptor pit rendered as one
 * pile of overlapping bodies. Every unit test about camps agreed with the
 * broken code, because the pile is not a fact about one `Monster` — it is what
 * four of them do to each other over a respawn, and the layout only collapsed
 * once a pit had been cleared.
 *
 * Which is why the second measurement is the one that matters. At spawn the
 * bodies are placed from the pack's own offsets and look right whatever
 * `respawn()` does; it is only after the camp comes back that a shared home
 * point shows. Falsified against the original bug: with `respawn()` reading
 * `camp` instead of `home`, the closest pair drops from 97px to 34px — which
 * is not zero only because `UnitCollisionSystem` refuses to let two bodies
 * fully overlap.
 *
 *   node tests/e2e/verify-camp-spread.mjs
 */
import { startHarness, startMatch } from './harness.mjs';

const h = await startHarness({});
const { page, check, report, guard } = h;

await guard(async () => {
  await page.goto(h.url, { waitUntil: 'load' });
  await startMatch(page);
  await page.waitForFunction(
    () => window.__lol2d?.scene?.oScene?.game?.monsters?.length > 0,
    null,
    {
      timeout: 30_000,
    }
  );
  // Long enough for every camp to have run several idle ticks — the old bug
  // pulled the smalls to the middle on the first one.
  await page.waitForTimeout(4_000);

  const measure = () =>
    page.evaluate(() => {
      const groups = new Map();
      for (const m of window.__lol2d.scene.oScene.game.monsters) {
        if (!groups.has(m.camp)) groups.set(m.camp, []);
        groups.get(m.camp).push({ name: m.name, x: m.position.x, y: m.position.y });
      }
      const out = [];
      for (const bodies of groups.values()) {
        if (bodies.length < 2) continue;
        let min = Infinity;
        for (let i = 0; i < bodies.length; i++)
          for (let j = i + 1; j < bodies.length; j++)
            min = Math.min(min, Math.hypot(bodies[i].x - bodies[j].x, bodies[i].y - bodies[j].y));
        out.push({
          size: bodies.length,
          closestPair: Math.round(min),
          names: bodies.map(b => b.name),
        });
      }
      return out;
    });

  const camps = await measure();
  report.multiBodyCamps = camps.length;
  report.closestPairPerCamp = camps.map(c => c.closestPair);
  check('there are multi-body camps to measure', camps.length > 0, `${camps.length} camps`);

  // Two bodies are held `bodyRadius + bodyRadius` apart by the collision system
  // whatever their layout says — roughly 55px for a greater wolf beside a wolf.
  // So "piled on one point" and "correctly laid out" both clear 50; the layout
  // this pack declares puts its closest pair ~97px apart. 75 is between the two
  // and is not derived from either constant.
  const worst = Math.min(...camps.map(c => c.closestPair));
  report.worstClosestPair = worst;
  check('no camp is stacked on one point', worst > 75, `closest pair anywhere: ${worst}px`);

  // The half the first measurement cannot see. A camp's layout used to survive
  // exactly until it was first cleared: `respawn()` put every member back on
  // the shared slot point, so a re-taken pit came back as a pile.
  await page.evaluate(() => {
    for (const m of window.__lol2d.scene.oScene.game.monsters) m.respawn();
  });
  await page.waitForTimeout(1_500);

  const after = await measure();
  report.closestPairAfterRespawn = after.map(c => c.closestPair);
  const worstAfter = Math.min(...after.map(c => c.closestPair));
  report.worstAfterRespawn = worstAfter;
  check('and no camp piles up after it respawns', worstAfter > 75, `closest pair: ${worstAfter}px`);

  // The other half of "the layout is right": a body standing where the map
  // cannot be walked is a body in a wall. Reported from a real match for the
  // red-side raptor pit, and the same defect was in the red wolf pit unnoticed.
  // `isWalkable` is the navigation grid's own answer, so this asks the same
  // question the game asks when anything tries to path there.
  const stuck = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const grid = game.navigation.grid ?? game.navigation.navGrid;
    if (!grid?.isWalkable) return null;
    return game.monsters
      .filter(m => !grid.isWalkable(m.home.x, m.home.y, 30))
      .map(m => `${m.name} @ ${Math.round(m.home.x)},${Math.round(m.home.y)}`);
  });
  report.bodiesInsideTerrain = stuck?.length ?? 'no grid';
  check(
    'no camp body stands in a wall',
    stuck !== null && stuck.length === 0,
    (stuck ?? []).join(', ')
  );

  check('no runtime errors', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));
});
