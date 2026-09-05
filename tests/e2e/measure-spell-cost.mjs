#!/usr/bin/env node
/**
 * What one ability costs a frame when a fight is full of it.
 *
 *   node tests/e2e/measure-spell-cost.mjs Cassiopeia_W
 *   node tests/e2e/measure-spell-cost.mjs ../lol/spells/Annie_R.ts   # a path works too
 *   node tests/e2e/measure-spell-cost.mjs Brand_W --budget 200
 *
 * ## Why a *dynamic* test, next to the static one
 *
 * `scripts/perf-scan.mjs` reads shapes and is instant, which is what makes it
 * usable on every push — but it can only ever say "this looks expensive". It
 * counts primitives it can see and multiplies the loop bounds it can resolve;
 * it cannot know that an effect lives for eight seconds, that a wave-clear puts
 * forty of them on screen at once, or that the whole thing is behind an `if`
 * that is false in play. This one casts the real ability in a real match until
 * the board is full of it and *measures the frame*.
 *
 * ## The pattern it is built around
 *
 * Every expensive effect this codebase has found was expensive the same way:
 * **one instance is fine and forty are not.** A burn at 0.32ms is nothing until
 * an AoE puts it on a wave and the frame triples. So the number that matters is
 * not what a cast costs, it is **microseconds per live instance per frame** —
 * which is comparable between abilities, independent of how many happen to be
 * up, and the only figure that predicts what a teamfight does with it.
 *
 * The CPU is throttled (`--throttle`, 4x by default) for the same reason the
 * frame profiler throttles: a desktop finishes every frame inside its budget
 * and reports nothing, and the machine that matters is a phone.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { basename, dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : Number(args[at + 1]);
};
/** Microseconds per live instance per frame, over which an ability is reported. */
const BUDGET_US = flag('budget', 150);
/**
 * And the other half of the question: what the whole sustained load costs a
 * frame, however it divides.
 *
 * Per-instance alone missed a real one. An ability at 95us/instance is inside
 * budget and reads fine — until it turns out to keep 57 of them alive and add
 * **5.4ms to every frame**, which is most of a phone's budget for one spell.
 * Cheap per instance and ruinous in aggregate is a thing an ability can be, so
 * both are gated.
 *
 * ## Where these two numbers come from
 *
 * They were guessed, and then the guess was checked. Thirty-three abilities
 * were sampled across the three packs by walking each pack's spell list at a
 * fixed stride — a *population*, not a list of suspects, which is the only kind
 * of sample a threshold can honestly be drawn from. Twenty-five measured:
 *
 *     median delta   0.70 ms      median us/inst    41
 *     75th pct       ~1.5 ms      90th pct        ~2.2 ms
 *     worst          4.11 ms (the only one over 3ms, and over 150us/inst too)
 *
 * So an ordinary ability costs about **0.7ms** here and 24 of 25 sit under
 * 2.5ms. Three at 3ms was a good line and is kept.
 *
 * What was wrong was its *shape*, not its height. Ten of those abilities were
 * measured a second time under identical conditions and moved by **-77% to
 * +68%**, median 24% — `delta` is an aggregate, and aggregates swing here.
 * A 2.2ms ability can therefore read 3.5ms on a bad run, and one bad run was
 * enough to refuse a push. So the aggregate now warns at 3ms and only *fails*
 * at `--delta-fail`, twice that, which is far enough out that noise cannot
 * carry an ordinary ability across it — and every failure is re-measured
 * before it counts (see the confirmation pass below).
 */
const DELTA_BUDGET_MS = flag('delta-budget', 3);
/**
 * Where the aggregate stops being advice and becomes a refusal. Twice the warn
 * line, which is ~3x the population's 90th percentile: nothing ordinary reaches
 * it, and nothing that reaches it is ordinary.
 */
const DELTA_FAIL_MS = flag('delta-fail', 6);
/**
 * Below this many live instances, us-per-instance is a ratio with a rounding
 * error on the bottom, not a measurement — one ability measured 257us/instance
 * off 1.1 live and a 0.27ms delta, which is nothing at all. Under the floor the
 * aggregate is the only figure that means anything.
 */
