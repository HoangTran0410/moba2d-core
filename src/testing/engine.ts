/**
 * The rest of the observer's vocabulary, each admitted against the same
 * question `world.ts`'s header asks: what does an observer need this for.
 * Every one carries its own answer as the doc comment beside it; an export
 * that could not answer that question does not belong here.
 *
 * Every re-export below is named, never `export * from …`. Wildcarding
 * `../game/constants`, say, would publish that file's entire export list,
 * and the next person to add a constant there would widen this module's
 * public surface without ever touching a public file to do it.
 *
 * `spellGroups` (`../game/preset`) used to be here and no longer is —
 * removed, not merely unadded, so its absence is deliberate rather than an
 * oversight to fix. `spellGroups()` reads `contentRegistry()`, which core
 * fills solely from its own generated `installedPacks.ts` — correctly
 * *empty* for a genuinely separated pack, since core cannot know about
 * content it no longer has in its own tree. So the call still resolves and
 * then answers nothing: a pack author testing their own kit through it gets
 * an empty roster and no error, and goes looking for a bug in their own
 * code that is actually in the contract. A surface that resolves and
 * answers empty is worse than one that fails to resolve, because it fails
 * quietly — found only by running a pack's tests from outside this
 * checkout (`npm run verify:pack-standalone`), the one place `spellGroups`
 * ever sees an `installedPacks.ts` that does not already include the pack
 * asking. One installed pack's own test suite leaned on it, for a single
 * champion's own kit; it now reads that pack's own data module directly,
 * which is the only object that actually knows the pack's own roster
 * standalone.
 */

/**
 * Seeding a hand-built game context's event bus. Both fixture modules
 * already construct one internally.
 */
export { default as EventManager } from '../managers/EventManager';

/**
 * Putting a real wave on the board — a spell's behaviour against minions is
 * a different case from against champions.
 */
export { default as Minion } from '../game/gameObject/attackableUnits/Minion';

/**
 * A real tower to hang a passive on.
 *
 * Published the moment `ContentPackCode.turretPassives` existed: a pack that
 * can now state what its turrets are built carrying has to be able to build one
 * and watch the passive work. A stub with an `addBuff` would prove the passive
 * calls `addBuff`, which is not the thing anybody doubts — the tower's own
 * `update()` running the buffs, and `stats.attackDamage` being what a shot
 * reads, are.
 */
export { default as Turret, DEFAULT_TURRET_PRESET } from '../game/gameObject/structures/Turret';
export type { TurretPassive } from '../game/gameObject/structures/Turret';

/**
 * Building a synthetic stat block, and checking a pack's numbers against
 * core's own ceiling.
 */
export { default as Stats, MAX_ATTACK_SPEED } from '../game/gameObject/Stats';

/**
 * Standing two units on opposite sides. A spell never picks a team; an
 * observer always does.
 */
export { default as TeamId } from '../game/enums/TeamId';

/**
 * Reading where a map's lanes actually go, to assert a map's geometry.
 */
export { LANES, Lane, getLaneWaypoints } from '../game/lanes';
export type { LaneWaypoint } from '../game/lanes';

/**
 * Installing a map's own lane set as the active match's — building a world
 * an observer can then read `LANES`/`getLaneWaypoints` back out of, the same
 * way `Game`'s own constructor does for a real match. Core's own
 * `tests/setup.ts` never calls this directly: it goes through the
 * cache-then-install indirection in `src/testing/setup.ts` and
 * `tests/game/lanesFixture.ts` instead, because a checkout can have more
 * than one map-bearing pack installed and "the first one wins" has to be
 * decided somewhere. `tests/game/lanesFixture.ts` is this checkout's own
 * file, in `tests/`, and does not travel with a separated pack. A pack's own
 * `vitest.setup.ts` has no such ambiguity — it knows its own map is the only
 * one it ships — so it calls this directly with its own map's resolved
 * `geometry.lanes`, the same value `src/content/ContentPack.ts`'s
 * `MapGeometry` already carries.
 */
export { setActiveLanes } from '../game/lanes';

/**
 * Asking what a unit can see, directly, without painting a frame.
 */
export { default as FogOfWar } from '../game/gameObject/map/FogOfWar';

/**
 * Putting a real auto-attack in a slot, so a key-press-to-swing sequence is
 * the real one.
 */
export { default as BasicAttack } from '../game/gameObject/coreSpells/BasicAttack';

/**
 * Driving the same input pipeline the player drives, rather than calling
 * `press()` directly.
 */
export { SpellInputController } from '../game/spell/input/SpellInputController';

/**
 * Naming the key to press, for the same reason.
 */
export { HotKeys, SpellHotKeys } from '../game/constants';

/**
 * Checking a pack's attack-profile table against the mechanism constants
 * those numbers have to agree with.
 */
export {
  MELEE_RANGE_THRESHOLD,
  MELEE_WINDUP_MS,
  BasicAttackSwing,
} from '../game/combat/BasicAttack';

/**
 * Installing a pack and reading the errors it refuses on. The installer sits
 * one level above what a pack is handed, which is exactly the observer's
 * altitude.
 */
export { PackRegistry } from '../content/PackRegistry';

/**
 * The same, for shape validation without a full install.
 */
export { validatePack } from '../content/validate';

/**
 * The data half's own validator — the same check a *runtime* install runs,
 * beside the whole-pack one above.
 *
 * Published for a reason of its own: `validatePackData` is what stands
 * between a published pack and `PackLoadError('shape', ...)`, and until it
 * was reachable from a pack the only place to meet it was a browser, after a
 * deploy, with the pack already live at a URL. Every failure it reports names
 * a field and a champion and takes a minute to fix — a scaffolded pack ships
 * four abilities and a portrait because this function requires them of
 * anything `playable` — and none of them could be discovered in less than a
 * deploy cycle. The scaffold's own `packInstallable.test.ts` is what
 * says so out loud, in that pack's test run.
 *
 * `validatePack` above is the stricter one and needs the code half too; this
 * is the half `loadPackFromManifest` checks before any of a pack's code runs.
 */
export { validatePackData } from '../content/validate';
export type { DataValidationResult } from '../content/validate';
