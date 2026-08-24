import { beforeEach, describe, expect, it, vi } from 'vitest';

// The picker's catalogue resolves a champion's portrait and each ability's
// icon through `AssetManager`, and this fixture's art does not exist. Stubbed
// rather than given real files: what is under test is which champions the
// lists contain after an install, not whether their pictures load.
vi.mock('@/managers/AssetManager', () => ({
  default: {
    get: () => ({ url: '', image: null }),
    getAsset: () => undefined,
    placeholder: () => undefined,
    registerPackAssets: () => undefined,
  },
}));
import { contentRegistry, resetContentRegistryForTests } from '@/content/registry';
import { buildContentApi } from '@/content/ContentApi';
import { installRuntimePack } from '@/content/install';
import { playableKits, planLoadout } from '@/game/preset';
import {
  listSelectableChampions,
  listSummonerSpells,
  packSpellCatalogEntry,
} from '@/game/config/spellCatalog';
import type { ChampionLoadout } from '@/game/config/PregameConfig';
import type { LoadedPack } from '@/content/packSource';

/**
 * A pack installed **after** core has already answered a question about its
 * own roster.
 *
 * This is the runtime-pack case and it is not the same as the bundled one. A
 * bundled pack is in the registry before anything reads it; a runtime pack is
 * installed *into the registry that is already being read from*, without a
 * reload — `installPackNow`, spec §5.2 — so every memo core holds over that
 * registry has to notice.
 *
 * Reported from a real browser: after installing the LMHT pack the picker
 * listed all 58 champions, and choosing one still spawned Vera. The picker
 * reads `getPregameCatalog()`, which `PacksScene` resets on a successful
 * install; `planLoadout` reads `playableKits()`, which was memoised on the
 * *identity* of the registry — and a runtime install mutates that very
 * instance rather than replacing it, so the identity never changed and the
 * pre-install list (core's one reference champion) answered forever.
 * `planLoadout` then failed to find the name, fell through to
 * `planRandomKit()`, and rolled the only champion it could see.
 */
class Bolt {}

/** Four abilities and a portrait, which is what `validate.ts` requires of a playable champion. */
const playablePack = (id: string, championName: string): LoadedPack => ({
  manifest: {
    id,
    version: '1.0.0',
    coreRange: '>=1.0.0',
    name: id,
    entry: 'pack.js',
    assets: 'assets/',
  },
  data: {
    manifest: { id, version: '1.0.0', coreRange: '>=1.0.0', assets: 'assets/' },
    champions: [
      {
        id: championName,
        name: championName,
        image: 'hero',
        playable: true,
        spells: ['q', 'w', 'e', 'r'],
        recall: 'Recall',
      },
      // The D/F shelf, exactly the shape the real pack ships: one row that is
      // not a champion, flagged `summonerShelf`, holding the summoner spells.
      {
        id: 'Summoners',
        name: 'Phép Bổ Trợ',
        image: null,
        playable: false,
        spells: ['Flash', 'Heal'],
        summonerShelf: true,
      },
    ],
    // Real display entries, not `{}`: `listSpellCatalog` maps
    // `spellDisplayIds()`, so an empty display half gives the catalogue
    // nothing to list and the assertion below would fail for a reason that
    // has nothing to do with caching.
    spellDisplay: Object.fromEntries(
      ['q', 'w', 'e', 'r', 'Flash', 'Heal'].map(slot => [
        slot,
        {
          name: `${championName} ${slot.toUpperCase()}`,
          description: '',
          iconKey: 'hero',
          coolDownMs: 1000,
          manaCost: 10,
          specCoolDownMs: 1000,
        },
      ])
    ),
  } as unknown as LoadedPack['data'],
  code: () => ({ spells: { q: Bolt, w: Bolt, e: Bolt, r: Bolt, Flash: Bolt, Heal: Bolt } }),
  assetManifest: {
    hero: { kind: 'image', url: 'https://h/p/assets/hero.png', path: 'hero.png' },
  },
  baseUrl: 'https://h/p/manifest.json',
});

