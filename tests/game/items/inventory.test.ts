import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Spell from '@/game/gameObject/Spell';
import { HeldItem, INVENTORY_SIZE, ITEM_STAT_KEYS, modifierFor } from '@/game/items/Item';
import { StatsModifier } from '@/game/gameObject/Stats';
import type { CastSpec } from '@/game/spell/runtime/types';
import type { ItemDef } from '@/content/ContentPack';

class ItemPassive extends Spell {
  static presses = 0;
  name = 'Item Passive';
  coolDown = 0;
  manaCost = 0;
  targetingMode = 'SELF' as const;
  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: 0 },
    };
  }
  onSpellCast(): void {
    ItemPassive.presses += 1;
  }
}

const def = (over: Partial<ItemDef> = {}): ItemDef => ({
  id: 'test_item',
  name: 'Test Item',
  icon: 'item_test',
  cost: 900,
  ...over,
});

describe('modifierFor', () => {
  it('lands every grant on flatBonus, never baseValue', () => {
    // A bonus is something added on top of what the unit is. Writing
    // `baseValue` would make an item's contribution indistinguishable from the
    // champion's own tuning to anything that read the stat afterwards.
    const modifier = modifierFor({ armor: 40, attackDamage: 15 });
    expect(modifier.armor.flatBonus).toBe(40);
    expect(modifier.armor.baseValue).toBe(0);
    expect(modifier.attackDamage.flatBonus).toBe(15);
  });

  it('ignores a key that is not grantable', () => {
    // `health` is a current pool, not a capacity — see ITEM_STAT_KEYS. An item
    // granting it would top a champion up on equip and take that health back
    // on unequip, which is a shop that can kill you.
    const modifier = modifierFor({ health: 500, size: 200 } as never);
    expect(modifier.health.flatBonus).toBe(0);
    expect(modifier.size.flatBonus).toBe(0);
  });

  it('ignores a non-finite amount rather than poisoning the stat', () => {
    const modifier = modifierFor({ armor: Number.NaN } as never);
    expect(modifier.armor.flatBonus).toBe(0);
  });

  it('grants nothing for an item that grants nothing', () => {
    // A component a bigger item is built out of is exactly this, and it has to
    // be legal.
    expect(modifierFor(undefined).armor.flatBonus).toBe(0);
  });
});

describe('ITEM_STAT_KEYS', () => {
  const modifier = new StatsModifier() as unknown as Record<string, unknown>;

  it('names only fields that really exist on StatsModifier', () => {
    // A typo here is an item that silently grants nothing, forever, with
    // nothing anywhere to look at.
    const missing = ITEM_STAT_KEYS.filter(key => modifier[key] === undefined);
    expect(missing, `${missing.join(', ')} is not a stat`).toEqual([]);
  });

  it('leaves the current pools and the body out on purpose', () => {
    for (const excluded of ['health', 'mana', 'size', 'height']) {
      expect(ITEM_STAT_KEYS as readonly string[]).not.toContain(excluded);
    }
  });
});

