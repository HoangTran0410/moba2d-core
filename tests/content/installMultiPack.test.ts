/**
 * More than one pack installed at once.
 *
 * `tests/content/install.test.ts` beside this file imports `packs/riot`, so
 * it is pack-dependent and does not run in a checkout without that tree —
 * which is every checkout core's own CI has. This file imports no pack at
 * all. It reads whatever `src/generated/installedPacks.ts` says is installed,
 * which is one pack in core alone and four on a machine with the three
 * content repositories linked, and asserts the property that has to hold in
 * both.
 *
 * ## The bug it exists for
 *
 * Core's `BasicAttack` and `Recall` live in core, not in any pack, and a
 * pack's champions name them bare — `spells: ['BasicAttack']`,
 * `recall: 'Recall'`. `PackRegistry.writeData` qualifies a bare id against
 * **the pack that declared it**, so those become `<packId>:BasicAttack` and
 * `<packId>:Recall`, and `install.ts` folds core's own two spells onto the
 * pack so that the ids resolve.
 *
 * It folded them onto `index === 0` only. That was invisible while one
 * optional pack existed to be first; `installedPacks.ts` sorts by package
 * name and its own header warned the ordering "stops being theoretical the
 * moment a third pack exists". It did — `dota`, `lol`, `naruto` — `dota`
 * sorted first, and the League pack stopped installing:
 *
 *   content pack rejected:
 *     champions.lol:Đánh Thường: spell lol:BasicAttack is not in this pack
 *     champions.lol:Đánh Thường: recall lol:Recall is not in this pack
 *
 * Reported from the browser, because nothing here had ever installed a
 * second pack that names a core spell.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: { get: (key: string) => ({ key, path: key, status: 'ready', data: null }) },
}));

import { PackRegistry } from '../../src/content/PackRegistry';
import {
  BUNDLED_PACK_DATA,
  BUNDLED_PACKS,
  installBundledPackCode,
  installBundledPackData,
} from '../../src/content/install';
import { buildContentApi } from '../../src/content/ContentApi';

describe('every bundled pack, not only the first', () => {
  it('folds core’s BasicAttack onto each pack’s display data', () => {
    expect(BUNDLED_PACK_DATA.length).toBeGreaterThan(0);
    for (const data of BUNDLED_PACK_DATA) {
      expect(data.spellDisplay?.BasicAttack, data.manifest.id).toBeDefined();
      // `Recall` is deliberately display-less — it is a spell with no tooltip
      // — so the data half must *not* grow an entry for it.
      expect(data.spellDisplay?.Recall, data.manifest.id).toBeUndefined();
    }
  });

  it('folds core’s BasicAttack and Recall onto each pack’s code half', () => {
    const api = buildContentApi();
    for (let index = 0; index < BUNDLED_PACKS.length; index++) {
      const code = BUNDLED_PACKS[index](api);
      const id = BUNDLED_PACK_DATA[index].manifest.id;
      expect(code.spells?.BasicAttack, id).toBeTypeOf('function');
      expect(code.spells?.Recall, id).toBeTypeOf('function');
    }
  });

  it('installs every bundled pack without a rejection', () => {
    // The assertion the browser made for us. `installCode` runs
    // `verifyPairing`, which is what threw — so this is the real reproduction
    // rather than a restatement of the fold.
    const registry = new PackRegistry();
    installBundledPackData(registry);
    expect(() => installBundledPackCode(registry, buildContentApi())).not.toThrow();
  });

  it('leaves every champion’s slot 0 and way home resolvable, in every pack', async () => {
    const registry = new PackRegistry();
    installBundledPackData(registry);
    installBundledPackCode(registry, buildContentApi());

    const packIds = new Set(BUNDLED_PACK_DATA.map(data => data.manifest.id));
    for (const packId of packIds) {
      // Asked through the registry by qualified id, which is the lookup a
      // champion's own kit performs — not by reading the fold back.
      const attack = await registry.loadSpellClass(`${packId}:BasicAttack`);
      expect(attack, `${packId}:BasicAttack`).toBeTypeOf('function');
      const recall = await registry.loadSpellClass(`${packId}:Recall`);
      expect(recall, `${packId}:Recall`).toBeTypeOf('function');
    }
  });
});
