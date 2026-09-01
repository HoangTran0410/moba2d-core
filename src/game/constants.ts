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

/**
 * Which index in `Champion.spells` each ability actually lives at.
 *
 * **Slot 0 is the basic attack, not Q.** `preset.ts` states it — "every kit
 * has it in slot 0" — and `SpellHotKeys` below is the same list written as
 * keys. Anything that fills the kit by counting from zero swaps the basic
 * attack and shifts every ability one place left, which is precisely what a
 * transforming ultimate did on its first outing: it replaced attack/Q/W where
 * it meant Q/W/E, and the bug was only visible in a match.
 *
 * So the indices are published rather than counted. A pack writing
 * `spells[SpellSlot.Q]` cannot make that mistake; a pack writing `spells[0]`
 * has already made it.
 */
export const SpellSlot = Object.freeze({
  /** The basic attack. Present on every kit, and not something a pack replaces. */
  ATTACK: 0,
  Q: 1,
  W: 2,
  E: 3,
  R: 4,
  /** The two summoner slots. */
  D: 5,
  F: 6,
});

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
