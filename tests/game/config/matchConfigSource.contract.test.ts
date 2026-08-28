import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MatchDirector from '../../../src/game/MatchDirector';
import MatchDirectorSource, {
  type MatchDirectorHost,
} from '../../../src/game/hud/config/MatchDirectorSource';
import PregameConfigSource from '../../../src/game/hud/config/PregameConfigSource';
import type { MatchConfigSource } from '../../../src/game/hud/config/MatchConfigSource';
import {
  AI_COUNT_MAX,
  DEFAULT_MAP_ID,
  DEFAULT_PREGAME_CONFIG,
  loadPregameConfig,
  savePregameConfig,
} from '../../../src/game/config/PregameConfig';
import { MatchTeam } from '../../../src/game/config/MatchTeams';
import { INVENTORY_SIZE } from '../../../src/game/items/Item';
import { context as practiceContext } from '../practice/helpers';
import { packIsInstalled } from '../../support/installedPacks';
import { contentCatalog } from '../../../src/content/catalog';

/**
 * A shelf to drive the item cheat against.
 *
 * This checkout's installed packs ship no items — the reference pack sells
 * nothing by design — so every assertion inside `for (const option of
 * itemStock())` used to run zero times and pass. A vacuous test is worse than
 * no test: it reports green for a shape nobody checked. One probe pack per
 * call, with a fresh id each time, so seeding cannot collide with the last
 * test's leftovers.
 */
let probeSeed = 0;
const seedItems = (): { id: string; name: string }[] => {
  const packId = `probe${probeSeed++}`;
  contentCatalog().installData({
    manifest: { id: packId, version: '1.0.0', coreRange: '*' },
    items: {
      boots: { id: 'boots', name: 'Giày Thử', icon: 'spell_basic_attack', cost: 300 },
      // A key nothing registered: legal, and the reason `image` may be `''`.
      ghost: { id: 'ghost', name: 'Đồ Ma', icon: 'no_such_asset_key', cost: 400 },
    },
  } as never);
  return [
    { id: `${packId}:boots`, name: 'Giày Thử' },
    { id: `${packId}:ghost`, name: 'Đồ Ma' },
  ];
};

/**
 * **The test that makes one panel possible.**
 *
 * The whole point of `MatchConfigSource` is that the match-config panel is one
 * component with two backends — the stored config on the menu, the running
 * match in game — and that the two can never again diverge into "the setup
 * screen alone can pick an input mode, the practice panel alone can assign
 * sides". Every assertion below runs against **both**, so a control that only
 * one source can serve fails here before it can ship.
 *
 * It asserts behaviour through the seam only. Where the two genuinely differ —
 * a row's `title` is the live champion in a match and the *loadout* outside one
 * — the difference is stated as a per-source expectation rather than skipped,
 * because that difference is a rule and rules are what a contract is for.
 */

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

/**
 * The suite runs on `environment: 'node'` like the rest of this repo (there is
 * no jsdom), so the browser globals the device settings genuinely read have to
 * be stubbed rather than assumed: `PregameConfig` reads a bare `localStorage`,
 * `touchPreferences` and `renderPreferences` read `window.localStorage`, and
 * the input-mode row toggles `body.touch-ui`. One storage object behind all
 * three, so a write through any path is visible to the others.
 */
const stubBrowser = (storage: MemoryStorage): void => {
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { localStorage: storage, location: { search: '' } });
  vi.stubGlobal('document', { body: { classList: { toggle: () => {} } } });
};

/** The shape `loadChampionPresetFromLoadout` resolves to, as far as the director cares. */
const presetFor = (loadout: { championName: string }) => ({
  name: loadout.championName === 'random' ? 'Ngẫu Nhiên' : loadout.championName,
  spells: [],
});

/** A camera, render settings and an exit, with no `Game` behind them. */
/** What `openShopFor` was asked to open, so the delegation can be asserted. */
const openedShopFor: string[] = [];

