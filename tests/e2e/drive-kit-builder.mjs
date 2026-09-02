/**
 * End-to-end drive of the rebuilt loadout editor and per-bot AI config on the
 * pregame setup screen. Boots its own Vite dev server, opens the game in
 * system Chrome through Playwright, and reaches the live scene through the
 * DEV-only `window.__moba2d` handle — same pattern as the other
 * tests/e2e/*.mjs scripts.
 *
 * The editor used to be a mode toggle ("Chọn Tướng" / "Tự Ghép Chiêu") over
 * two different editors, each of which drilled into a *third* view: a per-slot
 * catalogue you highlighted in and committed out of ("Dùng chiêu này"), one
 * slot at a time. All of that is gone. It is now one screen — seven slot pills
 * pinned above a grid of champion tiles, where tapping a tile opens that
 * champion in place and offers both answers at once: "Dùng cả bộ" for the whole
 * kit, or one of its abilities for the selected slot — with every pick held as a
 * *draft* until "Xác nhận" (see `LoadoutEditorModal.vue` and `KitRoster.vue`).
 * This script drives exactly that shape rather than the old drill-down.
 *
 * A compact/expanded toggle over the same roster came in between and is also
 * gone: it made the player choose up front between tiles that could not fill a
 * single slot and ~200 ability icons too dense to find a champion in. Section 8
 * is what used to check it and now checks the disclosure that replaced it.
 *
 * What it proves, in order:
 *   1. the roster exposes the *whole* spell catalogue in one scrolling list,
 *      including the standalone abilities (Olaf_Q, Graves_W) the old champion
 *      grid left out entirely, and offers a whole-kit action on every shelf
 *      that actually has a kit. Counted against `getPregameCatalog()` rather
 *      than against a literal — see `catalogShape` for why the literals that
 *      used to be here were both brittle and testing the wrong thing;
 *   2. picks are a draft: nothing reaches `localStorage` until "Xác nhận", and
 *      and the header's X discards it without a trace, both for a single
 *      ability and for a whole-kit pick;
 *   3. the *gesture* decides the mode, since there is no mode toggle left to
 *      ask: a shelf header is a champion pick; a real summoner spell dropped
 *      into D/F keeps champion mode; a single ability (or a non-summoner in
 *      D/F) turns the loadout custom with the champion's own kit expanded into
 *      the seven slots first; plus
 *      `.kit-slot-random`, the eighth control in the slot group, which leaves
 *      the *selected* slot to chance (disabled when that slot already is) and
 *      whose `'random'` really does resolve to a spell at spawn;
 *   4. hovering a card describes it — with this match's CDR already applied —
 *      without picking it and without opening a second dialog, and hovering a
 *      *slot pill* gives the same answer for the spell already in that slot,
 *      out of the same single panel, without selecting the slot;
 *   5. the player's card and a bot's card open the *same* modal, and the
 *      screen never has more than one dialog open at once (the full-viewport
 *      backdrop makes two loadout editors structurally impossible, which is
 *      the fix for the layout duplication this screen's redesign was asked
 *      for);
 *   6. a pre-existing v1 stored blob (no mode/customSlots/ai.bots) loads into
 *      the UI with every old field preserved and no error;
 *   7. a hand-built custom kit spawns exactly the chosen spells in exactly the
 *      chosen slots, and a per-bot champion assignment spawns that champion's
 *      real kit on that specific bot — both driven from a real match, not just
 *      read back from storage.
 *
 *   node tests/e2e/drive-kit-builder.mjs [outPrefix]
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/moba2d-kitbuilder';

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const port = server.config.server.port ?? server.httpServer.address().port;
const url = `http://localhost:${port}/`;

// `MOBA2D_CHROME_CHANNEL=` (empty) swaps system Chrome for Playwright's bundled
// Chromium, which is the only way this runs on a machine without Chrome
// installed. Same line the shared harness uses; this script keeps its own boot
// (it is not a harness importer), so it needs its own copy.
const channel = process.env.MOBA2D_CHROME_CHANNEL ?? 'chrome';
const browser = await chromium.launch(channel ? { channel } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

const report = {};
const evaluate = (fn, arg) => page.evaluate(fn, arg);
const CFG = 'moba2d:pregameConfig:v1';

/**
 * An id-shaped string, minus the pack that qualified it.
 *
 * This script names spells the way a person does — `Ahri_Q`, `BasicAttack`,
 * `Ghost` — and a *bundled* pack's ids look the same. An **installed** pack
 * qualifies everything it owns (`lol:Ahri_Q`), which is the form the DOM, the
 * stored config and the spawned kit all carry when the roster comes from a
 * linked pack. Comparing the two spellings failed every assertion in this file
 * that names a spell, and the failure said nothing about the feature: the
 * editor was storing exactly the right ability under exactly the right name for
 * where it came from.
 *
 * So the comparison drops the prefix on both sides. What this script is
 * actually asserting is *which spell*, never which registry spelled it — and a
 * drive that had to be rewritten for each is a drive that stops running the day
 * a pack is linked, which is how it stopped running.
 *
 * Narrow on purpose: `<lowercase pack>:<Identifier>` and nothing else, so a
 * label, a URL or a piece of Vietnamese carrying a colon is left alone.
 */
const ID_WITH_PACK = /^[a-z][a-z0-9_-]*:[A-Za-z][A-Za-z0-9_]*$/;
const unqualify = value => {
  if (typeof value === 'string') return ID_WITH_PACK.test(value) ? value.split(':')[1] : value;
  if (Array.isArray(value)) return value.map(unqualify);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unqualify(v)]));
  return value;
};