const MIN_INSTANCES = 3;
/**
 * How often the harness re-casts. Fast enough to saturate the board with
 * anything, which is the point — and deliberately unrelated to the ability's
 * own cooldown, which is why `reach` exists to say what the cooldown allows.
 */
const FIRE_INTERVAL_MS = 90;
const THROTTLE = flag('throttle', 4);
const WINDOW_MS = flag('window', 4000);
/**
 * Which render quality to measure under.
 *
 * `auto` is what a desktop plays at and what the numbers above mean. `low`
 * turns on `ObjectManager.draw`'s particle ration, which is the *only* thing a
 * `ParticleSystem` conversion buys: converting a hand-rolled array does not
 * make it cheaper at full quality, it makes it **rationable** — so a conversion
 * has to be checked here or the claim is unproven. (It also compacts unit
 * bodies, so read a `low` number as "with the whole stress path on", not as the
 * particle budget alone.)
 */
const QUALITY = (() => {
  const at = process.argv.indexOf('--quality');
  return at === -1 ? null : process.argv[at + 1];
})();

/**
 * `lol/spells/Annie_R.ts`, `Annie_R`, `Annie_R.ts` — all the same ability.
 * Pack spells are `<Champion>_<Slot>.ts` everywhere, which is what lets the
 * push hook hand this a changed file path and get an ability back.
 */
const spellNames = args
  .filter(a => !a.startsWith('--') && !/^\d+$/.test(a))
  .map(a => basename(a).replace(/\.ts$/, ''))
  .filter(name => /^[A-Za-z][\w]*_[A-Za-z0-9]+$/.test(name));

if (spellNames.length === 0) {
  console.error('usage: measure-spell-cost.mjs <Champion_Slot | path/to/Champion_Slot.ts> ...');
  process.exit(2);
}

/**
 * Which champion owns an ability, read off the packs' own rosters.
 *
 * The file name is `<Champion>_<Slot>.ts` and the *class* is named for it, but
 * the roster is not: `ChoGath_Q` belongs to "Cho'Gath", `LeeSin_W` to "Lee
 * Sin", `KogMaw_E` to "Kog'Maw". Guessing the roster name from the file name
 * put nine abilities on the wrong champion, and `applyLoadout` answers an
 * unknown name with a *random* one rather than an error — so the run reported
 * "not in Kakashi's kit (Singed_Q, Singed_W, ...)" and skipped, which is at
 * least honest, but nine abilities went unmeasured.
 *
 * A pack states the pairing in its own roster, and the three do not agree on
 * where that lives — one keeps it in `data.ts`, two in `pack.ts` — so both are
 * read. The shape is the same in all of them: a `name`, then a `spells` list.
 */
