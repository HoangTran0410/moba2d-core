import AssetManager, { type AssetHandle, type AssetKey } from '@/managers/AssetManager';
import { packAsset } from '@/game/config/packAsset';
import { CHAMPION_Z_INDEX } from '@/game/managers/ObjectManager';
import type Spell from '@/game/gameObject/Spell';
import BasicAttackController from '@/game/combat/BasicAttackController';
import { uuidv4 } from '@/utils/index';
import { HeldItem, INVENTORY_SIZE, type ItemStatKey } from '@/game/items/Item';
import AttackableUnit from './AttackableUnit';
import type {
  AttackableUnitOptions,
  AttackableUnitRenderOptions,
  UnitDeathData,
} from './AttackableUnit';
import type { KillCredit } from '@/game/combat/MatchTally';
import Airborne from '@/game/gameObject/buffs/Airborne';
import Charm from '@/game/gameObject/buffs/Charm';
import Dash from '@/game/gameObject/buffs/Dash';
import Fear from '@/game/gameObject/buffs/Fear';
import Root from '@/game/gameObject/buffs/Root';
import Silence from '@/game/gameObject/buffs/Silence';
import Slow from '@/game/gameObject/buffs/Slow';
import Stun from '@/game/gameObject/buffs/Stun';
import Taunt from '@/game/gameObject/buffs/Taunt';
import Wallet, { CHAMPION_BOUNTY, STARTING_GOLD } from '@/game/economy/Wallet';
import type Buff from '@/game/gameObject/Buff';
import type { BuffStackId } from '@/game/gameObject/Buff';

/** A champion's basic attack profile. `range` alone decides melee or ranged. */
export interface ChampionAttackTuning {
  /** Damage per swing. */
  damage: number;
  /** Swings per second. */
  attacksPerSecond: number;
  /** Surface-to-surface reach. Above MELEE_RANGE_THRESHOLD this fires a bolt. */
  range: number;
  /**
   * World units per second the bolt flies, ranged champions only. Optional —
   * absent, `DEFAULT_CHAMPION_ATTACK.boltUnitsPerSecond` applies — so a pack
   * tunes only the champions whose delivery is part of their identity.
   */
  boltUnitsPerSecond?: number;
}

/**
 * Basic attack numbers for a champion with no profile of its own.
 *
 * A champion pool is 100 health, a minion 140, a turret 400 dealing 12 per
 * 1.3s (9.2 dps). 14 per swing at 1.1/s is 15.4 dps, so autos alone take about
 * seven connected swings — a little over six seconds once regeneration is
 * counted — to end a champion. That is long enough that a duel is a fight with
 * room for spells and disengages, and short enough that autoing is worth doing.
 *
 * 0.8/s was the previous rate, and it was the same rate for every champion in
 * the game: a kit designed to be carried by attack speed had none to be carried
 * by. Roles now declare their own profile — see `ATTACK` in `packs/riot/data.ts`
 * — and this is only the fallback for anything that names no role.
 *
 * The range is 300, comfortably inside the 500 sight radius (so you can attack
 * what you can see and the leash never fires first) and below a turret's 430.
 *
 * The bolt flies at 1000 units/s — the source game's median ranged missile
 * (~2000 units/s) at this canvas's half scale, crossing the 300 reach in
 * 0.3s. It used to be 420, a leftover from when the only requirement was
 * "faster than a minion's 360": relative to the champion's own 180 units/s
 * walk that was 2.3×, against the 5-11× the genre trains people on, and every
 * ranged auto read as a lob. A pack tunes it per champion through
 * `boltUnitsPerSecond` (a buckshot marksman near-hitscan, an enchanter's slow
 * arc), which is how the source game does it too — per champion, roughly
 * 1000-3800 there, so ~500-1900 here.
 */
export const DEFAULT_CHAMPION_ATTACK: ChampionAttackTuning = {
  damage: 14,
  attacksPerSecond: 1.1,
  range: 300,
  boltUnitsPerSecond: 1000,
};

/** A champion's durability profile. See `content/ContentPack.ts`'s `ChampionDefence`. */
export interface ChampionDefenceTuning {
  health: number;
  healthRegen: number;
  armor: number;
  magicResist: number;
}

/**
 * Durability for a champion with no profile of its own — **today's numbers,
 * written down.**
 *
 * Every one of these is what `Stats` already constructs a champion with, so
 * the day this file grew a defence profile not one champion in any pack
 * changed. That is the whole point of the default existing: a pack opts into
 * a durability spread the way it opted into an attack spread, and a pack that
 * says nothing keeps the game it shipped.
 *
 * The numbers are also a fair record of the problem. 100 health is *less than
 * a minion's* 140, and it was tuned — see `DEFAULT_CHAMPION_ATTACK` above —
 * against about 15 damage a second, back when nothing could be bought. Zero of
 * both resistances is `Stats.armor`'s own migration story: they shipped inert
 * so that adding damage types moved no existing number.
 */
export const DEFAULT_CHAMPION_DEFENCE: ChampionDefenceTuning = {
  health: 100,
  healthRegen: 0.06,
  armor: 0,
  magicResist: 0,
};

