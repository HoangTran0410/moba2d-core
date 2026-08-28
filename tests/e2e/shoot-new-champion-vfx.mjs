/**
 * Screenshot rig for the currently installed roster's VFX.
 *
 * Not an assertion script — a *look at it* script. Whether an effect reads
 * clearly is not a property any unit test can hold, so the only honest check
 * is to run the real renderer and photograph each ability at the moments
 * that matter: the windup, the strike, and the settle. It samples several
 * frames per cast for exactly that reason — a single frame cannot tell an
 * effect that animates from one that pops in.
 *
 * It does verify the two things a screenshot cannot show by itself:
 *   - every cast produced at least one world effect — an object, or a buff,
 *     or genuine movement (nothing silently no-oped);
 *   - dashes actually travelled, which is the `onDashUpdate` regression.
 *
 *   node tests/e2e/shoot-new-champion-vfx.mjs [outDir] [championFilter]
 *
 * The filter is a substring of the champion name, and it is the point of the
 * argument: a full run costs real minutes, which is far more than a change
 * to one kit needs.
 *
 * Originally written to shoot a growing Riot-content roster whenever a
 * kit's VFX was rebuilt — see git history before content-pack-and-repo-
 * split batch 6 task 11 for the champion-by-champion shape (`ALL_CASTS`
 * grown per rebuilt kit, never accumulated as a standing suite). That
 * content left this repository; the technique this script demonstrates
 * (sample real frames, check for at least one produced world effect,
 * confirm a dash actually moved) is engine tooling, not Riot-specific, so
 * it is repointed at `packs/reference/`'s own four abilities rather than
 * deleted — the worked example `docs/VFX_STANDARD.md` and
 * `docs/ADDING_SPELLS.md` §6a both point at.
 *
 * Requires a system Chrome install.
 */
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/moba2d-new-vfx';
const CFG_KEY = 'moba2d:pregameConfig:v1';
const VIEWPORT = { width: 1280, height: 900 };

mkdirSync(OUT, { recursive: true });

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

/**
 * Which slot each ability sits in, and where to aim it relative to the
 * player. Frame timings are derived from each spell's own tuning constants
 * (`packs/reference/spells/Vera_*.ts`), not observed by eye against a real
 * run — a human still has to open the PNGs and judge the look, this is only
 * "aim the camera at roughly the right moments":
 *
 *   - Q (`VERA_Q_RANGE`=420, `VERA_Q_SPEED`=12): a straight bolt, aimed at
 *     300 so it has travel to show — windup, mid-flight, impact.
 *   - W (self shield, `VERA_W_DURATION_MS`=3000): no travel at all, so the
 *     three frames are early (just applied), mid-duration, and just before
 *     it expires.
 *   - E (dash, `VERA_E_DISTANCE`=260, `VERA_E_SPEED`=18): the shortest cast
 *     on this roster — windup, mid-dash, landed.
 *   - R (point AoE, `VERA_R_RANGE`=500, the ring's own `lifeTime`=500):
 *     cast, the ring at its widest, and the fade.
 */
const ALL_CASTS = [
  { champion: 'Vera', slot: 'Q', aim: [300, 0], frames: [80, 200, 500] },
  { champion: 'Vera', slot: 'W', aim: [0, 0], frames: [80, 1500, 2900] },
  { champion: 'Vera', slot: 'E', aim: [260, 0], frames: [60, 150, 400] },
  { champion: 'Vera', slot: 'R', aim: [400, 0], frames: [80, 250, 550] },
];

// Substring match, so a filter still works once this roster grows.
const ONLY = process.argv[3];
const CASTS = ONLY
  ? ALL_CASTS.filter(cast => cast.champion.toLowerCase().includes(ONLY.toLowerCase()))
  : ALL_CASTS;
if (!CASTS.length) {
  console.error(`no casts match "${ONLY}"`);
  process.exit(1);
}

