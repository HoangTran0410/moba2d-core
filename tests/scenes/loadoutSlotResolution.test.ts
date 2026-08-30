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
  contentCatalog: () => ({
    champions: () => [],
    // What the resolver's last branch walks: every id any installed pack has
    // display data for. The double carries the qualified spelling of the two
    // spells above so a *bare* lookup can still find them, which is the case
    // `BASIC_ATTACK_ID` and a persisted `summonerD` both arrive as.
    spellDisplayIds: () => ['lol:Alistar_Q'],
  }),
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

  /**
   * The other half of the same crossing, and the one that had no branch at all.
   *
   * Core names the basic attack bare (`BASIC_ATTACK_ID`) because it names a
   * spell every pack has and none owns, and a config persisted before packs
   * were installable holds its summoner spells bare for the same reason. Every
   * branch above is bundled-pack-shaped, so with only a *linked* pack installed
   * all three miss — and a miss reads as `'random'` in the loadout editor. The
   * A slot drew dice over a basic attack the player could not pick anywhere
   * else, because that shelf has no tile of its own.
   */
  it('resolves a bare id against whichever pack actually provides it', async () => {
    const { resolveCatalogEntry } = await load();
    expect(resolveCatalogEntry('Alistar_Q')?.display.name).toBe('Alistar Q');
  });

  it('but an exact id still wins, so no pack can shadow another', async () => {
    const { resolveCatalogEntry } = await load();
    // `Ahri_Q` is in the bundled map; the local-id sweep must never get a look
    // in ahead of it.
    expect(resolveCatalogEntry('Ahri_Q')?.display.name).toBe('Ahri Q');
  });
});
