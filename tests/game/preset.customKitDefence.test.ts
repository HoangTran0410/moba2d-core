import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same reason as `preset.runtimePack.test.ts`: the catalogue resolves portraits
// through `AssetManager` and this fixture's art does not exist. What is under
// test is a number, not whether a picture loads.
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
import { DEFAULT_CHAMPION_DEFENCE } from '@/game/gameObject/attackableUnits/Champion';
import type { ChampionLoadout } from '@/game/config/PregameConfig';
import type { LoadedPack } from '@/content/packSource';

/**
 * What a kit the player assembled by hand is made of.
 *
 * A custom kit — Q from one champion, R from another — has no archetype, so
 * `planLoadout` hands it `DEFAULT_CHAMPION_ATTACK` and says why. Durability
 * could not follow that lead, and the reason is the trap this file exists for:
 * `DEFAULT_CHAMPION_DEFENCE` is *the state before any pack declared a profile*
 * — 100 health, no resistances. The moment a pack spreads its roster from 125
 * to 220 health, a constant-defaulted custom kit stops being average and
 * becomes the single thinnest body in the game, thinner than the marksman,
 * with nothing anywhere saying why.
 *
 * So it is the roster's own average, which cannot fall out of the pack's range
 * however the pack is retuned.
 */
class Bolt {}

const roster = (
  id: string,
  champions: { name: string; health: number; armor: number; magicResist: number }[]
): LoadedPack =>
  ({
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
        ...champions.map(champion => ({
          id: champion.name,
          name: champion.name,
          image: 'hero',
          playable: true,
          spells: ['q', 'w', 'e', 'r'],
          defence: {
            health: champion.health,
            armor: champion.armor,
            magicResist: champion.magicResist,
          },
        })),
        {
          id: 'Summoners',
          name: 'Phép Bổ Trợ',
          image: null,
          playable: false,
          spells: ['Flash', 'Heal'],
          summonerShelf: true,
        },
      ],
      spellDisplay: Object.fromEntries(
        ['q', 'w', 'e', 'r', 'Flash', 'Heal'].map(slot => [
          slot,
          {
            name: slot,
            description: '',
            iconKey: 'hero',
            coolDownMs: 1000,
            manaCost: 10,
            specCoolDownMs: 1000,
          },
        ])
      ),
    },
    code: () => ({ spells: { q: Bolt, w: Bolt, e: Bolt, r: Bolt, Flash: Bolt, Heal: Bolt } }),
    assetManifest: {
      hero: { kind: 'image', url: 'https://h/p/assets/hero.png', path: 'hero.png' },
    },
    baseUrl: 'https://h/p/manifest.json',
  }) as unknown as LoadedPack;

const CUSTOM: ChampionLoadout = {
  mode: 'custom',
  championName: 'random',
  customSlots: ['random', 'random', 'random', 'random', 'random', 'random', 'random'],
  summonerD: 'Flash',
  summonerF: 'Heal',
};

/** Bounds of whatever roster is actually installed, core's own bundled pack included. */
const spread = (
  read: (health: { health: number; armor: number; magicResist: number }) => number
) => {
  const values = playableKits().map(kit => read(kit.defence));
  return { low: Math.min(...values), high: Math.max(...values) };
};

/** The three-argument form every other runtime-install test uses. */
const install = (pack: LoadedPack): void => {
  const registry = contentRegistry();
  installRuntimePack(registry, buildContentApi(registry), pack);
};

describe('a hand-assembled kit’s durability', () => {
  beforeEach(() => {
    resetContentRegistryForTests();
  });

  it('sits inside the roster it borrowed its abilities from', () => {
    install(
      roster('spread', [
        { name: 'Wall', health: 220, armor: 55, magicResist: 45 },
        { name: 'Glass', health: 130, armor: 15, magicResist: 15 },
      ])
    );

    const { defence } = planLoadout(CUSTOM);
    const health = spread(d => d.health);
    const armor = spread(d => d.armor);

    expect(defence.health).toBeGreaterThanOrEqual(health.low);
    expect(defence.health).toBeLessThanOrEqual(health.high);
    expect(defence.armor).toBeGreaterThanOrEqual(armor.low);
    expect(defence.armor).toBeLessThanOrEqual(armor.high);
  });

  it('is not left behind when the pack raises everyone', () => {
    // The actual bug: a constant here would still read 100 health and no
    // armour against a roster that starts at 130 and 15.
    install(
      roster('raised', [
        { name: 'Wall', health: 400, armor: 90, magicResist: 80 },
        { name: 'Also', health: 380, armor: 80, magicResist: 70 },
      ])
    );

    const { defence } = planLoadout(CUSTOM);

    expect(defence.health).toBeGreaterThan(DEFAULT_CHAMPION_DEFENCE.health);
    expect(defence.armor).toBeGreaterThan(DEFAULT_CHAMPION_DEFENCE.armor);
  });

  it('is a whole number of health, because a health bar prints one', () => {
    install(
      roster('odd', [
        { name: 'A', health: 101, armor: 1, magicResist: 1 },
        { name: 'B', health: 102, armor: 2, magicResist: 2 },
      ])
    );

    const { defence } = planLoadout(CUSTOM);

    expect(Number.isInteger(defence.health)).toBe(true);
    expect(Number.isInteger(defence.armor)).toBe(true);
    expect(Number.isInteger(defence.magicResist)).toBe(true);
  });

  it('falls back to core’s default when no champion declares a profile', () => {
    // Which is both the honest answer for such a pack and exactly what that
    // pack played like before this existed. `roster` with a zero-length list
    // would leave no playable champion at all, so one is declared with the
    // field simply absent.
    const plain = roster('plain', [{ name: 'Plain', health: 0, armor: 0, magicResist: 0 }]);
    const champions = (plain as unknown as { data: { champions: Record<string, unknown>[] } }).data
      .champions;
    delete champions[0].defence;

    install(plain);

    expect(planLoadout(CUSTOM).defence).toEqual(DEFAULT_CHAMPION_DEFENCE);
  });
});
