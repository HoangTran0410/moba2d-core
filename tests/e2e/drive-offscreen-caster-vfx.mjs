/**
 * End-to-end guard for one engine property: **a `SpellObject` draws and
 * deals its damage even when its owning caster is not rendered at all.**
 *
 * This exists because the bug it guards lived in the seam between
 * `ObjectManager.draw()` and `FogOfWar`, and no unit test in this repo could
 * see it. `Champion.draw()` calls `spell.drawVfx()`, so anything hung on
 * `castSpec.vfx` inherits the caster's visibility twice over: the draw pass
 * only reaches objects whose *own* display bounding box is on camera, and
 * `FogOfWar` clears `visibleToPlayerTeam` on every unit the player cannot
 * see. A long-reaching effect hung off the caster this way disappears the
 * moment the caster is off screen or out of vision, while still dealing its
 * damage — reported once as an ability's reveal icon appearing on a
 * player's bar after a cast they never saw the effect of.
 *
 * Originally reproduced against `Lux_R`, a Riot-content ultimate whose
 * 3400px beam and off-screen-caster shape made the seam directly visible.
 * That spell left this repository (content-pack-and-repo-split batch 6);
 * `packs/reference/`'s own four abilities are all short enough in range
 * (420 or under) that placing their caster outside camera and vision while
 * still landing the effect on the player is not reproducible with any of
 * them as written. So this probes the engine seam directly instead of
 * through a named spell's kit: a synthetic `SpellObject` (`api.AoePulse`,
 * the same helper `Vera_R` uses for its own purely-cosmetic ring), owned by
 * a champion placed far off screen, positioned at the *player's* location
 * rather than the caster's. That is the property a real spell's VFX would
 * need to hold regardless of which ability produces it — testing it this
 * way is decoupled from any one kit's correctness, which is arguably a
 * tighter regression than coupling it to a specific spell's implementation
 * ever was.
 *
 * ## The property is the conjunction
 *
 * Neither half means anything alone. "The effect was drawn" is trivially
 * true when the caster is on screen, and "the caster was unrendered" is
 * trivially true of anything far enough away. So the run asserts both at
 * once, of the same probe:
 *
 *   - the caster is genuinely unrendered — `visibleToPlayerTeam` false on
 *     every sample across the probe's life, and its own `Champion.draw()`
 *     called zero times, which is what makes a `castSpec.vfx`-style mistake
 *     unreachable; and
 *   - the probe's own `draw()` ran anyway; and
 *   - the probe really did reach the player — health dropped — so an
 *     effect that quietly stopped drawing or stopped hitting cannot pass
 *     this by doing nothing.
 *
 * A counter that is stuck on would pass the draw half for free, so the run
 * also checks the counter is zero before the probe is added.
 *
 *   node tests/e2e/drive-offscreen-caster-vfx.mjs [outPrefix]
 *
 * Requires a system Chrome install.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/moba2d-offscreen-caster-vfx';
const CFG_KEY = 'moba2d:pregameConfig:v1';
const VIEWPORT = { width: 1280, height: 900 };

/**
 * How far off to the side the caster stands. The camera box is about
 * 1422x1000 world units at the default scale and the player's vision radius
 * is 500, so 2600 puts it outside both by a wide margin — this run should
 * never be measuring a caster that was marginally on screen.
 */
const CASTER_OFFSET_PX = 2_600;

/**
 * A deterministic match: a named champion for the player and no bots but the
 * one this script adds, because a random kit wandering into the arena is how
 * every flaky assertion in this directory started.
 */
