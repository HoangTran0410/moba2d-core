/**
 * End-to-end drive of the kill feed's multi-kill fold.
 *
 * A penta used to arrive as five callouts into a stack that shows three, and
 * two on a phone — so the three kills that earned the word "Penta" were pushed
 * off the top before it was said. `hud/killFeedGroups.ts` folds a run into one
 * row; this script is the half a unit test cannot do, which is look at it.
 *
 * It emits real `ON_DIE` events at real champions in a running match rather
 * than posting to the announcer directly, so what is measured is the whole
 * path: `MatchAnnouncer.onDeath` → `hudState.buildFeed` → `KillFeed.vue`.
 *
 *   node tests/e2e/drive-kill-feed.mjs [outPrefix]
 *
 * Requires a system Chrome install.
 */
import { CFG_KEY, PHONE_VIEWPORT, startHarness, startMatch } from './harness.mjs';

const OUT = process.argv[2] ?? '/tmp/moba2d-kill-feed';

// Nine bots so the enemy side can field the five champions a penta needs; the
// default roster is three a side, which is a triple and no further.
const MATCH_CONFIG = {
  ai: { count: 9, autoMove: false, autoAttack: false, autoCast: false, bots: [] },
  rules: { manaFree: true },
};

const { url, page, report, check, guard } = await startHarness({
  out: OUT,
  viewport: PHONE_VIEWPORT,
  hasTouch: true,
  deviceScaleFactor: 3,
  touch: true,
});

/** Kills `count` enemies for the player, one event each, as fast as a burst is. */
const burst = (page, count) =>
  page.evaluate(n => {
    const game = window.__moba2d.scene.oScene.game;
    const player = game.player;
    const enemies = game.objectManager.objects.filter(
      o => o.killCredit === 'champion' && o.teamId !== player.teamId && o !== player
    );
    const taken = enemies.slice(0, n);
    for (const victim of taken) {
      game.eventManager.emit('onUnitDie', { unit: victim, killer: player, credit: 'champion' });
    }
    return taken.length;
  }, count);

const feedShape = page =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll('.kill-feed-row')];
    return rows.map(row => ({
      visible: getComputedStyle(row).display !== 'none',
      faces: row.querySelectorAll('.kill-feed-victims .kill-feed-face').length,
      badges: [...row.querySelectorAll('.kill-feed-badge')].map(b => b.textContent.trim()),
      width: Math.round(row.getBoundingClientRect().width),
      wrapped: row.getBoundingClientRect().height > 34,
    }));
  });

/** Every banner in the DOM right now — more than one means two share the column. */
const banners = page =>
  page.evaluate(() =>
    [...document.querySelectorAll('.kill-banner')].map(b => ({
      text: b.textContent.trim().slice(0, 40),
      top: Math.round(b.getBoundingClientRect().top),
    }))
  );

/** One kill for the player, at the moment it is called. */
const killOne = page =>
  page.evaluate(() => {
    const game = window.__moba2d.scene.oScene.game;
    const player = game.player;
    const victim = game.objectManager.objects.find(
      o => o.killCredit === 'champion' && o.teamId !== player.teamId && o !== player && !o.isDead
    );
    if (!victim) return null;
    game.eventManager.emit('onUnitDie', { unit: victim, killer: player, credit: 'champion' });
    return victim.name;
  });

