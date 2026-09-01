import type { MinionKind, MinionPresetData } from '@/game/gameObject/attackableUnits/Minion';
import type { TurretPresetData } from '@/game/gameObject/structures/Turret';

/**
 * Core's own numbers for everything a map may retune — the outermost layer of
 * `config/mapTuning.ts`'s three, in a module that imports **nothing at
 * runtime**.
 *
 * ## Why they are here and not on the classes that use them
 *
 * `mapTuning.ts` is the one place a map's numbers meet core's, so it has to
 * read every default. It lives under `src/game/config/`, and that directory is
 * pinned to the `pregame` chunk (`vite.config.ts`) because the setup screen's
 * whole data layer sits there — a match's config, its saved kits, its spell
 * catalogue. Reading `MinionPresets` out of `Minion.ts` therefore made the
 * *menu* statically import the megabyte-sized match chunk, and `chunks:check`
 * said so: `pregame statically imports game`.
 *
 * This is the shape `src/game/items/itemStats.ts` already takes and for the
 * same reason, one directory over: a bare table with no imports, read from
 * both sides of a chunk boundary, pinned where the reader that cannot afford
 * the engine lives. The classes read it back the other way — `game` importing
 * `pregame` is the allowed direction, and every existing import site keeps
 * working because each class re-exports what it used to define.
 *
 * **Nothing in here may grow a value import.** A single one puts the whole
 * engine back on the menu's first paint, silently, and the only thing that
 * would notice is a chunk check somebody has to be running.
 */

// ------------------------------------------------------------------ economy

/**
 * Gold per second, to everyone, for existing.
 *
 * The floor under a player who is losing: farm dries up when a lane is lost,
 * and a game where falling behind means falling further behind with no way
 * back is one nobody finishes. Roughly League's own 2.03/s, which is a number
 * two decades of tuning arrived at.
 */
export const PASSIVE_GOLD_PER_SECOND = 2;

/** What a champion walks out of the fountain with at the start of a match. */
export const STARTING_GOLD = 500;

/**
 * What killing one of these is worth to whoever did it.
 *
 * The numbers are the shape of the economy, not a translation of anyone
 * else's: a match here is minutes rather than half an hour, and an item priced
 * for League's curve would never be reached. Sized against
 * `PASSIVE_GOLD_PER_SECOND` so a player who farms is meaningfully richer than
 * one who does not, and a player who does neither is still buying something.
 *
 * They live together rather than as a field on each unit class for the same
 * reason `Difficulty.ts` holds every knob a tier changes: an economy is a set
 * of numbers that only mean anything *relative to each other*, and one of them
 * living somewhere else is how the set gets retuned by halves.
 */
export const MINION_BOUNTY = 20;
/** A camp is worth a little more than a caster minion and takes longer to take. */
export const MONSTER_BOUNTY = 32;
export const CHAMPION_BOUNTY = 200;
/** A building. Killer-only, like everything else here — no team split yet. */
export const TURRET_BOUNTY = 150;

/**
 * What selling an item pays back, as a fraction of its cost.
 *
 * Here rather than in `economy/ItemShop.ts` — which re-exports it, and is
 * where every reader still looks — for this file's whole reason: `mapTuning.ts`
 * has to read it to resolve a map's own `sellRefund`, and that module is
 * pinned to the `pregame` chunk. Importing it from `ItemShop` put the entire
 * match chunk on the menu's first paint, which `pregameChunkPurity.test.ts`
 * caught in the same edit that introduced it.
 *
 * 0.7 and not 1: a full refund turns an inventory into a scratchpad, and the
 * cost of changing your mind is what makes committing to a build a decision.
 */
export const SELL_REFUND_FRACTION = 0.7;

/**
 * How long after hurting somebody you are still counted as having helped kill
 * them.
 *
 * Ten seconds, which is League's own window, and long enough that the number
 * is about *participation* rather than about the last half-second. It is a map
 * rule rather than a constant because it changes what a team fight is worth: a
 * short window makes a kill the property of whoever landed the last two hits,
 * a long one pays everybody who committed to the fight at all.
 */
