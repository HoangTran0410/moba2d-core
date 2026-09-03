import { describe, expect, it } from 'vitest';
import type { ContentPackData, ItemDef } from '@/content/ContentPack';
import { GRANT_SLOT, INVENTORY_SIZE } from '@/game/items/Item';
import { FRAMES_PER_SECOND, MAX_ABILITY_HASTE } from '@/game/gameObject/Stats';

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
 *   - the same cooldown ceiling, with **core's own constant copied into each
 *     of them as a bare literal** (that ceiling has since become
 *     `MAX_ABILITY_HASTE`, which is the point: the copies would still say
 *     `0.6`);
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
 * This module reaches `game/items/Item` and `gameObject/Stats` for the
 * constants and the one table it refuses to copy, so importing it is not free
 * the way a data-only test is. That is the trade being made on purpose: a literal `6`
 * and a literal `0.6` in two repositories are two numbers that go stale
 * silently — and one of them since has, when cooldown reduction became ability
 * haste and the constant changed both name and magnitude. The whole point of
 * the file is to have one of each.
 */

/**
 * The spans core's shop and spell panels paint, and no others.
 *
 * `heal` is on the list because it means what `damage` means in the other
 * colour, and the optional second class on either is the damage type
 * (`damage physical`) that `styles/main.css` paints. Still an allow-list and still
 * closed: `ShopDetail` and the inventory tooltip both render this with `v-html`,
 * so markup a pack writes here is markup it puts on a player's screen.
 *
 * `data-flat="none"` is admitted for the same reason the classes are: it is
 * core's own attribute, written by `combat/DamageText.ts`'s `tint`, and on an
 * item it is simply true — core never rescales item text, because
 * `economy/ItemShop` opts every item ability out of ability scaling. A pack's
 * data half cannot call the helper (it may not value-import the engine), so
 * this is the one place the attribute is typed out by hand, and admitting it
 * is what lets `testing/spellText` tell paint from a figure that forgot its
 * helper on the shelf as well as in a spell.
 *
 * All three of core's `data-` attributes are admitted, not just that one, and
 * in any order: an item *spell*'s description does go through `dmg()` and
 * carries `data-base`. Spelling one attribute out in sequence is how two other
 * copies of this pattern went blind — see `combat/DamageText.ts`'s
 * `SCALING_SPAN_OPEN`. Still an allow-list: the attribute *names* are named,
 * so a pack cannot smuggle arbitrary markup onto a player's screen.
 */
const ALLOWED_SPAN =
  /<span class="(?:damage|heal)(?: (?:physical|magic|true))?"(?: data-(?:base|base-high|flat)="[^"]*")*>[^<]*<\/span>|<span class="(?:buff|time)">[^<]*<\/span>/g;

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

/**
 * The most regeneration an item may grant, **per second**, before this is
 * almost certainly a unit error rather than a strong item.
 *
 * `Stats.update()` adds `healthRegen` and `manaRegen` once per *frame*, so the
 * stored number is per frame and a champion's own base is `0.1` — six mana a
 * second. Nothing about the field says so, both units are plain numbers, and
 * the shop card printed the stored figure raw for a long time, so it agreed
 * with whoever wrote a per-second number into it. Three items in one pack were
 * written that way and shipped: a 500-gold stone granting seventy-two mana a
 * second against a base of six, refilling a full pool in seven seconds.
 *
 * Thirty a second is five times what a champion regenerates unaided and about
 * as far past any real item as a ceiling can be while still catching the
 * mistake — a per-second figure written into this field is off by sixty, so
 * anything that trips this is out by a factor nobody chose on purpose.
 *
 * A heuristic, and the only shape available: `1.2` is a legal number, it is
 * just an enormous one, and no scan can read the author's intent. So the
 * message names the trap rather than asserting the value is wrong.
 */
export const MAX_ITEM_REGEN_PER_SECOND = 30;

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

    it('states regeneration in the unit the engine stores it in', () => {
      // The one stat pair whose *unit* is not what a reader assumes, and the
      // pack that got it wrong got it wrong three times in one shelf. See
      // `MAX_ITEM_REGEN_PER_SECOND`.
      for (const [key, def] of entries) {
        for (const stat of ['healthRegen', 'manaRegen'] as const) {
          const perFrame = def.stats?.[stat];
          if (typeof perFrame !== 'number') continue;
          const perSecond = perFrame * FRAMES_PER_SECOND;
          expect(
            perSecond,
            `${key}: ${stat} ${perFrame} is ${perSecond}/s — ` +
              '`Stats.update()` adds this every frame, so a per-second figure belongs here ' +
              `divided by ${FRAMES_PER_SECOND}`
          ).toBeLessThanOrEqual(MAX_ITEM_REGEN_PER_SECOND);
        }
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
    it('sells ability haste in points, not as a fraction', () => {
      // The rule this replaced policed `cooldownReduction` against its cap.
      // Haste has no cap worth approaching (`MAX_ABILITY_HASTE` is a runaway
      // rail at 500, not a balance line), so the failure worth catching is the
      // *migration* one: a pack writing `abilityHaste: 0.15` because that is
      // what the old fraction looked like. It is not a type error, it is not a
      // validation error, and it buys a fifteen-hundredth of a point — an item
      // that silently grants nothing, which is exactly the class of bug this
      // suite exists for.
      for (const [key, def] of entries) {
        const haste = def.stats?.abilityHaste ?? 0;
        if (haste === 0) continue;
        expect(
          haste,
          `${key} grants ${haste} ability haste — points, not a fraction (25, not 0.25)`
        ).toBeGreaterThanOrEqual(1);
        expect(haste, `${key} grants a fractional point of haste`).toBe(Math.round(haste));
      }
    });

    it('sells a share of the wearer as a fraction, not as percentage points', () => {
      // The same mistake as the haste one, in the other direction, and read
      // off `GRANT_SLOT` rather than listed here so a stat added to that table
      // is covered the day it lands.
      //
      // These are the keys core multiplies the wearer's own base by
      // (`items/Item.ts`), so `attackSpeed: 15` is not +15%, it is sixteen
      // times the champion's swing rate. Nothing downstream objects: it is a
      // number, it is finite, and the item is simply the best in the game.
      // Two, not one, so a pack may still sell a legendary that doubles a
      // stat — what is being caught is a factor of a hundred.
      const shares = Object.keys(GRANT_SLOT) as (keyof NonNullable<ItemDef['stats']>)[];
      for (const [key, def] of entries) {
        for (const stat of shares) {
          const share = def.stats?.[stat] ?? 0;
          if (share === 0) continue;
          expect(
            share,
            `${key} grants ${share} ${stat} — a fraction, not percentage points (0.15, not 15)`
          ).toBeLessThanOrEqual(2);
        }
      }
    });

    it('cannot reach core’s runaway rail on haste even holding the whole shop', () => {
      const total = Object.values(items)
        .map(def => def.stats?.abilityHaste ?? 0)
        .reduce((sum, amount) => sum + amount, 0);

      expect(
        total,
        `the whole shop grants ${total} haste, against a rail of ${MAX_ABILITY_HASTE}`
      ).toBeLessThan(MAX_ABILITY_HASTE);
    });
  });
}
