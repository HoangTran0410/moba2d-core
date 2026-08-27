import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same reason as `preset.runtimePack.test.ts`: the catalogue resolves portraits
// through `AssetManager` and this fixture's art does not exist. What is under
// test is which id lands in a slot, not whether a picture loads.
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
import { planLoadout } from '@/game/preset';
import { BASIC_ATTACK_ID } from '@/game/config/spellCatalog';
import type { ChampionLoadout } from '@/game/config/PregameConfig';
import type { LoadedPack } from '@/content/packSource';

/**
 * Slot 0 is the A key and the basic-attack input path: `BasicAttackController`
 * drives whatever sits there, and a champion whose slot 0 holds an ordinary
 * ability cannot auto-attack at all. `planSlot` used to roll a `'random'`
 * choice in *any* slot from the whole catalogue, so a custom kit whose A was
 * left to chance — the dice button, or a stored default of seven `'random'`s —
 * usually spawned with no basic attack.
 *
 * The roll is the thing under test, so one call proves nothing: with seven ids
 * installed a broken roll still lands on the basic attack one time in seven.
 * Every trial must agree.
 */
class Bolt {}

const TRIALS = 20;

const pack = (): LoadedPack =>
  ({
    manifest: {
      id: 'p',
      version: '1.0.0',
      coreRange: '>=1.0.0',
      name: 'p',
      entry: 'pack.js',
      assets: 'assets/',
    },
    data: {
      manifest: { id: 'p', version: '1.0.0', coreRange: '>=1.0.0', assets: 'assets/' },
      champions: [
        {
          id: 'Hero',
          name: 'Hero',
          image: 'hero',
          playable: true,
          spells: ['q', 'w', 'e', 'r'],
        },
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

describe('the A slot of a custom kit', () => {
  beforeEach(() => {
    resetContentRegistryForTests();
    const registry = contentRegistry();
    installRuntimePack(registry, buildContentApi(registry), pack());
  });

  it("resolves 'random' to the basic attack, never to a rolled ability", () => {
    for (let trial = 0; trial < TRIALS; trial++) {
      expect(planLoadout(CUSTOM).spellIds[0]).toBe(BASIC_ATTACK_ID);
    }
  });

  it('still rolls the ability slots from the catalogue', () => {
    // The fix must not widen: Q–R and D–F keep their dice. Across the trials
    // at least one non-basic-attack id has to land somewhere, or slot 0's
    // fallback has leaked into the others.
    const rolled = new Set<string>();
    for (let trial = 0; trial < TRIALS; trial++) {
      for (const id of planLoadout(CUSTOM).spellIds.slice(1)) rolled.add(id);
    }
    expect([...rolled].some(id => id !== BASIC_ATTACK_ID)).toBe(true);
  });
});