export const ASSIST_WINDOW_MS = 10_000;

/**
 * What an assist pays, as a share of the bounty the killer collects.
 *
 * Paid *on top of* the killer's full bounty rather than carved out of it. The
 * alternative — split one purse N ways, League's own rule — retunes every kill
 * in the game the moment assists exist, and quietly nerfs solo kills that were
 * balanced without them. This way nothing a killer earned before moved, and
 * the map author has one number for how much a match rewards grouping.
 */
export const ASSIST_GOLD_SHARE = 0.5;

/**
 * How long a unit stays lit after giving itself away, and how much of the map
 * around it is lit too — League's own 2 seconds and 300 units.
 * `combat/AttackReveal.ts` quotes the sentence they come from and re-exports
 * these names, so the rule and its numbers read together.
 *
 * Here, beside the sell refund, for exactly the reason recorded above it: a map
 * may override both (`MapTuning.vision`), so `config/mapTuning.ts` has to read
 * them — and that module is pinned to the `pregame` chunk while the fog and the
 * combat seams that apply them are `game`. A table with no imports is the one
 * shape both sides can read.
 *
 * The radius is in world pixels, not League units. It is about a champion body
 * and a half, which is the shape of "whoever is standing with them".
 */
export const DEFAULT_ATTACK_REVEAL_MS = 2_000;
export const DEFAULT_ATTACK_REVEAL_RADIUS = 300;

// ------------------------------------------------------------------ minions

/**
 * Three bodies, all intentionally cheap. The melee line tanks, casters poke from
 * behind it, and the periodic cannon is a slower, tougher ranged siege body.
 *
 * ## Sized against the champion, which for a long time they were not
 *
 * These numbers used to be picked against each other alone — "a lane fight
 * resolves in roughly ten seconds" — and never against the thing that has to
 * walk through them. Measured against `DEFAULT_CHAMPION_ATTACK` and
 * `DEFAULT_CHAMPION_DEFENCE`, the wave they described was not an obstacle, it
 * was the strongest unit on the board:
 *
 *   - A melee minion had **140 health against a champion's 100** — more than
 *     every body but a tank's, in a pack that ships six of them. `Champion.ts`
 *     and `content/ContentPack.ts` both name that number as the thing wrong
 *     with the champion; it was equally the thing wrong with the minion.
 *   - The opening wave was 690 health, and a champion swinging at the default
 *     15.4 damage a second needed **45 seconds** of uninterrupted autoing to
 *     clear it. Waves arrive every `WAVE_INTERVAL_MS` — thirty. A lane could
 *     not be cleared as fast as it filled, by anyone, ever.
 *   - That same wave dealt **19.6 damage a second**, against the champion's
 *     15.4. Six minions out-damaged the player they were walking at, which is
 *     the whole of "I am more afraid of the wave than of the enemy laner".
 *
 * So health comes down by half and damage with it, holding the minion-versus-
 * minion clock roughly where it was (three melee focusing one still take it
 * down in about nine seconds, against ten before) while moving both numbers
 * back under the champion's. `minionBalance.test.ts` holds all three of the
 * bounds above as arithmetic over these constants and the champion's, so a
 * future retune of either side cannot quietly cross them again.
 *
 * ## Bigger bites, on a slower beat
 *
 * Reported after the champion bodies grew: *"damage minion giờ cũng yếu yếu"*.
 * The arithmetic agrees, and the interesting half is *why the rule below did
 * not catch it*. The bound is written against `DEFAULT_CHAMPION_DEFENCE` —
 * 100 health, **no armour** — which is the body core promises a pack that
 * declares nothing, and no longer the body anybody plays: the lol pack's
 * champions run 112 to 233 health with real resistances. A wave dealing 12.2/s
 * to a bare 100-health champion deals about 9 effective to a 200-health
 * bruiser on 30 armour, and that is twenty seconds of being nibbled.
 *
 * Two things changed and they are not the same thing. Damage per second is up
 * about 15% (12.2 to 14.0 for the opening wave, against the champion's 15.4),
 * which is real but modest — the rule below is what caps it, and it is right
 * to. The **hit** is up much more: 3 to 4, 2 to 3, 5 to 7, on beats stretched
 * to match. That is the half the report was actually about. A minion that bites
 * for 2 reads as an ant whatever its damage per second says, and one that bites
 * for 3 on a slower swing reads as a unit, for the same cost to the player.
 *
 * If it still reads as weak, the lever is **not here**. Core's bound protects
 * core's own default body; a pack whose champions are twice that body can
 * declare its own minion types and tune them against its own roster, which is
 * what `MinionSpawner`'s `types` is for. Raising these past the rule below
 * would make core's default champion lose to the wave, which is the one thing
 * this file may not do.
 *
 * ## The cannon is the wave's payday
 *
 * It is the one body worth stopping for — three times the melee bounty, the
 * way the source game prices its siege minion — and `MinionSpawner` leaves a
 * `goldBounty` a type names for itself alone, so a map that retunes
 * `economy.minionBounty` retunes the other two and not this one. That is the
 * documented behaviour of the field rather than a surprise: a type that
 * priced itself said something more specific than the map did.
 */