const championLoadout = (name: string): ChampionLoadout => ({
  mode: 'champion',
  championName: name,
  summonerD: 'Flash',
  summonerF: 'Heal',
  customSlots: [],
});

describe('a pack installed at runtime, after the roster has been read once', () => {
  beforeEach(() => {
    resetContentRegistryForTests();
  });

  it('adds its playable champions to playableKits()', () => {
    const registry = contentRegistry();
    // The read that populates the memo. Without it the bug is invisible:
    // a first read after the install is correct, and that is what every
    // existing test does.
    expect(playableKits().map(kit => kit.name)).not.toContain('Probey');

    installRuntimePack(registry, buildContentApi(registry), playablePack('probe', 'Probey'));

    expect(playableKits().map(kit => kit.name)).toContain('Probey');
  });

  /**
   * The net under the specific fix.
   *
   * `playableKits` was one memo; the class of bug is "core cached something
   * about installed content and a runtime install did not invalidate it".
   * Rather than scan the source for cache shapes, this asks every list core
   * publishes about its roster the same question, so a memo added to any of
   * them later fails here instead of in a browser.
   */
  it('shows up in every list core publishes about installed content', () => {
    const registry = contentRegistry();
    // Populate whatever each of these memoises, before the install.
    playableKits();
    listSelectableChampions();
    packSpellCatalogEntry('probe:q');

    installRuntimePack(registry, buildContentApi(registry), playablePack('probe', 'Probey'));

    expect(
      playableKits().map(kit => kit.name),
      'playableKits'
    ).toContain('Probey');
    expect(
      listSelectableChampions().map(champion => champion.name),
      'listSelectableChampions'
    ).toContain('Probey');
    // `listSpellCatalog()` is deliberately *not* asked: it is the bundled
    // pack's own catalogue by design (see `bareCatalogId`), and a foreign
    // pack's abilities are reached through this seam instead.
    expect(packSpellCatalogEntry('probe:q')?.id, 'packSpellCatalogEntry').toBe('probe:q');
  });

  it('bumps the registry content revision, which is what any memo must key on', () => {
    const registry = contentRegistry();
    const before = registry.contentRevision;

    installRuntimePack(registry, buildContentApi(registry), playablePack('probe', 'Probey'));

    expect(registry.contentRevision).not.toBe(before);
  });

  /**
   * The same split, one field over.
   *
   * `summonerSpellIds()` finds the pack's `summonerShelf` row and then ran
   * every id through `bareCatalogId`, which answers `null` for anything that
   * is not the *bundled* pack's own. That narrowing was written when the
   * bundled pack was the one carrying the summoner shelf; core's bundled pack
   * carries none now, so the list came back empty for every runtime pack.
   * `summonerIdOr` then fell through to `ids[0] ?? choice` — `'Flash'`, a bare
   * name the registry has never heard of, since it stores `probe:Flash` — and
   * `classForId` degraded both D and F to a basic attack.
   */
  it('offers the pack’s summoner spells, and resolves a stored bare name to one', () => {
    const registry = contentRegistry();
    installRuntimePack(registry, buildContentApi(registry), playablePack('probe', 'Probey'));

    expect(listSummonerSpells().map(option => option.id)).toContain('probe:Flash');

    // `PregameConfig`'s own defaults are the bare names, and every save made
    // before the split holds them too.
    const plan = planLoadout({
      ...championLoadout('Probey'),
      summonerD: 'Flash',
      summonerF: 'Heal',
    });
    // spellIds is [BasicAttack, Q, W, E, R, D, F].
    expect(plan.spellIds[5], 'D').toBe('probe:Flash');
    expect(plan.spellIds[6], 'F').toBe('probe:Heal');
  });

  it('resolves a loadout naming one of them to that champion, not to a random one', () => {
    const registry = contentRegistry();
    playableKits();

    installRuntimePack(registry, buildContentApi(registry), playablePack('probe', 'Probey'));

    // The user-visible symptom: confirm a champion, get someone else.
    expect(planLoadout(championLoadout('Probey')).name).toBe('Probey');
  });
});