export interface ChampionPresetData {
  name?: string;
  /**
   * A pack's own asset key — a plain string, not core's generated `AssetKey`
   * union, because a pack's art is its own to type-check, not core's. See
   * `preset.ts`'s `PlayableChampionKit` for the write side and
   * `@/game/config/packAsset` for the read side, below.
   */
  avatar?: string;
  spells?: Array<new (owner: Champion) => Spell>;
  /**
   * This champion's passive, or absent.
   *
   * **In the preset, unlike `recall`, and the difference is the point.** Going
   * home is a property of the *map* — a fountain exists or it does not — so a
   * preset swap must never take it away, which is why `Champion.recall` sits
   * outside `ChampionPresetData` entirely. A passive is a property of the
   * *champion*, so becoming a different champion must absolutely replace it.
   * The two live in different places because they answer to different owners.
   */
  passive?: new (owner: Champion) => Spell;
  /** Overrides DEFAULT_CHAMPION_ATTACK. Drop `range` below the melee threshold
   *  and the champion swings instead of shooting; nothing else changes. */
  attack?: ChampionAttackTuning;
  /** Overrides DEFAULT_CHAMPION_DEFENCE. */
  defence?: ChampionDefenceTuning;
}

export interface ChampionOptions extends Omit<AttackableUnitOptions, 'avatar'> {
  avatar?: AssetHandle;
  preset?: ChampionPresetData;
}

/**
 * Health per tick mark on a champion's bar. The frame is a fixed width, so the
 * number of ticks is what communicates pool size: more ticks means more health.
 * The step widens once a pool would draw more than MAX_TICKS, otherwise a
 * grown-out health pool's bar turns into a solid block of lines.
 */
/**
 * Crowd-control buffs named under the health bar, in the order they print.
 * Module-level because the list is fixed and `drawHealthBar` runs per champion
 * per frame — rebuilding it there made a nine-element array 60 times a second
 * per champion for a label that is usually empty.
 */
const STATUS_TEXT_BUFFS = [Airborne, Root, Silence, Dash, Stun, Slow, Charm, Fear, Taunt];

/**
 * `STATUS_TEXT_BUFFS[Cls.prototype]` -> that class's index, so a buff's slot
 * can be found in one lookup instead of nine sequential `instanceof` checks.
 *
 * The naive version of this ("index by `buff.constructor`") is wrong: a
 * content pack subclasses these freely — two ultimates on the bundled roster
 * ship a knockback extending `Dash`, and one ships a movement debuff
 * extending `Slow` — so an exact-constructor match would silently stop
 * showing "Ghosted"/"Chậm" for anyone hit by those. Walking the buff's
 * own prototype chain and checking each level against this map reproduces
 * `instanceof`'s subclass-matching exactly, at whatever depth a future spell
 * adds — see `champion-status-text-scan-cost.test.ts`'s subclass case.
 */
const STATUS_TEXT_BUFF_INDEX = new Map<unknown, number>(
  STATUS_TEXT_BUFFS.map((BuffClass, index) => [BuffClass.prototype, index])
);

/**
 * `instanceof` against every `STATUS_TEXT_BUFFS` entry in one prototype-chain
 * walk instead of nine separate chain walks, one per candidate class. -1 if
 * `buff` is none of them (the common case for a champion carrying a large
 * permanent stat stack, none of which are crowd control). See the O(9N)
 * note on `STATUS_TEXT_BUFFS` above.
 *
 * Held as a method on a plain object, not a bare function, so a test can
 * `vi.spyOn` it directly to count calls — the seam for
 * `champion-status-text-duplicate-skip.test.ts`, which proves
 * `drawHealthBar` stops calling it for the 2nd..Nth instance of a
 * `singleRepresentativeDraw` stack (`Buff.ts`) once the first has answered
 * for that `stackId`, same idea as `AttackableUnit.drawBuffs()`'s skip and
 * for the same reason: at N in the thousands (a cheat-console stack count,
 * not a design limit — see `.superpowers/perf-healthbar-report.md`), a
 * prototype-chain walk run once per instance instead of once per *group* is
 * a real, measured, avoidable cost.
 */
export const ChampionStatusText = {
  indexOf(buff: Buff): number {
    let proto: unknown = Object.getPrototypeOf(buff);
    while (proto) {
      const index = STATUS_TEXT_BUFF_INDEX.get(proto);
      if (index !== undefined) return index;
      proto = Object.getPrototypeOf(proto);
    }
    return -1;
  },
};

export const TICK_LADDER = [50, 100, 250, 500, 1_000, 2_500] as const;
export const MAX_TICKS = 20;

/** Rounds `raw` up to the next "nice" step — 1, 2 or 5 times a power of ten —
 *  the standard technique for picking readable axis/tick spacing. Always
 *  `>= raw`, so a step from this function can never let a tick count exceed
 *  `maxHealth / step`'s ceiling. Only ever called past `TICK_LADDER`'s own
 *  reach (health > 50,000), so `raw` here is always a few thousand or more —
 *  not a general-purpose helper asked to behave at zero or negative input. */
const niceStepAtLeast = (raw: number): number => {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const niceMultiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceMultiplier * magnitude;
};

