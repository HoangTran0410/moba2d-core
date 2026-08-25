import { contentCatalog } from '@/content/catalog';
import type { QualifiedItem } from '@/content/PackRegistry';

/**
 * Everything the shop can sell, gathered from every installed pack.
 *
 * A thin read over the registry rather than a store of its own, and
 * deliberately not memoised: a pack installed at runtime is written *into* the
 * registry already being read from, so anything cached on that registry's
 * identity would answer with the catalogue core had before the player
 * installed anything — the exact bug `PackRegistry.contentRevision`'s own doc
 * comment records shipping once, on the champion roster.
 *
 * `contentCatalog()` and not `contentRegistry()`: an item is data — a name, an
 * icon, a price, two spell *ids* — and listing a shop must not build the
 * engine's whole spell surface. The classes those ids name are fetched
 * separately, by `shopSpellIds` below.
 */
export const shopItems = (): readonly QualifiedItem[] => contentCatalog().items();

/**
 * Every spell class the shop's stock needs, for the match's own preload.
 *
 * Loaded up front with the kits rather than left to `loadRemainingSpells`'s
 * idle sweep, because a champion spawns standing *in* the fountain and can buy
 * on the first frame — and `ItemShop.refusalFor` answers `NOT_LOADED` rather
 * than selling an inert copy of the thing the player wanted. Items are few and
 * their spells are small; a shop the player cannot use for the first two
 * seconds of every match is the worse trade.
 */
export const shopSpellIds = (): string[] => {
  const ids = new Set<string>();
  for (const item of shopItems()) {
    if (item.passive) ids.add(item.passive);
    if (item.active) ids.add(item.active);
  }
  return [...ids];
};

/** Every item icon, for the same preload — an unbuyable blank square otherwise. */
export const shopIconKeys = (): string[] => [...new Set(shopItems().map(item => item.icon))];
