import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * A slot the player just filled has to look filled.
 *
 * Reported with a screenshot: pick a champion in the loadout editor, press
 * "Dùng cả bộ", and the slot bar above still shows six dice glyphs — while
 * pressing Xác nhận produces exactly the kit that was picked. Two answers to
 * one question, and the wrong one is the one on screen.
 *
 * The cause is an id crossing. `SelectableChampionSpell.id` is the bundled
 * pack's *bare* id for a bundled champion and any other pack's
 * *registry-qualified* id for one of its champions — its own doc comment says
 * so. `catalogById` is keyed by the bare kind alone, so a plain
 * `catalogById.get('lol:Alistar_Q')` misses, the editor reads the miss as the
 * `'random'` sentinel, and `SpellIcon` draws its dice. Nothing is broken
 * downstream, which is why the confirmed match was right: the preset resolves
 * a champion by name and slot *position*, never through this map.
 *
 * `resolveCatalogEntry` is the crossing written once. The shelf builder in
 * `pregameCatalog.ts` already did it correctly and inline; this is that same
 * pair, exported, so the editor cannot get it wrong separately.
 */
vi.mock('@/game/config/spellCatalog', () => ({
  listSpellCatalog: () => [
    { id: 'Ahri_Q', display: { name: 'Ahri Q', iconUrl: 'ahri_q.webp' } },
    { id: 'BasicAttack', display: { name: 'Đánh Thường', iconUrl: 'basic.webp' } },
  ],
  listSummonerSpells: () => [],
  listSelectableChampions: () => [],
  bareCatalogId: (qualified: string) => (qualified.includes(':') ? null : qualified),
  packSpellCatalogEntry: (qualified: string) =>
    qualified === 'lol:Alistar_Q'
      ? { id: 'lol:Alistar_Q', display: { name: 'Alistar Q', iconUrl: 'alistar_q.webp' } }
      : null,
  abilitySlotOfId: () => 1,
  BASIC_ATTACK_ID: 'BasicAttack',
  packAsset: (key: string) => ({ url: key }),
}));

vi.mock('@/content/catalog', () => ({
  contentCatalog: () => ({ champions: () => [] }),
}));

vi.mock('@/content/installedPackStore', () => ({ readInstalledPacks: () => [] }));

/** `vi.resetModules()` in `beforeEach` is what clears the module's own cache. */
const load = () => import('@/scenes/setup/pregameCatalog');

describe('loadout slot id resolution', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('resolves the bundled pack’s bare id', async () => {
    const { resolveCatalogEntry } = await load();
    expect(resolveCatalogEntry('Ahri_Q')?.display.name).toBe('Ahri Q');
  });

  it('resolves a runtime pack’s qualified id — the reported bug', async () => {
    const { resolveCatalogEntry } = await load();
    expect(resolveCatalogEntry('lol:Alistar_Q')?.display.name).toBe('Alistar Q');
  });

  it('answers null for the random sentinel, which is not a miss', async () => {
    const { resolveCatalogEntry } = await load();
    expect(resolveCatalogEntry('random')).toBeNull();
  });

  it('answers null for an id no pack provides', async () => {
    const { resolveCatalogEntry } = await load();
    expect(resolveCatalogEntry('lol:Nobody_Q')).toBeNull();
  });
});