export const healthTickStep = (maxHealth: number): number => {
  for (const step of TICK_LADDER) {
    if (maxHealth / step <= MAX_TICKS) return step;
  }
  // Past the curated ladder — reachable, not theoretical: a permanent
  // per-stack max-health bonus has no cap of its own, so several uncapped
  // max-health sources can compound a pool past 50,000 (TICK_LADDER's last
  // rung x MAX_TICKS) over a long game.
  // The old code returned the ladder's last rung here regardless of how far
  // past it `maxHealth` had grown, so MAX_TICKS silently stopped holding
  // right at this threshold. Deriving the step directly keeps the cap true
  // at any input.
  return niceStepAtLeast(maxHealth / MAX_TICKS);
};

export default class Champion extends AttackableUnit {
  static displayZIndex = CHAMPION_Z_INDEX;
  killCredit: KillCredit = 'champion';

  /** See `Wallet` — the base class has none, and this is the class that does. */
  wallet: Wallet | null = new Wallet(STARTING_GOLD);

  goldBounty = CHAMPION_BOUNTY;

  /**
   * Whether a `BotBrain` is driving this body. `AIChampion` overrides it to
   * true.
   *
   * A flag rather than an `instanceof AIChampion` at the read sites, because
   * the one place that needs the answer is `TeamBlackboard` — and importing
   * `AIChampion` there would close a cycle (`AIChampion` -> `BotBrain` ->
   * `TeamBlackboard`). The board hands out lane assignments, and a human on
   * the roster must not consume one: nothing would ever act on it, and the
   * lane it took would be a lane no bot walked to.
   */
  readonly isBot: boolean = false;

  /**
   * The number on the health bar, now a view of the ledger rather than its own
   * counter. It means exactly what it always did — kills minus deaths — but the
   * two halves are separately readable, which is what a scoreboard needs.
   */
  get score(): number {
    return this.tally.score;
  }

  name?: string;
  spells: Spell[] = [];

  /** Standing attack order, swing timer and delivery. Never scans on its own. */
  basicAttack: BasicAttackController = new BasicAttackController(this);

  /**
   * This champion's way home, or null on a map that grants none.
   *
   * Not built here. Recall needs a fountain to return to, and a fountain is
   * something a map supplies — a battle-royale map has none, and on one the
   * `B` key and the touch button do nothing rather than doing something
   * meaningless. `preset.ts` fills this in today; a content pack declares it
   * per champion (`ChampionEntry.recall`) once the boot path reads packs.
   *
   * Deliberately **not** in `spells[]` even when present — see the header of
   * `spells/Recall.ts`: that array is indexed by `SpellHotKeys` and an eighth
   * entry ripples into the loadout editor's slots, `hudState`'s
   * summoner-spell test, `MatchDirectorSource` and the generated catalogue. A
   * champion swap does not take the ability to go home away, so
   * `replaceSpells`/`applyPreset` never touch it either.
   */
  recall: Spell | null = null;

  /**
   * A spell this champion *has* rather than one it casts, or null — which is
   * most champions.
   *
   * Outside `spells[]` for the same reason `recall` is, and the reason is
   * worth restating because the pull to make it an eighth entry is strong:
   * that array is indexed by `SpellHotKeys` and is also what the loadout
   * editor lets a player rearrange. A passive has no key to press and no
   * cooldown to read, and offering it in a kit builder as something to drop
   * into `W` is offering nonsense.
   *
   * **Core presses it exactly once per life**, on the dead → alive transition
   * (`armPassive`). Not once per match, because a passive that hung its effect
   * on a buff or an event listener has lost both by the time its champion
   * respawns; and not "whenever it is READY", which for any passive that
   * completes instantly is sixty presses a second.
   *
   * The same field is what an *item* passive will hang off when items exist —
   * an item that grants an always-on effect is this mechanism with a different
   * owner, not a second one.
   */
  passive: Spell | null = null;

  /**
   * What this champion is carrying. Fixed length, `null` where empty — a slot
   * is a place, so a sparse array would make "the third slot" mean different
   * things before and after the second one is sold.
   *
   * A **parallel row to `spells[]`, never part of it.** See
   * `game/items/Item.ts` for the whole reasoning; the short version is that
   * the kit array is the hotkey layout the loadout editor rearranges, and an
   * item is not something a player slots into `W`.
   */
  readonly items: (HeldItem | null)[] = Array.from({ length: INVENTORY_SIZE }, () => null);

  /**
   * Which passives have been armed for the life this champion is currently
   * living — the champion's own and every held item's, in one set because they
   * are one mechanism.
   *
   * Cleared by death, not by respawn, so a champion that never dies is armed
   * once and one that dies twice is armed three times.
   *
   * Keyed by the `Spell` instance rather than by slot, because a slot is not
   * what a passive belongs to — moving an item from slot 3 to slot 5 must not
   * re-arm it, and two items in one slot over a match are two passives.
   * `unequipItem` takes its entry back out, which is what makes re-equipping
   * the *same* instance arm it again: unequipping ran `removeSpell` on it, so
   * its buffs and listeners are already gone and an item put back on with a
   * stale "already armed" record would sit there doing nothing.
   */
  private readonly _armedPassives = new Set<Spell>();

