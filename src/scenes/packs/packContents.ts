/**
 * How much content each installed pack actually contributes.
 *
 * ## Why the registry, and not each pack's own data
 *
 * A bundled pack's roster is readable from `ContentPackData`; a pack installed
 * by URL declares only a champion count in its manifest, and nothing at all
 * about maps or items. Deriving the two separately would put two code paths
 * behind one line of UI, and the runtime one would be permanently poorer for
 * no reason — because by the time this screen exists, *every* installed pack,
 * bundled or fetched, is already in the same registry, with every id qualified
 * by the pack that declared it.
 *
 * So there is one pass over one source, and a row's numbers mean the same
 * thing whichever kind of row it is.
 *
 * Takes the registry as a structural argument rather than importing it:
 * `PacksScene` may not statically reach `@/content/registry` (it is the game
 * chunk — see `tests/scenes/packsBootPath.test.ts`), and a module that imports
 * it only for a type is a module that cannot be tested without one.
 */

export interface PackContents {
  /** Champions the pregame screen would actually offer. */
  readonly champions: number;
  readonly maps: number;
  readonly items: number;
}

/** The three listings this counts, as `PackRegistry` publishes them. */
export interface CountableRegistry {
  champions(): readonly { readonly packId: string; readonly playable: boolean }[];
  maps(): readonly { readonly packId: string }[];
  items(): readonly { readonly packId: string }[];
}

const empty = (): { champions: number; maps: number; items: number } => ({
  champions: 0,
  maps: 0,
  items: 0,
});

export function contentsByPack(registry: CountableRegistry): Map<string, PackContents> {
  const byPack = new Map<string, { champions: number; maps: number; items: number }>();
  const of = (packId: string) => {
    let counts = byPack.get(packId);
    if (!counts) byPack.set(packId, (counts = empty()));
    return counts;
  };

  // `playable`, not every roster row: a pack's shelves — the bare basic
  // attack, the summoner-spell group — are rows too, and counting them
  // promises champions the player cannot pick.
  for (const champion of registry.champions()) if (champion.playable) of(champion.packId).champions++;
  for (const map of registry.maps()) of(map.packId).maps++;
  for (const item of registry.items()) of(item.packId).items++;

  return byPack;
}

/**
 * The one line a row shows — `'58 tướng · 1 map · 42 trang bị'`.
 *
 * Zero counts are dropped rather than printed. A pack that ships only maps is
 * a real thing, and "0 tướng · 3 map · 0 trang bị" makes it read like a broken
 * champion pack. A pack that contributes nothing at all gets `''`, and the row
 * draws no line rather than an empty one.
 */
export function describeContents(contents: PackContents | undefined): string {
  if (!contents) return '';
  const parts: string[] = [];
  if (contents.champions) parts.push(`${contents.champions} tướng`);
  if (contents.maps) parts.push(`${contents.maps} map`);
  if (contents.items) parts.push(`${contents.items} trang bị`);
  return parts.join(' · ');
}

/**
 * The same sentence for a pack that has not been installed yet.
 *
 * The install confirmation holds a manifest and nothing else — no registry to
 * count, because none of the pack's code has run and, until the player presses
 * through, none of it will. So the pack's own build declares the numbers
 * (`scripts/write-manifest.mjs`) and this renders them through
 * `describeContents`, deliberately, so the line a player reads *before*
 * installing is word for word the line their row carries afterwards.
 *
 * Every field is optional and every absent one is dropped rather than shown as
 * zero — `maps` and `items` were added after packs were already published, and
 * an older manifest must read as it always did rather than as a pack that
 * ships no maps.
 */
export function describeDeclaredContents(declared: {
  champions?: number;
  maps?: number;
  items?: number;
}): string {
  return describeContents({
    champions: declared.champions ?? 0,
    maps: declared.maps ?? 0,
    items: declared.items ?? 0,
  });
}
