export const HotKeys = {
  A: 65,

  Q: 81,
  W: 87,
  E: 69,
  R: 82,

  D: 68,
  F: 70,

  // Recall (Game.recall). Deliberately absent from SpellHotKeys below: that
  // array is the kit's slot layout, and an eighth entry ripples into the
  // loadout editor, the HUD and every persisted config.
  B: 66,

  // The shop (Game.keyPressed -> HudInteractions.toggleShop). Not one of
  // SpellHotKeys' letters and not one of the inventory's digits, so it can
  // never steal a cast.
  P: 80,

  // The inventory row. A *second* layout, not more of the kit — see
  // `ItemHotKeys` below.
  ONE: 49,
  TWO: 50,
  THREE: 51,
  FOUR: 52,
  FIVE: 53,
  SIX: 54,
};

export const SpellHotKeys = [
  // internal spell
  HotKeys.A,

  // normal spells
  HotKeys.Q,
  HotKeys.W,
  HotKeys.E,
  HotKeys.R,

  // summoner spells
  HotKeys.D,
  HotKeys.F,
];

/**
 * The inventory row, and the reason it is its own array.
 *
 * "An active item is an extra spell slot" is true about what the player does
 * and false about where it lives. Growing `SpellHotKeys` would grow the kit —
 * the thing the loadout editor rearranges, `savedKits` validates the length
 * of, and every persisted config carries. An item is not something a player
 * slots into `W`.
 *
 * So the inventory is a parallel row with its own bindings, and
 * `SpellInputController` takes both its bindings and its `getSpell(slot)` as
 * options — which means a second instance pointed at `Champion.items` gives
 * item actives press, hold-and-release and charging with no new input code.
 * Indexed 0..5 against `Champion.items`, unlike `SpellHotKeys` whose slot 0 is
 * the basic attack.
 */
export const ItemHotKeys = [
  HotKeys.ONE,
  HotKeys.TWO,
  HotKeys.THREE,
  HotKeys.FOUR,
  HotKeys.FIVE,
  HotKeys.SIX,
];