describe('a champion carrying items', () => {
  let game: TestGame;
  let champion: Champion;

  const tick = (times = 1): void => {
    for (let i = 0; i < times; i++) champion.update();
  };

  beforeEach(() => {
    stubGameGlobals();
    ItemPassive.presses = 0;
    game = createGame();
    champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts with six empty slots', () => {
    expect(champion.items).toHaveLength(INVENTORY_SIZE);
    expect(champion.items.every(slot => slot === null)).toBe(true);
    expect(champion.firstEmptyItemSlot()).toBe(0);
  });

  it('gains the item’s stats on equip', () => {
    const before = champion.stats.armor.value;
    champion.equipItem(new HeldItem(def({ stats: { armor: 40 } }), null, null), 0);
    expect(champion.stats.armor.value).toBe(before + 40);
  });

  /**
   * The failure this whole test file exists for. Selling an item and keeping
   * its armour is a number that never adds up again, and nothing else in the
   * engine would ever report it — the champion simply becomes permanently
   * tougher than their inventory says.
   */
  it('loses them again on unequip, exactly', () => {
    const before = champion.stats.armor.value;
    const item = new HeldItem(def({ stats: { armor: 40, attackDamage: 15 } }), null, null);
    champion.equipItem(item, 0);
    champion.unequipItem(0);

    expect(champion.stats.armor.value).toBe(before);
    expect(champion.items[0]).toBeNull();
  });

  it('survives being equipped and sold repeatedly without drifting', () => {
    const before = champion.stats.attackDamage.value;
    for (let i = 0; i < 20; i++) {
      champion.equipItem(new HeldItem(def({ stats: { attackDamage: 15 } }), null, null), 2);
      champion.unequipItem(2);
    }
    expect(champion.stats.attackDamage.value).toBe(before);
  });

  it('hands back whatever it displaced, rather than dropping it silently', () => {
    // Who pays for the old one — a sale, a drop, a destruction — is the
    // caller's decision, and returning it is how the inventory stays out of it.
    const first = new HeldItem(def({ id: 'first' }), null, null);
    const second = new HeldItem(def({ id: 'second' }), null, null);
    champion.equipItem(first, 1);
    const displaced = champion.equipItem(second, 1);

    expect(displaced).toBe(first);
    expect(champion.items[1]).toBe(second);
  });

  it('takes the displaced item’s stats off, not the new one’s', () => {
    champion.equipItem(new HeldItem(def({ stats: { armor: 40 } }), null, null), 0);
    champion.equipItem(new HeldItem(def({ stats: { armor: 10 } }), null, null), 0);
    expect(champion.stats.armor.value).toBe(10);
  });

  it('arms an item’s passive once per life, the same way its own is armed', () => {
    const item = new HeldItem(def(), new ItemPassive(champion), null);
    champion.equipItem(item, 0);

    expect(ItemPassive.presses, 'armed inside equipItem instead of on a frame').toBe(0);
    tick(30);
    expect(ItemPassive.presses).toBe(1);
  });

  it('stops arming it the moment the item is gone', () => {
    const item = new HeldItem(def(), new ItemPassive(champion), null);
    champion.equipItem(item, 0);
    tick();
    expect(ItemPassive.presses).toBe(1);

    champion.unequipItem(0);
    champion.takeDamage(99_999, undefined, 'TRUE');
    champion.respawn();
    tick(10);

    expect(ItemPassive.presses, 'a sold item re-armed on respawn').toBe(1);
  });

  /**
   * The case that turns `unequipItem`'s `_armedPassives.delete` from a tidy-up
   * into a rule. Unequipping already ran `removeSpell` on the passive, so its
   * buffs and listeners are gone; putting the same instance back on with a
   * stale "already armed" record is an item that sits in the slot doing
   * nothing at all. Found by mutation — deleting that line broke no test until
   * this one existed.
   */
  it('arms the same item again when it is put back on', () => {
    const item = new HeldItem(def(), new ItemPassive(champion), null);
    champion.equipItem(item, 0);
    tick();
    expect(ItemPassive.presses).toBe(1);

    champion.unequipItem(0);
    champion.equipItem(item, 3);
    tick();

    expect(ItemPassive.presses, 'a re-equipped item never woke up').toBe(2);
  });

  it('does not re-arm an item merely moved between slots', () => {
    // Moving is not selling. The passive instance never left the champion, its
    // effects were never taken down, and arming it twice would double whatever
    // it granted.
    const item = new HeldItem(def(), new ItemPassive(champion), null);
    champion.equipItem(item, 0);
    tick();
    champion.moveItem(0, 4);
    tick(5);
    expect(ItemPassive.presses).toBe(1);
  });

  it('re-arms a held item’s passive after a death', () => {
    champion.equipItem(new HeldItem(def(), new ItemPassive(champion), null), 0);
    tick();
    champion.takeDamage(99_999, undefined, 'TRUE');
    tick(3);
    champion.respawn();
    tick();
    expect(ItemPassive.presses).toBe(2);
  });

  it('retires both of an item’s spells when it leaves', () => {
    const passive = new ItemPassive(champion);
    const active = new ItemPassive(champion);
    const deactivated = [vi.spyOn(passive, 'deactivate'), vi.spyOn(active, 'deactivate')];
    champion.equipItem(new HeldItem(def(), passive, active), 0);
    tick();

    champion.unequipItem(0);

    for (const spy of deactivated) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('gives everything back when the champion itself is removed', () => {
    const before = champion.stats.armor.value;
    champion.equipItem(new HeldItem(def({ stats: { armor: 40 } }), null, null), 0);
    champion.onRemoved();
    expect(champion.stats.armor.value, 'a removed champion kept a live modifier').toBe(before);
  });

  it('refuses a slot that is not one', () => {
    expect(champion.equipItem(new HeldItem(def(), null, null), -1)).toBeNull();
    expect(champion.equipItem(new HeldItem(def(), null, null), INVENTORY_SIZE)).toBeNull();
    expect(champion.items.every(slot => slot === null)).toBe(true);
  });

  it('reports no empty slot when it is full', () => {
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      champion.equipItem(new HeldItem(def({ id: `i${i}` }), null, null), i);
    }
    expect(champion.firstEmptyItemSlot()).toBe(-1);
  });

  /**
   * Rearranging the bag, which is a hotkey change and nothing else.
   *
   * The whole reason it is a method rather than two array writes at the call
   * site: `equipItem`/`unequipItem` are the *ownership* seam — they add and
   * remove the stat modifier, they arm and retire the passive, they run
   * `removeSpell` on both of the item's spells. A move crosses none of that.
   * The item never left the champion, so taking its armour off and putting it
   * back on is at best a wasted frame and at worst a rounding difference the
   * champion keeps for ever, and re-arming its passive is a second copy of
   * whatever that passive grants.
   *
   * What *does* change is which key casts it: `Game.itemInputController`
   * resolves `getSpell: slot => player.items[slot]?.active` live, so an active
   * follows its slot with no rebinding anywhere.
   */
  describe('moving an item between slots', () => {
    const named = (id: string) => new HeldItem(def({ id }), null, null);
    const ids = () => champion.items.map(held => held?.def.id ?? null);

    it('swaps two occupied slots', () => {
      champion.equipItem(named('a'), 0);
      champion.equipItem(named('b'), 3);
      expect(champion.moveItem(0, 3)).toBe(true);
      expect(ids()[0]).toBe('b');
      expect(ids()[3]).toBe('a');
    });

    it('moves into an empty slot and leaves the old one empty', () => {
      champion.equipItem(named('a'), 1);
      champion.moveItem(1, 5);
      expect(ids()[1]).toBeNull();
      expect(ids()[5]).toBe('a');
    });

    it('drags an empty slot onto an item, which is the same swap backwards', () => {
      // A thumb can start a drag on a gap. Refusing it would make the gesture
      // work in one direction only, for no reason the player can see.
      champion.equipItem(named('a'), 2);
      expect(champion.moveItem(4, 2)).toBe(true);
      expect(ids()[2]).toBeNull();
      expect(ids()[4]).toBe('a');
    });

    it('keeps every stat exactly where it was', () => {
      // The failure this is written against: a move implemented as
      // unequip-then-equip drifts the total, and nothing else in the engine
      // would ever report a champion who is quietly tougher than their bag.
      champion.equipItem(new HeldItem(def({ id: 'a', stats: { armor: 40 } }), null, null), 0);
      champion.equipItem(new HeldItem(def({ id: 'b', stats: { armor: 10 } }), null, null), 1);
      const before = champion.stats.armor.value;

      for (let i = 0; i < 20; i++) champion.moveItem(i % 2, (i + 1) % 2);

      expect(champion.stats.armor.value).toBe(before);
    });

    it('never retires either item’s spells', () => {
      const passive = new ItemPassive(champion);
      const active = new ItemPassive(champion);
      const deactivated = [vi.spyOn(passive, 'deactivate'), vi.spyOn(active, 'deactivate')];
      champion.equipItem(new HeldItem(def(), passive, active), 0);
      tick();

      champion.moveItem(0, 2);

      for (const spy of deactivated) expect(spy).not.toHaveBeenCalled();
    });

    it('is a no-op onto itself', () => {
      champion.equipItem(named('a'), 0);
      expect(champion.moveItem(0, 0)).toBe(false);
      expect(ids()[0]).toBe('a');
    });

    it('refuses a slot that is not one, rather than growing the bag', () => {
      champion.equipItem(named('a'), 0);
      expect(champion.moveItem(0, INVENTORY_SIZE)).toBe(false);
      expect(champion.moveItem(-1, 0)).toBe(false);
      expect(champion.items).toHaveLength(INVENTORY_SIZE);
      expect(ids()[0]).toBe('a');
    });

    it('refuses a move where both slots are empty', () => {
      expect(champion.moveItem(0, 1)).toBe(false);
    });
  });
});