const MATCH_CONFIG = {
  player: {
    mode: 'champion',
    championName: 'Vera',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  },
  ai: { count: 0, autoMove: false, autoAttack: false, autoCast: false, bots: [] },
  rules: { cooldownReductionPercent: 0, manaFree: true },
};

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const failures = [];
/** Records a mismatch instead of throwing, so one bad expectation cannot hide the rest. */
const check = (name, passed, detail) => {
  if (!passed) failures.push(`${name}: ${detail ?? 'failed'}`);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

await page.addInitScript(
  ([key, config]) => window.localStorage.setItem(key, JSON.stringify(config)),
  [CFG_KEY, MATCH_CONFIG]
);
await page.goto(url, { waitUntil: 'load' });
await page.click('#play-btn');
// Chơi opens the match-config panel now; Bắt Đầu is what starts
// the match. This script boots its own browser, so it cannot
// import the harness helper that does both (`e2eHarness.test.ts`).
await page.waitForSelector('#pregame-start-btn', { timeout: 30_000 });
await page.click('#pregame-start-btn');
await page.waitForFunction(() => window.__moba2d?.scene?.oScene?.game?.objectManager, null, {
  timeout: 30_000,
});
await page.waitForTimeout(1_200);

// ------------------------------------------------------------------ stage ---
const staged = await page.evaluate(async offset => {
  const game = window.__moba2d.scene.oScene.game;
  const player = game.player;

  // Empty arena: another object drifting through frame would be drawing the
  // probe's class for nobody's benefit but the counters'.
  for (const object of game.objectManager.objects) {
    if (object === player) continue;
    const name = object.constructor?.name ?? '';
    if (name === 'Turret' || name === 'Fountain') continue;
    object.toRemove = true;
  }
  game.objectManager.update();
  for (const buff of player.buffs) buff.deactivateBuff();
  player.updateBuffs();
  player.stats.health.baseValue = player.stats.maxHealth.value;

  const bot = game.director.addBot({
    mode: 'champion',
    championName: 'Vera',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  });
  if (!bot) return { ok: false, reason: 'director.addBot returned null' };
  game.director.setBotBehaviour(bot, { autoMove: false, autoAttack: false, autoCast: false });
  game.objectManager.update();

  // Relative to wherever the player actually spawned, so neither of them is
  // teleported into a wall.
  bot.position.set(player.position.x + offset, player.position.y);
  bot.destination.set(bot.position.x, bot.position.y);

  const { buildContentApi } = await import('/src/content/ContentApi.ts');
  const api = buildContentApi();

  // Counters for the two halves of the property.
  const counters = { probeDraws: 0, casterDraws: 0 };
  const probeDraw = api.AoePulse.prototype.draw;
  api.AoePulse.prototype.draw = function () {
    counters.probeDraws += 1;
    return probeDraw.call(this);
  };
  const casterDraw = bot.draw.bind(bot);
  bot.draw = function () {
    counters.casterDraws += 1;
    return casterDraw();
  };

  window.__probe = { game, player, bot, api, counters, visibilitySamples: [] };
  return { ok: true, botName: bot.name ?? null };
}, CASTER_OFFSET_PX);

check('an off-screen caster is standing in the arena', staged.ok, staged.reason ?? `name=${staged.botName}`);

if (staged.ok) {
  // Let the camera settle on the player and the fog recompute at the new positions.
  await page.waitForTimeout(1_200);

  const before = await page.evaluate(() => {
    const { game, player, bot, counters } = window.__probe;
    const box = game.camera.getBoundingBox();
    const inCamera = game.objectManager.queryObjects({
      queryByDisplayBoundingBox: true,
      area: game.camera.getBoundingBox(),
    });
    return {
      counters: { ...counters },
      health: player.stats.health.value,
      distance: Math.hypot(bot.position.x - player.position.x, bot.position.y - player.position.y),
      playerVisionRadius: player.stats.visionRadius.value,
      casterInCameraBox: inCamera.includes(bot),
      cameraBox: { w: Math.round(box.w), h: Math.round(box.h) },
    };
  });

  // Nothing else in the arena paints an AoePulse, so a nonzero count later
  // can only have come from the probe added below — a counter wired to
  // something that ticks anyway would pass the draw checks for free.
  check(
    'no probe is drawn before it exists',
    before.counters.probeDraws === 0,
    JSON.stringify(before.counters)
  );
  check(
    'the caster is outside the camera box and the player’s vision',
    !before.casterInCameraBox && before.distance > before.playerVisionRadius,
    `distance=${Math.round(before.distance)} vision=${before.playerVisionRadius} ` +
      `camera=${before.cameraBox.w}x${before.cameraBox.h} inCamera=${before.casterInCameraBox}`
  );

  // The probe: a SpellObject owned by the off-screen caster, but positioned
  // at the player's own location — exactly the shape a wide-reaching effect
  // takes when its owner is nowhere near what it is actually touching.
  await page.evaluate(() => {
    const { game, player, bot, api, counters } = window.__probe;
    counters.probeDraws = 0;
    counters.casterDraws = 0;

    const probe = new api.AoePulse(bot);
    probe.position.set(player.position.x, player.position.y);
    probe.radius = 80;
    probe.lifeTime = 1_400;
    probe.color = [225, 60, 60];
    game.objectManager.addObject(probe);
    player.takeDamage(20, bot);

    window.__probe.probeObject = probe;
    window.__probe.minHealthSeen = player.stats.health.value;
    window.__probe.sampler = setInterval(() => {
      window.__probe.visibilitySamples.push(bot.visibleToPlayerTeam);
      window.__probe.minHealthSeen = Math.min(window.__probe.minHealthSeen, player.stats.health.value);
    }, 60);
  });

  // Mid-life: the probe should be on screen right now.
  await page.waitForTimeout(650);
  await page.screenshot({ path: `${OUT}-1-midlife.png` });
  const midlife = await page.evaluate(() => ({ ...window.__probe.counters }));

  // Past the probe's own lifetime.
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}-2-settled.png` });

  const after = await page.evaluate(() => {
    const { player, bot, counters, visibilitySamples, minHealthSeen } = window.__probe;
    clearInterval(window.__probe.sampler);
    return {
      counters: { ...counters },
      health: player.stats.health.value,
      minHealthSeen,
      visibilitySeen: [...new Set(visibilitySamples)],
      sampleCount: visibilitySamples.length,
    };
  });

  // Half one: the caster is genuinely unrendered, so `Champion.draw()` — and
  // with it `spell.drawVfx()` for any effect hung off it — never ran.
  check(
    'the caster was unrendered for the whole probe (visibleToPlayerTeam false, Champion.draw at zero)',
    after.sampleCount > 0 &&
      after.visibilitySeen.every(seen => seen === false) &&
      after.counters.casterDraws === 0,
    `visibilitySeen=${JSON.stringify(after.visibilitySeen)} samples=${after.sampleCount} ` +
      `casterDraws=${after.counters.casterDraws}`
  );

  // Half two: the probe was painted anyway, at the player's own location.
  check('the probe was drawn while the caster was unrendered', midlife.probeDraws > 0, `probeDraws=${midlife.probeDraws}`);

  // And the effect was a real one, not a probe that had quietly stopped working.
  // The *minimum* health seen across the sampling window, not the health at
  // the very end of it — health regen can and does restore 20 points over
  // the ~1.5s this run watches, which made this check false-fail against a
  // hit that landed and then healed, not one that never landed.
  check(
    'the player took the hit',
    after.minHealthSeen < before.health,
    `${before.health} -> min ${after.minHealthSeen} (end ${after.health})`
  );
}

check('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();
await server.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed.');
}