const fakeHost = (director: MatchDirector): MatchDirectorHost => {
  let zoom = 1;
  let quality: MatchDirectorHost['renderQuality'] = 'auto';
  let fps: MatchDirectorHost['renderFps'] = 60;
  return {
    director,
    camera: {
      get zoomFactor() {
        return zoom;
      },
      setZoomFactor(factor: number) {
        zoom = factor;
      },
      snapToScale() {},
    },
    touchUi: false,
    openShopFor: (id: string) => openedShopFor.push(id),
    // Fixed, on purpose — this is the bench's stand-in for "the map this
    // match actually booted onto", which a real `Game` never changes for the
    // life of the match. `setMap` must never move it; that is exactly what
    // the 'map' suite below asserts.
    activeMapId: DEFAULT_MAP_ID,
    get renderQuality() {
      return quality;
    },
    get renderFps() {
      return fps;
    },
    setRenderQuality(next) {
      quality = next;
    },
    setRenderFps(next) {
      fps = next;
    },
    setTouchUiEnabled() {},
    requestExit() {},
  };
};

interface Bench {
  source: MatchConfigSource;
}

/**
 * No `ObjectManager.update()` anywhere below, deliberately. The panel holds the
 * match paused, so a tick is exactly what does *not* happen while these calls
 * run — and `MatchDirector.bots()` is built for that: it counts `_objectToBeAdd`
 * and skips `toRemove`, so an added or removed bot is on the roster
 * immediately. Ticking here would also run the AI on bots whose stub preset has
 * no spells, failing on a fixture detail rather than on the seam.
 */

const makePregame = async (): Promise<Bench> => {
  savePregameConfig({ ...DEFAULT_PREGAME_CONFIG, ai: { ...DEFAULT_PREGAME_CONFIG.ai, count: 1 } });
  return { source: new PregameConfigSource() };
};

const makeDirector = async (): Promise<Bench> => {
  savePregameConfig({ ...DEFAULT_PREGAME_CONFIG, ai: { ...DEFAULT_PREGAME_CONFIG.ai, count: 0 } });
  const { context } = practiceContext();
  // A stub loader: the contract is about the seam, not about what a kit
  // resolves to, and the real one reaches for the spell catalogue.
  const director = new MatchDirector(context, {
    loadPreset: async loadout => presetFor(loadout),
  });
  const source = new MatchDirectorSource(fakeHost(director));
  await source.addBot(MatchTeam.BLUE);
  return { source };
};

const SOURCES: [string, () => Promise<Bench>][] = [
  ['PregameConfigSource', makePregame],
  ['MatchDirectorSource', makeDirector],
];