// `hmr: false`: this repo is worked on by several agents in one tree, and a
// stray save anywhere in `src/` makes Vite reload the page mid-run, which wipes
// `window.__moba2d` and takes the whole script down with a bare "cannot read
// properties of undefined". The rig has no use for hot reload — it loads the
// page once and drives it.
const server = await createServer({ server: { port: 0, strictPort: false, hmr: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

// Same override as `harness.mjs`: system Chrome by default because that is what
// the game ships to, `MOBA2D_CHROME_CHANNEL=` (empty) for a machine without it.
const channel = process.env.MOBA2D_CHROME_CHANNEL ?? 'chrome';
const browser = await chromium.launch(channel ? { channel } : {});
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const failures = [];
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
await page.waitForTimeout(1_500);

// Clear the arena once, then stand a punching bag in front of the player so
// on-hit effects have something to land on.
await page.evaluate(() => {
  const game = window.__moba2d.scene.oScene.game;
  const player = game.player;
  for (const object of game.objectManager.objects) {
    if (object === player) continue;
    const name = object.constructor?.name ?? '';
    if (name === 'Turret' || name === 'Fountain') continue;
    object.toRemove = true;
  }
  game.objectManager.update();
  window.__rig = { game, player, home: player.position.copy() };
});

for (const cast of CASTS) {
  const staged = await page.evaluate(
    async ([championName, classPrefix, slot, aimX, aimY]) => {
      const { game, player, home } = window.__rig;

      // wipe leftovers from the previous cast so each shot is of one spell
      for (const object of game.objectManager.objects) {
        if (object === player) continue;
        const name = object.constructor?.name ?? '';
        if (name === 'Turret' || name === 'Fountain') continue;
        object.toRemove = true;
      }
      game.objectManager.update();
      for (const buff of player.buffs) buff.deactivateBuff();
      player.updateBuffs();

      // reset the player onto the champion under test
      game.director.applyLoadout(player, {
        mode: 'champion',
        championName,
        summonerD: 'Flash',
        summonerF: 'Heal',
        customSlots: Array(7).fill('random'),
      });
      game.objectManager.update();

      const subject = game.player;
      subject.position.set(home.x, home.y);
      subject.destination.set(home.x, home.y);
      subject.stats.mana.baseValue = subject.stats.maxMana.value;
      subject.stats.health.baseValue = subject.stats.maxHealth.value;

      // a dummy to be hit, so impacts have a body to land on
      const dummy = game.director.addBot({
        mode: 'champion',
        championName: 'Vera',
        summonerD: 'Flash',
        summonerF: 'Heal',
        customSlots: Array(7).fill('random'),
      });
      if (dummy) {
        game.director.setBotBehaviour(dummy, {
          autoMove: false,
          autoAttack: false,
          autoCast: false,
        });
        game.objectManager.update();
        dummy.position.set(home.x + aimX * 0.75, home.y + aimY * 0.75);
        dummy.destination.set(dummy.position.x, dummy.position.y);
        dummy.stats.health.baseValue = dummy.stats.maxHealth.value * 10;
        dummy.stats.maxHealth.baseValue = dummy.stats.maxHealth.value * 10;
      }

      window.__stage = { game, subject, home, dummy };
      return { ok: true };
    },
    [cast.champion, cast.slotName ?? cast.champion, cast.slot, cast.aim[0], cast.aim[1]]
  );

  // `label` only when one ability needs more than one shot of it — two entries
  // for the same slot would otherwise write over each other's screenshots.
  const label = cast.label ?? `${cast.slotName ?? cast.champion}_${cast.slot}`;
  if (!staged.ok) {
    check(`${label} staged`, false, staged.reason);
    continue;
  }

  // A frame has to run between standing the dummy up and pressing the key.
  // `queryObjects` answers out of the quadtree, which is rebuilt once per
  // update — cast in the same tick and an auto-locking spell looks for
  // bodies at the positions they were spawned at and finds nothing in
  // range, which reads as a broken ability rather than a stale index.
  await page.waitForTimeout(120);

  const fired = await page.evaluate(
    ([classPrefix, slot, aimX, aimY]) => {
      const { game, subject, home } = window.__stage;

      const wanted = `${classPrefix}_${slot}`;
      const spell = subject.spells.find(s => s?.constructor?.name === wanted);
      if (!spell) {
        return {
          ok: false,
          reason: `no ${wanted} in kit: ${subject.spells.map(s => s?.constructor?.name).join(',')}`,
        };
      }

      // `Spell.cast()` builds its own CastContext off game.worldMouse, which is
      // the path the real key press takes — press() alone wants a context.
      game.worldMouse = createVector(home.x + aimX, home.y + aimY);

      const objectsBefore = game.objectManager.objects.length;
      const buffsBefore = subject.buffs.length;
      const startPos = { x: subject.position.x, y: subject.position.y };
      spell.currentCooldown = 0;
      spell.cast();

      window.__cast = {
        game,
        subject,
        objectsBefore,
        buffsBefore,
        startPos,
        spawned: 0,
        buffed: 0,
        moved: 0,
      };
      return { ok: true };
    },
    [cast.slotName ?? cast.champion, cast.slot, cast.aim[0], cast.aim[1]]
  );

  if (!fired.ok) {
    check(`${label} staged`, false, fired.reason);
    continue;
  }

  let previous = 0;
  for (const [index, at] of cast.frames.entries()) {
    await page.waitForTimeout(at - previous);
    previous = at;

    await page.evaluate(() => {
      const rig = window.__cast;
      const game = rig.game;
      rig.spawned = Math.max(
        rig.spawned,
        game.objectManager.objects.length +
          game.objectManager._objectToBeAdd.length -
          rig.objectsBefore
      );
      rig.buffed = Math.max(rig.buffed, rig.subject.buffs.length - rig.buffsBefore);
      rig.moved = Math.max(
        rig.moved,
        Math.hypot(rig.subject.position.x - rig.startPos.x, rig.subject.position.y - rig.startPos.y)
      );
    });
    await page.screenshot({ path: `${OUT}/${label}-${index + 1}-t${at}.png` });
  }

  const result = await page.evaluate(() => {
    const rig = window.__cast;
    return { spawned: rig.spawned, buffed: rig.buffed, moved: Math.round(rig.moved) };
  });
  // Disjunctive, the same way `smoke-new-champions.mjs` checks it: an
  // ability whose whole payload is a buff on the caster (Vera W) spawns no
  // object and moves nobody, and calling that "produced no world effects"
  // would be the check being wrong, not the spell — a bug this file used to
  // carry, invisible only because no self-buff-only kit was ever in its
  // roster to trip it.
  check(
    `${label} produced world effects`,
    result.spawned > 0 || result.buffed > 0 || result.moved > 2,
    `objects=+${result.spawned} buffs=+${result.buffed} moved=${result.moved}px`
  );
}

console.log('\nscreenshots in', OUT);
if (errors.length) {
  console.log('\npage errors:');
  for (const error of errors.slice(0, 12)) console.log(' ', error);
}
check('no page errors during the run', errors.length === 0, `${errors.length} error(s)`);

await browser.close();
await server.close();

if (failures.length) {
  console.log(`\n${failures.length} FAILED`);
  process.exit(1);
}
console.log('\nall checks passed');
