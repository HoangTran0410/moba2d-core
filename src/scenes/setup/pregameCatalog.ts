import {
  BASIC_ATTACK_ID,
  bareCatalogId,
  packSpellCatalogEntry,
  listSelectableChampions,
  listSummonerSpells,
  listSpellCatalog,
  abilitySlotOfId,
  type SelectableChampion,
  type SummonerSpellOption,
  type SpellCatalogEntry,
} from '@/game/config/spellCatalog';
import { contentCatalog } from '@/content/catalog';
import { readInstalledPacks } from '@/content/installedPackStore';
import { removeAccents } from '@/utils/index';

/**
 * Folds a name for the picker's search box: case- and accent-insensitive.
 *
 * `removeAccents` rather than a hand-rolled strip — `src/utils/index.ts`
 * already owns that transform and is already on this screen's import path.
 */
const searchKey = (text: string): string => removeAccents(text).toLowerCase().trim();

/**
 * Whether `name` answers `query` — a plain substring test, both sides folded.
 *
 * An empty (or all-space) query matches everything, which is what makes
 * clearing the box restore the list without the caller having to special-case
 * it. Accents are folded on both sides because the player types on a
 * Vietnamese keyboard: Riot's champion names carry none, so that half only
 * pays off on the saved-kit shelf, which the same box filters.
 */
export const matchesQuery = (name: string, query: string): boolean => {
  const needle = searchKey(query);
  return needle === '' || searchKey(name).includes(needle);
};

/** One catalogue entry on a shelf, with the kit slot its name claims (`abilitySlotOfId`) or `null`. */
export interface KitShelfEntry {
  entry: SpellCatalogEntry;
  slotIndex: number | null;
}

/**
 * One champion's row in the loadout picker's roster: the shelf header
 * (portrait + name, and the "dùng cả bộ" action when there is a kit to
 * apply) and the ability icons under it.
 *
 * A reshaping of `CHAMPION_KITS` — the same shelves the in-game HUD picker
 * renders — reordered for a roster that is now ~50 deep: the two shelves that
 * are not a champion first, then the champions by name. See
 * `LoadoutEditorModal.vue`.
 */
export interface KitShelf {
  name: string;
  /**
   * Which installed pack this champion came from — `QualifiedChampion.packId`,
   * carried through unchanged.
   *
   * The roster is one flat list of ~60 tiles drawn from every pack at once,
   * and before this field nothing on it said where a champion came from. A
   * player who has just installed a pack has no way to see what they got, and
   * a player about to remove one has no way to see what they will lose. See
   * `KitRoster.shelfGroups`, which is the only reader.
   */
  packId: string;
  /** A pack's own asset key — a plain string; resolve it through `packAsset` from `@/game/config/spellCatalog`. */
  avatar: string | null;
  entries: KitShelfEntry[];
  /** The entries that name a Q/W/E/R slot. Empty for the two shelves that are not a champion (the basic attack, the summoner spells) — which is what leaves those without a whole-kit action. */
  kit: { entry: SpellCatalogEntry; slotIndex: number }[];
  /**
   * A valid `ChampionLoadout.championName` when this shelf is a full,
   * portrait-carrying champion — the same predicate `listSelectableChampions`
   * uses, so the two cannot disagree about what counts. `null` for a partial
   * shelf (a single-ability stub, ...), which no `championName` can name and which
   * therefore has to land in the custom kit slot by slot.
   */
  championName: string | null;
  /**
   * What this shelf serves when it is not a champion's row: the basic attack,
   * or the summoner spells. `null` for every champion.
   *
   * The roster's tile grid holds neither of these — a tile opens a champion's
   * kit and neither of these is a champion — but the slot bar can still select
   * A, D or F, and those three slots are filled from exactly these two shelves.
   * This is how the editor knows which one to open for the selected slot; see
   * `LoadoutEditorModal.shelfForSlot`.
   *
   * Derived from the catalogue rather than from the display name: matching
   * `'Phép Bổ Trợ'` as a string would break the moment the label is
   * retranslated, and nothing in this file would notice.
   */
  nonChampionKind: 'basicAttack' | 'summoner' | null;
}

/** How a pack is named and pictured over its own section of the roster. */
export interface PackLabel {
  id: string;
  name: string;
  /** The pack's own logo, absolute, from its own host. Absent for a pack that installed without one, and for every built-in. */
  icon?: string;
}

