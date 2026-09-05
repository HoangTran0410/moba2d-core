import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MATCH_TEMPLATES_STORAGE_KEY,
  MATCH_TEMPLATE_NAME_MAX,
  TEMPLATE_BAG_CAP,
  deleteMatchTemplate,
  loadMatchTemplates,
  renameMatchTemplate,
  sanitizeTemplateItems,
  saveMatchTemplate,
  stashTemplateItems,
  takeTemplateItems,
} from '../../../src/game/config/matchTemplates';
import {
  AI_COUNT_MAX,
  DEFAULT_PREGAME_CONFIG,
  sanitizePregameConfig,
} from '../../../src/game/config/PregameConfig';
import { MatchTeam } from '../../../src/game/config/MatchTeams';

/**
 * Same in-memory `localStorage` as `savedKits.test.ts`, for the same reason:
 * this vitest environment is `node` and has no ambient storage at all.
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

/** A setup that is not the defaults, so a round-trip proves the fields moved. */
const SETUP = {
  config: sanitizePregameConfig({
    ...DEFAULT_PREGAME_CONFIG,
    playerTeam: MatchTeam.RED,
    ai: { ...DEFAULT_PREGAME_CONFIG.ai, count: 5, autoCast: false },
    rules: { cooldownReductionPercent: 40, manaFree: true, recall: false },
    world: { jungle: false, minions: true },
  }),
  items: {
    player: ['probe:boots', 'probe:blade'],
    bots: [['probe:boots'], [], ['probe:ward']],
  },
};

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  // The stash is module state and outlives a stubbed storage — drain whatever
  // an earlier test parked, or a leftover would grant itself into this one.
  takeTemplateItems();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('matchTemplates', () => {
  it('round-trips a template, config and bags included', () => {
    const saved = saveMatchTemplate('Đấu trụ 5 bot', SETUP);
    expect(saved.name).toBe('Đấu trụ 5 bot');
    expect(saved.id).toBeTruthy();
    expect(saved.savedAt).toBeGreaterThan(0);

    const loaded = loadMatchTemplates();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].setup.config.ai.count).toBe(5);
    expect(loaded[0].setup.config.ai.autoCast).toBe(false);
    expect(loaded[0].setup.config.playerTeam).toBe(MatchTeam.RED);
    expect(loaded[0].setup.config.rules).toEqual({
      cooldownReductionPercent: 40,
      manaFree: true,
      recall: false,
    });
    expect(loaded[0].setup.config.world.jungle).toBe(false);
    expect(loaded[0].setup.items.player).toEqual(['probe:boots', 'probe:blade']);
    expect(loaded[0].setup.items.bots).toEqual([['probe:boots'], [], ['probe:ward']]);
  });

  it('lists newest first', () => {
    saveMatchTemplate('cũ', SETUP);
    saveMatchTemplate('mới', SETUP);
    expect(loadMatchTemplates().map(template => template.name)).toEqual(['mới', 'cũ']);
  });

  it('copies the setup rather than referencing the live draft', () => {
    const setup = {
      config: sanitizePregameConfig(DEFAULT_PREGAME_CONFIG),
      items: { player: ['probe:boots'], bots: [['probe:ward']] },
    };
    saveMatchTemplate('chụp lại', setup);
    // The caller keeps editing after the save, as the live panel does.
    setup.items.player.push('probe:blade');
    setup.config.ai = { ...setup.config.ai, count: 9 };

    const loaded = loadMatchTemplates()[0];
    expect(loaded.setup.items.player).toEqual(['probe:boots']);
    expect(loaded.setup.config.ai.count).toBe(DEFAULT_PREGAME_CONFIG.ai.count);
  });

  it('trims and caps the name, and refuses a blank one', () => {
    const saved = saveMatchTemplate(`  ${'x'.repeat(MATCH_TEMPLATE_NAME_MAX + 10)}  `, SETUP);
    expect(saved.name.length).toBe(MATCH_TEMPLATE_NAME_MAX);
    expect(() => saveMatchTemplate('   ', SETUP)).toThrow();
  });

  it('renames, ignoring unknown ids and blank names', () => {
    const saved = saveMatchTemplate('tên cũ', SETUP);
    renameMatchTemplate(saved.id, '  tên mới  ');
    expect(loadMatchTemplates()[0].name).toBe('tên mới');

    renameMatchTemplate(saved.id, '   ');
    renameMatchTemplate('không-tồn-tại', 'gì đó');
    expect(loadMatchTemplates()[0].name).toBe('tên mới');
  });

  it('deletes by id and ignores an unknown one', () => {
    const saved = saveMatchTemplate('sắp xoá', SETUP);
    deleteMatchTemplate('không-tồn-tại');
    expect(loadMatchTemplates()).toHaveLength(1);
    deleteMatchTemplate(saved.id);
    expect(loadMatchTemplates()).toEqual([]);
  });

  it('reads a corrupt library as an empty one', () => {
    localStorage.setItem(MATCH_TEMPLATES_STORAGE_KEY, '{not json');
    expect(loadMatchTemplates()).toEqual([]);
    localStorage.setItem(MATCH_TEMPLATES_STORAGE_KEY, '"a string"');
    expect(loadMatchTemplates()).toEqual([]);
  });

  it('drops an entry with no identity and repairs one with a mangled config', () => {
    localStorage.setItem(
      MATCH_TEMPLATES_STORAGE_KEY,
      JSON.stringify([
        // No name: nothing worth resurrecting under a label the player never typed.
        { id: 'a', savedAt: 1, setup: { config: {}, items: {} } },
        // Identity intact, config garbage: repaired to a bootable one, the
        // same policy the stored match config itself has.
        {
          id: 'b',
          name: 'sửa được',
          savedAt: 2,
          setup: { config: { ai: { count: 'ten' } }, items: { player: [3, 'probe:ok'] } },
        },
      ])
    );

    const loaded = loadMatchTemplates();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('sửa được');
    expect(loaded[0].setup.config.ai.count).toBe(DEFAULT_PREGAME_CONFIG.ai.count);
    // The non-string bag entry is dropped, the real one kept.
    expect(loaded[0].setup.items.player).toEqual(['probe:ok']);
  });

  it('sanitizes bags: strings only, capped, bot slots capped', () => {
    const items = sanitizeTemplateItems({
      player: Array.from({ length: TEMPLATE_BAG_CAP + 5 }, (_, i) => `probe:item${i}`),
      bots: Array.from({ length: AI_COUNT_MAX + 4 }, () => ['probe:x']),
    });
    expect(items.player).toHaveLength(TEMPLATE_BAG_CAP);
    expect(items.bots).toHaveLength(AI_COUNT_MAX);

    expect(sanitizeTemplateItems(null)).toEqual({ player: [], bots: [] });
    expect(sanitizeTemplateItems({ player: 'probe:x', bots: 7 })).toEqual({
      player: [],
      bots: [],
    });
  });

  it('hands stashed bags over exactly once', () => {
    stashTemplateItems({ player: ['probe:boots'], bots: [['probe:ward'], []] });
    expect(takeTemplateItems()).toEqual({ player: ['probe:boots'], bots: [['probe:ward'], []] });
    // The second boot after a stash is an ordinary one.
    expect(takeTemplateItems()).toBeNull();
  });
});