await guard(async () => {
  await page.addInitScript(
    ([key, config]) => window.localStorage.setItem(key, JSON.stringify(config)),
    [CFG_KEY, MATCH_CONFIG]
  );
  await page.goto(url, { waitUntil: 'load' });
  await startMatch(page);
  await page.waitForFunction(() => window.__moba2d?.scene?.oScene?.game?.announcer, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  // ------------------------------------------------------- 1. a lone kill

  report.firstBurst = await burst(page, 1);
  await page.waitForTimeout(400);
  report.afterOne = await feedShape(page);
  check('a single kill is one row', report.afterOne.length === 1);
  check('a single kill still names its victim', report.afterOne[0].faces === 1);
  await page.screenshot({ path: `${OUT}-01-single.png` });

  // ------------------------------------------------------------ 2. a penta

  report.pentaBurst = await burst(page, 4);
  await page.waitForTimeout(600);
  report.afterFive = await feedShape(page);

  check('five kills by one champion draw one row', report.afterFive.length === 1);
  check('that row carries all five faces', report.afterFive[0]?.faces === 5);
  check(
    'the row says Penta Kill',
    report.afterFive[0]?.badges.some(b => b.includes('Penta'))
  );
  check(
    'the row keeps the First Blood its opening kill earned',
    report.afterFive[0]?.badges.some(b => b.includes('First Blood'))
  );
  check(
    'no row is hidden by the stack cap',
    report.afterFive.every(r => r.visible)
  );
  check(
    'the row stays on one line of a 844px-wide phone',
    report.afterFive[0]?.wrapped === false && report.afterFive[0]?.width <= PHONE_VIEWPORT.width
  );
  await page.screenshot({ path: `${OUT}-02-penta.png` });

  // ---------------------------------------------- 3. and it ages out whole

  await page.waitForTimeout(7_000);
  report.afterTtl = await feedShape(page);
  check('the row ages out as one', report.afterTtl.length === 0);
  await page.screenshot({ path: `${OUT}-03-aged.png` });

  // ------------------------- 4. a run built over seconds, caught mid-escalation
  //
  // The burst above lands in one tick, which is the easy case. A real run
  // arrives seconds apart and escalates the banner each time — and a banner
  // that took a new key per kill put two in the flex column at once, the
  // arriving one 46px low until the leaving one let go.

  // Past `MULTI_KILL_WINDOW_MS` (10s), so this is a fresh run and not the tail
  // of the burst above — which does continue, correctly, if you only wait out
  // the six seconds the row is shown for.
  await page.waitForTimeout(4_000);

  report.timed = [];
  for (let i = 1; i <= 4; i++) {
    await killOne(page);
    // 120ms in: inside both the 0.3s pop and the 0.25s fade, where a second
    // banner would still be on screen if one were ever made.
    await page.waitForTimeout(120);
    report.timed.push({
      kill: i,
      rows: (await feedShape(page)).length,
      faces: (await feedShape(page))[0]?.faces,
      banners: await banners(page),
    });
    await page.waitForTimeout(1_200);
  }
  await page.screenshot({ path: `${OUT}-04-escalation.png` });

  check(
    'a run seconds apart still folds into one row',
    report.timed.every(step => step.rows === 1)
  );
  check(
    'each kill appends exactly one face rather than opening a row',
    report.timed.every((step, i) => step.faces === (i === 0 ? 1 : report.timed[i - 1].faces + 1)),
    report.timed.map(step => step.faces).join(' → ')
  );
  check(
    'never two banners at once, even mid-escalation',
    report.timed.every(step => step.banners.length <= 1)
  );
  check(
    'the banner keeps its place while it escalates',
    new Set(report.timed.flatMap(step => step.banners.map(b => b.top))).size === 1
  );
  // Sampled every frame rather than at four points: `kill-banner-pop` scales
  // 1.45 -> 1, and about a centre origin that lifted the top edge of the tall
  // banners by 15px and slid it back as the scale settled — a jerk on every
  // arrival, worst on the loudest word.
  report.bannerTops = await page.evaluate(
    () =>
      new Promise(resolve => {
        const tops = new Set();
        const t0 = performance.now();
        const tick = () => {
          const b = document.querySelector('.kill-banner');
          if (b) tops.add(Math.round(b.getBoundingClientRect().top));
          if (performance.now() - t0 < 1200) requestAnimationFrame(tick);
          else resolve([...tops]);
        };
        requestAnimationFrame(tick);
      })
  );
  check(
    'and does not slide as its pop settles',
    report.bannerTops.length <= 1,
    report.bannerTops.join(', ')
  );

  // ------------------------------------------ 5. a teamfight: five killers

  await page.waitForTimeout(7_000);
  report.teamfight = await page.evaluate(() => {
    const game = window.__moba2d.scene.oScene.game;
    const player = game.player;
    const champs = game.objectManager.objects.filter(o => o.killCredit === 'champion');
    const blue = champs.filter(o => o.teamId === player.teamId);
    const red = champs.filter(o => o.teamId !== player.teamId);
    const pairs = Math.min(blue.length, red.length, 5);
    for (let i = 0; i < pairs; i++) {
      game.eventManager.emit('onUnitDie', { unit: red[i], killer: blue[i], credit: 'champion' });
    }
    return pairs;
  });
  await page.waitForTimeout(600);
  report.afterTeamfight = await feedShape(page);
  await page.screenshot({ path: `${OUT}-05-teamfight.png` });

  // Five killers cannot share a row: which victim belongs to which killer is
  // the one thing a feed exists to say. What is checked is that they stack
  // rather than pile up, and that a single banner still holds the centre.
  //
  // Two on this viewport, and exactly two: the phone's cap is applied in
  // `KillFeed.vue` now rather than by a `display: none` at the foot of the
  // stack, so the row it will not show is no longer in the DOM to be counted —
  // this asked for three and got them, hidden. `nth-child` counted the rows
  // *leaving* as well as the ones on screen, and one ghost at the head of the
  // list pushed a live row past the cap and blanked it mid-fight.
  check(
    'five killers make five separate one-victim rows',
    report.afterTeamfight.length === 2,
    `${report.afterTeamfight.length} rows`
  );
  check(
    'no teamfight row carries someone else’s victim',
    report.afterTeamfight.every(row => row.faces === 1)
  );
  check(
    'the visible rows tile instead of overlapping',
    (() => {
      const shown = report.afterTeamfight.filter(r => r.visible);
      return shown.length >= 2;
    })()
  );
  report.teamfightBanners = await banners(page);
  check('a teamfight still shows one banner', report.teamfightBanners.length <= 1);

  // ------------------------- 6. the recap sits under the stack, not through it

  await page.waitForTimeout(7_000);
  await page.evaluate(() => {
    const game = window.__moba2d.scene.oScene.game;
    const player = game.player;
    const enemies = game.objectManager.objects.filter(
      o => o.killCredit === 'champion' && o.teamId !== player.teamId && o !== player
    );
    // A kill for the feed, then the player dies with a recap behind it.
    game.eventManager.emit('onUnitDie', {
      unit: game.objectManager.objects.find(
        o => o.killCredit === 'champion' && o.teamId === player.teamId && o !== player
      ),
      killer: enemies[0],
      credit: 'champion',
    });
    player.takeDamage(120, enemies[0], 'PHYSICAL', 'Đòn đánh');
    player.takeDamage(90, enemies[1], 'MAGICAL', 'Chiêu Q');
    player.takeDamage(10_000, enemies[0], 'PHYSICAL', 'Đòn kết liễu');
  });
  await page.waitForTimeout(700);

  report.stack = await page.evaluate(() => {
    const box = sel => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    };
    return {
      viewportHeight: innerHeight,
      callouts: box('.kill-callouts'),
      recap: box('.death-recap'),
      spectate: box('.spectate-bar'),
      banners: document.querySelectorAll('.kill-banner').length,
    };
  });
  await page.screenshot({ path: `${OUT}-06-recap.png` });

  // The recap opened at `top: 12%` — 46px of a 390px phone — which put it
  // inside the feed and over the banner, and being see-through it did not even
  // hide them: two sentences were legible through each other. It lives at the
  // bottom now, and the revive pill steps up over it.
  check(
    'the recap clears the callout stack',
    report.stack.recap.top >= report.stack.callouts.bottom,
    `callouts end ${report.stack.callouts.bottom}, recap starts ${report.stack.recap.top}`
  );
  // The panel *is* the revive pill on a phone: collapsed on the bottom edge,
  // carrying the countdown and the ally being watched, and `SpectateBar` — the
  // same three facts — steps aside rather than saying them twice.
  report.bar = await page.evaluate(() => {
    const spectate = document.querySelector('.spectate-bar');
    const recap = document.querySelector('.death-recap');
    return {
      spectateShown: spectate ? getComputedStyle(spectate).display !== 'none' : false,
      collapsed: recap?.classList.contains('collapsed') ?? false,
      countdownInRecap: !!recap?.querySelector('#recap-revive-seconds'),
      gapBelow: recap ? Math.round(innerHeight - recap.getBoundingClientRect().bottom) : -1,
    };
  });
  check('the recap carries the revive countdown', report.bar.countdownInRecap);
  check('and the separate revive pill stands down', report.bar.spectateShown === false);
  // Collapsed on every layout: opening it takes most of the screen, which is
  // the right trade for something asked for and the wrong one for something
  // that arrives by itself on every death.
  check('it opens collapsed', report.bar.collapsed);
  check(
    'it sits on the bottom edge',
    report.bar.gapBelow >= 0 && report.bar.gapBelow <= 24,
    `${report.bar.gapBelow}px below it`
  );
  // The point of the move: a dead player is watching, and the panel was across
  // the middle of the screen.
  check(
    'the top half of the screen is left to the fight',
    report.stack.recap.top >= report.stack.viewportHeight * 0.5,
    `recap starts ${report.stack.recap.top} of ${report.stack.viewportHeight}`
  );

  // And the whole reason it is anchored down there: it opens *upward*, so the
  // bar stays under the thumb and the numbers unfold over the dead screen.
  const beforeOpen = report.stack.recap;
  const chevron = () =>
    page.evaluate(() => document.querySelector('.death-recap-close i')?.className ?? '');
  report.chevronClosed = await chevron();
  await page.evaluate(() => {
    const title = document.querySelector('.death-recap-title');
    title.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    title.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    title.click();
  });
  await page.waitForTimeout(400);
  report.opened = await page.evaluate(() => {
    const r = document.querySelector('.death-recap').getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
  });
  await page.screenshot({ path: `${OUT}-06b-recap-open.png` });
  check(
    'opening it grows upward, not downward',
    report.opened.top < beforeOpen.top && Math.abs(report.opened.bottom - beforeOpen.bottom) <= 2,
    `top ${beforeOpen.top}→${report.opened.top}, bottom ${beforeOpen.bottom}→${report.opened.bottom}`
  );
  // Read while it is still open — the second death below shuts it again.
  report.chevronOpen = await chevron();

  // Opening is for *this* death and no other. The component is never remounted
  // between deaths — `deathRecap` outlives a respawn — so a panel left open
  // would still be open on the next one, which is the answer arriving by itself
  // rather than being asked for.
  const wasOpen = await page.evaluate(
    () => !document.querySelector('.death-recap').classList.contains('collapsed')
  );

  // Nothing a thumb is already on its way to may move on its own. The
  // countdown and the ally control go at respawn, and they used to share the
  // headline's line with the two buttons — so both buttons slid left into the
  // space, and the bar being `width: auto` and centred re-centred underneath
  // them as well. What a player pressed was whatever had just taken the place
  // of the thing they aimed at.
  //
  // They are on the line *above* now, and the panel grows upward from the
  // bottom edge, so the line the buttons are on is the last one and keeps its
  // distance from that edge whatever goes from above it.
  const barGeometry = () =>
    page.evaluate(() => {
      const panel = document.querySelector('.death-recap');
      const box = panel.getBoundingClientRect();
      return {
        panel: [Math.round(box.left), Math.round(box.right)],
        buttons: [...panel.querySelectorAll('.death-recap-close')].map(button => {
          const r = button.getBoundingClientRect();
          return [Math.round(r.left), Math.round(r.top)];
        }),
      };
    });
  report.barWhileDead = await barGeometry();
  // The *real* respawn, not a forced one: setting `isDead` by hand skips the
  // transition in `die()` that bumps `deathRecap.seq`, so the second death
  // would never look like a new one. Found by this check reporting a pass it
  // had not earned.
  await page.waitForFunction(() => !window.__moba2d.scene.oScene.game.player.isDead, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(300);
  report.barWhenAlive = await barGeometry();
  check(
    'nothing on the recap bar moves when the countdown goes at respawn',
    JSON.stringify(report.barWhileDead) === JSON.stringify(report.barWhenAlive),
    `${JSON.stringify(report.barWhileDead)} → ${JSON.stringify(report.barWhenAlive)}`
  );
  await page.evaluate(() => {
    const game = window.__moba2d.scene.oScene.game;
    const player = game.player;
    const enemies = game.objectManager.objects.filter(
      o => o.killCredit === 'champion' && o.teamId !== player.teamId && o !== player
    );
    player.takeDamage(90, enemies[1] ?? enemies[0], 'MAGICAL', 'Chiêu Q');
    player.takeDamage(10_000, enemies[0], 'PHYSICAL', 'Đòn kết liễu');
  });
  await page.waitForTimeout(600);
  report.reopened = await page.evaluate(() => {
    const panel = document.querySelector('.death-recap');
    return {
      seq: window.__moba2d.scene.oScene.game.player.deathRecap?.seq ?? null,
      collapsedAgain: panel?.classList.contains('collapsed') ?? null,
    };
  });
  report.reopened.wasOpen = wasOpen;
  check(
    'a later death opens shut, whatever the last one was left as',
    report.reopened.wasOpen === true &&
      report.reopened.seq > 1 &&
      report.reopened.collapsedAgain === true,
    `left ${report.reopened.wasOpen ? 'open' : 'shut'}, death ${report.reopened.seq} came back ${report.reopened.collapsedAgain ? 'shut' : 'open'}`
  );

  // The arrow points the way the panel moves. It pointed the other way while
  // this sat at the top of the screen and grew downward.
  check(
    'the arrow points the way it will move',
    report.chevronClosed.includes('fa-chevron-up') &&
      report.chevronOpen.includes('fa-chevron-down'),
    `closed "${report.chevronClosed}", open "${report.chevronOpen}"`
  );
  // The banner said "Bạn đã bị hạ / bởi X" over a recap headed "Hạ gục bởi X".
  check('no death banner behind the recap', report.stack.banners === 0);

  // ---------------------------------- 7. a turret falling is news, quietly

  await page.waitForTimeout(7_000);
  report.turret = await page.evaluate(() => {
    const game = window.__moba2d.scene.oScene.game;
    const player = game.player;
    const turret = game.objectManager.objects.find(
      o => o.announceAs === 'turret' && o.teamId !== player.teamId
    );
    if (!turret) return null;
    game.eventManager.emit('onUnitDie', {
      unit: turret,
      killer: player,
      credit: turret.killCredit,
    });
    return turret.name;
  });
  await page.waitForTimeout(500);
  report.turretRow = await page.evaluate(() => {
    const row = document.querySelector('.kill-feed-row');
    return {
      objectiveFaces: document.querySelectorAll('.kill-feed-face.objective').length,
      text: row?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      banners: document.querySelectorAll('.kill-banner').length,
      badges: row?.querySelectorAll('.kill-feed-badge').length ?? -1,
    };
  });
  await page.screenshot({ path: `${OUT}-07-turret.png` });

  // `Turret` declares `announceAs`, so this is the real wiring and not a
  // stand-in: the announcer never imports the class.
  check(
    'a turret makes a feed row',
    report.turret !== null && report.turretRow.objectiveFaces === 1
  );
  check('the turret row names it', (report.turretRow.text ?? '').includes('Trụ'));
  // A dozen turrets a match: a banner each would land on a Penta as often as not.
  check('a turret does not take the centre of the screen', report.turretRow.banners === 0);
  // And it is nobody's multi-kill.
  check('a turret earns no kill badge', report.turretRow.badges === 0);

  // The row clips to `max-width` in both directions, so a line box ending on
  // the baseline eats the dot under the ụ. Every name here can carry one.
  report.diacritic = await page.evaluate(() => {
    const row = document.querySelector('.kill-feed-row');
    const name = [...row.querySelectorAll('.kill-feed-name')].at(-1);
    if (!name) return null;
    const r = row.getBoundingClientRect();
    return { text: name.textContent.trim(), room: r.bottom - name.getBoundingClientRect().bottom };
  });
  check(
    'a Vietnamese descender is not clipped by the row',
    (report.diacritic?.text ?? '') === 'Trụ' && report.diacritic.room >= 4,
    `"${report.diacritic?.text}", ${report.diacritic?.room.toFixed(1)}px below the text`
  );

  // ------------------------- 8. the banner grows with the run, and then stops

  await page.waitForTimeout(11_000);
  report.tiers = [];
  for (let i = 1; i <= 8; i++) {
    await killOne(page);
    await page.waitForTimeout(400);
    report.tiers.push(
      await page.evaluate(() => {
        const b = document.querySelector('.kill-banner');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return {
          title: b.querySelector('.kill-banner-title')?.textContent.trim(),
          size: Math.round(
            parseFloat(getComputedStyle(b.querySelector('.kill-banner-title')).fontSize)
          ),
          height: Math.round(r.height),
          reachesPct: Math.round((r.bottom / innerHeight) * 100),
        };
      })
    );
    if (i === 6) await page.screenshot({ path: `${OUT}-08-hexa.png` });
  }
  await page.screenshot({ path: `${OUT}-09-legendary.png` });

  const titles = report.tiers.map(t => t?.title);
  check(
    'the words run past Penta',
    titles.includes('Hexa Kill') && titles.includes('Legendary Kill'),
    titles.join(' | ')
  );
  const sizes = report.tiers.map(t => t?.size ?? 0);
  check(
    'the banner grows with the run',
    sizes[4] > sizes[1] && sizes[5] > sizes[4],
    sizes.join(' → ')
  );
  // It stops where the words stop: a run of eight is the same sentence as
  // seven, so it must not keep swelling off the top of the screen.
  check('and stops growing where the words do', sizes[7] === sizes[6], sizes.slice(5).join(' → '));

  // The banner is absolute inside a column only as wide as the widest callout,
  // so a long title wrapped rather than overflowing it: "Legendary Kill" at
  // 40px went to two lines, 111px tall, and reached 49% down a 390px phone. A
  // wrap doubles the height, so a height that never jumps is what proves the
  // line held.
  const heights = report.tiers.map(t => t?.height ?? 0);
  check(
    'no tier wraps onto a second line',
    heights.every((h, i) => i === 0 || h < heights[i - 1] * 1.5),
    heights.join(' → ')
  );
  check(
    'the loudest banner still leaves the fight visible',
    Math.max(...report.tiers.map(t => t?.reachesPct ?? 0)) <= 40,
    report.tiers.map(t => `${t?.reachesPct}%`).join(' ')
  );

  // ------------- 9. the desktop layout, where the panel is not the bottom bar
  //
  // The countdown and the ally control were added to the recap header for the
  // phone, where the collapsed panel *is* the revive pill. A desktop keeps
  // `SpectateBar` at the bottom edge and the panel up at `top: 12%`, so an
  // unscoped header row put two copies of the same second on one screen —
  // which is what this catches, on the only layout that can see it.

  // A second context off the harness's own browser — not a second browser, and
  // not a second server: `tests/scripts/e2eHarness.test.ts` is what holds that
  // line, and this borrows what the harness already started. A context rather
  // than a page because `body.touch-ui` is decided at boot from `?touch=1`, so
  // the desktop layout needs its own load with that flag off.
  const desktopContext = await page
    .context()
    .browser()
    .newContext({
      viewport: { width: 1280, height: 900 },
    });
  const desktop = await desktopContext.newPage();
  await desktop.goto(url.replace(/\?touch=1$/, ''), { waitUntil: 'load' });
  await startMatch(desktop);
  await desktop.waitForFunction(() => window.__moba2d?.scene?.oScene?.game?.player, null, {
    timeout: 30_000,
  });
  await desktop.waitForTimeout(1_500);
  // Every attacker, every named source: a real teamfight death, and the case
  // the old cap could not show — thirty-six lines wanting 962px of panel.
  await desktop.evaluate(() => {
    const game = window.__moba2d.scene.oScene.game;
    const player = game.player;
    const enemies = game.objectManager.objects.filter(
      o => o.killCredit === 'champion' && o.teamId !== player.teamId && o !== player
    );
    const sources = [
      'Đòn đánh',
      'Chiêu Q',
      'Chiêu W',
      'Chiêu E',
      'Chiêu R',
      'Thiêu đốt',
      'Trúng độc',
    ];
    for (const enemy of enemies)
      for (const source of sources) {
        player.takeDamage(6, enemy, 'PHYSICAL', source);
      }
    player.takeDamage(10_000, enemies[0], 'PHYSICAL', 'Đòn kết liễu');
  });
  await desktop.waitForTimeout(700);

  report.desktop = await desktop.evaluate(() => {
    const shown = sel => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display !== 'none' : false;
    };
    const rect = sel => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    const recap = rect('.death-recap');
    return {
      vh: innerHeight,
      touchUi: document.body.classList.contains('touch-ui'),
      recapCountdown: shown('.death-recap-revive'),
      spectateBar: shown('.spectate-bar'),
      recapTop: Math.round(recap?.top ?? -1),
      recapBottom: Math.round(recap?.bottom ?? -1),
      calloutsBottom: Math.round(rect('.kill-callouts')?.bottom ?? 0),
      bottomHudTop: Math.round(rect('.bottom-HUD')?.top ?? innerHeight),
    };
  });
  await desktop.screenshot({ path: `${OUT}-09-desktop.png` });
  const desktop2 = desktop;

  check('the desktop layout is not the touch one', report.desktop.touchUi === false);
  // Exactly one countdown on the screen. It is the panel's, on both layouts,
  // and `SpectateBar` stands down — for a revision only the phone had been
  // moved and a desktop drew the same second twice.
  check(
    'the countdown is shown exactly once on a desktop',
    report.desktop.recapCountdown === true && report.desktop.spectateBar === false
  );
  // The desktop panel is a bottom bar too now: above the ability row, not
  // across the middle of the screen.
  check(
    'the desktop recap sits low, clear of the ability row',
    report.desktop.recapBottom <= report.desktop.bottomHudTop &&
      report.desktop.recapTop > report.desktop.vh * 0.4,
    `recap ${report.desktop.recapTop}–${report.desktop.recapBottom}, ability row at ${report.desktop.bottomHudTop}`
  );
  check(
    'and clears the kill feed above it',
    report.desktop.recapTop >= report.desktop.calloutsBottom,
    `callouts end ${report.desktop.calloutsBottom}, recap starts ${report.desktop.recapTop}`
  );

  // Opened, it wins the screen. It stopped at the kill feed's floor before,
  // which left a desktop 541px against content that wanted 962 — five
  // attackers and thirty-six source lines, more than half behind a scrollbar.
  const desktopClosed = { ...report.desktop };
  await desktop2.evaluate(() => document.querySelector('.death-recap-title').click());
  await desktop2.waitForTimeout(400);
  report.desktopOpen = await desktop2.evaluate(() => {
    const r = document.querySelector('.death-recap').getBoundingClientRect();
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      maxHeight: getComputedStyle(document.querySelector('.death-recap')).maxHeight,
      topPct: Math.round((r.top / innerHeight) * 100),
      lines: document.querySelectorAll('.death-recap-source').length,
      reachPct: Math.round(
        ((r.bottom -
          parseFloat(getComputedStyle(document.querySelector('.death-recap')).maxHeight)) /
          innerHeight) *
          100
      ),
    };
  });
  await desktop2.screenshot({ path: `${OUT}-10-desktop-open.png` });

  // The cap, not the content: how far the panel *may* reach is the contract,
  // and how far it does reach on any one death is a damage log. Anchored at the
  // bottom, the highest its top edge can go is `bottom - max-height`.
  check(
    'the desktop cap lets it reach a tenth of the top edge',
    report.desktopOpen.reachPct <= 12,
    `may reach ${report.desktopOpen.reachPct}% (max-height ${report.desktopOpen.maxHeight}), drew ${report.desktopOpen.lines} source lines at ${report.desktopOpen.topPct}%`
  );
  check(
    'and grows upward there too',
    report.desktopOpen.top < desktopClosed.recapTop &&
      Math.abs(report.desktopOpen.bottom - desktopClosed.recapBottom) <= 2,
    `top ${desktopClosed.recapTop}→${report.desktopOpen.top}, bottom ${desktopClosed.recapBottom}→${report.desktopOpen.bottom}`
  );
  await desktopContext.close();
});
