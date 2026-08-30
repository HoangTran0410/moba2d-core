/**
 * The pregame free-form kit builder's data source: `listSpellCatalog`,
 * `getSpellDisplay`, and the `mode: 'custom'` branch of
 * `getChampionPresetFromLoadout`. Every one of these is core's own
 * mechanism — it works over any corpus, including whichever pack (if any)
 * is actually installed — and is proved here against `packs/reference/`'s
 * own four spells plus `CoreSpells`.
 *
 * Content-pack-and-repo-split batch 6 task 10, fix round 2: this file used
 * to also carry the *catalogue-completeness audit* ("every export in the
 * `AllSpells` barrel appears in `SpellGroups`, and in `listSpellCatalog`")
 * and a *backward-compatibility promise* for pre-extraction save data
 * naming real riot champions by their old, bare id. Both are questions
 * about *whatever content is installed*, not about this mechanism, so both
 * left:
 *
 *   - The completeness audit moved to the pack's own suite
 *     (`catalogCompleteness.test.ts` there), reformulated against
 *     `data.ts`/`code.ts`/`generated/spellCatalog.ts` directly — the pack's
 *     own barrel and its own generated catalogue — rather than through
 *     `listSpellCatalog()`/`spellGroups()`, neither of which core publishes
 *     to a pack.
 *   - The backward-compatibility describe block ("a loadout persisted
 *     before content became packs still resolves") is retired outright,
 *     not moved: its underlying claim — a bare, unqualified id or champion
 *     name still resolves to a real spell/champion rather than a random
 *     one — is the exact property the rewritten tests below already prove
 *     with the reference pack's own bare ids (`'Vera_Q'`, not
 *     `'reference:Vera_Q'`), and `tests/game/practice/
 *     MatchDirector.loadout.test.ts`'s fixture-champion tests already prove
 *     the equivalent for `mode: 'champion'` (a real, bare champion name
 *     resolves to that champion's own kit, never a random one — round 1 of
 *     this same fix). What is genuinely lost is the *narrower*, riot-specific
 *     promise this block also carried — that an old browser save literally
 *     naming `'Yasuo'` or `'Ahri'` still resolves today — and re-proving
 *     that from the pack's own suite would need `getChampionPresetFromLoadout`
 *     published to a testing surface it is not on, which is a real, separate
 *     decision this fix round does not make.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as CoreSpells from '../../src/game/gameObject/coreSpells/index';
import {
  getChampionPresetFromLoadout,
  listSpellCatalog,
  getSpellDisplay,
  spellClassOfId,
} from '../../src/game/preset';
import { SLOT_COUNT, type ChampionLoadout } from '../../src/game/config/PregameConfig';
import { loadEverySpellForTests, AllSpells } from '../game/spell/registry';
import { contentRegistry } from '../../src/content/registry';

// Spell classes arrive by dynamic import in the game (`spellRegistry.ts`);
// this fills the registry synchronously so a test can read the whole
// catalogue without awaiting 238 of them.
beforeAll(loadEverySpellForTests);

// Two barrels — `spells/` (content) and `coreSpells/` (`BasicAttack`) —
// merged content-last, matching the catalogue generator.
const AllSpellsById: Record<string, unknown> = { ...AllSpells, ...CoreSpells };

describe('listSpellCatalog — display construction', () => {
  it('every catalogue id resolves back to the exact class AllSpells exports under it', () => {
    // The catalogue is generated data now; this is the join back to the code,
    // and the one assertion that would catch the generated file and the barrel
    // having drifted apart.
    for (const entry of listSpellCatalog()) {
      expect(spellClassOfId(entry.id)).toBe(AllSpellsById[entry.id]);
    }
  });

  it('gives every catalogue entry a non-null groupName, since every spell is in some SpellGroups shelf — except BasicAttack, which is cataloged for its own display but belongs to no single champion\'s shelf', () => {
    // `champion.spells` never lists `BasicAttack` for any real champion —
    // `planLoadout`/`planRandomKit` prepend it to slot 0 externally, the
    // same way they append the two summoner slots — so `shelfNameById()`
    // never has an entry for it and its groupName is null by construction,
    // not by omission. `install.ts`'s `dataWithCoreSpells` still folds a
    // `spellDisplay` entry for it onto every installed pack (core's own
    // fallback spell needs a name/icon in the HUD like any other), which is
    // why it is in the catalogue at all.
    const catalog = listSpellCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    const withoutGroup = catalog.filter(e => e.groupName === null && e.id !== 'BasicAttack');
    expect(withoutGroup.map(e => e.id)).toEqual([]);
  });

  it('constructs a real, non-empty description for every spell — the null-owner audit, pinned as a regression test', () => {
    const broken = listSpellCatalog().filter(
      e =>
        e.display.name === '?' ||
        typeof e.display.description !== 'string' ||
        e.display.description.length === 0
    );
    expect(broken.map(e => e.id)).toEqual([]);
  });
});

describe('getSpellDisplay — match-rules-aware numbers', () => {
  it('reports the raw and effective cooldown/mana as equal with no match rules', () => {
    const display = getSpellDisplay(AllSpells.Vera_Q);
    expect(display.effectiveCoolDownMs).toBe(display.coolDownMs);
    expect(display.effectiveManaCost).toBe(display.manaCost);
  });

  it('halves the effective cooldown at 50% reduction, leaving the raw number untouched', () => {
    const display = getSpellDisplay(AllSpells.Vera_Q, { cooldownMultiplier: 0.5, manaFree: false });
    expect(display.coolDownMs).toBe(6_000);
    expect(display.effectiveCoolDownMs).toBe(3_000);
  });

  it('zeroes the effective mana cost under URF, leaving the raw number untouched', () => {
    const display = getSpellDisplay(AllSpells.Vera_Q, { cooldownMultiplier: 1, manaFree: true });
    expect(display.manaCost).toBe(30);
    expect(display.effectiveManaCost).toBe(0);
  });

  it('carries the Vietnamese HTML description through untouched', () => {
    const display = getSpellDisplay(AllSpells.Vera_Q);
    expect(display.description).toContain('<span');
    expect(display.description.length).toBeGreaterThan(10);
  });
});

describe('getChampionPresetFromLoadout — mode: "custom"', () => {
  const customLoadout = (customSlots: string[]): ChampionLoadout => ({
    mode: 'custom',
    championName: 'random',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots,
  });

  it('resolves every slot to the exact spell class chosen, in the exact slot chosen', () => {
    // No summoner spell (Flash/Ghost/Heal/Ignite/StealthWard — packs/riot/'s
    // own content) is installed alongside the reference pack, so the two
    // repeats stand in for "some id, resolved in this exact slot" the same
    // way the original six distinct ids did — the property under test is
    // per-slot resolution, not that seven distinct spells exist.
    const slots = ['BasicAttack', 'Vera_Q', 'Vera_W', 'Vera_E', 'Vera_R', 'Vera_Q', 'Vera_W'];
    const preset = getChampionPresetFromLoadout(customLoadout(slots));
    expect(preset.spells).toEqual([
      CoreSpells.BasicAttack,
      AllSpells.Vera_Q,
      AllSpells.Vera_W,
      AllSpells.Vera_E,
      AllSpells.Vera_R,
      AllSpells.Vera_Q,
      AllSpells.Vera_W,
    ]);
  });

  it('allows a standalone (non-4-ability) spell in any slot, not only slot 0', () => {
    // `BasicAttack` is exactly this shape here — a real, resolvable spell
    // that belongs to no champion's four-ability kit — standing in for the
    // riot-specific stand-alone spells (`StealthWard`, `Heal`, ...) the
    // original test used, which left with that pack.
    const slots = ['Vera_Q', 'BasicAttack', 'Vera_W', 'BasicAttack', 'Vera_E', 'Vera_R', 'BasicAttack'];
    const preset = getChampionPresetFromLoadout(customLoadout(slots));
    expect(preset.spells).toEqual([
      AllSpells.Vera_Q,
      CoreSpells.BasicAttack,
      AllSpells.Vera_W,
      CoreSpells.BasicAttack,
      AllSpells.Vera_E,
      AllSpells.Vera_R,
      CoreSpells.BasicAttack,
    ]);
  });

  it('picks a random spell for a "random" slot, and for an unknown/stale id, rather than leaving the slot empty', () => {
    const slots = ['random', 'not-a-real-id', 'Vera_Q', 'random', 'random', 'random', 'random'];
    const preset = getChampionPresetFromLoadout(customLoadout(slots));
    expect(preset.spells).toHaveLength(SLOT_COUNT);
    expect(preset.spells[2]).toBe(AllSpells.Vera_Q);
    // A 'random' slot draws from `allSpellIds()`, which is a union across
    // every installed pack now (`spellRegistry.ts`) — not one pack's barrel
    // alone — so every name must belong to *some* installed pack's
    // displayable spell.
    const knownNames = new Set(Object.keys(AllSpellsById));
    for (const id of contentRegistry().spellDisplayIds()) {
      const spellClass = contentRegistry().spellClass(id);
      if (spellClass) knownNames.add((spellClass as { name: string }).name);
    }
    for (const spell of preset.spells)
      expect(knownNames.has((spell as { name: string }).name)).toBe(true);
  });

  it('pads a short customSlots array (e.g. from an older/corrupt save) rather than throwing', () => {
    const preset = getChampionPresetFromLoadout(customLoadout(['Vera_Q']));
    expect(preset.spells).toHaveLength(SLOT_COUNT);
    expect(preset.spells[0]).toBe(AllSpells.Vera_Q);
  });

  it('gives a custom kit a random avatar, same pool as a fully random champion', () => {
    // The pool is read off the registry rather than restated, so a pack
    // arriving or leaving cannot make this wrong again.
    const playable = contentRegistry()
      .champions()
      .filter(champion => champion.playable && champion.image);
    const avatars = new Set(playable.map(champion => champion.image));
    expect(avatars.size).toBeGreaterThan(0);
    const preset = getChampionPresetFromLoadout(customLoadout(Array(SLOT_COUNT).fill('random')));
    expect([...avatars]).toContain(preset.avatar);
  });
});