/**
 * A display name for a pack that is built into core rather than installed
 * from a URL.
 *
 * `PackManifest` — the manifest a pack's *code* declares — carries no `name`
 * at all; the name a player sees comes from the runtime manifest fetched over
 * the network, which a built-in pack has never had. So the one bundled pack
 * needs its label written here, and any future built-in will too. A pack id
 * that reaches this map and misses is shown as its bare id, which is ugly and
 * correct: it says exactly what core knows.
 */
const BUILT_IN_PACK_NAMES: Record<string, string> = {
  reference: 'Có sẵn trong game',
};

/**
 * Every pack that has a champion on the roster, named the way the player has
 * already seen it named elsewhere.
 *
 * The store is the source, not the registry: `installedPackStore` is written
 * from the runtime manifest on every boot (`runtimePacks.installRuntimePacks`),
 * so the name here is the same string the packs screen shows on the installed
 * row and the install confirmation showed before that. Reading the registry
 * instead would have meant inventing a second name for the same pack, which is
 * the exact bug this section headers were added to end.
 */
function buildPackLabels(): Map<string, PackLabel> {
  const labels = new Map<string, PackLabel>();
  for (const record of readInstalledPacks()) {
    const name = record.name?.trim();
    labels.set(record.id, { id: record.id, name: name || record.id, icon: record.icon });
  }
  for (const champion of contentCatalog().champions()) {
    if (labels.has(champion.packId)) continue;
    labels.set(champion.packId, {
      id: champion.packId,
      name: BUILT_IN_PACK_NAMES[champion.packId] ?? champion.packId,
    });
  }
  return labels;
}

/** One pack's stretch of the roster: its heading, and the champion tiles under it. */
export interface ShelfGroup {
  pack: PackLabel;
  shelves: KitShelf[];
}

/** The roster as the picker draws it: the unheaded shelves first, then a section per pack. */
export interface RosterSections {
  /**
   * The shelves that are not champion tiles — the basic attack and the
   * summoner spells.
   *
   * They lead the roster and wear no pack heading, because they are not a
   * pack's roster: the grid hides them outright
   * (`.kit-roster .kit-shelf:not(.has-kit)`) and they open only when the slot
   * they serve is selected. Counting them under a pack was the first version
   * of this and it read "60 tướng" over 58 visible tiles.
   */
  pinned: KitShelf[];
  groups: ShelfGroup[];
}

/**
 * Cuts a roster into one group per pack, in the order the packs first appear.
 *
 * Grouping and not merely labelling: ~60 tiles drawn from two packs into one
 * alphabetical run tells a player nothing about what a pack gave them, which is
 * the whole question right after installing one and right before removing one.
 *
 * Order is first appearance rather than a sort of its own, so the shelf order
 * this is handed — champions by name, see `getPregameCatalog` — still decides
 * which section leads and who leads it. Only champion shelves decide that:
 * `kit.length === 0` is the same predicate the grid's own hide rule uses, and
 * the two pinned shelves it selects would otherwise have handed the lead to
 * whichever pack happens to own Đánh Thường.
 *
 * Callers pass the *filtered* roster, so a pack whose champions all fail the
 * search box loses its heading with them instead of leaving an empty section
 * behind.
 *
 * A `packId` with no label is given one made of its own id. That is the honest
 * answer rather than a hidden group: it happens for a pack installed in this
 * session whose store record has not been written yet, and showing `riot` is
 * strictly better than showing those champions under someone else's heading.
 */
export function groupShelvesByPack(
  shelves: readonly KitShelf[],
  labels: ReadonlyMap<string, PackLabel>
): RosterSections {
  const pinned: KitShelf[] = [];
  const groups: ShelfGroup[] = [];
  const byPack = new Map<string, ShelfGroup>();
  for (const shelf of shelves) {
    if (shelf.kit.length === 0) {
      pinned.push(shelf);
      continue;
    }
    let group = byPack.get(shelf.packId);
    if (!group) {
      group = {
        pack: labels.get(shelf.packId) ?? { id: shelf.packId, name: shelf.packId },
        shelves: [],
      };
      byPack.set(shelf.packId, group);
      groups.push(group);
    }
    group.shelves.push(shelf);
  }
  return { pinned, groups };
}

export interface PregameCatalog {
  champions: SelectableChampion[];
  summoners: SummonerSpellOption[];
  spellCatalog: SpellCatalogEntry[];
  /** `SpellCatalogEntry` keyed by the stored id (an `AllSpells` barrel key) — what a persisted slot choice resolves through, and the only identity this screen uses. */
  catalogById: Map<string, SpellCatalogEntry>;
  /** The picker roster: the two non-champion shelves first, then the champions by name — see the sort in `getPregameCatalog`. */
  kitShelves: KitShelf[];
  /** How to head each pack's section of that roster, by `KitShelf.packId`. */
  packLabels: Map<string, PackLabel>;
}