describe.each(SOURCES)('MatchConfigSource contract — %s', (name, make) => {
  const isPregame = name === 'PregameConfigSource';
  let source: MatchConfigSource;

  beforeEach(async () => {
    stubBrowser(new MemoryStorage());
    source = (await make()).source;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('roster', () => {
    it('puts the player first, labelled Bạn, with the bots numbered after it', () => {
      const roster = source.roster();
      expect(roster[0].isPlayer).toBe(true);
      expect(roster[0].label).toBe('Bạn');
      expect(roster[1].isPlayer).toBe(false);
      expect(roster[1].label).toBe('Bot 1');
    });

    it('gives every row four ability slots, Q W E R', () => {
      for (const row of source.roster()) {
        expect(row.abilities.map(ability => ability.letter)).toEqual(['Q', 'W', 'E', 'R']);
      }
    });

    it('gives a bot a behaviour and the player none', () => {
      const roster = source.roster();
      expect(roster[0].behaviour).toBeUndefined();
      expect(roster[1].behaviour).toEqual({
        autoMove: expect.any(Boolean),
        autoAttack: expect.any(Boolean),
        autoCast: expect.any(Boolean),
        difficulty: expect.any(String),
      });
    });

    it('reports the bot count and whether another fits', () => {
      expect(source.botCount()).toBe(1);
      expect(source.canAddBot()).toBe(true);
    });

    it('adds a bot', async () => {
      await source.addBot(MatchTeam.BLUE);
      expect(source.botCount()).toBe(2);
      expect(source.roster()).toHaveLength(3);
    });

    it('removes a bot by id and persists the smaller roster', async () => {
      const id = source.roster()[1].id;
      source.removeBot(id);
      expect(source.botCount()).toBe(0);
      expect(loadPregameConfig().ai.count).toBe(0);
    });

    it('refuses to add past the cap', async () => {
      while (source.canAddBot()) {
        await source.addBot(MatchTeam.BLUE);
      }
      expect(source.botCount()).toBe(AI_COUNT_MAX);
      await source.addBot(MatchTeam.BLUE);
      expect(source.botCount()).toBe(AI_COUNT_MAX);
    });
  });

  describe('sides', () => {
    it('moves the player to the other side and persists it', () => {
      const id = source.roster()[0].id;
      source.setTeam(id, MatchTeam.RED);
      expect(source.roster()[0].team).toBe(MatchTeam.RED);
      expect(loadPregameConfig().playerTeam).toBe(MatchTeam.RED);
    });

    it('adds a bot to the side it was asked for', async () => {
      await source.addBot(MatchTeam.RED);
      const added = source.roster()[source.roster().length - 1];
      expect(added.team).toBe(MatchTeam.RED);

      await source.addBot(MatchTeam.BLUE);
      const next = source.roster()[source.roster().length - 1];
      expect(next.team).toBe(MatchTeam.BLUE);
    });

    it('moves a bot and persists it', () => {
      const row = source.roster()[1];
      const other = row.team === MatchTeam.BLUE ? MatchTeam.RED : MatchTeam.BLUE;
      source.setTeam(row.id, other);
      expect(source.roster()[1].team).toBe(other);
      expect(loadPregameConfig().ai.botTeams[0]).toBe(other);
    });
  });

  describe('per-bot behaviour', () => {
    it('sets one flag without disturbing the others, and persists it', () => {
      const id = source.roster()[1].id;
      source.setBotBehaviour(id, { autoCast: false });

      const behaviour = source.roster()[1].behaviour!;
      expect(behaviour.autoCast).toBe(false);
      expect(behaviour.autoMove).toBe(true);
      expect(loadPregameConfig().ai.botBehaviours[0].autoCast).toBe(false);
      expect(loadPregameConfig().ai.botBehaviours[0].autoMove).toBe(true);
    });

    /**
     * The tier travels inside `BotBehaviour` rather than beside it, which is
     * what makes it one control on the same row and one setter for all four
     * fields. A row that carried the flags but not the tier would be the exact
     * shape of divergence this suite exists to catch.
     */
    it('carries the bot’s difficulty on the row, normal until it is set', () => {
      expect(source.roster()[1].behaviour!.difficulty).toBe('normal');
    });

    it('sets the difficulty without disturbing the flags, and persists it', () => {
      const id = source.roster()[1].id;
      source.setBotBehaviour(id, { difficulty: 'hard' });

      const behaviour = source.roster()[1].behaviour!;
      expect(behaviour.difficulty).toBe('hard');
      expect(behaviour.autoMove).toBe(true);
      expect(behaviour.autoAttack).toBe(true);
      expect(behaviour.autoCast).toBe(true);
      expect(loadPregameConfig().ai.botBehaviours[0].difficulty).toBe('hard');
    });

    it('leaves the difficulty alone when only a flag is sent', () => {
      const id = source.roster()[1].id;
      source.setBotBehaviour(id, { difficulty: 'easy' });
      source.setBotBehaviour(id, { autoMove: false });

      expect(source.roster()[1].behaviour!.difficulty).toBe('easy');
      expect(loadPregameConfig().ai.botBehaviours[0].difficulty).toBe('easy');
    });

    it('ignores a behaviour set on the player', () => {
      const id = source.roster()[0].id;
      expect(() => source.setBotBehaviour(id, { autoCast: false })).not.toThrow();
      expect(source.roster()[0].behaviour).toBeUndefined();
    });
  });

  describe('loadouts', () => {
    it('reads back the loadout it was given, and persists it', async () => {
      const id = source.roster()[0].id;
      await source.applyLoadout(id, {
        ...DEFAULT_PREGAME_CONFIG.player,
        mode: 'champion',
        championName: 'Ahri',
      });
      expect(source.loadoutOf(id).championName).toBe('Ahri');
      expect(loadPregameConfig().player.championName).toBe('Ahri');
    });
  });

  describe('rules', () => {
    it('applies and persists a rules change', () => {
      source.setRules({ cooldownReductionPercent: 40, manaFree: true }, true);
      expect(source.getRules()).toEqual({ cooldownReductionPercent: 40, manaFree: true });
      expect(loadPregameConfig().rules.cooldownReductionPercent).toBe(40);
      expect(source.matchRules.cooldownMultiplier).toBeCloseTo(0.6);
      expect(source.matchRules.manaFree).toBe(true);
    });

    it('clamps out-of-range CDR the same way in both sources', () => {
      source.setRules({ cooldownReductionPercent: 999, manaFree: false }, true);
      expect(source.getRules().cooldownReductionPercent).toBe(90);
    });

    it('does not write storage mid-drag', () => {
      source.setRules({ cooldownReductionPercent: 10, manaFree: false }, true);
      const before = localStorage.getItem('moba2d:pregameConfig:v1');
      source.setRules({ cooldownReductionPercent: 70, manaFree: false }, false);
      expect(localStorage.getItem('moba2d:pregameConfig:v1')).toBe(before);
      // …but the label still reads the value being dragged.
      expect(source.getRules().cooldownReductionPercent).toBe(70);
    });
  });

  describe('world', () => {
    it('switches the jungle and the minions independently, and persists both', () => {
      source.setWorld({ jungle: false });
      expect(source.getWorld()).toEqual({ jungle: false, minions: true });
      expect(loadPregameConfig().world.jungle).toBe(false);

      source.setWorld({ minions: false });
      expect(source.getWorld()).toEqual({ jungle: false, minions: false });
      expect(loadPregameConfig().world.minions).toBe(false);
    });
  });

  /**
   * Task 10 of the content-pack extraction. `getMap`/`setMap` genuinely
   * differ by source — see `MatchConfigSource.getMap`'s own doc comment —
   * and that difference is asserted here rather than skipped, the same way
   * `roster()[].title` is: `PregameConfigSource` reports back whatever was
   * last chosen, because outside a match a choice and a setting are the same
   * fact; `MatchDirectorSource` keeps reporting the map the match actually
   * booted onto no matter what is picked, because nothing in this seam
   * rebuilds a live terrain map or nav grid — the only way to actually play
   * a different one is to leave this match and start a new one.
   */
  describe('map', () => {
    it('lists every installed map, by qualified id', () => {
      const maps = source.availableMaps();
      const ids = maps.map(map => map.id);
      // The reference pack's map is core's own and is always here; Summoner's
      // Rift belongs to the riot pack and is not. Asserting `>= 2` and naming
      // both was a literal about which packs a checkout has —
      // content-pack-extraction batch 5 task 8's drill scored it `expected 1
      // to be greater than or equal to 2` with the riot pack moved out of the
      // tree, which is the correct answer to the wrong question. What this
      // test is actually about is that ids come back *qualified*, which is
      // batch 2's last bug (a picker that stored the bare local id and then
      // rerolled to something random at match start).
      expect(ids).toContain('reference:proving-grounds');
      if (packIsInstalled('riot')) expect(ids).toContain('riot:summoners-rift');
      expect(ids.length).toBe(packIsInstalled('riot') ? 2 : 1);
      for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*:.+$/);
    });

    it('reads a qualified id', () => {
      expect(source.getMap()).toBe(DEFAULT_MAP_ID);
    });

    it('persists a different choice through storage, as the qualified id', () => {
      const other = source.availableMaps().find(map => map.id !== source.getMap())!;
      source.setMap(other.id);
      expect(loadPregameConfig().mapId).toBe(other.id);
    });

    it(
      isPregame
        ? 'reports the newly chosen map immediately — there is no running world to disagree with it'
        : 'keeps reporting the running match’s own map — a live world cannot be swapped from under it',
      () => {
        const before = source.getMap();
        const other = source.availableMaps().find(map => map.id !== before)!;

        source.setMap(other.id);

        if (isPregame) {
          expect(source.getMap()).toBe(other.id);
        } else {
          expect(source.getMap()).toBe(before);
          // The choice still lands in storage — it is what the *next* match
          // boots onto — even though this running one does not move.
          expect(loadPregameConfig().mapId).toBe(other.id);
        }
      }
    );
  });

  describe('cheats', () => {
    it('makes one participant invulnerable, on the row and in storage', () => {
      const id = source.roster()[1].id;
      source.setInvulnerable(id, true);

      expect(source.roster()[1].invulnerable).toBe(true);
      expect(source.roster()[0].invulnerable).toBe(false);
      expect(loadPregameConfig().cheats.botInvulnerable[0]).toBe(true);
      expect(loadPregameConfig().cheats.playerInvulnerable).toBe(false);
    });

    it('switches invulnerability back off', () => {
      const id = source.roster()[0].id;
      source.setInvulnerable(id, true);
      source.setInvulnerable(id, false);
      expect(source.roster()[0].invulnerable).toBe(false);
      expect(loadPregameConfig().cheats.playerInvulnerable).toBe(false);
    });

    it('reveals the map and persists it', () => {
      source.setCheats({ revealMap: true });
      expect(source.getCheats().revealMap).toBe(true);
      expect(loadPregameConfig().cheats.revealMap).toBe(true);
    });

    it('lights a debug layer and persists it', () => {
      source.setCheats({ debug: { ...source.getCheats().debug, quadtree: true } });
      expect(source.getCheats().debug.quadtree).toBe(true);
      expect(source.getCheats().debug.vision).toBe(false);
      expect(loadPregameConfig().cheats.debug.quadtree).toBe(true);
    });

    it('toggles the FPS overlay like any other debug layer, and persists it', () => {
      source.setCheats({ debug: { ...source.getCheats().debug, fps: true } });
      expect(source.getCheats().debug.fps).toBe(true);
      expect(source.getCheats().debug.terrain).toBe(false);
      expect(loadPregameConfig().cheats.debug.fps).toBe(true);
    });
  });

  describe('device settings', () => {
    it('stores an input mode choice and reports the resolved layout separately', () => {
      source.setInputMode('touch');
      expect(source.inputMode).toBe('touch');
      expect(typeof source.touchUi).toBe('boolean');

      source.setInputMode('auto');
      expect(source.inputMode).toBe('auto');
    });

    it('stores render quality and the FPS cap', () => {
      source.setRenderQuality('low');
      source.setRenderFps(30);
      expect(source.renderQuality).toBe('low');
      expect(source.renderFps).toBe(30);
    });
  });

  describe('live controls', () => {
    it('offers them only when a match is running', () => {
      expect(source.live === null).toBe(isPregame);
    });

    /**
     * The panel's other capability flag. Both sources answer `true` here
     * because neither bench is a LAN client — `netRole` is `'off'` for the
     * whole of this file, which is the ordinary case and the one every other
     * assertion above depends on. What a client may and may not do is
     * `tests/game/config/netClientMatchSettings.test.ts`; what belongs *here*
     * is that the flag exists on both implementations and does not
     * accidentally lock the single-player panel.
     */
    it('lets this device edit the match settings when it is not a LAN client', () => {
      expect(source.canEditMatchSettings).toBe(true);
    });

    /**
     * Gold and items are cheats, not settings: they change the match rather
     * than describing it, and `PregameConfig` has no wallet to write either
     * into. So they live behind `live` with refill and clear-cooldowns, and
     * the pregame source is right to offer nothing.
     *
     * They exist because bots do not buy anything. The player earns gold and
     * shops; a bot earns gold and has nowhere to spend it, so a match drifts
     * one-sided a few minutes in — and this panel is the way to a fair fight
     * until the AI has a shop of its own.
     */
    it('hands out gold, and reports what a participant has', () => {
      if (!source.live) return;
      const id = source.roster()[0].id;
      const before = source.live.goldOf(id);

      source.live.grantGold(id, 1_000);

      expect(source.live.goldOf(id)).toBe(before + 1_000);
    });

    it('lists what any installed pack sells, so a bot can be handed one', () => {
      if (!source.live) return;
      // The list is whatever the installed packs ship — possibly nothing, and
      // that is a legal state (every pack predating items). What is checked is
      // the *shape*, because an entry missing `cost` renders as `— undefined`
      // in the picker.
      seedItems();
      const listed = source.live.itemStock();
      expect(listed.length, 'the probe pack never reached the catalogue').toBeGreaterThan(0);

      for (const option of listed) {
        expect(typeof option.id).toBe('string');
        expect(typeof option.name).toBe('string');
        expect(Number.isFinite(option.cost)).toBe(true);
      }
    });

    /**
     * The roster's way into the shop. Asserted as delegation rather than as an
     * outcome because the outcome is a Vue panel: what this seam owes is that
     * the *id* survives the trip, so the shop opens over the unit whose row
     * was pressed and not over the player.
     */
    it('hands the shop panel to a named unit', () => {
      if (!source.live) return;
      const id = source.roster()[0].id;
      openedShopFor.length = 0;

      source.live.openShopFor(id);

      expect(openedShopFor).toEqual([id]);
    });

    it('empties a bag without charging or refunding anything', () => {
      if (!source.live) return;
      const id = source.roster()[0].id;
      const before = source.live.goldOf(id);

      source.live.clearItems(id);

      expect(source.live.goldOf(id), 'clearing the bag paid a refund').toBe(before);
    });

    /**
     * The bag, read back — the one question `MatchLiveControls` could not
     * answer.
     *
     * It had `giveItem`, `clearItems` and `itemStock` and no way to ask what a
     * unit is actually *holding*, so a roster row could hand a bot an item and
     * then show nothing about it. Six slots always, the empty ones included,
     * for the reason `ItemSlotDisplay` gives about the player's own bar: a
     * fixed shape reads at a glance where a list that grows as items are
     * bought does not.
     */
    it('reports a bag as six slots, the empty ones included', () => {
      if (!source.live) return;
      const [boots] = seedItems();
      const id = source.roster()[0].id;
      source.live.clearItems(id);

      source.live.giveItem(id, boots.id);
      const slots = source.live.itemsOf(id);

      expect(slots.length).toBe(INVENTORY_SIZE);
      expect(slots[0].filled).toBe(true);
      expect(slots[0].name).toBe(boots.name);
      expect(slots[1].filled, 'an untouched slot came back filled').toBe(false);
      expect(slots[1].name).toBe('');
    });

    /**
     * A pack may name art nothing registered — `seedItems`' `ghost` is exactly
     * that, and `HeldItem.icon` is `null` for it. `''` rather than `null`, so
     * a row has one falsy value to guard on: the same shape `ItemSlotDisplay`
     * already uses for an unregistered icon in the player's own bar.
     */
    it('carries an empty url for an item whose art nothing registered', () => {
      if (!source.live) return;
      const [, ghost] = seedItems();
      const id = source.roster()[0].id;
      source.live.clearItems(id);

      source.live.giveItem(id, ghost.id);

      expect(source.live.itemsOf(id)[0]).toEqual({ filled: true, url: '', name: ghost.name });
    });
  });

  describe('reset', () => {
    it('puts the config back to the defaults', async () => {
      source.setRules({ cooldownReductionPercent: 50, manaFree: true }, true);
      source.setTeam(source.roster()[0].id, MatchTeam.RED);
      source.setInvulnerable(source.roster()[0].id, true);

      await source.resetToDefaults();

      expect(source.getRules()).toEqual(DEFAULT_PREGAME_CONFIG.rules);
      expect(source.roster()[0].team).toBe(DEFAULT_PREGAME_CONFIG.playerTeam);
      expect(source.roster()[0].invulnerable).toBe(false);
      expect(loadPregameConfig().rules).toEqual(DEFAULT_PREGAME_CONFIG.rules);
      expect(loadPregameConfig().cheats.playerInvulnerable).toBe(false);
    });

    it('puts the stored map choice back to the default too', async () => {
      const other = source.availableMaps().find(map => map.id !== DEFAULT_MAP_ID)!;
      source.setMap(other.id);
      expect(loadPregameConfig().mapId).toBe(other.id);

      await source.resetToDefaults();

      expect(loadPregameConfig().mapId).toBe(DEFAULT_MAP_ID);
    });
  });
});