  constructor({
    game,
    position,
    collisionRadius,
    visionRadius,
    teamId,
    id,
    stats,
    avatar,
    preset,
  }: ChampionOptions) {
    super({
      game,
      position,
      collisionRadius,
      visionRadius,
      teamId,
      id,
      avatar: avatar ?? (preset?.avatar ? packAsset(preset.avatar) : undefined),
      stats,
    });

    // A champion with no preset at all is still a champion: it gets the default
    // attack profile rather than a unit that cannot swing.
    if (preset) this.applyPreset(preset);
    else {
      this.applyAttackTuning(DEFAULT_CHAMPION_ATTACK);
      this.applyDefenceTuning(DEFAULT_CHAMPION_DEFENCE);
    }
  }

  /**
   * Everything a `ChampionPresetData` decides about a champion, in one place.
   *
   * Written as a method rather than left in the constructor because a champion
   * takes a preset in more than one situation: at construction, and on a
   * respawn that rolls a new champion (`AIChampion.respawn`). Those used to be
   * two partial copies of this, and the respawn copy restored only `avatar`
   * and `spells` — so a bot that respawned as a new champion kept the old
   * one's name and its attack damage, speed and range for the rest of the
   * match.
   *
   * Deliberately does NOT touch health or mana. The constructor must not (the
   * unit is still being built) and `respawn()` must not (`super.respawn()` has
   * already refilled). Refilling the bars belongs to whoever swaps a champion
   * under a unit that is standing there, which is a different act entirely.
   *
   * A slot still holding the same spell class keeps its *instance*, rather than
   * being rebuilt into an identical-looking new one. The practice panel's
   * loadout editor commits a whole loadout even when the player changed a
   * single slot, so rebuilding unconditionally charged every edit the state
   * that lives on a spell instance and nowhere else: a stacking spell's stacks went to
   * zero when the player swapped a different slot. Running cooldowns and active phases went
   * the same way.
   */
  applyPreset(preset: ChampionPresetData): void {
    this.name = preset.name;
    if (preset.avatar) this.avatar = packAsset(preset.avatar);
    const previous = this.spells;
    this.replaceSpells(
      (preset.spells ?? []).map((SpellClass, index) => {
        const standing = previous[index];
        return standing?.constructor === SpellClass ? standing : new SpellClass(this);
      })
    );
    this.applyPassive(preset.passive);
    this.applyAttackTuning(preset.attack ?? DEFAULT_CHAMPION_ATTACK);
    this.applyDefenceTuning(preset.defence ?? DEFAULT_CHAMPION_DEFENCE);
  }

  /**
   * Swaps the passive, keeping the instance when the class has not changed.
   *
   * Same rule `applyPreset` follows for a kit slot, and for the same reason:
   * the loadout editor commits the whole loadout on every edit, so rebuilding
   * unconditionally would re-arm a passive — and reset whatever state it keeps
   * on its own instance — every time the player touched an unrelated slot.
   *
   * Re-arming is deliberate when the class *does* change: the outgoing passive
   * is retired through `removeSpell` so its buffs and listeners go with it, and
   * `_passiveArmed` is cleared so the incoming one is pressed on the next frame
   * rather than never.
   */
  private applyPassive(PassiveClass?: new (owner: Champion) => Spell): void {
    if (this.passive?.constructor === PassiveClass) return;
    this.removeSpell(this.passive ?? undefined);
    this.passive = PassiveClass ? new PassiveClass(this) : null;
    // Arming a passive is not casting a spell — see `Spell.countsAsAbilityCast`.
    if (this.passive) this.passive.countsAsAbilityCast = false;
    // Nothing to clear from `_armedPassives`: it is keyed by instance, and the
    // outgoing instance is gone. The incoming one has never been armed, so the
    // next frame arms it.
  }

  /**
   * Applies a durability profile, **keeping the champion exactly as hurt as it
   * was.**
   *
   * The health *pool* is tuning and is written straight through. Current health
   * is a resource, and this method runs in more places than a spawn: the
   * practice panel's loadout editor commits a whole loadout on every single
   * edit, and `MatchDirector` swaps a champion under a unit already standing on
   * the map. Writing `health = maxHealth` here would make the editor a full
   * heal on tap, mid-fight, for free.
   *
   * So the fraction is preserved rather than the amount. A champion at half
   * health whose pool goes from 100 to 220 comes out at 110 — still half. On a
   * fresh unit the fraction is 1 and it fills, which is what a spawn wants
   * without this method having to know it is one. `applyPreset`'s own comment
   * says health and mana are not its business; this is the narrow exception,
   * and it moves nobody's health *bar* even while it moves the pool under it.
   *
   * **An unchanged pool is not rescaled at all**, rather than multiplied by a
   * ratio that happens to be one. `7 / 100 * 100` is `7.000000000000001` in
   * binary floating point, and the editor commits a loadout on every keystroke
   * — so the round trip alone would have walked a champion's health off a whole
   * number and kept walking. Which is also the only case that matters in
   * practice: swapping a kit almost never changes the pool.
   */
  private applyDefenceTuning(defence: ChampionDefenceTuning): void {
    const pool = this.stats.maxHealth.baseValue;

    this.stats.maxHealth.baseValue = defence.health;
    this.stats.healthRegen.baseValue = defence.healthRegen;
    this.stats.armor.baseValue = defence.armor;
    this.stats.magicResist.baseValue = defence.magicResist;

    if (defence.health === pool) return;

    // Whole points, like every other write to a health pool — see `takeDamage`.
    const filled = pool > 0 ? this.stats.health.baseValue / pool : 1;
    this.stats.health.baseValue = Math.min(
      this.stats.maxHealth.value,
      Math.max(0, Math.round(defence.health * filled))
    );
  }

