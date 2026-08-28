/**
 * Does a concurrent basic-attack order silently steal a champion's own
 * in-flight `Dash`? And does crowd control still correctly end one?
 * Reproduced against the real game.
 *
 * Boots its own Vite dev server on a free port, opens the game in system
 * Chrome through Playwright and reaches the live scene through the DEV-only
 * `window.__lol2d` handle set in src/main.ts.
 *
 * `Dash.onUpdate()` steps `targetUnit.position` directly
 * (`VectorUtils.moveVectorToVector`) — it never reads or writes
 * `destination`. `BasicAttackController.stopMovement()`, which the standing-
 * order controller calls every frame once a target is in range, clears
 * `pathAgent` and sets `destination = position` — neither of which a Dash's
 * own movement ever consults. So the two ought to be structurally unable to
 * interfere, and this run measures that directly rather than trusting the
 * reasoning: a dash's travel with a concurrent attack order should match a
 * plain control run, because nothing about issuing the order should be able
 * to touch the position the dash is already writing every frame.
 *
 * The other half is the opposite claim, and just as real: `Dash` is `HELD`
 * by `CancelPolicy`'s own vocabulary (`docs/ADDING_SPELLS.md`) unless a
 * spell says otherwise, and `DASH_INTERRUPT_BUFFS` (`Airborne`, `Root`,
 * `Stun`, `Fear`, `Charm`) is checked every tick via `foreignControlBuff` —
 * a stun mid-dash *should* end it early. Getting only the first half right
 * would be a broken contract dressed as a fix, so both runs are in the same
 * script and the same verdict.
 *
 * Three runs, each starting a fresh Vera E on the player:
 *   control     — dash with a plain move order, nothing else;
 *   attackOrder — dash, then order a basic attack on a nearby dummy, which
 *                 keeps `stopMovement()` firing every frame the dash is live;
 *   stunned     — dash, then land a Stun on the dasher mid-flight, which the
 *                 HELD form says must end it early.
 *
 * Originally reproduced against Rammus Q — a Riot-content roll whose
 * multi-second lifetime, contact-triggered "crash", and `INDEPENDENT`
 * `SpellForm` (surviving a stun, unlike a plain dash) gave the property a
 * wide, easy-to-observe window. That spell left this repository (content-
 * pack-and-repo-split batch 6). The `stopMovement()`-cannot-touch-a-Dash
 * half of the property does not depend on any of that — it holds for any
 * `Dash`, including the reference pack's own short one-shot `Vera_E` — so
 * it is repointed rather than deleted. The `INDEPENDENT`-survives-a-stun
 * half genuinely does not transfer: `Vera_E` is (correctly) `HELD`, so a
 * stun is *supposed* to end it, and this run checks exactly that instead —
 * the other, equally real half of the same `CancelPolicy` contract, rather
 * than a strained impersonation of Rammus Q's own design.
 *
 *   node tests/e2e/drive-dash-attack-order.mjs [outPrefix]
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-dash-attack-order';

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const port = server.config.server.port ?? server.httpServer.address().port;
const url = `http://localhost:${port}/`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const report = {};

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.click('#play-btn');
  // Chơi opens the match-config panel now; Bắt Đầu is what starts
  // the match. This script boots its own browser, so it cannot
  // import the harness helper that does both (`e2eHarness.test.ts`).
  await page.waitForSelector('#pregame-start-btn', { timeout: 30_000 });
  await page.click('#pregame-start-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  // Empty the arena down to the player plus one pinned dummy, and give the
  // player Vera (the reference pack's own champion) if the menu rolled
  // something else.
  report.setup = await page.evaluate(async () => {
    const { default: DummyChampion } = await import(
      '/src/game/gameObject/attackableUnits/DummyChampion.ts'
    );
    const { buildContentApi } = await import('/src/content/ContentApi.ts');
    const api = buildContentApi();
    const { default: makeVeraE, VERA_E_DISTANCE } = await import(
      '/packs/reference/spells/Vera_E.ts'
    );
    const VeraE = makeVeraE(api);
    const { getChampionPresetRandom } = await import('/src/game/preset.ts');
    const game = window.__lol2d.scene.oScene.game;

    game.director.applyLoadout(game.player, {
      mode: 'champion',
      championName: 'Vera',
      summonerD: 'Flash',
      summonerF: 'Heal',
      customSlots: Array(7).fill('random'),
    });
    game.objectManager.update();
    const player = game.player;

    for (const object of game.objectManager.objects) {
      if (object === player) continue;
      const name = object.constructor?.name ?? '';
      if (name === 'Turret' || name === 'Fountain') continue;
      object.toRemove = true;
    }
    game.objectManager.update();
    for (const buff of [...player.buffs]) buff.deactivateBuff();
    player.updateBuffs();
    player.deathData = null;
    player.stats.health.baseValue = player.stats.maxHealth.value;
    player.stats.mana.baseValue = 9_999;
    player.stats.maxMana.baseValue = 9_999;

    const home = { x: 2_600, y: 2_600 };
    player.position.set(home.x, home.y);
    player.destination.set(home.x, home.y);

    // The dash has to have somewhere clear to land. Walk him a short way down
    // each of eight headings and keep the clearest one, the same probe
    // `drive-rammus-cancel.mjs` used for a much longer roll.
    const obstacles = game.objectManager.objects.filter(
      o => o !== player && typeof o.takeDamage === 'function'
    );
    const clearOf = angle => {
      let nearest = Infinity;
      for (const o of obstacles) {
        for (let t = 0; t <= 1.001; t += 0.05) {
          const x = home.x + Math.cos(angle) * 400 * t;
          const y = home.y + Math.sin(angle) * 400 * t;
          nearest = Math.min(nearest, Math.hypot(o.position.x - x, o.position.y - y));
        }
      }
      return nearest;
    };
    let bestAngle = 0;
    let bestClearance = -Infinity;
    for (let step = 0; step < 8; step++) {
      const angle = (step / 8) * Math.PI * 2;
      const clearance = clearOf(angle);
      if (clearance > bestClearance) {
        bestClearance = clearance;
        bestAngle = angle;
      }
    }
    const heading = { x: Math.cos(bestAngle), y: Math.sin(bestAngle) };
    const landing = {
      x: home.x + heading.x * VERA_E_DISTANCE,
      y: home.y + heading.y * VERA_E_DISTANCE,
    };

    // A dummy near the landing spot — inside basic-attack range once the
    // dash lands, so the attack-order run has something to path toward and
    // `stopMovement()` fires every frame while the dash is still live.
    const dummy = new DummyChampion({
      game,
      position: window.createVector(landing.x, landing.y),
      preset: getChampionPresetRandom(),
    });
    dummy.stats.speed.baseValue = 0;
    dummy.stats.healthRegen.baseValue = 0;
    dummy.stats.maxHealth.baseValue = 100_000;
    dummy.stats.health.baseValue = 100_000;
    game.objectManager.addObject(dummy);
    game.objectManager.update();

    window.__probe = { player, dummy, home, heading, landing, VeraE };

    game.camera.target = null;
    game.camera.scale = 1;
    game.camera.currentScale = 1;
    game.camera.position.set(home.x, home.y);

    return {
      playerChampion: player.name,
      headingDeg: Math.round((bestAngle * 180) / Math.PI),
      clearanceAtHeading: Math.round(bestClearance),
      dashDistance: VERA_E_DISTANCE,
      landing,
    };
  });

  /**
   * One run: reset the player, cast Vera E aimed at the landing spot, apply
   * the run's order, then sample position every 40ms for a window that
   * comfortably exceeds the dash's own travel time.
   */
  const run = async (label, orderAttack, stunAtMs = null) =>
    page.evaluate(
      async ({ label, orderAttack, stunAtMs }) => {
        const game = window.__lol2d.scene.oScene.game;
        const { player, dummy, home, landing, VeraE } = window.__probe;

        player.basicAttack.clear();
        for (const buff of [...player.buffs]) buff.deactivateBuff();
        player.updateBuffs();
        player.position.set(home.x, home.y);
        player.destination.set(home.x, home.y);
        player.stats.mana.baseValue = 9_999;

        const spell = new VeraE(player);
        player.spells[3] = spell;
        spell.resetCoolDown?.();

        game.worldMouse.set(landing.x, landing.y);
        const accepted = spell.cast();

        if (orderAttack) player.basicAttack.order(dummy);

        const Stun = (await import('/src/game/gameObject/buffs/Stun.ts')).default;
        const samples = [];
        let stunned = false;
        const start = { x: player.position.x, y: player.position.y };
        let last = { ...start };
        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => setTimeout(resolve, 40));
          if (stunAtMs !== null && !stunned && (i + 1) * 40 >= stunAtMs) {
            stunned = true;
            // sourceUnit must differ from the dash's own (player), or
            // `foreignControlBuff` correctly treats it as not-foreign and lets
            // the dash's own caster stun itself without cancelling it — the
            // same rule that protects a root-then-pull spell from cancelling
            // its own pull. A real stun landing on the dasher comes from
            // someone else, so it is sourced from the dummy here.
            player.addBuff(new Stun(1_000, dummy, player));
          }
          const moved = Math.hypot(player.position.x - last.x, player.position.y - last.y);
          last = { x: player.position.x, y: player.position.y };
          samples.push({
            at: (i + 1) * 40,
            movedSinceLast: Math.round(moved * 10) / 10,
            distanceFromStart: Math.round(Math.hypot(player.position.x - start.x, player.position.y - start.y)),
            dashActive: player.buffs.some(b => b.constructor?.name === 'Dash'),
            stunnedNow: player.buffs.some(b => b.constructor?.name === 'Stun'),
            ordered: player.basicAttack.target === dummy,
          });
        }

        const end = samples[samples.length - 1];
        // The distance at the moment the dash itself ended, not at the end
        // of the whole sampling window: once the champion lands on top of
        // the dummy, unit-collision separation keeps nudging both bodies
        // apart for a few more frames, which is a real and unrelated system
        // and would otherwise be mistaken for the dash still travelling (or
        // not travelling far enough).
        const endedSample = samples.find(s => !s.dashActive) ?? end;
        return {
          label,
          accepted,
          orderAttack,
          stunAtMs,
          distanceWhenDashEnded: endedSample.distanceFromStart,
          finalDistanceFromStart: end.distanceFromStart,
          totalTravel: Math.round(samples.reduce((sum, s) => sum + s.movedSinceLast, 0) * 10) / 10,
          dashEndedAtMs: samples.find(s => !s.dashActive)?.at ?? null,
          samples,
        };
      },
      { label, orderAttack, stunAtMs }
    );

  report.control = await run('control: dash, plain move order only', false);
  report.attackOrder = await run('attackOrder: dash, then a basic-attack order on the dummy', true);
  report.stunnedMidDash = await run('stunned mid-dash, no attack order', false, 80);

  const distanceTolerancePx = 20; // room for one extra 40ms sample straddling the destination check
  report.verdict = {
    dashCompletesUnaffectedByAttackOrder:
      Math.abs(report.attackOrder.distanceWhenDashEnded - report.control.distanceWhenDashEnded) <=
      distanceTolerancePx,
    controlAndAttackOrderDistanceWhenDashEnded: [
      report.control.distanceWhenDashEnded,
      report.attackOrder.distanceWhenDashEnded,
    ],
    dashCorrectlyEndedByStun:
      report.stunnedMidDash.distanceWhenDashEnded <
      report.control.distanceWhenDashEnded - distanceTolerancePx,
    stunDistanceWhenDashEnded: report.stunnedMidDash.distanceWhenDashEnded,
    controlDistanceWhenDashEnded: report.control.distanceWhenDashEnded,
  };

  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}

const failed =
  errors.length > 0 ||
  !report.verdict?.dashCompletesUnaffectedByAttackOrder ||
  !report.verdict?.dashCorrectlyEndedByStun;
if (failed) process.exitCode = 1;
