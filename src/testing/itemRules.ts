import { describe, expect, it } from 'vitest';
import type { ContentPackData, ItemDef } from '@/content/ContentPack';
import { INVENTORY_SIZE } from '@/game/items/Item';
import { MAX_COOLDOWN_REDUCTION } from '@/game/gameObject/Stats';

/**
 * `@moba2d/core/testing/items` — the rules every pack's shop has to obey,
 * asserted once instead of once per pack.
 *
 * ## Why this is a module and not a template
 *
 * `scripts/templates/pack/` is where a scaffold's files come from, and a
 * template is a *copy*: the moment two packs exist, a fix to the template is a
 * fix to neither of them. `scripts/pack-core-link.mjs` makes exactly this
 * argument about itself, in its own header, having been three byte-identical
 * copies before it became a bin.
 *
 * The two shipped packs had reached that state. Both had an `items.test.ts`,
 * and between them they asserted:
 *
 *   - the same icon rule, written twice;
 *   - the same "an item spell must not reach `spellDisplay`" rule, written
 *     twice and differently — one by prefix, one by an enumerated list;
 *   - the same cooldown ceiling, with **core's own `MAX_COOLDOWN_REDUCTION`
 *     copied into each of them as a literal `0.6`**;
 *   - a description contract each had half of — one checked that no markup
 *     escaped the three allowed spans, the other that no digit escaped them;
 *   - and a set of recipe rules only one of them had at all, which is to say
 *     the other pack's shop was never checked for a combine that is a
 *     downgrade or a recipe that does not fit in the bag.
 *
 * None of that is a fact about either pack. Every one of them is a fact about
 * what *core* does with an item, which is the definition of something that
 * belongs here.
 *
 * ## What stays in the pack
 *
 * Everything that is a number somebody chose: the roster and its exact stats,
 * the price bands, how much ability power a full build should reach, the
 * `coreRange` floor. Those are a pack's design, and a shared file asserting
 * them would be core having opinions about content.
 *
 * The dividing line is worth stating as a rule: **if core could not have
 * written the assertion without reading the pack's design document, it is not
 * in here.**
 *
 * ## Cost
 *
 * This module reaches `game/items/Item` and `gameObject/Stats` for the two
 * constants it refuses to copy, so importing it is not free the way a
 * data-only test is. That is the trade being made on purpose: a literal `6`
 * and a literal `0.6` in two repositories are two numbers that go stale
 * silently, and the whole point of the file is to have one of each.
 */

/**
 * The spans core's shop and spell panels paint, and no others.
 *
 * `heal` is on the list because it means what `damage` means in the other
 * colour, and the optional second class on either is the damage type
 * (`damage physical`) that `styles/main.css` paints. Still an allow-list and still
 * closed: `ShopDetail` and the inventory tooltip both render this with `v-html`,
 * so markup a pack writes here is markup it puts on a player's screen.
 */
const ALLOWED_SPAN =
  /<span class="(?:damage|heal)(?: (?:physical|magic|true))?">[^<]*<\/span>|<span class="(?:buff|time)">[^<]*<\/span>/g;

/**
 * Prose that restates the stat list beside it.
 *
 * Every item description in both packs used to open this way — "Tăng 40 giáp,
 * 30 kháng phép và 55% sức mạnh phép" — because the inventory tooltip had no
 * stat list and the sentence was the only place those numbers appeared. It has
 * one now (`hud/itemStatLines.ts`), so the shop card printed them twice and
 * the prose was doing a job that had a widget.
 */
const RESTATES_STATS = /^Tăng /;

/** Text a pack meant to come back to. */
const PLACEHOLDER = /Chưa hoàn thiện|TODO|PLACEHOLDER/i;

export interface ItemShopFixture {
  /**
   * The pack's data half — `data` from its own `pack.ts`. Only the three
   * fields these rules read are required, so a pack under construction can
   * pass a partial one.
   */
  data: Pick<ContentPackData, 'items' | 'champions' | 'spellDisplay'>;
  /** The pack's `generated/assetManifest.ts`, for the icon rule. */
  assetManifest: Readonly<Record<string, unknown>>;
  /** The pack's `generated/spellCatalog.ts`, for the passive/active rule. */
  spellCatalog: Readonly<Record<string, unknown>>;
  /**
   * A name for the suite, so a failure in a repository with several packs
   * says which one. Defaults to the plain heading.
   */
  label?: string;
}

