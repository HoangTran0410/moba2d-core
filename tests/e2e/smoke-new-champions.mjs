/**
 * Does every ability in the currently installed roster still fire via the
 * real keypress path?
 *
 * `verify` says every spell compiles and its unit tests pass. Neither of
 * those runs `draw()`. What is left to find is the class of bug that only
 * exists once p5 is real and a frame is running: a null read inside a draw,
 * a missing global, an effect that constructs and then throws on its first
 * update — all of which present as a working build and a dead champion.
 *
 * Originally written to drive a growing Riot-content roster in a real
 * browser before it shipped, one batch of new kits at a time — see git
 * history before content-pack-and-repo-split batch 6 task 11 for that
 * shape, `ROSTER` retargeted per batch and never accumulated. That content
 * left this repository; the property this script proves (the real
 * `SpellInputController.keyDown` path — `createSpellContext` then `press()`
 * — actually fires every slot of the currently installed roster without a
 * page error) is engine behaviour, not Riot-specific, so it is repointed at
 * `packs/reference/`'s own champion instead of deleted. It is `npm run
 * e2e:champions` now: a small, permanent regression check rather than a
 * one-off per-batch tool, because the reference pack's roster is not
 * expected to grow the way the departed one did.
 *
 * Deliberately *not* a screenshot rig; `shoot-new-champion-vfx.mjs` is that.
 * This one asks the three questions a number can answer:
 *
 *   1. no page error while the ability is on screen,
 *   2. the cast was *accepted* — `press()`'s own return value, not an
 *      inference from the spell's state afterwards; see the note beside it,
 *   3. something happened — an object, a buff, or the caster moved.
 *
 * The third is deliberately a disjunction: an ability whose whole payload is
 * a buff on the caster (Vera W) spawns no object and does not move the
 * caster, and calling that broken would be the test being wrong rather than
 * the game.
 *
 *   node tests/e2e/smoke-new-champions.mjs [championFilter]
 *
 * Requires a system Chrome install.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const CFG_KEY = 'lol2d:pregameConfig:v1';

/**
 * [preset display name, spell class prefix] — they differ where a name has a
 * space, which is why both are carried even though the reference pack's one
 * champion needs neither to differ. `ROSTER` stays an array (not a single
 * constant) so a future second reference-pack champion is one more entry,
 * the same shape a departed pack's roster used to be.
 */
const ROSTER = [['Vera', 'Vera']];

/**
 * Abilities whose first press needs the board set, keyed by the label
 * printed below; the value is the slot to cast first. Empty today — the
 * reference pack's four abilities all fire clean from a cold board — kept
 * as a real mechanism rather than removed, because the day this roster
 * grows a seize/recast-style ability it is exactly this table that needs an
 * entry, not a rewritten harness.
 */
const PREREQUISITES = {};
const PREREQUISITE_SETTLE_MS = 700;

/**
 * Two-stage abilities whose payload lands on the **recast**, so one press is
 * half the gesture and the "something happened" disjunction below correctly
 * sees nothing. Empty today for the same reason `PREREQUISITES` is; kept
 * wired for the same reason.
 */
const RECASTS = new Set();
/** Budget for a recast to reach its recastable ACTIVE window, once one exists. */
const RECAST_WINDOW_TIMEOUT_MS = 2000;

const ONLY = process.argv[2];
const CASTS = [];
for (const [champion, prefix] of ROSTER) {
  if (ONLY && !champion.toLowerCase().includes(ONLY.toLowerCase())) continue;
  for (const slot of ['Q', 'W', 'E', 'R']) CASTS.push({ champion, prefix, slot });
}
if (CASTS.length === 0) {
  console.error(`no champion matches "${ONLY}"`);
  process.exit(1);
}

/** How long to watch one cast. Generous relative to any of the reference pack's own cast/channel times. */
const OBSERVE_MS = 2_400;
const SAMPLE_MS = 300;

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
  world: { jungle: false, minions: false },
};