/**
 * The slot-id sentinel for "let the match roll this one" (`SlotChoice`).
 * Not an id any pack can provide, so it resolves to no entry by definition.
 */
const RANDOM_SLOT_ID = 'random';

/**
 * A stored slot id resolved to its catalogue entry, or `null` where there is
 * nothing to draw.
 *
 * **Two id shapes arrive here and only one of them is in `catalogById`.**
 * `SelectableChampionSpell.id` is the bundled pack's *bare* id for a bundled
 * champion (`'Vera_Q'`) and another pack's *registry-qualified* id for one of
 * its champions (`'somepack:Vera_Q'`) — its own doc comment says so, and a
 * custom slot stores whichever of the two the player picked. `catalogById` is
 * populated from `listSpellCatalog()`, which is the bundled pack alone, so a
 * bare `.get()` answers `undefined` for every runtime pack's spell.
 *
 * That miss is indistinguishable from `'random'` to a caller that treats
 * `null` as "nothing picked", and the loadout editor did: press "Dùng cả bộ"
 * on a pack champion and the slot bar drew six dice over a kit the player had
 * just chosen, while Xác nhận built the right champion anyway —
 * `getChampionPresetFromLoadout` resolves by name and slot *position* and
 * never reads this map. The screen and the match disagreed, and the screen was
 * the wrong one.
 *
 * The lookup is written here rather than at the call site because the shelf
 * builder in `getPregameCatalog` below already needed exactly this pair and
 * had it inline. Two copies of a crossing is how the second one came to be
 * missing half of it.
 */
export const resolveCatalogEntry = (id: string): SpellCatalogEntry | null => {
  if (id === RANDOM_SLOT_ID) return null;
  const { catalogById } = getPregameCatalog();
  // Qualified-bundled (`'reference:Vera_Q'`) first, then bare-bundled, then
  // any other pack's. `bareCatalogId` answers `null` for a foreign pack's id
  // on purpose, which is what makes the third branch the one that runs for it.
  const bare = bareCatalogId(id);
  const entry =
    (bare === null ? undefined : catalogById.get(bare)) ??
    catalogById.get(id) ??
    packSpellCatalogEntry(id);
  return entry ?? null;
};

let cached: PregameCatalog | null = null;

/**
 * The catalogue used not to change at runtime, so this builds it once,
 * lazily, and every caller gets back the same object — the same "build once,
 * not on every render" rule `SetupScene.ts` used to enforce by hand in its
 * `setup()`. Every component that needs champion/summoner/spell data calls
 * this directly instead of receiving it through props, since it is read-only
 * and shared by several unrelated branches of the component tree (the
 * participant list's kit icons, the loadout picker's slot row and roster).
 *
 * **It does change now.** `installPackNow` (`content/runtimePacks.ts`, spec
 * §5.2) installs a runtime pack into the live registry without a reload, so
 * `resetPregameCatalog` below is what keeps this cache from answering a
 * grown roster with whatever was true the first time any screen opened the
 * picker.
 */