export const MinionPresets: Record<MinionKind, MinionPresetData> = {
  melee: {
    name: 'Lính Cận Chiến',
    kind: 'melee',
    style: 'melee',
    speed: 2.6,
    size: 34,
    health: 70,
    damage: 4,
    attackInterval: 1_300,
    attackRange: 40,
    aggroRange: 300,
  },
  ranged: {
    name: 'Lính Phép Sư',
    kind: 'ranged',
    style: 'ranged',
    speed: 2.6,
    size: 30,
    health: 45,
    damage: 3,
    attackInterval: 1_900,
    attackRange: 280,
    aggroRange: 340,
  },
  cannon: {
    name: 'Lính Xe Pháo',
    kind: 'cannon',
    style: 'cannon',
    goldBounty: 60,
    speed: 2.6,
    size: 38,
    health: 150,
    damage: 7,
    attackInterval: 1_900,
    attackRange: 300,
    aggroRange: 360,
  },
};

// ----------------------------------------------------------------- monsters

/**
 * How far past its own ground a camp will chase, on top of the camp radius.
 *
 * Wide enough that a camp finishes what it started rather than stopping at the
 * edge of its own ground while a fleeing target walks away.
 */
export const MONSTER_CHASE_MARGIN = 350;

/**
 * Grace after a camp's target leaves the chase leash before it turns for home,
 * so a target that ducks out and back is still pursued.
 */
export const MONSTER_GIVE_UP_DELAY_MS = 2000;

/**
 * How long after being hurt a camp refuses to regenerate at all.
 *
 * Without it a camp resets the moment a fight pauses, for any reason, and
 * every point of damage done to it is gone before a player can walk back. A
 * rooted boss made that worse still: stepping outside its reach used to drop
 * its target on the spot, so "leave range for a second" was a complete heal.
 *
 * Four seconds is a *pause in the fight*, not a leash: it is shorter than any
 * camp's respawn and longer than the time to reposition, so kiting a camp is
 * still free and abandoning one is still a reset.
 */
export const MONSTER_REGEN_DELAY_MS = 4000;

// ------------------------------------------------------------------ turrets

/**
 * A tower with no map behind it.
 *
 * Every shipped map states its own, so this is the floor a map with no
 * `tuning.turrets` block plays on — and the numbers a slot's own `stats`
 * merge over, one layer at a time (`mapTuning.ts`).
 */
export const DEFAULT_TURRET_PRESET: TurretPresetData = {
  health: 400,
  size: 92,
  attackRange: 430,
  attackInterval: 1300,
  damage: 50,
  rebuildTime: 30000,
  repairDelay: 6000,
  repairRate: 0.4,
};