// `hmr: false`: several agents share this tree and a stray save mid-run would
// reload the page and wipe `window.__lol2d` under us.
const server = await createServer({ server: { port: 0, strictPort: false, hmr: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

let errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const rows = [];
const failures = [];

try {
  await page.addInitScript(
    ([key, config]) => window.localStorage.setItem(key, JSON.stringify(config)),
    [CFG_KEY, MATCH_CONFIG]
  );
  await page.goto(url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    window.__rig = { game, home: game.player.position.copy() };
  });

  for (const cast of CASTS) {
    const label = `${cast.prefix}_${cast.slot}`;
    errors = [];

    const staged = await page.evaluate(
      ([championName]) => {
        const { game, home } = window.__rig;
        const player = game.player;

        // One cast per arena: leftovers from the last ability would be counted
        // as this one's, and a lingering zone would keep ticking into it.
        for (const object of game.objectManager.objects) {
          if (object === player) continue;
          const name = object.constructor?.name ?? '';
          if (name === 'Turret' || name === 'Fountain') continue;
          object.toRemove = true;
        }
        game.objectManager.update();
        for (const buff of player.buffs) buff.deactivateBuff();
        player.updateBuffs();

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
        subject.stats.health.baseValue = subject.stats.maxHealth.value * 0.6;

        // A body to aim at, well inside every range on this roster, and fat
        // enough to survive being hit several times.
        const dummy = game.director.addBot({
          mode: 'champion',
          championName: 'Vera',
          summonerD: 'Flash',
          summonerF: 'Heal',
          customSlots: Array(7).fill('random'),
        });
        if (!dummy) return { ok: false, reason: 'no dummy' };
        game.director.setBotBehaviour(dummy, {
          autoMove: false,
          autoAttack: false,
          autoCast: false,
        });
        game.objectManager.update();
        dummy.position.set(home.x + 240, home.y);
        dummy.destination.set(dummy.position.x, dummy.position.y);
        dummy.stats.maxHealth.baseValue = 100_000;
        dummy.stats.health.baseValue = 100_000;

        window.__stage = { game, subject, home, dummy };
        return { ok: true };
      },
      [cast.champion]
    );

    if (!staged.ok) {
      rows.push({ label, ok: false, detail: staged.reason });
      failures.push(`${label}: ${staged.reason}`);
      continue;
    }

    // The quadtree is rebuilt once per update, so an auto-locking spell cast in
    // the same tick the dummy was placed looks for a body the index has not
    // seen yet and reports a working ability as broken.
    await page.waitForTimeout(150);

    // Same class of harness error, one step further out: an ability whose first
    // press needs the board set rather than a target picked. Casting it cold
    // measures this script, not the spell.
    const prerequisite = PREREQUISITES[label];
    if (prerequisite) {
      await page.evaluate(
        ([prefix, slot]) => {
          const { game, subject, home } = window.__stage;
          const spell = subject.spells.find(s => s?.constructor?.name === `${prefix}_${slot}`);
          if (!spell) return;
          spell.currentCooldown = 0;
          const at = { x: home.x + 140, y: home.y };
          game.worldMouse = createVector(at.x, at.y);
          const context = game.createSpellContext(spell, subject, at);
          if (context) spell.press(context);
        },
        [cast.prefix, prerequisite]
      );
      await page.waitForTimeout(PREREQUISITE_SETTLE_MS);
    }

    const fired = await page.evaluate(
      ([prefix, slot]) => {
        const { game, subject, home } = window.__stage;
        const wanted = `${prefix}_${slot}`;
        const spell = subject.spells.find(s => s?.constructor?.name === wanted);
        if (!spell) {
          return {
            ok: false,
            reason: `not in kit (${subject.spells.map(s => s?.constructor?.name).join(',')})`,
          };
        }

        // `game.createSpellContext` and then `press`, which is exactly what
        // `SpellInputController.keyDown` does. `Spell.cast()` is *not* the same
        // path: it builds a bare context with no `target`, so a UNIT spell —
        // whose whole job is resolving one — is handed nothing to act on and
        // silently declines.
        game.worldMouse = createVector(home.x + 240, home.y);
        spell.currentCooldown = 0;

        window.__cast = {
          game,
          subject,
          spell,
          objectsBefore: game.objectManager.objects.length,
          buffsBefore: subject.buffs.length,
          startPos: { x: subject.position.x, y: subject.position.y },
          spawned: 0,
          buffed: 0,
          moved: 0,
        };
        const context = game.createSpellContext(spell, subject, {
          x: home.x + 240,
          y: home.y,
        });
        if (!context) return { ok: false, reason: 'no cast context (target refused?)' };
        const accepted = spell.press(context);
        return { ok: true, accepted, stateAfter: String(spell.state) };
      },
      [cast.prefix, cast.slot]
    );

    if (!fired.ok) {
      rows.push({ label, ok: false, detail: fired.reason });
      failures.push(`${label}: ${fired.reason}`);
      continue;
    }

    if (RECASTS.has(label)) {
      // Wait for the recastable window rather than a fixed delay: a flat wait
      // races the spell's own cast time and loses under load. The real
      // second press is `createSpellContext` + `press`, the same as
      // `SpellInputController.keyDown` takes.
      await page
        .waitForFunction(() => String(window.__cast.spell.state) === 'ACTIVE', {
          timeout: RECAST_WINDOW_TIMEOUT_MS,
        })
        .catch(() => {});
      await page.evaluate(() => {
        const rig = window.__cast;
        const { game, home } = window.__stage;
        const at = { x: home.x + 300, y: home.y };
        game.worldMouse = createVector(at.x, at.y);
        const context = game.createSpellContext(rig.spell, rig.subject, at);
        if (context) rig.spell.press(context);
      });
    }

    for (let elapsed = 0; elapsed < OBSERVE_MS; elapsed += SAMPLE_MS) {
      await page.waitForTimeout(SAMPLE_MS);
      await page.evaluate(() => {
        const rig = window.__cast;
        const manager = rig.game.objectManager;
        rig.spawned = Math.max(
          rig.spawned,
          manager.objects.length + manager._objectToBeAdd.length - rig.objectsBefore
        );
        rig.buffed = Math.max(rig.buffed, rig.subject.buffs.length - rig.buffsBefore);
        rig.moved = Math.max(
          rig.moved,
          Math.hypot(
            rig.subject.position.x - rig.startPos.x,
            rig.subject.position.y - rig.startPos.y
          )
        );
      });
    }

    const result = await page.evaluate(() => {
      const rig = window.__cast;
      return {
        spawned: rig.spawned,
        buffed: rig.buffed,
        moved: Math.round(rig.moved),
      };
    });

    // `press()` returns whether the runtime accepted the cast, and that is the
    // only honest answer to the question. This used to be re-derived afterwards
    // as "the spell is no longer READY, or its cooldown is running", which is a
    // guess about a spell that has already resolved — and it is wrong for every
    // spell that legitimately goes straight back to READY, such as a charge
    // spell mid-sequence.
    const accepted = fired.accepted;
    const didSomething = result.spawned > 0 || result.buffed > 0 || result.moved > 2;
    const ok = errors.length === 0 && accepted && didSomething;
    const detail =
      `objects=+${result.spawned} buffs=+${result.buffed} moved=${result.moved}px` +
      `${accepted ? '' : ' NOT-ACCEPTED'}${errors.length ? ` ${errors[0].slice(0, 120)}` : ''}`;

    rows.push({ label, ok, detail });
    if (!ok) failures.push(`${label}: ${detail}`);
  }
} catch (error) {
  failures.push(`run: ${String(error).split('\n')[0]}`);
} finally {
  for (const row of rows)
    console.log(`${row.ok ? 'ok  ' : 'FAIL'}  ${row.label.padEnd(18)} ${row.detail}`);
  console.log(
    `\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}  ${rows.length} casts, ${CASTS.length} attempted`
  );
  await browser.close();
  await server.close();
}

process.exit(failures.length === 0 ? 0 : 1);