/** Everything the parts of `def` grant, added together. */
const partStats = (
  items: Readonly<Record<string, ItemDef>>,
  def: ItemDef
): Record<string, number> => {
  const total: Record<string, number> = {};
  for (const partId of def.buildsFrom ?? []) {
    for (const [key, amount] of Object.entries(items[partId]?.stats ?? {})) {
      if (typeof amount === 'number') total[key] = (total[key] ?? 0) + amount;
    }
  }
  return total;
};

/**
 * Registers the shared suite. Call it at the top level of the pack's own
 * `items.test.ts`, then write that pack's own numbers underneath.
 */
export function describeItemShop(fixture: ItemShopFixture): void {
  const items = fixture.data.items ?? {};
  const entries = Object.entries(items);
  const iconKeys = new Set(Object.keys(fixture.assetManifest));
  const spellIds = new Set(Object.keys(fixture.spellCatalog));

  /** Every spell id any item names, in either slot. */
  const itemSpellIds = (): string[] => {
    const named = new Set<string>();
    for (const def of Object.values(items)) {
      if (def.passive) named.add(def.passive);
      if (def.active) named.add(def.active);
    }
    return [...named];
  };

  describe(fixture.label ? `${fixture.label}: the shop core reads` : 'the shop core reads', () => {
    it('ships at least one item, or every rule below is vacuous', () => {
      expect(entries.length).toBeGreaterThan(0);
    });

    it('keys every item by its own id', () => {
      // `validate.ts` refuses the pack over this, but its message names a key
      // rather than saying what went wrong with it.
      for (const [key, def] of entries) expect(def.id, key).toBe(key);
    });

    it('names an icon this pack actually ships', () => {
      for (const [key, def] of entries) {
        expect(def.icon, `${key} has no icon`).toBeTruthy();
        expect(iconKeys.has(def.icon), `${key}: icon "${def.icon}" is in no manifest of ours`).toBe(
          true
        );
      }
    });

    it('gives every item something to be — stats, or a passive, or an active', () => {
      for (const [key, def] of entries) {
        const grants = Object.keys(def.stats ?? {}).length > 0;
        expect(grants || Boolean(def.passive ?? def.active), `${key} does nothing at all`).toBe(
          true
        );
      }
    });

    it('points every passive and active at a spell this pack actually ships', () => {
      for (const [key, def] of entries) {
        for (const id of [def.passive, def.active]) {
          if (!id) continue;
          expect(spellIds.has(id), `${key}: "${id}" is in no barrel of ours`).toBe(true);
        }
      }
    });

    it('never puts an item’s spell in a champion’s kit', () => {
      // One spell wearing two prices: an ability a champion casts for free and
      // an item the shop charges for.
      const kit = new Set((fixture.data.champions ?? []).flatMap(champion => champion.spells));
      for (const [key, def] of entries) {
        for (const id of [def.passive, def.active]) {
          if (!id) continue;
          expect(kit.has(id), `${key}: "${id}" is also in a champion's kit`).toBe(false);
        }
      }
    });

    it('keeps every item spell out of spellDisplay', () => {
      // `spellDisplay` is `PackRegistry.spellDisplayIds`, which is the
      // population a `'random'` loadout slot is drawn from — so an item's
      // active landing there is dealt to a champion who never bought the item,
      // on a key the HUD will happily draw. It fails silently in both
      // directions: nothing throws, and the spell works.
      const display = fixture.data.spellDisplay ?? {};
      for (const id of itemSpellIds()) {
        expect(Object.hasOwn(display, id), `${id} leaked into spellDisplay`).toBe(false);
      }
    });
  });

  describe(fixture.label ? `${fixture.label}: what an item says` : 'what an item says', () => {
    it('leaves what an item *grants* to the stat list', () => {
      // See `RESTATES_STATS`. A pure stat component is now allowed to say
      // nothing at all rather than repeat the list beside it.
      for (const [key, def] of entries) {
        if (def.description === undefined) continue;
        expect(def.description, `${key} restates its own stat list`).not.toMatch(RESTATES_STATS);
        expect(def.description, `${key} still carries placeholder text`).not.toMatch(PLACEHOLDER);
        expect(def.description.trim().length, `${key} has an empty description`).toBeGreaterThan(0);
      }
    });

    it('says so when it does something the numbers cannot show', () => {
      // The other half of the same rule. A passive or an active is the one
      // thing a stat list *cannot* draw, so an item with either and no
      // sentence is an item whose whole point is invisible in the shop.
      for (const [key, def] of entries) {
        if (!def.passive && !def.active) continue;
        expect(def.description, `${key} has an ability and says nothing about it`).toBeTruthy();
      }
    });

    it('paints every number it prints, and prints no other markup', () => {
      // Two failures with one cause. An item panel used to render as one flat
      // grey paragraph beside a spell panel with three colours in it — same
      // pipeline, same stylesheet, nothing in the text for either to work on.
      //
      // A tagged number is *colour only* for an item: core rescales a `damage`
      // span by the reader's ability power for a spell and deliberately not
      // for an item, since `economy/ItemShop` opts every item ability out of
      // ability scaling.
      //
      // And the contract is those three spans, not "any HTML" — `ShopDetail`
      // and the inventory tooltip both render this with `v-html`, so arbitrary
      // markup in shop text is markup a pack can put on the player's screen.
      for (const [key, def] of entries) {
        const stripped = (def.description ?? '').replace(ALLOWED_SPAN, '');
        expect(stripped, `${key} prints markup that is not one of the three spans`).not.toMatch(
          /[<>]/
        );
        expect(stripped, `${key} prints a number it did not colour`).not.toMatch(/\d/);
      }
    });
  });

  const finished = Object.values(items).filter(def => def.buildsFrom !== undefined);

  describe(fixture.label ? `${fixture.label}: the build paths` : 'the build paths', () => {
    it('names only parts this pack actually sells', () => {
      for (const def of finished) {
        for (const partId of def.buildsFrom ?? []) {
          expect(items[partId], `${def.id} builds from ${partId}, which does not exist`).toBeDefined();
        }
      }
    });

    it('prices every total at or above the sum of its parts', () => {
      // Core refuses the pack over this too, but its message arrives at
      // install and names one item. Here it names all of them and prints the
      // combine cost, which is the number a designer is actually retuning.
      for (const def of finished) {
        const parts = (def.buildsFrom ?? []).reduce((sum, id) => sum + (items[id]?.cost ?? 0), 0);
        expect(
          def.cost,
          `${def.id}: parts cost ${parts}, item costs ${def.cost}`
        ).toBeGreaterThanOrEqual(parts);
      }
    });

    it('never makes the upgrade worse than the things it is made of', () => {
      // Combining swaps the parts' stats for the finished item's, so an item
      // granting less of something its own parts granted charges gold to make
      // the champion worse. Nothing in core can notice: the purchase succeeds.
      for (const def of finished) {
        const own = def.stats ?? {};
        for (const [key, fromParts] of Object.entries(partStats(items, def))) {
          expect(
            (own as Record<string, number>)[key] ?? 0,
            `${def.id} grants ${(own as Record<string, number>)[key] ?? 0} ${key}, its parts grant ${fromParts}`
          ).toBeGreaterThanOrEqual(fromParts);
        }
      }
    });

    it('keeps every recipe inside the slots a bag actually has', () => {
      // The parts have to be held at once for the combine to be worth
      // anything, and `INVENTORY_SIZE` is how many can be.
      for (const def of finished) {
        expect((def.buildsFrom ?? []).length, def.id).toBeLessThanOrEqual(INVENTORY_SIZE);
      }
    });

    it('leaves no item that is a dead end', () => {
      // An item with no recipe, that nothing builds from, and that does
      // nothing but grant stats, is a stat stick a player buys once and can
      // never upgrade — and the shop gives them no way to find that out.
      const used = new Set(finished.flatMap(def => def.buildsFrom ?? []));
      for (const [key, def] of entries) {
        if (def.buildsFrom !== undefined) continue;
        if (used.has(def.id)) continue;
        expect(
          Boolean(def.passive ?? def.active),
          `${key} builds into nothing, is built from nothing, and does nothing`
        ).toBe(true);
      }
    });
  });

  describe(fixture.label ? `${fixture.label}: what a full build reaches` : 'what a full build reaches', () => {
    it('never sells enough cooldown reduction to reach core’s cap', () => {
      // `Stat` clamps at `MAX_COOLDOWN_REDUCTION`, so a shop that can reach it
      // sells a key which can be held down — and every point bought past the
      // clamp is gold that buys literally nothing.
      const total = Object.values(items)
        .map(def => def.stats?.cooldownReduction ?? 0)
        .reduce((sum, amount) => sum + amount, 0);

      expect(
        total,
        `the whole shop grants ${total}, against a cap of ${MAX_COOLDOWN_REDUCTION}`
      ).toBeLessThan(MAX_COOLDOWN_REDUCTION);
    });
  });
}
