import { describe, expect, it } from 'vitest';
import { validatePack, validatePackData } from '@/content/validate';
import { PackRegistry } from '@/content/PackRegistry';
import type { ContentPack } from '@/content/ContentPack';

const manifest = { id: 'ref', version: '1.0.0', coreRange: '^1' };

const item = (over: Record<string, unknown> = {}) => ({
  id: 'boots',
  name: 'Giày',
  icon: 'item_boots',
  cost: 300,
  ...over,
});

/**
 * An item is content a pack declares, and validation is the only thing
 * standing at that boundary — the same argument the rest of `validate.ts`
 * makes. The specific silent failures here:
 *
 *   - a stat key that is not a stat grants nothing, forever, with nothing
 *     anywhere to look at;
 *   - a `passive`/`active` naming a spell the pack does not ship builds an
 *     item whose whole point never happens, and the player is simply out the
 *     gold.
 */
describe('validating a pack’s items', () => {
  it('accepts a pack that declares none, which is most of them', () => {
    expect(validatePack({ manifest }).ok).toBe(true);
  });

  it('accepts an item that grants nothing at all', () => {
    // A component a bigger item is built out of is exactly this. Refusing it
    // would mean a pack could not express a build path.
    expect(validatePack({ manifest, items: { boots: item() } }).ok).toBe(true);
  });

  it('refuses an entry whose key and id disagree', () => {
    // The map key is what everything else looks the item up by; an `id` that
    // says something else is two names for one thing.
    const result = validatePack({ manifest, items: { boots: item({ id: 'shoes' }) } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/shoes|boots/);
  });

  it('refuses an item with no icon', () => {
    const result = validatePack({ manifest, items: { boots: item({ icon: undefined }) } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/icon/);
  });

  it('refuses a negative price but allows a free one', () => {
    expect(validatePack({ manifest, items: { boots: item({ cost: 0 }) } }).ok).toBe(true);
    const result = validatePack({ manifest, items: { boots: item({ cost: -5 }) } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/cost/);
  });

  it('names the stat key that is not a stat', () => {
    const result = validatePack({
      manifest,
      items: { boots: item({ stats: { speed: 25, abilityPower: 40 } }) },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/abilityPower/);
  });

  it('refuses a stat the shop must never grant, however real the field is', () => {
    // `health` is a *current pool*. An item granting it would top a champion
    // up on equip and take that health back on sale — a shop that can kill
    // you. See `ITEM_STAT_KEYS`.
    const result = validatePack({ manifest, items: { boots: item({ stats: { health: 500 } }) } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/health/);
  });

  it('names the spell an item’s passive points at when the pack does not ship it', () => {
    const result = validatePack({
      manifest,
      spells: { Boots_P: class {} },
      items: { boots: item({ passive: 'Boots_P', active: 'Boots_A' }) },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/Boots_A/);
  });

  it('does not cross-check spell ids while only the data half is on the table', () => {
    // The identical guard `checkChampions` and `checkSpellDisplay` already
    // make: a `ContentPackData` has no `spells` key at all, so there is
    // nothing yet to check against — and `install()` still validates the
    // merged pack before either half is written.
    expect(validatePackData({ manifest, items: { boots: item({ active: 'Boots_A' }) } }).ok).toBe(
      true
    );
  });
});

/**
 * Installed items are namespaced like everything else a pack ships. Two packs
 * may each reasonably call an item `boots`, and the author of either writes
 * only the local half.
 */
describe('items in the registry', () => {
  const install = (pack: unknown): PackRegistry => {
    const registry = new PackRegistry();
    registry.install(pack as ContentPack);
    return registry;
  };

  it('qualifies the id, so two packs may each ship a "boots"', () => {
    const registry = install({ manifest, items: { boots: item() } });
    expect(registry.items().map(entry => entry.id)).toEqual(['ref:boots']);
    expect(registry.item('ref:boots')?.name).toBe('Giày');
  });

  it('answers null for an id nobody declared', () => {
    expect(install({ manifest }).item('ref:nothing')).toBeNull();
  });

  it('qualifies the spell ids an item points at', () => {
    const registry = install({
      manifest,
      spells: { Boots_P: class {}, Boots_A: class {} },
      items: { boots: item({ passive: 'Boots_P', active: 'Boots_A' }) },
    });
    const entry = registry.item('ref:boots')!;
    expect(entry.passive).toBe('ref:Boots_P');
    expect(entry.active).toBe('ref:Boots_A');
  });

  it('qualifies the icon against the pack’s own art tree', () => {
    const registry = install({
      manifest: { ...manifest, assets: 'ref' },
      items: { boots: item() },
    });
    expect(registry.item('ref:boots')?.icon).toBe('ref:item_boots');
  });

  it('leaves the icon bare for a pack that ships no art tree of its own', () => {
    const registry = install({ manifest, items: { boots: item() } });
    expect(registry.item('ref:boots')?.icon).toBe('item_boots');
  });

  it('says which pack an item came from', () => {
    expect(install({ manifest, items: { boots: item() } }).item('ref:boots')?.packId).toBe('ref');
  });
});