  private applyAttackTuning(attack: ChampionAttackTuning): void {
    this.stats.attackDamage.baseValue = attack.damage;
    this.stats.attackSpeed.baseValue = attack.attacksPerSecond;
    this.stats.attackRange.baseValue = attack.range;
    // A plain field, not a stat: nothing in the game modifies missile speed,
    // and `BasicAttackController.launch` reads it once per bolt.
    this.attackBoltUnitsPerSecond =
      attack.boltUnitsPerSecond ?? DEFAULT_CHAMPION_ATTACK.boltUnitsPerSecond;
  }

  update() {
    super.update();
    this.basicAttack.update();
    this.spells.forEach(spell => spell.update());
    // `?.` for the same reason `drawAttackOrder` uses it: prototype-only
    // champions built with Object.create never run a field initializer.
    this.recall?.update();
    this.passive?.update();
    // `?? []` for the same reason the `?.` above exists: a prototype-only
    // champion built with `Object.create` never ran a field initializer, so
    // `items` is `undefined` rather than empty.
    for (const item of this.items ?? []) {
      item?.passive?.update();
      item?.active?.update();
    }
    this.armPassives();
    // Per unit of *time*, not per frame — `Wallet.accrue`'s own doc comment has
    // the reason. Deliberately outside any `isDead` check: income is the floor
    // under a player who is losing, and stopping it while they are dead stops
    // it hardest exactly when it is doing its job.
    this.wallet?.accrue(deltaTime);
  }

  /**
   * Presses the passive on the frame this champion is alive and has not been
   * armed for this life. See `passive`'s own doc comment for why the trigger
   * is the dead → alive transition and not anything simpler.
   *
   * The context is built here rather than fetched from
   * `game.createSpellContext`, and that is not a shortcut. A passive is `SELF`
   * by definition: it has no cursor, resolves no target, and needs nothing the
   * targeting layer produces. Depending on the game context for it also makes
   * a passive silently *never arm* anywhere that context is minimal — the test
   * world stubs `createSpellContext` to `undefined` on purpose, and a champion
   * built by a pack's own harness would have had a dead passive with nothing
   * to see. Origin and cursor are both the champion's own feet, which is the
   * literal truth about where a passive is aimed.
   *
   * It still goes through `press` rather than `onSpellCast`, so a passive is
   * subject to the same activation, resource and cooldown rules as everything
   * else — one that refuses its own cast stays visibly unarmed rather than
   * half-running.
   */
  private armPassives(): void {
    if (this.isDead) {
      this._armedPassives?.clear();
      return;
    }
    this.armPassive(this.passive);
    for (const item of this.items ?? []) this.armPassive(item?.passive ?? null);
  }

  /** One passive, armed if it is not already armed for this life. */
  private armPassive(passive: Spell | null): void {
    if (!passive || this._armedPassives?.has(passive)) return;

    const here = Object.freeze({ x: this.position.x, y: this.position.y });
    this._armedPassives?.add(passive);
    passive.press(
      Object.freeze({
        spellId: passive.id,
        activationId: uuidv4(),
        startedAtMs: Date.now(),
        caster: this,
        origin: here,
        cursorWorld: here,
        // A self cast aims nowhere. `Spell.cast()` produces the same degenerate
        // direction when the cursor sits exactly on the caster, so this is the
        // established shape rather than a new one — and no `SELF` spell reads it.
        direction: Object.freeze({ x: 0, y: 0 }),
      })
    );
  }

  draw(options: AttackableUnitRenderOptions = {}) {
    super.draw(options);
    this.drawAttackOrder();
    this.spells.forEach(spell => spell.drawVfx());
    this.recall?.drawVfx();
    this.passive?.drawVfx();
    for (const item of this.items ?? []) {
      item?.passive?.drawVfx();
      item?.active?.drawVfx();
    }
  }

  /**
   * Order this champion to attack a unit: walk into range, then swing on the
   * interval until it dies, leaves sight or a different order arrives.
   */
  orderAttack(target: AttackableUnit): void {
    this.basicAttack.order(target);
  }

  /**
   * A move order is also the cancel for an attack order. It routes around
   * terrain: clicking across a wall walks around the wall rather than into it.
   *
   * `urgent` puts the route at the front of the search queue. Game passes it
   * for the local player's own clicks, because a frame of search latency on a
   * bot is invisible and a frame of it on a click is not.
   */
  orderMove(x: number, y: number, urgent = false): void {
    this.basicAttack.clear();
    this.navigateTo(x, y, urgent);
  }

  /**
   * The reticle. Only the local player draws one: six overlapping rings would
   * turn a teamfight into noise, and the bots' targets are already legible from
   * the bolts in the air.
   */
  drawAttackOrder(): void {
    // `?.` because the draw path is reached by prototype-only champions built
    // with Object.create, which never run a field initializer
    const target = this.basicAttack?.target;
    if (!target || this.isDead || this.game.player !== this) return;

    const size = target.animatedValues.displaySize;
    push();
    noFill();
    stroke(255, 92, 78, 190);
    strokeWeight(2);
    circle(target.position.x, target.position.y, size + 16);
    stroke(255, 92, 78, 55);
    circle(this.position.x, this.position.y, this.basicAttack.reachTo(target) * 2);
    pop();
  }

