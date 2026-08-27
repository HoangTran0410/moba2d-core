/**
 * Two browsers, one match: the LAN prototype driven end to end.
 *
 * Boots the relay (`scripts/net-relay.mjs`, the one extra process a LAN
 * match needs), then the harness's own server and browser; opens a hosting
 * page and a joining page in separate contexts, lets the match run, and
 * measures — the way `drive-bot-discipline.mjs` measures a posture rather
 * than screenshotting it:
 *
 *   - cross-page position error, sampled repeatedly over the run: for every
 *     unit id both sessions know, the distance between the host's truth and
 *     the client's interpolated copy. The median must sit under 50 world
 *     units — interpolation renders ~1 snapshot interval (66ms) behind, so
 *     a walking champion (~200 units/s) legitimately trails by ~15;
 *   - the client's orders landing on the host: a right-click march order
 *     must move the host-side remote champion, and a Q press must put a
 *     host-side spell of that champion on cooldown;
 *   - stream liveness: snapshots received, events applied, zero page errors
 *     on either page.
 *
 * The relay is a `spawn`, not a `createServer` — the harness rule
 * (`tests/scripts/e2eHarness.test.ts`) is about not booting a second Vite
 * or browser, and both of those still come from the harness.
 *
 * Known flake, not worth chasing (CLAUDE.md's own category): the WS leg's
 * "remote cast commits under 150ms" occasionally reports 0.5-4s on a loaded
 * machine — three-plus pages in one headless browser starve the host page's
 * event loop. It has never reproduced twice in a row, and the RTC leg's
 * identical measurement stays at 2-4ms in the same runs; re-run before
 * believing it.
 */
import { spawn } from 'node:child_process';
import { startHarness } from './harness.mjs';

const RELAY_PORT = 8790 + Math.floor(Math.random() * 500);

const relay = spawn('node', ['scripts/net-relay.mjs', String(RELAY_PORT)], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('relay never came up')), 10_000);
  relay.stdout.on('data', chunk => {
    if (chunk.toString().includes('listening')) {
      clearTimeout(timer);
      resolve();
    }
  });
});
process.on('exit', () => relay.kill());

const { url, page, report, check, guard, openPage } = await startHarness();

const withParams = (mode, transport, room) =>
  `${url}${url.includes('?') ? '&' : '?'}net=${mode}&transport=${transport}` +
  `&signal=ws://localhost:${RELAY_PORT}&room=${room}`;

