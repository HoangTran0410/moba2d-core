import { describe, expect, it } from 'vitest';
import { describeTemplateGaps, templateGaps } from '../../../src/game/hud/config/templateGaps';
import {
  DEFAULT_MAP_ID,
  DEFAULT_PREGAME_CONFIG,
  sanitizePregameConfig,
} from '../../../src/game/config/PregameConfig';
import type { MatchTemplateSetup } from '../../../src/game/config/matchTemplates';
import { contentCatalog } from '../../../src/content/catalog';

/**
 * The visible half of the skip-quietly policy: what a saved "Trận mẫu" asks
 * for that this install cannot supply, said on the row before the press.
 *
 * Champion names are read off the live catalogue rather than written as
 * literals, so the suite holds in a core-alone checkout and in one with three
 * packs linked — and so no pack's vocabulary lands in a file of this repo.
 */

/** One probe pack per call, fresh id each time — `matchConfigSource.contract.test.ts`'s pattern. */
let probeSeed = 0;
const seedProbeItem = (): string => {
  const packId = `gapsprobe${probeSeed++}`;
  contentCatalog().installData({
    manifest: { id: packId, version: '1.0.0', coreRange: '*' },
    items: {
      boots: { id: 'boots', name: 'Giày Thử', icon: 'spell_basic_attack', cost: 300 },
    },
  } as never);
  return `${packId}:boots`;
};

const setupWith = (overrides: {
  championName?: string;
  botChampions?: string[];
  mapId?: string;
  playerItems?: string[];
  botItems?: string[][];
}): MatchTemplateSetup => {
  const config = sanitizePregameConfig({
    ...DEFAULT_PREGAME_CONFIG,
    player: {
      ...DEFAULT_PREGAME_CONFIG.player,
      championName: overrides.championName ?? 'random',
    },
    ai: {
      ...DEFAULT_PREGAME_CONFIG.ai,
      count: overrides.botChampions?.length ?? 0,
      bots: (overrides.botChampions ?? []).map(championName => ({
        ...DEFAULT_PREGAME_CONFIG.player,
        championName,
      })),
    },
    mapId: overrides.mapId ?? DEFAULT_MAP_ID,
  });
  return {
    config,
    items: { player: overrides.playerItems ?? [], bots: overrides.botItems ?? [] },
  };
};

describe('templateGaps', () => {
  it('reads a template this install can serve whole as gapless', () => {
    const installedItem = seedProbeItem();
    const installed = contentCatalog().champions();
    const gaps = templateGaps(
      setupWith({
        championName: installed.length ? installed[0].name : 'random',
        playerItems: [installedItem],
        mapId: DEFAULT_MAP_ID,
      })
    );

    expect(gaps).toEqual({ champions: [], missingItems: 0, mapMissing: false });
    expect(describeTemplateGaps(gaps)).toBeNull();
  });

  it('never flags random — a roll is not a reference', () => {
    const gaps = templateGaps(setupWith({ championName: 'random', botChampions: ['random'] }));
    expect(gaps.champions).toEqual([]);
  });

  it('names a champion nothing installed offers, once, across player and bots', () => {
    const gaps = templateGaps(
      setupWith({
        championName: 'Không Có Thật',
        botChampions: ['Không Có Thật', 'Cũng Không Có'],
      })
    );
    expect(gaps.champions).toEqual(['Không Có Thật', 'Cũng Không Có']);
  });

  it('ignores bot slots past the count — they are storage, not the match', () => {
    const setup = setupWith({ botChampions: [] });
    const bots = setup.config.ai.bots.slice();
    bots[3] = { ...bots[3], championName: 'Ngoài Biên Chế' };
    const gaps = templateGaps({
      ...setup,
      config: { ...setup.config, ai: { ...setup.config.ai, bots } },
      // A bag stored beside an inactive slot is not granted either.
      items: { player: [], bots: [[], [], [], ['nope:ghost']] },
    });
    expect(gaps.champions).toEqual([]);
    expect(gaps.missingItems).toBe(0);
  });

  it('counts bag ids that resolve to nothing, and only those', () => {
    const installedItem = seedProbeItem();
    const gaps = templateGaps(
      setupWith({
        botChampions: ['random'],
        playerItems: [installedItem, 'nope:ghost'],
        botItems: [['nope:another']],
      })
    );
    expect(gaps.missingItems).toBe(2);
  });

  it('flags a map id nothing installs', () => {
    expect(templateGaps(setupWith({ mapId: 'nope:mất-rồi' })).mapMissing).toBe(true);
    expect(templateGaps(setupWith({ mapId: DEFAULT_MAP_ID })).mapMissing).toBe(false);
  });

  it('writes the gaps as one line, in the panel vocabulary', () => {
    const line = describeTemplateGaps({
      champions: ['Không Có Thật'],
      missingItems: 2,
      mapMissing: true,
    });
    expect(line).toContain('Thiếu');
    expect(line).toContain('Không Có Thật');
    expect(line).toContain('2 trang bị');
    expect(line).toContain('bản đồ');
  });
});