  onRemoved() {
    this.spells.forEach(spell => this.removeSpell(spell));
    // `?? undefined`: `removeSpell` takes `Spell | undefined`, and `recall` is
    // `Spell | null` now that a map without a fountain can leave it unset.
    this.removeSpell(this.recall ?? undefined);
    // A passive left behind keeps its buffs and its event listeners after the
    // champion carrying it is gone — the same leak `recall` is retired to avoid.
    this.removeSpell(this.passive ?? undefined);
    // Items go the same way, and through `unequipItem` rather than by clearing
    // the array: the stat grant has to come back off too, and a champion
    // removed mid-match with a live modifier still on their `Stats` is a leak
    // nothing else would ever notice.
    for (let slot = 0; slot < (this.items?.length ?? 0); slot++) this.unequipItem(slot);
  }

  /**
   * Retires whatever the incoming kit does not carry over. A spell present in
   * both lists is being *kept*, not replaced, so it must not be deactivated —
   * `applyPreset` hands back the instances of the slots it did not change.
   */
  replaceSpells(spells: Spell[]) {
    this.spells.forEach(spell => {
      if (spells.indexOf(spell) === -1) this.removeSpell(spell);
    });
    this.spells = spells;
  }

  replaceSpell(index: number, spell: Spell) {
    this.removeSpell(this.spells[index]);
    this.spells[index] = spell;
  }

  private removeSpell(spell?: Spell) {
    spell?.deactivate();
    spell?.onRemoved?.();
  }

  /**
   * Puts an item in a slot, taking whatever was there out first.
   *
   * `passive` and `active` arrive as already-constructed spells rather than as
   * classes, because resolving a *local pack id* to a class is `preset.ts`'s
   * job and nothing in this file may reach the content registry — the same
   * split that keeps `applyPreset` taking classes and not ids.
   *
   * Returns the item that was displaced, or null. A caller putting an item
   * into an occupied slot has to decide what happens to the old one (sold,
   * dropped, destroyed), and returning it is how this stays out of that
   * decision.
   */
  equipItem(item: HeldItem, slot: number): HeldItem | null {
    if (!this.items || slot < 0 || slot >= this.items.length) return null;
    const displaced = this.unequipItem(slot);
    this.items[slot] = item;
    this.stats.addModifier(item.modifier);
    // Not armed here. `armPassives` runs on the next frame and arms it then,
    // which is the same path a champion's own passive takes — and the same
    // path a respawn takes. One arming rule, one place.
    return displaced;
  }

  /**
   * Takes the item in a slot back off, and everything it granted with it.
   *
   * The stat modifier, both spells and the armed-passive record all have to go
   * together. Dropping any one of them is a champion who sold an item and kept
   * its armour, or kept its on-hit listener firing off an item they no longer
   * own — and neither shows up anywhere except as a number that will not add
   * up much later.
   */
  unequipItem(slot: number): HeldItem | null {
    const item = this.items?.[slot];
    if (!item) return null;
    this.items[slot] = null;
    this.stats.removeModifier(item.modifier);
    if (item.passive) this._armedPassives?.delete(item.passive);
    this.removeSpell(item.passive ?? undefined);
    this.removeSpell(item.active ?? undefined);
    return item;
  }

  /**
   * Swaps two inventory slots. Answers whether anything moved.
   *
   * **Deliberately not `unequipItem` then `equipItem`.** That pair is the
   * *ownership* seam: it adds and removes the `StatsModifier`, it arms and
   * retires the passive, and it runs `removeSpell` on both of the item's
   * spells. A move crosses none of those — the item never left the champion.
   * Routing a move through them takes an item's armour off and puts it back
   * on, which is at best a wasted frame and at worst a difference the champion
   * keeps for ever, and it re-arms the passive, which is a second copy of
   * whatever that passive grants.
   *
   * What genuinely changes is which key casts it, and that needs no work here:
   * `Game.itemInputController` resolves `getSpell: slot => items[slot]?.active`
   * live, so an active follows its slot with nothing rebound.
   *
   * A slot holding nothing is a legal end *and* a legal start — a thumb can
   * begin a drag on a gap, and refusing that would make the gesture work in
   * one direction only for no reason visible on screen. Two empty slots is the
   * one pairing that is refused, because it is a drag that did nothing.
   */
  moveItem(from: number, to: number): boolean {
    if (!this.items) return false;
    const last = this.items.length - 1;
    if (from < 0 || to < 0 || from > last || to > last || from === to) return false;
    if (!this.items[from] && !this.items[to]) return false;

    const moved = this.items[from];
    this.items[from] = this.items[to];
    this.items[to] = moved;
    return true;
  }

  /** The first empty slot, or -1. What a shop asks before it takes anyone's gold. */
  firstEmptyItemSlot(): number {
    return this.items?.findIndex(slot => slot === null) ?? -1;
  }

  /** A champion fights through its standing order, so a taunt writes that. */
  forceAttackTarget(attacker: AttackableUnit): void {
    this.basicAttack.order(attacker);
  }

