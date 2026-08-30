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
    damage: 3,
    attackInterval: 1_100,
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
    damage: 2,
    attackInterval: 1_500,
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
    damage: 5,
    attackInterval: 1_650,
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
  damage: 12,
  rebuildTime: 30000,
  repairDelay: 6000,
  repairRate: 0.4,
};