/** Records a mismatch instead of throwing, so one bad expectation doesn't hide the rest of the run. */
const expect = (label, actual, expected) => {
  if (JSON.stringify(unqualify(actual)) !== JSON.stringify(unqualify(expected))) {
    errors.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

/**
 * Opens the editor for the nth participant, 1-based, player first — the order
 * the old flat participant list had.
 *
 * Addressed through `#practice-row-toggle-N` rather than `:nth-child`, because
 * the roster is grouped into Đội Xanh and Đội Đỏ now and document order follows
 * the sides. That id carries the position in the *full* roster (0 is the
 * player), which is the thing this helper's argument actually means.
 */
/**
 * Chơi, and stop on the setup panel — this script's four entries into it.
 *
 * It was `page.click('#config-btn')`, and the menu's Cấu hình link is gone
 * (`MenuScene.ts`: Chơi opens the panel, configuring *is* the pregame step),
 * so all four sites were auto-waiting thirty seconds for an element that
 * cannot appear. `harness.mjs` exports `openSetup` for exactly this, but this
 * script boots its own server and browser on purpose and so is not a harness
 * importer — `tests/scripts/e2eHarness.test.ts` bans being half of one.
 *
 * Answers the no-roster nudge if it comes: a checkout of this repository
 * alone ships the one catalog that raises it (`MenuScene.vue`'s `pressPlay`).
 */
const openSetup = async () => {
  await page.waitForSelector('#play-btn', { state: 'visible', timeout: 30_000 });
  await page.click('#play-btn');
  await page.waitForSelector('#pregame-scene, #pack-nudge-play', { state: 'visible' });
  if (await page.$('#pack-nudge-play')) await page.click('#pack-nudge-play');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
};

const openParticipantAt = n =>
  page.click(`.practice-roster-main:has(#practice-row-toggle-${n - 1}) .practice-roster-open`);
/**
 * The way out without committing. There used to be two — a "Huỷ" button in the
 * slot bar and this X — and the script drove each once. The button is gone
 * (see `LoadoutEditorModal.vue`), so both discard cases now go through the X,
 * which is the same `cancel` handler the button called. The backdrop is a
 * third path and is deliberately still untested: it is one `@click.self`.
 */
const dismissLoadoutModal = async () => {
  await page.click('.loadout-modal .pregame-modal-header .pregame-icon-btn');
  try {
    const discardBtn = await page.waitForSelector('.kit-unsaved-discard', {
      state: 'visible',
      timeout: 150,
    });
    if (discardBtn) await discardBtn.click();
  } catch {
    // No unsaved changes dialog if draft was not changed
  }
};
const cancelLoadout = dismissLoadoutModal;
/** The one `.kit-bar-btn` left, and `:not(.secondary)` is what says so. */
const confirmLoadout = () => page.click('.kit-bar-btn:not(.secondary)'); // Xác nhận
/**
 * Which slot the next roster tap fills. 0 = A, 1 = Q, ... 5 = D, 6 = F.
 * `.kit-slot-random` shares the `.kit-slot-pill` class but is the *eighth*
 * child of the bar, so `:nth-child` still addresses only the seven slots —
 * anything that *counts* pills has to say `:not(.kit-slot-random)` though.
 */
const selectSlot = index => page.click(`.kit-slot-bar .kit-slot-pill:nth-child(${index + 1})`);
/** Opens a shelf's tile, or leaves it alone if it is already the open one. */
const openShelf = name =>
  evaluate(n => {
    const shelf = document.querySelector(`.kit-shelf[data-champion="${n}"]`);
    if (shelf && !shelf.classList.contains('open'))
      shelf.querySelector('.kit-shelf-apply')?.click();
  }, name);

/**
 * Taps one ability, opening the shelf that holds it first.
 *
 * That second step is the gesture now, not a workaround: the roster is a grid of
 * closed champion tiles and only the open shelf shows its abilities, so a
 * player reaching a single spell opens its champion on the way. The script used
 * to skip it by seeding the old `expanded` view into `localStorage` before the
 * page loaded, which drove a layout no default player ever saw.
 *
 * The owning shelf is found from the card rather than passed in, so a caller
 * still names only the spell it wants.
 */
/**
 * A catalogue id as the DOM spells it.
 *
 * This script names abilities bare (`Olaf_Q`) and an *installed* pack qualifies
 * them with its own registry prefix (`lol:Olaf_Q`), so a literal selector finds
 * nothing whenever the roster is served by a linked pack rather than a bundled
 * one. Resolved from what the shelves advertise, so either spelling works and
 * neither is written down twice.
 */
const spellId = bare =>
  evaluate(
    b =>
      [...document.querySelectorAll('.kit-shelf')]
        .flatMap(shelf => (shelf.dataset.spells || '').split(' '))
        .find(id => id === b || id.endsWith(`:${b}`)) ?? b,
    bare
  );

const pickSpell = async bare => {
  const id = await spellId(bare);
  await evaluate(s => {
    // `data-spells` rather than the card itself: a closed shelf renders no
    // cards any more (`KitRoster.vue` mounts them only for the open shelf),
    // so the attribute is what says which champion owns an ability.
    const shelf = document.querySelector(`.kit-shelf[data-spells~="${s}"]`);
    if (shelf && !shelf.classList.contains('open'))
      shelf.querySelector('.kit-shelf-apply')?.click();
  }, id);
  await page.click(`.catalog-spell-card[data-spell="${id}"]`);
};

/** Takes a whole shelf's kit: open the tile, then the Dùng cả bộ button inside it. */
const applyShelf = async name => {
  await openShelf(name);
  await page.click(`.kit-shelf[data-champion="${name}"] .kit-apply-all`);
};

const storedPlayer = () =>
  evaluate(k => JSON.parse(localStorage.getItem(k) ?? 'null')?.player ?? null, CFG);

/**
 * The roster's shape, read out of the catalogue the component itself renders
 * from — never restated as a literal here.
 *
 * This check used to hardcode 85 spells / 33 shelves / 31 whole-kit actions,
 * which meant every champion added to `SpellGroups` broke a script that was
 * not about `SpellGroups`. It went stale exactly that way: the real numbers
 * are 194 / 49 / 47 by the time anyone ran it again, and three failures said
 * nothing about the editor.
 *
 * Deriving is not the "a transform verifying itself" trap, because the claim
 * is not "the catalogue has N spells" — it is "the roster puts *every* shelf
 * and *every* entry the catalogue has on screen, and offers the whole-kit
 * action on exactly the shelves that have a kit". That is a statement about
 * rendering against a source, and the source is where it has to come from.
 * The hardcoded version was, if anything, testing the wrong thing.
 */
const catalogShape = () =>
  evaluate(async () => {
    const { getPregameCatalog } = await import('/src/scenes/setup/pregameCatalog.ts');
    const { kitShelves } = getPregameCatalog();
    return {
      shelves: kitShelves.length,
      entries: kitShelves.reduce((total, shelf) => total + shelf.entries.length, 0),
      withKit: kitShelves.filter(shelf => shelf.kit.length > 0).length,
      /**
       * The shelves a player actually sees on opening: the roster folds by pack
       * and starts with the biggest one expanded, so a second pack cannot push
       * the first off the screen (`KitRoster.vue`). One pack means no fold at
       * all, and this is then every shelf that has a kit.
       */
      biggestPackWithKit: (() => {
        const counts = new Map();
        for (const shelf of kitShelves) {
          if (shelf.kit.length === 0) continue;
          counts.set(shelf.packId, (counts.get(shelf.packId) ?? 0) + 1);
        }
        return counts.size <= 1
          ? [...counts.values()].reduce((a, b) => a + b, 0)
          : Math.max(...counts.values());
      })(),
      /** Named a shelf that has abilities but no `championName` — see the partial-shelf check. */
      partialShelfNames: kitShelves
        .filter(shelf => shelf.kit.length > 0 && !shelf.championName)
        .map(shelf => shelf.name),
    };
  });
const setCdr = async percent => {
  // The rules live on Trận đấu and the roster on Đội — one panel, but not one
  // tab; the setup screen's two tabs were Tướng / Cấu hình.
  await page.click('#practice-tab-rules');
  // Unfold the tab's sections: a folded control is v-show'n away (PanelSection.vue).
  await page.evaluate(() => {
    for (const head of document.querySelectorAll('.panel-section-head[aria-expanded="false"]')) head.click();
  });
  await page.waitForSelector('#practice-cdr', { state: 'visible' });
  await evaluate(value => {
    const range = document.querySelector('#practice-cdr');
    range.value = value;
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(percent));
  await page.click('#practice-tab-roster');
  await page.waitForSelector('.practice-roster-body', { state: 'visible' });
};

/** Opens the player's editor, runs `steps` inside it, commits, and returns what was actually stored. */
const editPlayer = async steps => {
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  await steps();
  await confirmLoadout();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });
  return storedPlayer();
};

try {
  await page.goto(url, { waitUntil: 'load' });
  await evaluate(k => localStorage.removeItem(k), CFG);
  await openSetup();
  await page.waitForTimeout(150);

  // 1. one roster, whole catalogue, standalone abilities reachable
  await openParticipantAt(1); // the player
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  report.rosterShape = await evaluate(() => ({
    // The abilities the roster *offers*, counted off what each shelf
    // advertises. It used to count mounted `.catalog-spell-card`s, which meant
    // asserting that all 262 of them were in the DOM at once — an
    // implementation detail, and an expensive one: they are mounted for the
    // open shelf only now, and the thing worth checking was never "are they
    // all built" but "is every ability reachable".
    catalogCardCount: [...document.querySelectorAll('.kit-shelf')].reduce(
      (total, shelf) => total + (shelf.dataset.spells || '').split(' ').filter(Boolean).length,
      0
    ),
    shelfCount: document.querySelectorAll('.kit-shelf').length,
    wholeKitActions: document.querySelectorAll('.kit-shelf-apply').length,
    // Only the two shelves that are not a champion — no Q/W/E/R to land in.
    shelvesWithoutWholeKitAction: [...document.querySelectorAll('.kit-shelf')]
      .filter(s => !s.querySelector('.kit-shelf-apply'))
      .map(s => s.dataset.champion),
    standaloneAbilitiesReachable: ['Olaf_Q', 'Graves_W', 'Fizz_E', 'Nasus_Q'].every(bare =>
      [...document.querySelectorAll('.kit-shelf')]
        .flatMap(shelf => (shelf.dataset.spells || '').split(' '))
        .some(id => id === bare || id.endsWith(`:${bare}`))
    ),
    slotKeys: [...document.querySelectorAll('.kit-slot-pill-key')].map(e => e.textContent),
    activeSlot: document.querySelector('.kit-slot-pill.active .kit-slot-pill-key')?.textContent,
    // Seven slots plus the "leave this one to chance" button that acts on them.
    slotBarButtons: document.querySelectorAll('.kit-slot-bar .kit-slot-pill').length,
    // The default loadout is a random champion, so that is what reads as picked.
    randomCardSelected: !!document.querySelector('.catalog-random-card.selected'),
    selectedShelf: document.querySelector('.kit-shelf.selected')?.dataset.champion ?? null,
  }));
  report.catalog = await catalogShape();
  expect(
    'rosterShape.catalogCardCount',
    report.rosterShape.catalogCardCount,
    report.catalog.entries
  );
  expect('rosterShape.shelfCount', report.rosterShape.shelfCount, report.catalog.shelves);
  expect('rosterShape.wholeKitActions', report.rosterShape.wholeKitActions, report.catalog.withKit);
  // A roster of nothing would satisfy all three of those. This is the floor
  // that keeps them meaning "the whole catalogue is on screen".
  expect('catalog is not empty', report.catalog.entries > 50 && report.catalog.shelves > 10, true);
  expect(
    'rosterShape.shelvesWithoutWholeKitAction',
    report.rosterShape.shelvesWithoutWholeKitAction,
    ['Đánh Thường', 'Phép Bổ Trợ']
  );
  expect('rosterShape.slotKeys', report.rosterShape.slotKeys, ['A', 'Q', 'W', 'E', 'R', 'D', 'F']);
  expect('rosterShape.slotBarButtons', report.rosterShape.slotBarButtons, 8);
  await page.screenshot({ path: `${OUT}-roster.png` });

  // 2. a pick is a draft: visible in the slot bar, absent from storage, and
  // thrown away by either exit. There is no highlight-then-commit step inside
  // the picker any more — the commit is the modal's own "Xác nhận".
  await selectSlot(1); // Q
  await pickSpell('Olaf_Q');
  await page.waitForTimeout(120);
  report.draftIsNotStored = {
    changedPills: await evaluate(() =>
      [...document.querySelectorAll('.kit-slot-pill.changed .kit-slot-pill-key')].map(
        e => e.textContent
      )
    ),
    selectedCard: await evaluate(
      () => document.querySelector('.catalog-spell-card.selected')?.dataset.spell ?? null
    ),
    storedWhileDrafting: await storedPlayer(),
  };
  expect('draftIsNotStored.changedPills', report.draftIsNotStored.changedPills, ['Q']);
  expect('draftIsNotStored.selectedCard', report.draftIsNotStored.selectedCard, 'Olaf_Q');
  expect('draftIsNotStored.storedWhileDrafting', report.draftIsNotStored.storedWhileDrafting, null);

  await dismissLoadoutModal();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });
  report.storedAfterXDiscards = await storedPlayer();
  expect('storedAfterXDiscards', report.storedAfterXDiscards, null);

  // re-opening starts from the stored loadout again — the discarded draft did
  // not leak into the next open.
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  report.reopenedAfterDiscard = await evaluate(() => ({
    changedPills: document.querySelectorAll('.kit-slot-pill.changed').length,
    selectedCard: document.querySelector('.catalog-spell-card.selected')?.dataset.spell ?? null,
    randomCardSelected: !!document.querySelector('.catalog-random-card.selected'),
  }));
  expect('reopenedAfterDiscard', report.reopenedAfterDiscard, {
    changedPills: 0,
    selectedCard: null,
    randomCardSelected: true,
  });

  // ...and it discards a whole-kit pick just as completely, not only a single
  // ability — a different code path in `applyKit`, hence a second drive.
  await applyShelf('Ahri');
  await page.waitForTimeout(80);
  await cancelLoadout();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });
  report.storedAfterCancelDiscards = await storedPlayer();
  expect('storedAfterCancelDiscards', report.storedAfterCancelDiscards, null);

  // 3. the gesture decides the mode — there is no toggle left to ask.
  const yasuoKit = ['BasicAttack', 'Yasuo_Q', 'Yasuo_W', 'Yasuo_E', 'Yasuo_R'];
  report.gestureDecidesMode = {
    // a shelf header: a champion pick, keeping the summoners already chosen
    shelfHeader: await editPlayer(() => applyShelf('Yasuo')),
    // a real summoner spell into D: still a champion pick (D/F have their own fields)
    summonerIntoD: await editPlayer(async () => {
      await selectSlot(5);
      await pickSpell('Ghost');
    }),
    // one ability into R: custom, with Yasuo's own kit expanded into the slots first
    abilityIntoR: await editPlayer(async () => {
      await selectSlot(4);
      await pickSpell('Zed_R');
    }),
    // back to a champion pick in one tap, from a custom kit
    backToChampion: await editPlayer(() => applyShelf('Ahri')),
    // something that is not a summoner spell, into F: also custom
    nonSummonerIntoF: await editPlayer(async () => {
      await selectSlot(6);
      await pickSpell('Ahri_W');
    }),
    randomCard: await editPlayer(() => page.click('.catalog-random-card')),
  };
  const g = report.gestureDecidesMode;
  expect('gestureDecidesMode.shelfHeader', g.shelfHeader, {
    mode: 'champion',
    championName: 'Yasuo',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  });
  expect('gestureDecidesMode.summonerIntoD', g.summonerIntoD, {
    mode: 'champion',
    championName: 'Yasuo',
    summonerD: 'Ghost',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  });
  expect('gestureDecidesMode.abilityIntoR', g.abilityIntoR, {
    mode: 'custom',
    championName: 'Yasuo',
    summonerD: 'Ghost',
    summonerF: 'Heal',
    customSlots: [...yasuoKit.slice(0, 4), 'Zed_R', 'Ghost', 'Heal'],
  });
  expect(
    'gestureDecidesMode.backToChampion.mode',
    [g.backToChampion.mode, g.backToChampion.championName],
    ['champion', 'Ahri']
  );
  expect('gestureDecidesMode.nonSummonerIntoF', g.nonSummonerIntoF, {
    mode: 'custom',
    championName: 'Ahri',
    summonerD: 'Ghost',
    summonerF: 'Heal',
    customSlots: ['BasicAttack', 'Ahri_Q', 'Ahri_W', 'Ahri_E', 'Ahri_R', 'Ghost', 'Ahri_W'],
  });
  // ## The partial shelf, and where it went
  //
  // This used to drive Graves — a shelf that was only `Graves_W`, which no
  // `championName` can name, so applying it went through the custom path and
  // landed in the slot its *name* claims (W) rather than the first slot of the
  // shelf. Graves has a full kit now, and so does every other shelf: nothing
  // in the catalogue is partial any more, so the check had no subject left and
  // was failing on its own premise rather than on the behaviour.
  //
  // Written as the catalogue invariant instead of deleted. The custom path it
  // guarded is still there (`KitShelf.championName` is still nullable and
  // `applyKit` still branches on it), so if a partial shelf is ever added back
  // this fails and says exactly which one — at which point the drive above is
  // worth restoring for it. A silent skip would have let that rot unnoticed.
  const partial = report.catalog.partialShelfNames;
  expect('no shelf is partial, so the partial-shelf drive has no subject', partial, []);
  expect(
    'gestureDecidesMode.randomCard.mode',
    [g.randomCard.mode, g.randomCard.championName],
    ['champion', 'random']
  );

  // ...and one slot left to chance. `.kit-slot-random` is the eighth control
  // in the slot group because it acts on the *selected slot*, not on a spell:
  // it is the per-slot `'random'` the old drill-down catalogue offered as its
  // own "Ngẫu Nhiên" card, which the roster has nowhere to put that would not
  // be mistaken for the whole-loadout one. It is disabled while the selected
  // slot is already random — there is nothing for it to do.
  const randomSlotState = () =>
    evaluate(() => ({
      disabled: document.querySelector('.kit-slot-random').disabled,
      activeSlot:
        document.querySelector('.kit-slot-pill.active .kit-slot-pill-key')?.textContent ?? null,
    }));
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  // The loadout is still the random champion left by the step above, so Q —
  // the slot the picker opens on — is already rolling the dice.
  report.randomSlotButton = { onARandomSlot: await randomSlotState() };
  await applyShelf('Yasuo');
  await page.waitForTimeout(80);
  report.randomSlotButton.afterTakingAKit = await randomSlotState();
  await selectSlot(4); // R
  await page.click('.kit-slot-random');
  await page.waitForTimeout(80);
  report.randomSlotButton.afterRandomising = await randomSlotState();
  await confirmLoadout();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });
  report.randomSlotButton.stored = await storedPlayer();
  expect('randomSlotButton.onARandomSlot', report.randomSlotButton.onARandomSlot, {
    disabled: true,
    activeSlot: 'Q',
  });
  expect('randomSlotButton.afterTakingAKit', report.randomSlotButton.afterTakingAKit, {
    disabled: false,
    activeSlot: 'Q',
  });
  // Having just rolled R back to chance, there is nothing left to randomise.
  expect('randomSlotButton.afterRandomising', report.randomSlotButton.afterRandomising, {
    disabled: true,
    activeSlot: 'R',
  });
  expect('randomSlotButton.stored', report.randomSlotButton.stored, {
    mode: 'custom',
    championName: 'Yasuo',
    summonerD: 'Ghost',
    summonerF: 'Heal',
    customSlots: ['BasicAttack', 'Yasuo_Q', 'Yasuo_W', 'Yasuo_E', 'random', 'Ghost', 'Heal'],
  });

  // ...and that `'random'` is resolved at spawn, not dropped: six fixed slots
  // and one real, arbitrary spell where R was left open.
  await page.click('#pregame-start-btn');
  await page.waitForFunction(() => window.__moba2d?.scene?.oScene?.game?.player, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(400);
  report.randomSlotButton.spawnedSpells = await evaluate(() =>
    window.__moba2d.scene.oScene.game.player.spells.map(s => s?.constructor?.name ?? null)
  );
  const spawned = report.randomSlotButton.spawnedSpells;
  expect(
    'randomSlotButton.spawnedSpells (fixed slots)',
    [...spawned.slice(0, 4), ...spawned.slice(5)],
    ['BasicAttack', 'Yasuo_Q', 'Yasuo_W', 'Yasuo_E', 'Ghost', 'Heal']
  );
  if (typeof spawned[4] !== 'string' || spawned[4].length === 0) {
    errors.push(
      `randomSlotButton.spawnedSpells: the R slot rolled ${JSON.stringify(spawned[4])}, expected a real spell`
    );
  }
  // back out to the setup screen — the rest of this script drives it further
  // Back out to the menu the way the game itself does. This was `stopGame()`
  // followed by Escape, from when Escape left the match — Escape now opens the
  // practice panel (`GameScene.keyPressed`), so the scene never switched and
  // every step after this waited for a menu that was not coming.
  // `onExitRequested` is the seam the panel's own exit button calls.
  await evaluate(() => window.__moba2d.scene.oScene.game.onExitRequested());
  await openSetup();
  await page.waitForSelector('.practice-roster-body', { state: 'visible' });
  await page.waitForTimeout(120);

  // ...and a kit assembled slot by slot, exactly as the free-form builder used
  // to do it in seven round trips through a nested dialog.
  report.persistedCustomKit = await editPlayer(async () => {
    await selectSlot(0);
    await pickSpell('BasicAttack');
    await selectSlot(1);
    await pickSpell('Olaf_Q');
    await selectSlot(2);
    await pickSpell('Yasuo_W');
    await selectSlot(3);
    await pickSpell('Yasuo_E');
    await selectSlot(4);
    await pickSpell('Yasuo_R');
    await selectSlot(5);
    await pickSpell('Ghost');
    await selectSlot(6);
    await pickSpell('Ignite');
  });
  expect('persistedCustomKit.customSlots', report.persistedCustomKit.customSlots, [
    'BasicAttack',
    'Olaf_Q',
    'Yasuo_W',
    'Yasuo_E',
    'Yasuo_R',
    'Ghost',
    'Ignite',
  ]);
  expect('persistedCustomKit.mode', report.persistedCustomKit.mode, 'custom');
  await page.screenshot({ path: `${OUT}-custom-kit.png` });

  // 4. hovering a card describes it — under this match's CDR — and picks
  // nothing. The description panel floats over the roster (`position: fixed`,
  // `pointer-events: none`); it is not a second dialog and there is no commit
  // button beside it any more. CDR is set *before* opening because the modal
  // is full-screen: the Settings tab's slider is not reachable while it is up,
  // which is the "no two overlays open at once" fix at the layout level.
  await setCdr(50);
  const beforeHover = await storedPlayer();
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  // Deliberately a spell the kit above does *not* contain, so "hovering picks
  // nothing" is checkable in the roster too.
  await openShelf('Lux'); // a closed tile builds no cards, and hover needs a real one
  await page.hover(`.catalog-spell-card[data-spell="${await spellId('Lux_Q')}"]`);
  await page.waitForTimeout(250);
  report.hoverDescribesWithoutPicking = await evaluate(() => {
    const peek = document.querySelector('.spell-peek');
    const rect = peek?.getBoundingClientRect();
    return {
      name: peek?.querySelector('.spell-detail-header h3')?.textContent ?? null,
      cooldown: peek?.querySelector('.spell-detail-cooldown')?.textContent.trim() ?? null,
      hasDescription: !!peek?.querySelector('.spell-detail-body')?.textContent.trim(),
      pointerEvents: peek ? getComputedStyle(peek).pointerEvents : null,
      insideViewport:
        !!rect &&
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= innerWidth + 1 &&
        rect.bottom <= innerHeight + 1,
      dialogCount: document.querySelectorAll('.pregame-modal-backdrop').length,
      changedPills: document.querySelectorAll('.kit-slot-pill.changed').length,
      selectedCard: document.querySelector('.catalog-spell-card.selected')?.dataset.spell ?? null,
    };
  });
  await page.screenshot({ path: `${OUT}-hover-description.png` });
  /**
   * The expected label, from the spell's own tuning number and arithmetic
   * written out here.
   *
   * It used to call `preset.getSpellDisplay(entry.spellClass, …)` twice, and
   * had been silently broken since the catalogue became generated data:
   * `listSpellCatalog()` entries carry `id` where they used to carry
   * `spellClass` (see the note in `config/spellCatalog.ts`), so this passed
   * `undefined` to a `new SpellClass(...)`. That logged "SpellClass is not a
   * constructor" twice and produced `0.0s` for *both* labels — an expectation
   * that could never match, blaming a panel that was showing the right number.
   *
   * So: `display.coolDownMs` is the rule-free tuning value, and the halving is
   * done by hand rather than through `toMatchRules`/`spellDisplayOf`. A check
   * that reaches for the transform it is checking agrees with itself however
   * wrong it is — see CLAUDE.md's Testing section.
   */
  report.cooldownUnderCdr = await evaluate(async () => {
    // `resolveCatalogEntry`, not a scan of `listSpellCatalog()`: that list is
    // the *bundled* pack's alone and is empty whenever the roster comes from a
    // linked one, so the scan found nothing and this threw before it could
    // check anything. The resolver is the thing that knows how to spell an id.
    const { resolveCatalogEntry } = await import('/src/scenes/setup/pregameCatalog.ts');
    const entry = resolveCatalogEntry('Lux_Q');
    const rawMs = entry.display.coolDownMs;
    return {
      rawLabel: `${(rawMs / 1000).toFixed(1)}s`,
      halvedLabel: `${((rawMs * 0.5) / 1000).toFixed(1)}s`,
    };
  });
  const peeked = report.hoverDescribesWithoutPicking;
  expect('hoverDescribesWithoutPicking.hasDescription', peeked.hasDescription, true);
  expect('hoverDescribesWithoutPicking.pointerEvents', peeked.pointerEvents, 'none');
  expect('hoverDescribesWithoutPicking.insideViewport', peeked.insideViewport, true);
  expect('hoverDescribesWithoutPicking.dialogCount', peeked.dialogCount, 1);
  expect('hoverDescribesWithoutPicking.changedPills', peeked.changedPills, 0);
  // Nothing reads as selected, and that is the assertion. The active slot
  // holds Olaf_Q while Lux's shelf is the open one, so Olaf's card is not built
  // — and it was never *on screen* even back when it was, since a closed shelf
  // hid it. What matters is that the card under the cursor did not quietly
  // become the pick: `changedPills` above says the draft is untouched, and this
  // says the roster agrees.
  expect('hoverDescribesWithoutPicking.selectedCard', peeked.selectedCard, null);
  if (!peeked.cooldown?.includes(report.cooldownUnderCdr.halvedLabel)) {
    errors.push(
      `hoverDescribesWithoutPicking.cooldown: "${peeked.cooldown}" does not show the 50% CDR value ${report.cooldownUnderCdr.halvedLabel} (raw ${report.cooldownUnderCdr.rawLabel})`
    );
  }

  // 4b. The slot bar answers the same question for the spell already in a
  // slot — the one a player is most likely to be asking about, and the one
  // this screen used to answer only by making them find that spell again down
  // in an 85-card roster.
  //
  // The expected text is not typed here: it is whatever the *roster card* for
  // the same spell says, read a moment earlier. Two independent surfaces, one
  // answer — and nothing in the check recomputes the answer itself.
  const peekTitle = () =>
    evaluate(
      () => document.querySelector('.spell-peek .spell-detail-header h3')?.textContent ?? null
    );
  await openShelf('Yasuo');
  await page.hover(`.catalog-spell-card[data-spell="${await spellId('Yasuo_W')}"]`);
  await page.waitForTimeout(250);
  const cardTitle = await peekTitle();
  // W, not the active slot (Q): hovering has to describe without selecting.
  await page.hover('.kit-slot-bar .kit-slot-pill:nth-child(3)');
  await page.waitForTimeout(250);
  report.slotPillDescribes = await evaluate(() => ({
    title: document.querySelector('.spell-peek .spell-detail-header h3')?.textContent ?? null,
    hasDescription: !!document.querySelector('.spell-peek .spell-detail-body')?.textContent.trim(),
    // One editor, one panel: the slot bar and the roster share an instance.
    panels: document.querySelectorAll('.spell-peek').length,
    // A hover ends itself on `mouseleave`, so it must not raise the
    // full-screen dismiss layer the touch path needs.
    scrims: document.querySelectorAll('.spell-peek-scrim').length,
    activeSlot:
      document.querySelector('.kit-slot-pill.active .kit-slot-pill-key')?.textContent ?? null,
    changedPills: document.querySelectorAll('.kit-slot-pill.changed').length,
  }));
  expect('slotPillDescribes.title', report.slotPillDescribes.title, cardTitle);
  expect('slotPillDescribes.hasDescription', report.slotPillDescribes.hasDescription, true);
  expect('slotPillDescribes.panels', report.slotPillDescribes.panels, 1);
  expect('slotPillDescribes.scrims', report.slotPillDescribes.scrims, 0);
  expect('slotPillDescribes.activeSlot', report.slotPillDescribes.activeSlot, 'Q');
  expect(
    'slotPillDescribes.changedPills',
    report.slotPillDescribes.changedPills,
    peeked.changedPills
  );
  if (!cardTitle) {
    errors.push('slotPillDescribes: the roster card it is compared against described nothing');
  }
  // Off the pill: a hover ends itself, and the panel must not linger.
  await page.hover('.kit-hint');
  await page.waitForTimeout(150);
  expect('slotPillDescribes.closedOnLeave', await peekTitle(), null);

  await cancelLoadout();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });
  report.storedUnchangedByHover =
    (await storedPlayer())?.customSlots?.join(',') === beforeHover?.customSlots?.join(',');
  expect('storedUnchangedByHover', report.storedUnchangedByHover, true);
  await setCdr(0); // don't let it leak into the live match below

  // 5. the player's card and a bot's card open the identical modal, and only
  // one is ever open — the full-viewport backdrop makes a second one
  // structurally unreachable while the first is up (confirmed here: exactly
  // one backdrop exists, and the player's own card behind it is not an
  // actionable target).
  await openParticipantAt(2); // Bot 1
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  report.bot1EditorIsSameComponent = await evaluate(() => ({
    title: document.querySelector('.pregame-modal-header h3')?.textContent,
    slotPills: document.querySelectorAll('.kit-slot-pill:not(.kit-slot-random)').length,
    hasRandomSlotButton: !!document.querySelector('.kit-slot-random'),
    catalogCardCount: [...document.querySelectorAll('.kit-shelf')].reduce(
      (total, shelf) => total + (shelf.dataset.spells || '').split(' ').filter(Boolean).length,
      0
    ),
    wholeKitActions: document.querySelectorAll('.kit-shelf-apply').length,
    backdropCount: document.querySelectorAll('.pregame-modal-backdrop').length,
  }));
  // Same catalogue as the player's editor, because it is the same component —
  // derived, not restated, for the reason `catalogShape` gives.
  // "Đổi tướng — Bot 1", not the bare "Bot 1" the setup screen used: the two
  // panels became one and kept the in-game wording, which says what the modal
  // is for rather than only who it is bound to.
  expect('bot1EditorIsSameComponent', report.bot1EditorIsSameComponent, {
    title: 'Đổi tướng — Bot 1',
    slotPills: 7,
    hasRandomSlotButton: true,
    catalogCardCount: report.catalog.entries,
    wholeKitActions: report.catalog.withKit,
    backdropCount: 1,
  });
  report.playerCardNotClickableBehindModal = await page
    .click('.practice-roster-row.is-player .practice-roster-open', { timeout: 500 })
    .then(() => 'click went through (bug)')
    .catch(() => 'blocked, as expected');
  expect(
    'playerCardNotClickableBehindModal',
    report.playerCardNotClickableBehindModal,
    'blocked, as expected'
  );

  await applyShelf('Ahri');
  await confirmLoadout();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });
  report.bot1SummaryAfterPick = await evaluate(
    () =>
      document.querySelector(
        '.practice-roster-main:has(#practice-row-toggle-1) .practice-roster-name'
      )?.textContent
  );
  expect('bot1SummaryAfterPick', report.bot1SummaryAfterPick, 'Ahri');
  await page.screenshot({ path: `${OUT}-bot-config.png` });

  // 6. a pre-existing v1 blob (no mode/customSlots/ai.bots) loads cleanly
  await evaluate(() => {
    localStorage.setItem(
      'moba2d:pregameConfig:v1',
      JSON.stringify({
        player: { championName: 'Zed', summonerD: 'Ghost', summonerF: 'Ignite' },
        ai: { count: 6, autoMove: true, autoAttack: false, autoCast: true },
        rules: { cooldownReductionPercent: 20, manaFree: true },
      })
    );
  });
  await page.reload({ waitUntil: 'load' });
  await openSetup();
  await page.waitForTimeout(150);
  const legacyBotCount = await evaluate(
    () => document.querySelectorAll('.practice-roster-row:not(.is-player)').length
  );
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  const legacyEditorState = await evaluate(() => ({
    selectedShelf: document.querySelector('.kit-shelf.selected')?.dataset.champion ?? null,
    // The old blob's D/F really are Ghost/Ignite, so no slot reads as "roll
    // the dice" — every pill carries a real icon rather than the dice glyph.
    slotsStillRandom: [...document.querySelectorAll('.kit-slot-pill:not(.kit-slot-random)')].filter(
      p => !p.querySelector('img')
    ).length,
    pillTitles: [...document.querySelectorAll('.kit-slot-pill img')].map(i =>
      i.getAttribute('title')
    ),
  }));
  await dismissLoadoutModal();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });
  await page.click('#practice-tab-rules');
  // Unfold the tab's sections: a folded control is v-show'n away (PanelSection.vue).
  await page.evaluate(() => {
    for (const head of document.querySelectorAll('.panel-section-head[aria-expanded="false"]')) head.click();
  });
  await page.waitForSelector('#practice-cdr', { state: 'visible' });
  report.legacyV1BlobLoaded = {
    ...legacyEditorState,
    botCount: legacyBotCount,
    cdr: await evaluate(() => document.querySelector('#practice-cdr').value),
    urf: await evaluate(() => document.querySelector('#practice-urf').checked),
  };
  expect('legacyV1BlobLoaded.selectedShelf', report.legacyV1BlobLoaded.selectedShelf, 'Zed');
  expect('legacyV1BlobLoaded.slotsStillRandom', report.legacyV1BlobLoaded.slotsStillRandom, 0);
  expect('legacyV1BlobLoaded.botCount', report.legacyV1BlobLoaded.botCount, 6);
  expect('legacyV1BlobLoaded.cdr', report.legacyV1BlobLoaded.cdr, '20');
  expect('legacyV1BlobLoaded.urf', report.legacyV1BlobLoaded.urf, true);
  await page.screenshot({ path: `${OUT}-legacy-blob-loaded.png` });

  // 7. start a real match with a custom kit and one fixed-champion bot
  await evaluate(() => {
    localStorage.setItem(
      'moba2d:pregameConfig:v1',
      JSON.stringify({
        player: {
          mode: 'custom',
          championName: 'random',
          summonerD: 'Flash',
          summonerF: 'Heal',
          customSlots: [
            'BasicAttack',
            'Olaf_Q',
            'Yasuo_W',
            'Yasuo_E',
            'Yasuo_R',
            'Ghost',
            'Ignite',
          ],
        },
        ai: {
          count: 2,
          autoMove: false,
          autoAttack: true,
          autoCast: true,
          bots: [
            {
              mode: 'champion',
              championName: 'Ahri',
              summonerD: 'Flash',
              summonerF: 'Heal',
              customSlots: Array(7).fill('random'),
            },
            {
              mode: 'champion',
              championName: 'random',
              summonerD: 'Flash',
              summonerF: 'Heal',
              customSlots: Array(7).fill('random'),
            },
          ],
        },
        rules: { cooldownReductionPercent: 0, manaFree: false },
      })
    );
  });
  await page.reload({ waitUntil: 'load' });
  await page.click('#play-btn');
  // Chơi opens the match-config panel now; Bắt Đầu is what starts
  // the match. This script boots its own browser, so it cannot
  // import the harness helper that does both (`e2eHarness.test.ts`).
  await page.waitForSelector('#pregame-start-btn', { timeout: 30_000 });
  await page.click('#pregame-start-btn');
  await page.waitForFunction(() => window.__moba2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(500);
  report.liveMatch = await evaluate(async () => {
    const aiModule = await import('/src/game/gameObject/attackableUnits/AIChampion.ts');
    const game = window.__moba2d.scene.oScene.game;
    const bots = game.objectManager.objects.filter(o => o instanceof aiModule.default);
    return {
      playerSpellNames: game.player.spells.map(s => s.constructor.name),
      botCount: bots.length,
      ahriBotSpellNames: bots
        .map(b => b.spells.map(s => s.constructor.name))
        .find(names => names.includes('Ahri_Q')),
    };
  });
  expect('liveMatch.playerSpellNames', report.liveMatch.playerSpellNames, [
    'BasicAttack',
    'Olaf_Q',
    'Yasuo_W',
    'Yasuo_E',
    'Yasuo_R',
    'Ghost',
    'Ignite',
  ]);
  expect('liveMatch.botCount', report.liveMatch.botCount, 2);
  expect('liveMatch.ahriBotSpellNames', report.liveMatch.ahriBotSpellNames?.slice(0, 5), [
    'BasicAttack',
    'Ahri_Q',
    'Ahri_W',
    'Ahri_E',
    'Ahri_R',
  ]);
  await page.screenshot({ path: `${OUT}-live-match.png` });

  // 8. the roster's two states: a grid of closed tiles, and one open shelf
  //
  // This replaced a compact/expanded mode toggle, and the check replaced with
  // it: there is no stored view to seed any more, so the section opens the
  // editor the way a player does and drives the disclosure itself.
  //
  // Last, and still after a fresh load, because what it proves is that the
  // *default* state of the roster is the closed grid. Seeded state was how the
  // old version of this script hid the fact that everything above it drove a
  // layout no default player ever saw.
  await page.goto(url, { waitUntil: 'load' });
  await openSetup();
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  await page.waitForTimeout(150);

  const rosterShown = () =>
    evaluate(() => {
      // `offsetParent === null` is what `display: none` on the element or on any
      // ancestor produces, which is exactly how a closed tile hides its body.
      const shown = selector =>
        [...document.querySelectorAll(selector)].filter(element => element.offsetParent !== null);
      return {
        open: document.querySelector('.kit-shelf.open')?.dataset.champion ?? null,
        // Every shelf stays mounted — a tile is what the grid *is*. Its cards
        // do not: they are built for the open shelf only, which is what makes
        // this modal open in a frame instead of building 262 buttons nobody
        // has asked to see yet.
        shelvesInDom: document.querySelectorAll('.kit-shelf').length,
        cardsInDom: document.querySelectorAll('.catalog-spell-card').length,
        // What the roster *offers*, which is the thing "the whole catalogue is
        // reachable" actually means. A closed shelf says so without mounting it.
        advertised: [...document.querySelectorAll('.kit-shelf')].reduce(
          (total, shelf) => total + (shelf.dataset.spells || '').split(' ').filter(Boolean).length,
          0
        ),
        // ...and these are what a player can actually see and press.
        shelvesVisible: shown('.kit-shelf').length,
        cardIds: shown('.catalog-spell-card').map(element => element.dataset.spell),
        nonChampionShelvesVisible: shown('.kit-shelf:not(.has-kit)').length,
        wholeKitButtonsVisible: shown('.kit-apply-all').length,
        randomCardVisible: shown('.catalog-random-card').length,
        labelsVisible: shown('.kit-bar-label').length,
      };
    });

  report.rosterClosed = await rosterShown();

  expect('rosterClosed.open', report.rosterClosed.open, null);
  // Derived from the catalogue for the reason section 1 gives.
  expect('rosterClosed.shelvesInDom', report.rosterClosed.shelvesInDom, report.catalog.shelves);
  // Zero, and that is the assertion rather than an accident: with no shelf open
  // there is no ability on screen, so there is no reason to have built one.
  expect('rosterClosed.cardsInDom', report.rosterClosed.cardsInDom, 0);
  // ...while every ability the catalogue has is still reachable from the grid,
  // which is what the count above used to be standing in for.
  expect('rosterClosed.advertised', report.rosterClosed.advertised, report.catalog.entries);
  // Every shelf of the expanded pack that has a kit, and only those: the two
  // that are not a champion are opened by selecting the slot they serve, never
  // by being tapped, and another pack's rows stay behind their own heading.
  expect(
    'rosterClosed.shelvesVisible',
    report.rosterClosed.shelvesVisible,
    report.catalog.biggestPackWithKit
  );
  expect(
    'rosterClosed.nonChampionShelvesVisible',
    report.rosterClosed.nonChampionShelvesVisible,
    0
  );
  // The whole point of the rework: nothing is pickable and nothing is
  // committable until a tile is opened, so a stray tap on the grid cannot
  // replace the kit.
  expect('rosterClosed.cardIds', report.rosterClosed.cardIds, []);
  expect('rosterClosed.wholeKitButtonsVisible', report.rosterClosed.wholeKitButtonsVisible, 0);
  // Ngẫu Nhiên stays: it is a whole-loadout action and needs no champion.
  expect('rosterClosed.randomCardVisible', report.rosterClosed.randomCardVisible, 1);
  // Desktop viewport, so what labels there are keep their words. Just the one:
  // Xác nhận is the only button in the bar still carrying a word — Huỷ is gone,
  // Lưu bộ is icon-only, and the view toggle it used to sit beside no longer
  // exists (see `LoadoutEditorModal.vue`). The number is the control for the
  // narrow-viewport check at the end, which is the real assertion; if a label
  // comes back, that one is what has to keep passing.
  expect('rosterClosed.labelsVisible', report.rosterClosed.labelsVisible, 1);

  await page.screenshot({ path: `${OUT}-roster-closed.png` });

  // Opening one champion shows exactly that champion's abilities and exactly one
  // whole-kit button. "Exactly" is the assertion: an accordion that opened two
  // shelves, or left a previous one open, is the density this replaced.
  await openShelf('Ahri');
  report.rosterOpen = await rosterShown();
  expect('rosterOpen.open', report.rosterOpen.open, 'Ahri');
  expect('rosterOpen.cardIds', report.rosterOpen.cardIds, ['Ahri_Q', 'Ahri_W', 'Ahri_E', 'Ahri_R']);
  expect('rosterOpen.wholeKitButtonsVisible', report.rosterOpen.wholeKitButtonsVisible, 1);

  await openShelf('Lux');
  report.rosterSwitched = await rosterShown();
  expect('rosterSwitched.open', report.rosterSwitched.open, 'Lux');
  expect('rosterSwitched.cardCount', report.rosterSwitched.cardIds.length, 4);

  // Tapping the open tile closes it again, back to the grid.
  await page.click('.kit-shelf[data-champion="Lux"] .kit-shelf-apply');
  report.rosterReclosed = await rosterShown();
  expect('rosterReclosed.open', report.rosterReclosed.open, null);
  expect('rosterReclosed.cardIds', report.rosterReclosed.cardIds, []);

  await page.screenshot({ path: `${OUT}-roster-open.png` });

  // ## The two shelves a champion tile cannot offer
  //
  // A, D and F are filled from the basic-attack and summoner shelves, which are
  // not champions and so are not tiles. Selecting one of those slots opens the
  // shelf that serves it; going back to an ability slot closes it again, because
  // a summoner list standing over a Q selection offers spells that slot cannot
  // take. The roster is ordered for this too: both non-champion shelves are
  // pinned ahead of the champions, which are sorted by name.
  report.shelfOrder = await evaluate(() =>
    [...document.querySelectorAll('.kit-shelf')].slice(0, 3).map(e => e.dataset.champion)
  );
  // The third is whichever champion sorts first, read off the catalogue rather
  // than named here — a new champion beginning with "A" must not break this.
  const firstChampion = await evaluate(async () => {
    const { getPregameCatalog } = await import('/src/scenes/setup/pregameCatalog.ts');
    return (
      getPregameCatalog()
        .kitShelves.filter(shelf => shelf.kit.length > 0)
        .map(shelf => shelf.name)[0] ?? null
    );
  });
  expect('shelfOrder', report.shelfOrder, ['Đánh Thường', 'Phép Bổ Trợ', firstChampion]);

  await selectSlot(1); // Q — an ability slot, so nothing opens on its own
  report.slotQ = await rosterShown();
  expect('slotQ.open', report.slotQ.open, null);
  expect('slotQ.cardIds', report.slotQ.cardIds, []);

  await selectSlot(5); // D
  report.slotD = await rosterShown();
  expect('slotD.open', report.slotD.open, 'Phép Bổ Trợ');
  // Exactly the summoner spells, from the catalogue rather than a hand list.
  const summonerIds = await evaluate(async () => {
    const { getPregameCatalog } = await import('/src/scenes/setup/pregameCatalog.ts');
    return getPregameCatalog()
      .summoners.map(option => option.id)
      .sort();
  });
  expect('slotD.cardIds', [...report.slotD.cardIds].sort(), summonerIds);
  // No whole-kit button: there is no kit here to take.
  expect('slotD.wholeKitButtonsVisible', report.slotD.wholeKitButtonsVisible, 0);

  // Picked while D is the selected slot, so it lands in a summoner field and
  // leaves the loadout a champion pick — the same rule section 3 proves, now
  // reachable without hunting for the shelf.
  await pickSpell('Ignite');

  await selectSlot(0); // A
  report.slotA = await rosterShown();
  expect('slotA.open', report.slotA.open, 'Đánh Thường');
  expect('slotA.cardIds', report.slotA.cardIds, ['BasicAttack']);

  // Back to an ability slot: the summoner shelf must not be left standing.
  await selectSlot(1);
  report.slotBackToQ = await rosterShown();
  expect('slotBackToQ.open', report.slotBackToQ.open, null);

  // --- 10. the search box ------------------------------------------------
  // The roster is ~50 tiles in one scrolling list, so finding one by eye means
  // scrolling past forty. The box filters the tiles; `matchesQuery` itself is
  // unit-tested, so what is checked here is the wiring and the two cases a unit
  // test cannot see: that clearing restores the list, and that a query does not
  // close a shelf the player has open.
  const shelfNames = () =>
    evaluate(() => [...document.querySelectorAll('.kit-shelf')].map(e => e.dataset.champion));
  const typeSearch = async text => {
    await page.fill('.kit-search-input', text);
    await page.waitForTimeout(80);
  };

  await selectSlot(1); // an ability slot, so nothing is open on its own
  const everyShelf = await shelfNames();

  await typeSearch('yas');
  const narrowed = await shelfNames();
  report.searchNarrowed = {
    from: everyShelf.length,
    to: narrowed.length,
    names: narrowed,
    // Checked here rather than by calling `matchesQuery`, which is the function
    // under test: a transform asked to verify itself agrees with itself.
    allContainQuery: narrowed.every(name => name.toLowerCase().includes('yas')),
  };
  expect('searchNarrowed.allContainQuery', report.searchNarrowed.allContainQuery, true);
  expect('searchNarrowed.hasYasuo', narrowed.includes('Yasuo'), true);
  expect('searchNarrowed.isNarrower', narrowed.length < everyShelf.length, true);

  // A query nothing answers says so, rather than showing an empty screen.
  await typeSearch('zzzz');
  report.searchEmptyState = await evaluate(() => ({
    shelves: document.querySelectorAll('.kit-shelf').length,
    message: document.querySelector('.kit-search-empty')?.textContent?.trim() ?? null,
  }));
  expect('searchEmptyState.shelves', report.searchEmptyState.shelves, 0);
  expect('searchEmptyState.hasMessage', report.searchEmptyState.message !== null, true);

  // The clear button is a real target, and it puts the whole roster back.
  await page.click('.kit-search-clear');
  await page.waitForTimeout(80);
  report.searchCleared = await shelfNames();
  expect('searchCleared', report.searchCleared, everyShelf);

  // A / D / F open a shelf whose name the player never typed and which has no
  // tile. A query must not take it away from under them.
  await selectSlot(5); // D — opens Phép Bổ Trợ
  await typeSearch('zzzz');
  report.searchKeepsOpenShelf = await evaluate(() => ({
    open: document.querySelector('.kit-shelf.open')?.dataset.champion ?? null,
    cards: document.querySelectorAll('.kit-shelf.open .catalog-spell-card').length,
  }));
  expect('searchKeepsOpenShelf.open', report.searchKeepsOpenShelf.open, 'Phép Bổ Trợ');
  expect('searchKeepsOpenShelf.hasCards', report.searchKeepsOpenShelf.cards > 0, true);

  await page.click('.kit-search-clear');
  await selectSlot(1);

  // A tile opens; the button inside it is what takes the kit.
  await applyShelf('Ahri');
  await confirmLoadout();
  report.tileApplied = await storedPlayer();
  expect('tileApplied.mode', report.tileApplied?.mode, 'champion');
  expect('tileApplied.championName', report.tileApplied?.championName, 'Ahri');
} catch (error) {
  report.FAILURE = `${error.message}\n${error.stack}`;
} finally {
  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}

if (errors.length || report.FAILURE) process.exitCode = 1;