await guard(async () => {
  // ------------------------------------------------------------- the host
  await page.goto(withParams('host', 'ws', 'e2e'), { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForFunction(() => window.__lol2dNet, null, { timeout: 15_000 });

  // ------------------------------------------------------------ the client
  const { context: clientContext, page: clientPage } = await openPage({ label: 'client' });
  await clientPage.goto(withParams('join', 'ws', 'e2e'), { waitUntil: 'load' });
  await clientPage.click('#play-btn');
  await clientPage.waitForFunction(() => window.__lol2dNet, null, { timeout: 30_000 });
  await clientPage.waitForTimeout(2_000);

  // ------------------------------------------------- position error probe
  const errors = [];
  const unitCounts = [];
  for (let sample = 0; sample < 24; sample++) {
    const [hostPositions, clientPositions] = await Promise.all([
      page.evaluate(() => window.__lol2dNet.debugPositions()),
      clientPage.evaluate(() => window.__lol2dNet.debugPositions()),
    ]);
    const shared = Object.keys(hostPositions).filter(id => clientPositions[id]);
    unitCounts.push(shared.length);
    for (const id of shared) {
      const [hx, hy] = hostPositions[id];
      const [cx, cy] = clientPositions[id];
      errors.push(Math.hypot(hx - cx, hy - cy));
    }
    await clientPage.waitForTimeout(500);
  }
  errors.sort((a, b) => a - b);
  const median = errors[Math.floor(errors.length / 2)] ?? Infinity;
  const p95 = errors[Math.floor(errors.length * 0.95)] ?? Infinity;
  report.sharedUnitsPerSample = Math.round(
    unitCounts.reduce((a, b) => a + b, 0) / unitCounts.length
  );
  report.positionSamples = errors.length;
  report.medianErrorUnits = Math.round(median * 10) / 10;
  report.p95ErrorUnits = Math.round(p95 * 10) / 10;
  check(
    'client tracks the host roster',
    report.sharedUnitsPerSample >= 8,
    `${report.sharedUnitsPerSample} shared units`
  );
  check('median position error < 50 units', median < 50, `${report.medianErrorUnits}`);

  // ------------------------------------------------- latency measurements
  // One act measures both numbers: arm the host-side watcher, then the
  // client presses its slots in order until one commits locally (a random
  // kit can hold UNIT-targeted spells that refuse when every enemy is
  // across the map — a refusal says nothing about latency). Own latency is
  // keypress to local state change; remote latency is the same press's
  // commit appearing on the host. Runs before any marching, at the spawn,
  // where the champion cannot already be dead.
  const ownCastProbe = `new Promise(resolve => {
    const game = window.__lol2d.scene.oScene.game;
    const enemies = game.objectManager.objects.filter(
      o => o.constructor?.name?.includes('Champion') && o.teamId !== game.player.teamId && !o.isDead
    );
    const target = enemies[0] ?? game.player;
    game.worldMouse.set(target.position.x, target.position.y);
    const slots = [
      [87, 2],
      [81, 1],
      [69, 3],
      [82, 4],
    ]; // W, Q, E, R
    const tryNext = () => {
      const next = slots.shift();
      if (!next) {
        resolve({ latencyMs: -1, stamp: Date.now() });
        return;
      }
      const [keyCode, slot] = next;
      const spell = game.player.spells[slot];
      const t0 = Date.now();
      game.spellInputController.keyDown(keyCode, false);
      game.spellInputController.keyUp(keyCode);
      const timer = setInterval(() => {
        if (spell.currentCooldown > 0 || spell.state !== 'READY') {
          clearInterval(timer);
          resolve({ latencyMs: Date.now() - t0, stamp: t0 });
        } else if (Date.now() - t0 > 700) {
          clearInterval(timer);
          tryNext();
        }
      }, 2);
    };
    tryNext();
  })`;
  const hostStampProbe = `new Promise(resolve => {
    const session = window.__lol2dNet;
    const armedAt = Date.now();
    const timer = setInterval(() => {
      const remote = session.debugRemote();
      if (remote && remote.cooldowns.slice(1, 5).some(cd => cd > 0)) {
        clearInterval(timer);
        resolve(Date.now());
      } else if (Date.now() - armedAt > 8000) {
        clearInterval(timer);
        resolve(-1);
      }
    }, 2);
  })`;

  const hostStampPromise = page.evaluate(hostStampProbe);
  const ownCast = await clientPage.evaluate(ownCastProbe);
  const hostCommitStamp = await hostStampPromise;
  report.ownCastLatencyMs = ownCast.latencyMs;
  report.remoteCommitLatencyMs = hostCommitStamp > 0 ? hostCommitStamp - ownCast.stamp : -1;
  check(
    'own cast visible under 50ms',
    ownCast.latencyMs >= 0 && ownCast.latencyMs < 50,
    `${ownCast.latencyMs}ms`
  );
  check(
    'remote cast commits under 150ms',
    report.remoteCommitLatencyMs >= 0 && report.remoteCommitLatencyMs < 150,
    `${report.remoteCommitLatencyMs}ms`
  );

  // ------------------------------------------------ client orders -> host
  const before = await page.evaluate(() => window.__lol2dNet.debugRemote());
  check('host spawned a champion for the client', !!before, JSON.stringify(before));

  // A right-click march, held so the tick loop sees it, far from the spawn.
  const viewport = clientPage.viewportSize();
  await clientPage.mouse.move(viewport.width * 0.72, viewport.height * 0.3);
  await clientPage.mouse.down({ button: 'right' });
  await clientPage.waitForTimeout(350);
  await clientPage.mouse.up({ button: 'right' });
  await clientPage.waitForTimeout(2_500);

  const afterMove = await page.evaluate(() => window.__lol2dNet.debugRemote());
  const marched =
    before && afterMove ? Math.hypot(afterMove.x - before.x, afterMove.y - before.y) : 0;
  report.remoteMarchUnits = Math.round(marched);
  check(
    'client right-click marches the host champion',
    marched > 100,
    `${report.remoteMarchUnits} units`
  );

  // The latency probe above already pressed until a cast committed; the
  // host's cooldown row *at that moment* (`before`, read right after the
  // probe) is that commit's receipt. Deliberately not a fresh read here —
  // the march above burns ~3s, and a champion rolled with a short-cooldown
  // spell (Leblanc W, 1s) has ticked back to zero by now, which is a fact
  // about the roll, not about the wire.
  const onCooldown = (before?.cooldowns ?? []).filter(
    (cd, slot) => slot >= 1 && slot <= 4 && cd > 0
  );
  report.remoteCooldowns = before?.cooldowns?.map(Math.round);
  check(
    'a client cast commits on the host',
    onCooldown.length > 0,
    JSON.stringify(report.remoteCooldowns)
  );

  // ----------------------------------------- the panel must not pause (§)
  // Opening the in-game config panel used to `pause()` — on a client that
  // froze its own view while the host match played on, and the player came
  // back dead. `Game.pause()` now refuses while a net session is attached;
  // the snapshots continuing to arrive is the proof the sim never stopped.
  const pauseProbe = await clientPage.evaluate(
    () =>
      new Promise(resolve => {
        const game = window.__lol2d.scene.oScene.game;
        const snapsBefore = game.net.debugStats.snapshotsReceived;
        game.inGameHUD.vueInstance.hud.openSpellPicker();
        setTimeout(() => {
          const snapsDuring = game.net.debugStats.snapshotsReceived - snapsBefore;
          const paused = game.paused;
          game.inGameHUD.vueInstance.hud.closeSpellPicker();
          resolve({ paused, snapsDuring });
        }, 700);
      })
  );
  report.pauseProbe = pauseProbe;
  check(
    'config panel does not pause a net client',
    pauseProbe.paused === false && pauseProbe.snapsDuring > 10,
    JSON.stringify(pauseProbe)
  );

  // --------------------------------- the editor opens on the client's kit
  // `loadoutOf(player)` used to be seeded from this device's stored
  // pregameConfig — and two tabs on one machine share localStorage, which
  // the host tab persists its own loadout into on every panel mutation: the
  // client's đổi-tướng modal opened showing the *host's* kit. The seed now
  // comes from the hello plan, so resolving it must reproduce the exact
  // classes the client is standing there holding.
  const seededLoadout = await clientPage.evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    const loadout = game.director.loadoutOf(game.player);
    const { getChampionPresetFromLoadout } = await import('/src/game/preset.ts');
    const preset = getChampionPresetFromLoadout(loadout);
    return {
      mode: loadout.mode,
      championName: loadout.championName,
      matches:
        preset.spells.map(cls => cls.name).join() ===
        game.player.spells.map(spell => spell.constructor.name).join(),
    };
  });
  report.seededLoadout = seededLoadout;
  check(
    "the client's editor opens on its own hello kit",
    seededLoadout.matches,
    JSON.stringify(seededLoadout)
  );

  // -------------------------------------------- đổi tướng crosses the wire
  // The client re-rolls its own champion through the same director the panel
  // uses. The host must end up running the *same* classes — before this wire
  // existed the change lived only on the client's screen and the two ends
  // fought the rest of the match with two different kits.
  const clientKit = await clientPage.evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    const kitOf = () => game.player.spells.map(spell => spell.constructor.name);
    const before = kitOf().join();
    const current = game.director.loadoutOf(game.player);
    // All-random custom slots, re-rolled until the kit *actually differs* —
    // a roll that lands back on the same classes would let a broken wire
    // pass vacuously (guaranteed in a checkout whose only pack has one
    // champion, where `championName: 'random'` can only ever re-pick it).
    for (let attempt = 0; attempt < 5 && kitOf().join() === before; attempt++) {
      await game.director.applyLoadoutLoaded(game.player, {
        ...current,
        mode: 'custom',
        customSlots: ['random', 'random', 'random', 'random', 'random', 'random', 'random'],
      });
    }
    return {
      name: game.player.name,
      kit: kitOf(),
      changed: kitOf().join() !== before,
    };
  });
  // Wire + the host fetching spell chunks it may never have seen.
  await page.waitForFunction(
    expected => {
      const remote = window.__lol2dNet.debugRemote();
      return remote && remote.name === expected.name && remote.kit.join() === expected.kit.join();
    },
    clientKit,
    { timeout: 15_000 }
  ).catch(() => null);
  const hostKitView = await page.evaluate(() => {
    const remote = window.__lol2dNet.debugRemote();
    return remote ? { name: remote.name, kit: remote.kit } : null;
  });
  report.loadoutSync = { client: clientKit, host: hostKitView };
  check(
    'a client kit change reaches the host, class for class',
    clientKit.changed &&
      !!hostKitView &&
      hostKitView.name === clientKit.name &&
      hostKitView.kit.join() === clientKit.kit.join(),
    JSON.stringify(report.loadoutSync)
  );

  // -------------------------------------------- đổi phe crosses the wire
  // Hostility is computed independently at both ends, so an unsynced side
  // switch is the worst kind of desync: the client "fights" people its own
  // host copy is allied to, and nobody loses health.
  const teamSwitch = await clientPage.evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    const { MatchTeam } = await import('/src/game/config/MatchTeams.ts');
    const next = game.player.teamId === MatchTeam.BLUE ? MatchTeam.RED : MatchTeam.BLUE;
    game.director.setTeam(game.player, next);
    return { local: game.player.teamId };
  });
  await page
    .waitForFunction(
      expected => window.__lol2dNet.debugRemote()?.team === expected.local,
      teamSwitch,
      { timeout: 5_000 }
    )
    .catch(() => null);
  const hostTeamView = await page.evaluate(() => window.__lol2dNet.debugRemote()?.team);
  report.teamSwitch = { client: teamSwitch.local, host: hostTeamView };
  check(
    "a client side switch reaches the host",
    hostTeamView === teamSwitch.local,
    JSON.stringify(report.teamSwitch)
  );

  // ------------------------------------------- minimap teleport, by wire
  // The one wire-only intercept: a locally-jumped body would be snapped
  // straight back by reconciliation (the reported bug), so the client only
  // asks and the jump comes back in a snapshot.
  const tpTarget = { x: 2000, y: 2000 };
  await clientPage.evaluate(target => {
    window.__lol2d.scene.oScene.game.net.interceptTeleport(target);
  }, tpTarget);
  await clientPage
    .waitForFunction(
      target => {
        const game = window.__lol2d.scene.oScene.game;
        return Math.hypot(game.player.position.x - target.x, game.player.position.y - target.y) < 400;
      },
      tpTarget,
      { timeout: 5_000 }
    )
    .catch(() => null);
  const tpAfter = await clientPage.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    return { x: Math.round(game.player.position.x), y: Math.round(game.player.position.y) };
  });
  const tpMiss = Math.hypot(tpAfter.x - tpTarget.x, tpAfter.y - tpTarget.y);
  report.teleport = { ...tpAfter, miss: Math.round(tpMiss) };
  // 400 units of slack: `teleportTo` ignores terrain and the map pushes the
  // body out of any wall it landed in.
  check('minimap teleport crosses the wire', tpMiss < 400, JSON.stringify(report.teleport));

  // --------------------------------------- a host-added bot, kit and all
  // The Đội tab's addBot mid-match. The client must not only *see* it (the
  // discover diff always sent the spawn) but run its real classes — its
  // chunks may never have been fetched there, and `presetFromPlan` would
  // silently degrade every slot to a basic attack.
  const hostBot = await page.evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    const bot = await game.director.addBotLoaded({
      mode: 'champion',
      championName: 'random',
      summonerD: 'Flash',
      summonerF: 'Heal',
      customSlots: [],
    });
    return bot
      ? { name: bot.name, kit: bot.spells.map(spell => spell.constructor.name) }
      : null;
  });
  await clientPage
    .waitForFunction(
      expected => {
        for (const unit of window.__lol2dNet.units.values()) {
          if (
            unit.name === expected.name &&
            unit.spells &&
            unit.spells.map(spell => spell.constructor.name).join() === expected.kit.join()
          ) {
            return true;
          }
        }
        return false;
      },
      hostBot,
      { timeout: 15_000 }
    )
    .catch(() => null);
  const clientSeesBot = await clientPage.evaluate(expected => {
    for (const unit of window.__lol2dNet.units.values()) {
      if (unit.name === expected.name) {
        return { name: unit.name, kit: unit.spells?.map(spell => spell.constructor.name) ?? [] };
      }
    }
    return null;
  }, hostBot);
  report.botSync = { host: hostBot, client: clientSeesBot };
  check(
    'a host-added bot reaches the client with its real kit',
    !!hostBot && !!clientSeesBot && clientSeesBot.kit.join() === hostBot.kit.join(),
    JSON.stringify(report.botSync)
  );

  // ------------------------------------------------- the Đội tab's rows
  // Both ends' rosters must know the net-borne champions the local director
  // does not own: the host lists its remote player, the client lists
  // everything remote (host player + both bots by now).
  const rosterCounts = await Promise.all([
    page.evaluate(() => window.__lol2d.scene.oScene.game.net.netRosterUnits().length),
    clientPage.evaluate(() => window.__lol2d.scene.oScene.game.net.netRosterUnits().length),
  ]);
  report.netRoster = { host: rosterCounts[0], client: rosterCounts[1] };
  check(
    'both rosters list the LAN champions',
    rosterCounts[0] === 1 && rosterCounts[1] >= 3,
    JSON.stringify(report.netRoster)
  );

  // --------------------------------------- the Đội tab itself, rendered
  // The seam count above is necessary and was not sufficient: the tab reads
  // `net` through the hudInteractions adapter (`MatchDirectorHost.net`), an
  // *optional* member a forgotten getter satisfies as `undefined` — which is
  // exactly what shipped. Only the rendered DOM proves the whole path.
  const rosterDom = await clientPage.evaluate(
    () =>
      new Promise(resolve => {
        const hud = window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud;
        hud.openRoster();
        setTimeout(() => {
          const text = document.body.innerText;
          hud.closeSpellPicker();
          resolve({ lan1: text.includes('LAN 1'), lan3: text.includes('LAN 3') });
        }, 600);
      })
  );
  report.rosterDom = rosterDom;
  check(
    "the client's Đội tab renders the LAN rows",
    rosterDom.lan1 && rosterDom.lan3,
    JSON.stringify(rosterDom)
  );

  // ------------------------------------- champion swings become visible
  // A champion's basic attack lives in `BasicAttackController`, which never
  // fires on an order-less puppet — so a host champion could beat a client
  // half to death with nothing on screen. The host walks over and attacks;
  // the client must see carrier objects (bolt or melee swing) appear.
  await page.evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    // An *enemy* of the host champion — the client's champion may well be an
    // ally (the joiner lands on the smaller team), and a right-click on an
    // ally is a walk, not a swing.
    const victim = game.director.bots().find(bot => bot.teamId !== game.player.teamId);
    game.player.teleportTo(victim.position.x + 150, victim.position.y);
    // The ordinary right-click seam: resolves the enemy, walks into reach,
    // swings on the interval — exactly what a real host player does.
    const { issuePointerOrder } = await import('/src/game/input/PointerOrders.ts');
    issuePointerOrder(game.player, game.objectManager, {
      x: victim.position.x,
      y: victim.position.y,
    });
  });
  const swingCount = await clientPage
    .waitForFunction(
      () => {
        const game = window.__lol2d.scene.oScene.game;
        let seen = 0;
        for (const object of game.objectManager.objects) {
          const kind = object.constructor?.name;
          if (
            (kind === 'BasicAttackBolt' || kind === 'BasicAttackSwing') &&
            object.owner !== game.player
          ) {
            seen++;
          }
        }
        return seen > 0 ? seen : false;
      },
      null,
      { timeout: 10_000 }
    )
    .then(handle => handle.jsonValue())
    .catch(() => 0);
  report.remoteSwings = swingCount;
  check("a host champion's swings are visible on the client", swingCount > 0, `${swingCount}`);

  // ----------------------------------------------- exactly one pet each
  // A summon exists once per world: the host's pet crosses as a sized spawn
  // event, and a client's locally-played summon is refused at `addObject` —
  // the pair of bugs was one real-looking local ghost the host knew nothing
  // about beside an avatar-less default-sized puppet.
  const rosterBeforePet = await clientPage.evaluate(
    () => window.__lol2d.scene.oScene.game.net.netRosterUnits().length
  );
  await page.evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    const { default: Pet } = await import('/src/game/gameObject/attackableUnits/Pet.ts');
    const summon = new Pet({
      game,
      position: createVector(game.player.position.x + 100, game.player.position.y),
      teamId: game.player.teamId,
      ownerUnit: game.player,
      lifeTimeMs: 60_000,
      preset: { name: 'Gấu Kiểm Thử' },
    });
    summon.stats.size.baseValue = 111;
    game.objectManager.addObject(summon);
  });
  const petView = await clientPage
    .waitForFunction(
      () => {
        const game = window.__lol2d.scene.oScene.game;
        const copies = [];
        for (const object of game.objectManager.objects) {
          if (object.name === 'Gấu Kiểm Thử') {
            copies.push({
              size: object.stats.size.baseValue,
              // A real Pet puppet, not a champion-framed stand-in — the pet
              // chrome (compact bar, life timer) is the class's own draw.
              kind: object.constructor.name,
              timerLive: typeof object.remainingMs === 'number' && object.remainingMs > 0,
            });
          }
        }
        return copies.length > 0 ? copies : false;
      },
      null,
      { timeout: 10_000 }
    )
    .then(handle => handle.jsonValue())
    .catch(() => []);
  const rosterAfterPet = await clientPage.evaluate(
    () => window.__lol2d.scene.oScene.game.net.netRosterUnits().length
  );
  report.petSync = { copies: petView, rosterBeforePet, rosterAfterPet };
  check(
    'a summoned pet stands exactly once on the client, as a real sized Pet, off the roster',
    petView.length === 1 &&
      petView[0].size === 111 &&
      petView[0].kind === 'Pet' &&
      petView[0].timerLive &&
      rosterAfterPet === rosterBeforePet,
    JSON.stringify(report.petSync)
  );

  // --------------------------------------- a pack summon keeps its body
  // The probe above covers the *fallback* (a core-Pet puppet for a summon
  // with no local twin). The real path is adoption: the cast replay spawns
  // the pack's own Pet subclass — its custom draw is why the client keeps
  // it — and the host's spawn event must claim that body, not build a
  // core-Pet lookalike beside it ("tibber phía client vẫn render dạng
  // champion").
  await clientPage.evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    await game.director.applyLoadoutLoaded(game.player, {
      mode: 'champion',
      championName: 'Annie',
      summonerD: 'Flash',
      summonerF: 'Heal',
      customSlots: [],
    });
  });
  // The host must be running Annie before the R lands there, or the cast
  // applies to the old kit's slot and no host summon ever exists.
  await page
    .waitForFunction(() => window.__lol2dNet.debugRemote()?.kit?.includes('Annie_R'), null, {
      timeout: 15_000,
    })
    .catch(() => null);
  await clientPage.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    game.worldMouse.set(game.player.position.x + 120, game.player.position.y);
    game.spellInputController.keyDown(82, false);
    game.spellInputController.keyUp(82);
  });
  const countSummons = () => {
    const game = window.__lol2d.scene.oScene.game;
    const descendsFromPet = object => {
      let ctor = object.constructor;
      while (ctor) {
        if (ctor.name === 'Pet') return true;
        ctor = Object.getPrototypeOf(ctor);
      }
      return false;
    };
    const summons = [];
    for (const object of game.objectManager.objects) {
      if (object.name !== 'Gấu Kiểm Thử' && !object.toRemove && descendsFromPet(object)) {
        summons.push({ kind: object.constructor.name, adopted: !!object.isNetPuppet });
      }
    }
    return summons;
  };
  // Filtered to the Tibbers class by name: a live match legitimately holds
  // other summons (a bot's voidlings were on this very probe's first run),
  // so "exactly one pet anywhere" was the wrong question — exactly one
  // *Tibbers*, adopted, is the right one.
  // "Adopted" is waited for, not asserted on first sight: the local body
  // legitimately exists a beat before the host's claiming event arrives.
  const adoptedPet = await clientPage
    .waitForFunction(
      body => {
        const bears = new Function(`return (${body})()`)().filter(s => s.kind === 'Tibbers');
        return bears.length > 0 && bears.every(bear => bear.adopted) ? bears : false;
      },
      `${countSummons.toString()}`,
      { timeout: 10_000 }
    )
    .then(handle => handle.jsonValue())
    .catch(() => []);
  // Past the adoption grace: a lingering unclaimed ghost or a late-built
  // lookalike would both show up as a second bear here.
  await clientPage.waitForTimeout(3_000);
  const lateBears = await clientPage.evaluate(
    body => new Function(`return (${body})()`)().filter(s => s.kind === 'Tibbers'),
    `${countSummons.toString()}`
  );
  report.petAdoption = { onCast: adoptedPet, afterGrace: lateBears };
  check(
    'a pack summon keeps its own subclass body, adopted, one only',
    adoptedPet.length === 1 && adoptedPet[0].adopted && lateBears.length === 1,
    JSON.stringify(report.petAdoption)
  );

  // -------------------------------------------------- death recap, told
  // A client's own `takeDamage` is gated, so its death ledger is empty by
  // construction — the recap must arrive from the host's sim or the death
  // screen has nothing to say (the reported bug).
  await page.evaluate(() => {
    const session = window.__lol2dNet;
    const champion = session.clients.values().next().value;
    champion.takeDamage(999_999, session.game?.player, 'PHYSICAL', 'Đòn kiểm thử');
  });
  const recap = await clientPage
    .waitForFunction(
      () => {
        const player = window.__lol2d.scene.oScene.game.player;
        return player.isDead && player.deathRecap && player.deathRecap.entries.length > 0
          ? {
              killer: player.deathRecap.killerName,
              entries: player.deathRecap.entries.length,
              amount: player.deathRecap.entries[0].amount,
            }
          : false;
      },
      null,
      { timeout: 8_000 }
    )
    .then(handle => handle.jsonValue())
    .catch(() => null);
  report.deathRecap = recap;
  check(
    "the client's death recap carries the host's ledger",
    !!recap && recap.entries > 0 && recap.amount > 0,
    JSON.stringify(recap)
  );

  // The same killing blow must also have floated a damage number on the
  // client — its own `takeDamage` is gated, so the count can only move if
  // the host's 'dmg' stream arrived and went through `CombatText.show`.
  // Minion skirmishes usually push this well past 1 by now; the kill above
  // guarantees at least the one.
  const damageTexts = await clientPage.evaluate(
    () => window.__lol2dNet.debugStats.damageTextsShown
  );
  report.damageTexts = damageTexts;
  check('damage numbers float on the client', damageTexts > 0, `${damageTexts} shown`);

  // ------------------------------------------------ blur must not freeze
  // The away-handler (blur/visibilitychange) used to suspend the runtime
  // unconditionally and open the panel; with `pause()` refusing in a net
  // match, closing that panel had no `unpause()` to resume through and the
  // scene froze for ever. Now a LAN match ignores the away-handler entirely:
  // frames keep coming, and no panel pops open uninvited.
  const blurProbe = await clientPage.evaluate(
    () =>
      new Promise(resolve => {
        const game = window.__lol2d.scene.oScene.game;
        const framesBefore = frameCount;
        const snapsBefore = game.net.debugStats.snapshotsReceived;
        window.dispatchEvent(new Event('blur'));
        setTimeout(() => {
          resolve({
            frames: frameCount - framesBefore,
            snaps: game.net.debugStats.snapshotsReceived - snapsBefore,
            panelOpened: game.inGameHUD.vueInstance.hud.showSpellsPicker,
            paused: game.paused,
          });
        }, 700);
      })
  );
  report.blurProbe = blurProbe;
  check(
    'a blurred client keeps rendering, panel stays shut',
    blurProbe.frames > 10 && blurProbe.snaps > 10 && !blurProbe.panelOpened && !blurProbe.paused,
    JSON.stringify(blurProbe)
  );

  // The host half matters more: a suspended host sim is everyone's match
  // frozen. Blur it and watch the snapshots keep arriving on the client.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const hostBlur = await clientPage.evaluate(
    () =>
      new Promise(resolve => {
        const game = window.__lol2d.scene.oScene.game;
        const snapsBefore = game.net.debugStats.snapshotsReceived;
        setTimeout(
          () => resolve({ snaps: game.net.debugStats.snapshotsReceived - snapsBefore }),
          700
        );
      })
  );
  report.hostBlur = hostBlur;
  check('a blurred host keeps serving snapshots', hostBlur.snaps > 10, JSON.stringify(hostBlur));

  // ------------------------------------------------------------ liveness
  const hostStats = await page.evaluate(() => window.__lol2dNet.debugStats);
  const clientStats = await clientPage.evaluate(() => window.__lol2dNet.debugStats);
  report.hostStats = hostStats;
  report.clientStats = clientStats;
  check(
    'snapshots flowed',
    clientStats.snapshotsReceived > 100,
    `${clientStats.snapshotsReceived}`
  );
  check('events flowed', clientStats.eventsApplied > 5, `${clientStats.eventsApplied}`);

  // The WS pages keep running as the RTC leg boots two more matches in the
  // same browser; closing the WS client trims one full game's CPU out of the
  // latency measurements below. It doubles as the leave test: the socket
  // drop must sweep the departed player's champion off the host ("thoát
  // phòng mà champ vẫn đứng chỗ cũ" was v1's deliberate cut, now closed).
  const departedName = clientKit.name;
  await clientContext.close();
  const swept = await page
    .waitForFunction(
      name => {
        if (window.__lol2dNet.debugRemote() !== null) return false;
        for (const object of window.__lol2d.scene.oScene.game.objectManager.objects) {
          if (object.name === name && !object.toRemove && !object.isDead) return false;
        }
        return true;
      },
      departedName,
      { timeout: 8_000 }
    )
    .then(() => true)
    .catch(() => false);
  report.leaveSwept = swept;
  check("a departed client's champion is swept from the host", swept, `${swept}`);

  // ================================================== the WebRTC leg
  // Same match shape, fresh pages, `transport=rtc`: the relay carries only
  // the SDP/ICE handshake and the game runs over peer-to-peer DataChannels
  // (reliable `r` + lossy `u`). Headless chromium negotiates loopback host
  // candidates between the two contexts, which is exactly the same-LAN path.
  const { page: rtcHost } = await openPage({ label: 'rtc-host' });
  await rtcHost.goto(withParams('host', 'rtc', 'e2ertc'), { waitUntil: 'load' });
  await rtcHost.click('#play-btn');
  await rtcHost.waitForFunction(() => window.__lol2dNet, null, { timeout: 30_000 });

  const { page: rtcClient } = await openPage({ label: 'rtc-client' });
  await rtcClient.goto(withParams('join', 'rtc', 'e2ertc'), { waitUntil: 'load' });
  await rtcClient.click('#play-btn');
  await rtcClient.waitForFunction(() => window.__lol2dNet, null, { timeout: 30_000 });
  await rtcClient.waitForTimeout(3_000);

  const rtcErrors = [];
  for (let sample = 0; sample < 8; sample++) {
    const [hostPositions, clientPositions] = await Promise.all([
      rtcHost.evaluate(() => window.__lol2dNet.debugPositions()),
      rtcClient.evaluate(() => window.__lol2dNet.debugPositions()),
    ]);
    for (const id of Object.keys(hostPositions).filter(each => clientPositions[each])) {
      const [hx, hy] = hostPositions[id];
      const [cx, cy] = clientPositions[id];
      rtcErrors.push(Math.hypot(hx - cx, hy - cy));
    }
    await rtcClient.waitForTimeout(400);
  }
  rtcErrors.sort((a, b) => a - b);
  report.rtcPositionSamples = rtcErrors.length;
  report.rtcMedianErrorUnits =
    Math.round((rtcErrors[Math.floor(rtcErrors.length / 2)] ?? Infinity) * 10) / 10;
  check('rtc: client tracks the host', rtcErrors.length > 100, `${rtcErrors.length} samples`);
  check(
    'rtc: median error < 50 units',
    report.rtcMedianErrorUnits < 50,
    `${report.rtcMedianErrorUnits}`
  );

  const rtcHostStamp = rtcHost.evaluate(hostStampProbe);
  const rtcOwnCast = await rtcClient.evaluate(ownCastProbe);
  const rtcHostCommit = await rtcHostStamp;
  report.rtcOwnCastLatencyMs = rtcOwnCast.latencyMs;
  report.rtcRemoteCommitLatencyMs = rtcHostCommit > 0 ? rtcHostCommit - rtcOwnCast.stamp : -1;
  check(
    'rtc: own cast under 50ms',
    rtcOwnCast.latencyMs >= 0 && rtcOwnCast.latencyMs < 50,
    `${rtcOwnCast.latencyMs}ms`
  );
  check(
    'rtc: remote cast commits under 150ms',
    report.rtcRemoteCommitLatencyMs >= 0 && report.rtcRemoteCommitLatencyMs < 150,
    `${report.rtcRemoteCommitLatencyMs}ms`
  );

  const rtcStats = await rtcClient.evaluate(() => window.__lol2dNet.debugStats);
  report.rtcClientStats = rtcStats;
  check(
    'rtc: snapshots flowed p2p',
    rtcStats.snapshotsReceived > 60,
    `${rtcStats.snapshotsReceived}`
  );
});
