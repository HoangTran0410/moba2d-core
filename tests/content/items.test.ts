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
    // `abilityHaste` rather than `abilityPower`: this test used to reach for
    // the latter as its example of a plausible-looking non-stat, and then
    // `abilityPower` became a real one. Its neighbour is the same shape of
    // mistake a pack author actually makes — the *other* game's word for
    // cooldown reduction, which this engine deliberately does not have.
    const result = validatePack({
      manifest,
      items: { boots: item({ stats: { speed: 25, abilityHaste: 40 } }) },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/abilityHaste/);
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

/**
 * A recipe — `buildsFrom` — and the four ways one can be nonsense.
 *
 * Three of them are silent at runtime and that is why they are refused here:
 * an id naming nothing is a component the shop can never match, so the item
 * simply always costs full price and nobody ever learns why; a cycle is an
 * item that is its own ancestor, which no build path can ever complete; and a
 * total under the sum of its parts makes `ItemShop.priceFor` want to return a
 * negative, which is the shop paying the player to shop. Core floors that at
 * zero rather than trusting this check, but a floored price is still a pack
 * whose author wrote a number they did not mean.
 */
describe('validating a recipe', () => {
  const pack = (items: Record<string, unknown>) => validatePack({ manifest, items });
  const install = (data: unknown): PackRegistry => {
    const registry = new PackRegistry();
    registry.install(data as ContentPack);
    return registry;
  };

  const parts = {
    sword: item({ id: 'sword', name: 'Kiếm Dài', cost: 350 }),
    cloak: item({ id: 'cloak', name: 'Áo Choàng', cost: 400 }),
  };

  it('accepts one built out of items this pack declares', () => {
    const result = pack({
      ...parts,
      blade: item({ id: 'blade', cost: 1200, buildsFrom: ['sword', 'cloak'] }),
    });
    expect(result.ok).toBe(true);
  });

  it('accepts the same component named twice', () => {
    // Two of one thing is an ordinary recipe, and `componentSlotsFor` claims
    // two separate held copies for it.
    const result = pack({
      ...parts,
      twin: item({ id: 'twin', cost: 900, buildsFrom: ['sword', 'sword'] }),
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a combine cost of exactly zero', () => {
    // The parts add up to the total and combining is free. A real design —
    // two components that are worth the finished item on their own — and the
    // boundary the check below has to not cross.
    const result = pack({
      ...parts,
      blade: item({ id: 'blade', cost: 750, buildsFrom: ['sword', 'cloak'] }),
    });
    expect(result.ok).toBe(true);
  });

  it('refuses a total that is under the sum of its parts', () => {
    const result = pack({
      ...parts,
      blade: item({ id: 'blade', cost: 700, buildsFrom: ['sword', 'cloak'] }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/blade/);
  });

  it('refuses an id naming nothing in this pack', () => {
    const result = pack({ blade: item({ id: 'blade', cost: 1200, buildsFrom: ['ghost'] }) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/ghost/);
  });

  it('refuses an item that builds out of itself', () => {
    const result = pack({ blade: item({ id: 'blade', cost: 1200, buildsFrom: ['blade'] }) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/blade/);
  });

  it('refuses a cycle through a third item', () => {
    const result = pack({
      a: item({ id: 'a', cost: 100, buildsFrom: ['b'] }),
      b: item({ id: 'b', cost: 100, buildsFrom: ['c'] }),
      c: item({ id: 'c', cost: 100, buildsFrom: ['a'] }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/a|b|c/);
  });

  it('refuses a recipe that is not an array', () => {
    const result = pack({ blade: item({ id: 'blade', buildsFrom: 'sword' }) });
    expect(result.ok).toBe(false);
  });

  it('refuses an entry that is not a string', () => {
    const result = pack({ blade: item({ id: 'blade', buildsFrom: [7] }) });
    expect(result.ok).toBe(false);
  });

  it('qualifies every id in it, so a held item can be matched against one', () => {
    // The failure this catches is total and silent: an unqualified entry never
    // equals the qualified id on a `HeldItem`, so the recipe matches nothing a
    // player is ever carrying and the item just costs full price for ever.
    const registry = install({
      manifest,
      items: {
        ...parts,
        blade: item({ id: 'blade', cost: 1200, buildsFrom: ['sword', 'cloak'] }),
      },
    });
    expect(registry.item('ref:blade')?.buildsFrom).toEqual(['ref:sword', 'ref:cloak']);
  });

  it('leaves a component’s own recipe undefined rather than empty', () => {
    const registry = install({ manifest, items: { boots: item() } });
    expect(registry.item('ref:boots')?.buildsFrom).toBeUndefined();
  });
});

/**
 * Depth is not ours to bound — a pack may draw as long a build path as it
 * likes — so `checkRecipes` walks with an explicit stack rather than
 * recursing. Five hundred links is far past anything a real pack would ship
 * and comfortably past the point where a recursive walk falls over.
 */
describe('a very deep build path', () => {
  it('validates without running out of stack', () => {
    const manifest = { id: 'ref', version: '1.0.0', coreRange: '^1' };
    const items: Record<string, unknown> = {};
    for (let i = 0; i < 500; i++) {
      items[`i${i}`] = {
        id: `i${i}`,
        name: `Món ${i}`,
        icon: 'item_boots',
        // Each link is worth one more than the whole chain below it, so no
        // step is ever under the sum of its parts.
        cost: i + 1,
        ...(i > 0 ? { buildsFrom: [`i${i - 1}`] } : {}),
      };
    }
    const result = validatePack({ manifest, items });
    expect(result.ok, result.ok ? '' : result.errors.slice(0, 3).join(' | ')).toBe(true);
  });
});