const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const championOf = new Map();
for (const pack of ['lol', 'naruto', 'dota']) {
  for (const roster of ['data.ts', 'pack.ts']) {
    const file = resolve(CORE_ROOT, '..', pack, roster);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const entry of text.matchAll(/name:\s*(['"])(.*?)\1[\s\S]*?spells:\s*\[([^\]]*)\]/g)) {
      for (const quoted of entry[3].match(/['"][\w]+['"]/g) ?? []) {
        if (!championOf.has(quoted.slice(1, -1))) championOf.set(quoted.slice(1, -1), entry[2]);
      }
    }
  }
}

const MATCH_CONFIG = {
  ai: { count: 1, autoMove: false, autoAttack: false, autoCast: false, bots: [] },
  rules: { manaFree: true },
};

const server = await createServer({ server: { port: 0, strictPort: false, hmr: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
const channel = process.env.MOBA2D_CHROME_CHANNEL ?? 'chrome';
const browser = await chromium.launch(channel ? { channel } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

/**
 * Fail, warn, or fine.
 *
 * Per-instance is the figure that fails on its own: it is comparable between
 * abilities and it is what predicts a teamfight, because the pattern is always
 * "one is fine and forty are not". The aggregate is the sanity check on it, and
 * it fails only when it is far enough over that a noisy run cannot explain it.
 */
const verdictFor = row => {
  const overPer = row.enough && row.perInstance > BUDGET_US;
  const overFail = row.delta > DELTA_FAIL_MS;
  const reason = [overPer && 'per-instance', overFail && 'total'].filter(Boolean).join(' + ');
  return {
    fails: overPer || overFail,
    warns: !overPer && !overFail && row.delta > DELTA_BUDGET_MS,
    reason,
  };
};

const results = [];
try {
  await page.addInitScript(
    ([key, config]) => window.localStorage.setItem(key, JSON.stringify(config)),
    ['moba2d:pregameConfig:v1', MATCH_CONFIG]
  );
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#play-btn', { timeout: 30_000 });
  await page.click('#play-btn');
  await page.waitForSelector('#pregame-start-btn', { timeout: 30_000 });
  await page.click('#pregame-start-btn');
  await page.waitForFunction(() => window.__moba2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  const cdp = await page.context().newCDPSession(page);
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

  const measureOnce = async spellName => {
    const championName =
      championOf.get(spellName) ?? spellName.slice(0, spellName.lastIndexOf('_'));
    const measured = await page.evaluate(
      async ([spellName, championName, windowMs, quality, FIRE_INTERVAL_MS]) => {
        const game = window.__moba2d.scene.oScene.game;
        const settle = ms => new Promise(r => setTimeout(r, ms));
        if (quality) game.renderQuality = quality;

        // An empty arena, so what is on screen is this ability and nothing else.
        const clear = () => {
          for (const object of game.objectManager.objects) {
            if (object === game.player) continue;
            const name = object.constructor?.name ?? '';
            if (name === 'Turret' || name === 'Fountain') continue;
            object.toRemove = true;
          }
          game.objectManager.update();
        };
        clear();

        const loadout = {
          mode: 'champion',
          championName,
          summonerD: 'Flash',
          summonerF: 'Heal',
          customSlots: Array(7).fill('random'),
        };
        try {
          game.director.applyLoadout(game.player, loadout);
        } catch (error) {
          return { skipped: `no champion "${championName}": ${error.message}` };
        }
        game.objectManager.update();

        const subject = game.player;
        const home = subject.position.copy();
        subject.stats.mana.baseValue = subject.stats.maxMana.value * 100;
        subject.stats.maxMana.baseValue = subject.stats.maxMana.value * 100;

        const spell = subject.spells.find(s => s?.constructor?.name === spellName);
        if (!spell) {
          return {
            skipped: `${spellName} not in ${championName}'s kit ` +
              `(${subject.spells.map(s => s?.constructor?.name).filter(Boolean).join(', ')})`,
          };
        }

        // Something to land on, so an effect that needs a body to attach to
        // actually attaches — an unattached one draws nothing and measures as
        // free, which is the wrong answer rather than a cheap one.
        const dummies = [];
        for (let i = 0; i < 6; i++) {
          const bot = game.director.addBot({ ...loadout, championName: 'Vera' });
          if (!bot) break;
          game.director.setBotBehaviour(bot, { autoMove: false, autoAttack: false, autoCast: false });
          dummies.push(bot);
        }
        game.objectManager.update();
        dummies.forEach((bot, i) => {
          const a = (i / Math.max(1, dummies.length)) * Math.PI * 2;
          bot.position.set(home.x + Math.cos(a) * 130, home.y + Math.sin(a) * 130);
          bot.destination.set(bot.position.x, bot.position.y);
          bot.stats.maxHealth.baseValue = 1e9;
          bot.stats.health.baseValue = 1e9;
        });
        await settle(200);

        const proto = Object.getPrototypeOf(game);
        const sample = async (label, duringFrame) => {
          let frames = 0;
          let drawMs = 0;
          let population = 0;
          const real = proto.draw;
          proto.draw = function (...a) {
            const t = performance.now();
            const out = real.apply(this, a);
            frames++;
            drawMs += performance.now() - t;
            population += duringFrame ? duringFrame() : 0;
            return out;
          };
          await settle(400);
          frames = 0;
          drawMs = 0;
          population = 0;
          await settle(windowMs);
          proto.draw = real;
          return {
            label,
            msPerFrame: drawMs / Math.max(1, frames),
            instances: population / Math.max(1, frames),
            frames,
          };
        };

        // What the board looks like with nothing cast — the classes present now
        // are the floor, and anything new during the load is this ability's.
        const baselineClasses = new Set(
          game.objectManager.objects.map(o => o.constructor?.name ?? '?')
        );
        const baselineBuffs = new Set();
        for (const unit of [subject, ...dummies]) {
          for (const buff of unit.buffs) baselineBuffs.add(buff.constructor?.name ?? '?');
        }
        const mine = () => {
          let n = 0;
          for (const object of game.objectManager.objects) {
            if (!baselineClasses.has(object.constructor?.name ?? '?')) n++;
          }
          for (const unit of [subject, ...dummies]) {
            for (const buff of unit.buffs) {
              if (!baselineBuffs.has(buff.constructor?.name ?? '?')) n++;
            }
          }
          return n;
        };

        const before = await sample('idle', mine);

        // Cast on a hard loop, aimed around the ring, so a steady population
        // builds instead of one instance being measured in isolation.
        let shots = 0;
        const firing = setInterval(() => {
          const a = (shots++ / 8) * Math.PI * 2;
          game.worldMouse = createVector(home.x + Math.cos(a) * 220, home.y + Math.sin(a) * 220);
          subject.position.set(home.x, home.y);
          subject.stats.mana.baseValue = subject.stats.maxMana.value;
          spell.currentCooldown = 0;
          try {
            spell.cast();
          } catch {
            /* a refusal is not a measurement failure; the population says so */
          }
        }, FIRE_INTERVAL_MS);
        await settle(600);
        const during = await sample('casting', mine);
        clearInterval(firing);

        return {
          shots,
          idleMs: before.msPerFrame,
          loadedMs: during.msPerFrame,
          instances: during.instances,
          coolDownMs: spell.coolDown,
        };
      },
      [spellName, championName, WINDOW_MS, QUALITY, FIRE_INTERVAL_MS]
    );

    if (measured.skipped) return { spell: spellName, skipped: measured.skipped };
    const delta = measured.loadedMs - measured.idleMs;
    const enough = measured.instances >= MIN_INSTANCES;
    /**
     * How many of these one caster can actually keep up.
     *
     * The harness fires every `FIRE_INTERVAL_MS` regardless of the ability's
     * own cooldown, which is what makes a population big enough to divide by —
     * but it can also build one the game cannot. Ninety healing totems measured
     * at 9ms a frame, and a 16s cooldown means a Juggernaut has *one*. Scaling
     * the saturated population back by the real firing rate is the honest
     * reading of it, and it is reported rather than gated because how many
     * champions bring the same ability is a decision about the match, not a
     * measurement.
     */
    const reach =
      measured.coolDownMs > FIRE_INTERVAL_MS
        ? (measured.instances * FIRE_INTERVAL_MS) / measured.coolDownMs
        : measured.instances;
    return {
      spell: spellName,
      idleMs: measured.idleMs,
      loadedMs: measured.loadedMs,
      delta,
      instances: measured.instances,
      perInstance: enough ? (delta * 1000) / measured.instances : 0,
      enough,
      reach,
      coolDownMs: measured.coolDownMs,
    };
  };

  for (const spellName of spellNames) results.push(await measureOnce(spellName));

  /**
   * Anything that failed gets measured a second time, and the *better* of the
   * two runs is the one that counts.
   *
   * Not politeness — the numbers demand it. Ten abilities measured twice under
   * identical conditions moved by -77% to +68%, median 24%: `delta` is an
   * aggregate, and this codebase already knew aggregates swing (`selfMs/calls`
   * is the stable one). A single noisy run was therefore enough to fail a push,
   * and did — a branch that took three abilities down 35-64% was refused by the
   * gate it had just improved. Re-measuring only the failures costs ten seconds
   * each and only on the way to a refusal, and taking the better run means the
   * gate says "this is reproducibly expensive", which is the only claim the
   * measurement can actually support.
   */
  if (!args.includes('--no-confirm')) {
    for (let i = 0; i < results.length; i++) {
      if (results[i].skipped || !verdictFor(results[i]).fails) continue;
      const again = await measureOnce(results[i].spell);
      if (again.skipped) continue;
      const [kept, other] = again.delta < results[i].delta ? [again, results[i]] : [results[i], again];
      results[i] = { ...kept, confirmedAgainst: other.delta };
    }
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(
  `\n=== spell draw cost (CPU throttle ${THROTTLE}x, ` +
    `fails over ${BUDGET_US}us/instance or ${DELTA_FAIL_MS}ms/frame, ` +
    `warns over ${DELTA_BUDGET_MS}ms/frame) ===`
);
console.log(
  'spell'.padEnd(24) +
    'idle'.padStart(9) +
    'loaded'.padStart(9) +
    'delta'.padStart(9) +
    'live'.padStart(8) +
    'us/inst'.padStart(10) +
    'reach'.padStart(8)
);
let over = 0;
for (const row of results) {
  if (row.skipped) {
    console.log(`${row.spell.padEnd(24)}  skipped — ${row.skipped}`);
    continue;
  }
  const verdict = verdictFor(row);
  if (verdict.fails) over++;
  const confirmed =
    row.confirmedAgainst === undefined ? '' : ` [confirmed, other run ${row.confirmedAgainst.toFixed(2)}]`;
  console.log(
    row.spell.padEnd(24) +
      row.idleMs.toFixed(2).padStart(9) +
      row.loadedMs.toFixed(2).padStart(9) +
      row.delta.toFixed(2).padStart(9) +
      row.instances.toFixed(1).padStart(8) +
      (row.enough ? Math.round(row.perInstance).toString() : '—').padStart(10) +
      row.reach.toFixed(1).padStart(8) +
      (verdict.fails ? `   OVER (${verdict.reason})${confirmed}` : verdict.warns ? '   heavy' : '')
  );
  // Only worth saying when the two disagree enough to change what you would do
  // about the row — a saturated aggregate that the cooldown cannot pay for.
  if (verdict.fails && row.reach < row.instances / 4) {
    console.log(
      `${' '.repeat(24)}a ${(row.coolDownMs / 1000).toFixed(1)}s cooldown keeps about ` +
        `${row.reach.toFixed(1)} of these up per caster, not ${row.instances.toFixed(0)} — ` +
        `so one caster's real cost is nearer ${((row.perInstance * row.reach) / 1000).toFixed(2)}ms.`
    );
  }
}
if (pageErrors.length) console.log(`\npage errors: ${pageErrors.slice(0, 3).join(' | ')}`);
console.log('');

const heavy = results.filter(row => !row.skipped && verdictFor(row).warns).length;
if (heavy > 0) {
  console.log(
    `${heavy} ability(s) marked heavy — over ${DELTA_BUDGET_MS}ms a frame under saturation,\n` +
      'which is roughly three times what an ordinary ability in these packs costs.\n' +
      'Not a refusal: worth a look, not worth blocking a push over.\n'
  );
}
if (over > 0) {
  console.error(
    `${over} ability(s) over budget — ${BUDGET_US}us per live instance, ` +
      `or ${DELTA_FAIL_MS}ms a frame all told,\n` +
      'and measured twice so that a noisy run is not what refused you.\n' +
      'One of these is fine and forty are not — that is how every expensive\n' +
      'effect in this game has been expensive. Cut the primitive count, or make\n' +
      'the effect a ParticleSystem so the draw budget can ration it.'
  );
  process.exit(1);
}