  drawHealthBar(compact = false) {
    let pos = this.position;
    let { displaySize: size, alpha } = this.animatedValues;
    let health = this.stats.health.value;
    let maxHealth = this.stats.maxHealth.value;
    let mana = this.stats.mana.value;
    let maxMana = this.stats.maxMana.value;

    // At minimum mobile zoom a champion body is only ~10–15 screen pixels, but
    // the normal health frame deliberately stays 125px and also paints score,
    // ticks, buff icons and status text. Eight of those cost more than the
    // terrain pass and cover the fight they are meant to explain. The compact
    // path keeps the three combat signals that still read at that scale.
    if (compact) {
      const k = this.game?.camera?.constantSize?.(1) ?? 1;
      const barWidth = 52 * k;
      const healthHeight = 6 * k;
      const manaHeight = 2 * k;
      const x = pos.x - barWidth / 2;
      const y = pos.y - size / 2 - 12 * k;
      const healthRatio = maxHealth > 0 ? constrain(health / maxHealth, 0, 1) : 0;
      const shieldRatio = maxHealth > 0 ? constrain(this.shieldAmount / maxHealth, 0, 1) : 0;

      // A unit with no mana pool gets no mana strip, and the backing shrinks to
      // match. An empty channel under the health bar reads as a resource the
      // unit has and has spent, which for a summon is simply false.
      const hasMana = maxMana > 0;

      push();
      noStroke();
      fill(2, 15, 21, alpha);
      rect(x - k, y - k, barWidth + 2 * k, healthHeight + (hasMana ? manaHeight + 3 * k : 2 * k));
      fill(
        this.isDead
          ? [153, 153, 153, alpha]
          : this.isAllied
            ? [67, 196, 29, alpha]
            : [196, 67, 29, alpha]
      );
      rect(x, y, barWidth * healthRatio, healthHeight);
      if (shieldRatio > 0) {
        const shieldWidth = barWidth * shieldRatio;
        const shieldX = Math.min(barWidth * healthRatio, barWidth - shieldWidth);
        fill(225, 230, 238, alpha * 0.85);
        rect(x + shieldX, y, shieldWidth, healthHeight);
      }
      if (hasMana) {
        fill(this.isDead ? [153, 153, 153, alpha] : [108, 179, 213, alpha]);
        const manaRatio = constrain(mana / maxMana, 0, 1);
        rect(x, y + healthHeight + k, barWidth * manaRatio, manaHeight);
      }
      pop();
      return;
    }

    push();
    // Overlay, not world: the whole frame — bar, ticks, buff icons and their
    // text — compensates for the camera scale together. See Camera.constantSize.
    const k = this.game?.camera?.constantSize?.(1) ?? 1;
    let borderWidth = 3 * k,
      barWidth = 125 * k,
      barHeight = 17 * k,
      manaHeight = 5 * k;
    const healthContainerW = barWidth - barHeight;
    // The bar is a fixed frame: a shield is a share of it, never an extension of
    // it. Growing the frame made a heavily shielded champion bar sprawl across the
    // screen, and left no way to read how hurt someone actually was.
    const frameWidth = barWidth;
    const healthRatio = maxHealth > 0 ? constrain(health / maxHealth, 0, 1) : 0;
    const shieldRatio = maxHealth > 0 ? constrain(this.shieldAmount / maxHealth, 0, 1) : 0;
    const healthW = healthRatio * healthContainerW;
    // Shield sits to the right of current health because it is eaten first. With
    // no room left it slides back over the health so it can never be invisible.
    const shieldW = shieldRatio * healthContainerW;
    const shieldX = Math.min(healthW, healthContainerW - shieldW);
    const shieldOverflows = this.shieldAmount > maxHealth;
    const topleft = {
      x: pos.x - frameWidth / 2,
      y: pos.y - size / 2 - barHeight - 15 * k,
    };

    fill(2, 15, 21, alpha);
    stroke(91, 92, 87, alpha);
    strokeWeight(3);
    rect(
      topleft.x - borderWidth * 0.5,
      topleft.y - borderWidth * 0.5,
      frameWidth + borderWidth,
      barHeight + borderWidth
    );

    fill(242, 242, 242, alpha);
    textSize(12 * k);
    text(this.score, topleft.x + 3 * k, topleft.y + 12 * k);

    noStroke();

    fill(
      this.isDead
        ? [153, 153, 153, alpha]
        : this.isAllied
          ? [67, 196, 29, alpha]
          : [196, 67, 29, alpha]
    );
    const healthRowH = barHeight - manaHeight - 1 * k;
    rect(topleft.x + barHeight, topleft.y, healthW, healthRowH);

    if (shieldW > 0) {
      fill(225, 230, 238, alpha * 0.85);
      rect(topleft.x + barHeight + shieldX, topleft.y, shieldW, healthRowH);

      // The bar cannot grow, so a shield larger than the whole health pool is
      // flagged instead of drawn past the end.
      if (shieldOverflows) {
        fill(255, 246, 200, alpha);
        rect(topleft.x + barHeight + healthContainerW - 2 * k, topleft.y, 2 * k, healthRowH);
      }
    }

    // Ticks every `tickStep` health. The frame is fixed, so a champion with a
    // bigger pool simply shows more of them — that is what makes two bars
    // comparable at a glance, and it also reads the shield against real health.
    const tickStep = healthTickStep(maxHealth);
    stroke(2, 15, 21, alpha * 0.6);
    strokeWeight(1);
    for (let mark = tickStep; mark < maxHealth; mark += tickStep) {
      const tickX = topleft.x + barHeight + (mark / maxHealth) * healthContainerW;
      line(tickX, topleft.y + 1 * k, tickX, topleft.y + healthRowH - 1 * k);
    }
    noStroke();

    const manaW = maxMana > 0 ? constrain(mana / maxMana, 0, 1) * healthContainerW : 0;
    fill(this.isDead ? [153, 153, 153, alpha] : [108, 179, 213, alpha]);
    rect(topleft.x + barHeight, topleft.y + barHeight - manaHeight, manaW, manaHeight);

    push();
    let x = topleft.x + 10 * k;
    if (alpha < 255) tint(255, alpha);
    // One icon per kind of buff with a stack count, not one per instance:
    // one stacking spell can hold hundreds of StatAmp stacks, which used to draw hundreds
    // of icons straight off the side of the screen.
    // (buff.draw() belongs to AttackableUnit.drawBuffs(); calling it here too
    // drew every buff twice, and inside this block's tint().)
    // `buff.stacks` rather than "one per array entry": a `countedStacks`
    // buff is a single instance carrying its whole count on `.stacks`, and
    // every other buff in the game leaves
    // `.stacks` at `Buff`'s default of 1 — so summing it is exactly the old
    // per-instance count for them, and the real stack count for a counted
    // buff instead of always reading 1.
    const buffCounts = new Map<BuffStackId, { image: AssetHandle; count: number }>();
    for (const buff of this.buffs) {
      if (!buff.image) continue;
      if (buff.hudVisible === false) continue;
      const key = buff.stackId;
      const row = buffCounts.get(key);
      if (row) row.count += buff.stacks;
      else buffCounts.set(key, { image: buff.image, count: buff.stacks });
    }

    for (const { image: buffImage, count } of buffCounts.values()) {
      image(AssetManager.renderable(buffImage), x, topleft.y - 13 * k, 20 * k, 20 * k);
      if (count > 1) {
        noStroke();
        fill(255, alpha);
        textAlign(RIGHT, BOTTOM);
        textSize(10 * k);
        text(count, x + 10 * k, topleft.y - 3 * k);
        textAlign(LEFT, BASELINE);
      }
      x += 20 * k;
    }
    pop();

    if (this.isDead) {
      noStroke();
      fill(200);
      textAlign(CENTER, CENTER);
      textSize(13 * k);
      if (this.deathData) {
        text(
          `Hồi Sinh Sau ${~~(this.deathData.reviveAfter / 1000)}...`,
          pos.x,
          topleft.y + barHeight + 8 * k
        );
      }
    } else {
      // One pass over `this.buffs`, not nine: the old shape re-scanned the
      // *whole* buff array once per STATUS_TEXT_BUFFS class (9 full passes)
      // to find each class's first instance, which is O(9N) every frame for
      // a champion whose N buffs are almost always none of the 9 — a large
      // permanent stat stack most of all. This
      // still gives the *first* buff of a class the final word — a
      // self-inflicted one prints nothing rather than deferring to a later
      // buff of the same class — and still prints in STATUS_TEXT_BUFFS'
      // fixed class order regardless of where in `this.buffs` each one sits.
      const firstOfClass: (Buff | undefined)[] = new Array(STATUS_TEXT_BUFFS.length);
      let unfilled = STATUS_TEXT_BUFFS.length;
      // A `singleRepresentativeDraw` stack can
      // be thousands of instances of the exact same class, and every one of
      // them resolves to the exact same answer here — so once the first
      // instance of a given `stackId` has been resolved, skip the
      // prototype-chain walk entirely for the rest of that group rather than
      // repeating it. `resolvedGroups` is only allocated if a stack that
      // opts in is actually present.
      let resolvedGroups: Set<BuffStackId> | null = null;
      for (let j = 0; j < this.buffs.length && unfilled > 0; j++) {
        const buff = this.buffs[j];
        if (buff.singleRepresentativeDraw) {
          resolvedGroups ??= new Set();
          if (resolvedGroups.has(buff.stackId)) continue;
          resolvedGroups.add(buff.stackId);
        }
        const index = ChampionStatusText.indexOf(buff);
        if (index === -1 || firstOfClass[index]) continue;
        firstOfClass[index] = buff;
        unfilled--;
      }

      let statusString = '';
      for (let i = 0; i < firstOfClass.length; i++) {
        const buff = firstOfClass[i];
        if (buff && buff.sourceUnit !== this) {
          statusString = statusString ? `${statusString}, ${buff.name}` : buff.name;
        }
      }

      if (statusString) {
        noStroke();
        fill(200);
        textAlign(CENTER, CENTER);
        textSize(13 * k);
        text(statusString, pos.x, topleft.y + barHeight + 8 * k);
      }
    }
    pop();
  }

  die(deathData: UnitDeathData) {
    // The ledger is `AttackableUnit.die`'s: it is the one place that knows
    // whether a death was already counted, and a turret's kill is a kill.
    super.die(deathData);
    this.basicAttack.clear();
  }
}