export const getPregameCatalog = (): PregameCatalog => {
  if (!cached) {
    const spellCatalog = listSpellCatalog();
    const catalogById = new Map(spellCatalog.map(entry => [entry.id, entry]));
    const summoners = listSummonerSpells();
    // Plain `Set<string>` inference — `summonerIds.has` below is checked
    // against `KitShelfEntry.entry.id`, which is `string` (a pack's own
    // qualified id can live there too, see `SpellCatalogEntry.id`'s doc
    // comment). Until batch 5 task 2 this needed an explicit `Set<string>`
    // annotation to avoid inferring the narrower `Set<SpellCatalogId>` —
    // `SpellCatalogId` was the bundled pack's own 237-literal union then, and
    // `.has()` would have refused a foreign pack's id. `SpellCatalogId` is
    // `string` itself now, so the two infer identically and the annotation
    // no longer changes anything.
    const summonerIds = new Set(summoners.map(option => option.id));

    /**
     * Which of the two non-champion shelves this is, if either. Written out
     * rather than inlined as a ternary so the return type is `KitShelf`'s own
     * union — TypeScript widens a nested ternary of string literals to
     * `string`, and the shelf then no longer satisfies `KitShelf`.
     */
    const nonChampionKindOf = (entries: KitShelfEntry[]): KitShelf['nonChampionKind'] => {
      if (entries.some(e => e.entry.id === BASIC_ATTACK_ID)) return 'basicAttack';
      if (entries.length > 0 && entries.every(e => summonerIds.has(e.entry.id))) return 'summoner';
      return null;
    };

    /** Registry install order, for the pinned shelves — see the sort below. The riot pack installs first and lists these in `CHAMPION_KITS`'s own order, so this reproduces that ordering without reading `CHAMPION_KITS` directly. */
    const sourceOrder = new Map(
      contentCatalog()
        .champions()
        .map((champion, index) => [champion.name, index])
    );

    const kitShelves: KitShelf[] = contentCatalog()
      .champions()
      .map(champion => {
        // `champion.spells` are registry-qualified (`riot:<Champion>_Q`,
        // `reference:Vera_Q`); `catalogById` keys by the *bundled* pack's own
        // bare id (`spellCatalogIds()`'s population). `bareCatalogId` is the
        // same crossing `spellCatalog.ts` uses internally, and for any other
        // pack's id it answers `null` on purpose — `packSpellCatalogEntry` is
        // its companion, reading the registry directly by the qualified id
        // rather than dropping a champion whose kit lives entirely outside
        // the bundled pack.
        const entries: KitShelfEntry[] = [];
        for (const qualifiedId of champion.spells) {
          const id = bareCatalogId(qualifiedId);
          const entry = id ? catalogById.get(id) : packSpellCatalogEntry(qualifiedId);
          if (entry) entries.push({ entry, slotIndex: abilitySlotOfId(entry.id) });
        }

        const kit: { entry: SpellCatalogEntry; slotIndex: number }[] = [];
        for (const e of entries) {
          if (e.slotIndex !== null) kit.push({ entry: e.entry, slotIndex: e.slotIndex });
        }

        return {
          name: champion.name,
          packId: champion.packId,
          avatar: champion.image,
          entries,
          kit,
          // `champion.playable` is exactly "portrait plus exactly four
          // abilities" — validated once at pack install
          // (`content/validate.ts`) rather than re-derived here, and it is
          // the same rule `listSelectableChampions` now reads too.
          // `getChampionPresetFromLoadout` resolves a `championName` by the
          // shelf's *position* (spells[0] is Q), so a shelf this calls a
          // champion must be one that function will also accept, whatever the
          // ability names happen to say.
          championName: champion.playable ? champion.name : null,
          nonChampionKind: nonChampionKindOf(entries),
        };
      })
      .filter(shelf => shelf.entries.length > 0)
      /**
       * Champions by name, with the two shelves that are not a champion pinned
       * ahead of them in `CHAMPION_KITS` order.
       *
       * A flat `localeCompare` put the basic attack between two champions
       * alphabetically nowhere near either end, which is where nobody looks for it — and both pinned shelves are
       * things you reach for *while* building a kit rather than instead of one.
       *
       * `kit.length === 0` is the pin because it is already the predicate that
       * decides whether a shelf gets a whole-kit button and whether compact
       * mode shows it: one rule, three uses. `championName === null` is a
       * different question and would be the wrong test — a partial shelf has no
       * `championName` and is still a champion's row.
       *
       * The tie-break is explicit rather than leaning on `sort` being stable.
       * It is (V8, and specified since ES2019), and `sort` is not one of the
       * `Array.prototype` methods `main.ts` patches — but a reader should not
       * have to establish both of those to know why Đánh Thường comes first.
       */
      .sort((a, b) => {
        const aPinned = a.kit.length === 0;
        const bPinned = b.kit.length === 0;
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        if (aPinned) return (sourceOrder.get(a.name) ?? 0) - (sourceOrder.get(b.name) ?? 0);
        return a.name.localeCompare(b.name);
      });

    cached = {
      champions: listSelectableChampions(),
      summoners,
      spellCatalog,
      catalogById,
      kitShelves,
      packLabels: buildPackLabels(),
    };
  }
  return cached;
};

/**
 * Forgets the cached catalogue, so the next `getPregameCatalog()` call
 * rebuilds it from whatever the live registry holds now.
 *
 * Called from `PacksScene.vue`'s `confirmInstall` after `installPackNow`
 * reports `ok: true` — see `getPregameCatalog`'s own doc comment for why this
 * has to exist at all. Not exported for general invalidation: nothing else
 * in the running game installs a pack after boot, so this one call site is
 * the whole of what needs it.
 */
export function resetPregameCatalog(): void {
  cached = null;
}
