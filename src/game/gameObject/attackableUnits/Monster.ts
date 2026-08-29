import { withinRadius } from '@/utils/math.utils';
import { Circle } from '@/libs/quadtree';
import { MONSTER_BOUNTY } from '@/game/economy/Wallet';
import { packAsset } from '@/game/config/packAsset';
import { OBJECTIVE_Z_INDEX, PredefinedFilters } from '@/game/managers/ObjectManager';
import AttackableUnit from './AttackableUnit';
import type { AttackableUnitRenderOptions } from './AttackableUnit';
import type { AttackableUnitOptions, UnitDeathData } from './AttackableUnit';
import Champion from './Champion';

/**
 * Something a camp can do besides swing — a ranged spit, a melee slam,
 * a pool it leaves behind. Declared on the preset rather than written into
 * `Monster`, so the second camp that wants a kit (a dragon, a buff camp) states
 * it the same way instead of adding another branch here.
 *
 * `cast` gets the camp and the champion it has locked, and is expected to do
 * the whole thing — spawn the projectile, start the telegraph, apply the buff.
 * `Monster` only decides *when*.
 */
export interface MonsterAbility {
  /** Read by tests and the debug overlay; never shown to a player. */
  name: string;
  cooldownMs: number;
  /**
   * How close the target has to be, centre to centre. Defaults to the camp's
   * `attackRange`, which is the honest default for a camp whose kit is built
   * around its reach — an ability that wants to be usable further out, or only
   * up close, says so.
   */
  range?: number;
  cast(monster: Monster, target: Champion): void;
  /**
   * The camp's death, reported to the ability — once per life, on the
   * transition, and only when something actually dealt it (`die` without an
   * attacker stays silent). This is the whole seam a reward camp needs: a
   * camp whose meaning is what slaying it grants — a mana blessing, an
   * on-hit brand, a boss paying its team-wide reward — states that grant
   * here, beside the kit it casts while alive, instead of core growing a
   * separate reward table. Runs after `AttackableUnit.die` has settled the
   * ledger, so the killer's bounty gold is already in their wallet.
   */
  onKilled?(monster: Monster, killer: AttackableUnit): void;
}

/**
 * How a camp answers a champion.
 *
 * - `aggressive` — the default, and what every camp written before this was:
 *   it fights whatever damaged it (`takeDamage` → `aggroOn`), chases inside
 *   its leash and walks home. Absent means this, so no existing camp moves.
 * - `passive` — never fights. `aggroOn` is a no-op and a hit does not wake
 *   the pack, so it can be killed and does nothing about it.
 * - `skittish` — never fights *and* runs. A champion inside `aggroRange`, or
 *   any damage at all, puts it in `FLEE`.
 *
 * Deliberately three named values rather than a pair of booleans
 * (`canFight`, `flees`): the fourth combination — "runs away but also
 * swings" — is not a camp anyone has asked for, and a type that cannot
 * express it is one fewer state to reason about in `update`.
 */
export type MonsterTemperament = 'aggressive' | 'passive' | 'skittish';

/**
 * Where a body may wander — the region `isOutsideCamp` leashes against and
 * the one a flee destination has to land in.
 *
 * `camp` is the `camp.r` circle every camp used before this existed, and is
 * the default.
 *
 * `terrain` is the region "anywhere inside this map layer", which exists for
 * a camp whose home is a *shape* rather than a circle — a river crab that
 * should stay in the water no matter how the river bends. A circle cannot
 * express that: sized to hold the river it also holds both banks.
 */
export type MonsterRoam = { kind: 'camp' } | { kind: 'terrain'; layer: 'water' | 'bush' };

export interface MonsterPresetData {
  name: string;
  /**
   * A pack-relative asset key (resolved through `packAsset`), or null for the
   * anonymous fallback camp — every real camp names its art.
   */
  avatar: string | null;
  /**
   * The camp point — where this body sits at rest, chases from and leashes
   * back to. **Also the pack's identity**: every body spawned into the same
   * neutral slot is handed the exact same `camp` object (`Game.spawnJungle()`
   * via `preset.ts`'s `monsterBodyPreset`), and `alertCamp` finds its
   * packmates by that shared reference rather than a separate id — see its
   * own doc comment.
   */
  camp: { x: number; y: number; r: number };
  /**
   * Where *this body* stands in the camp — `slot + member.offset`. Optional,
   * and it defaults to `camp`, so a camp of one and every pack written before
   * this existed are untouched.
   *
   * It exists because `camp` is the **slot**: one point shared by every member
   * and held by reference, which is what `alertCamp` matches on. Using it as
   * "where do I belong" collapsed every multi-body camp into a pile on the
   * middle — see `campSpread.test.ts` for the three separate ways it did that.
   */
  home?: { x: number; y: number };
  speed: number;
  size: number;
  attackRange: number;
  reviveTime: number;
  health: number;
  /** Per swing. Defaults to a share of the camp's health. */
  damage?: number;
  /** ms between swings. */
  attackInterval?: number;
  /** Champions this close wake the camp up. Defaults to attackRange + 120. */
  aggroRange?: number;
  /** Defaults to `'aggressive'` — see the type. */
  temperament?: MonsterTemperament;
  /** Defaults to `{ kind: 'camp' }` — see the type. */
  roam?: MonsterRoam;
  /**
   * Extra chase distance past this camp's pit/reach. Defaults to
   * `MONSTER_CHASE_MARGIN`.
   *
   * Per body rather than a module constant because it is the knob that makes
   * a jungle feel different — a map where camps give up instantly and one
   * where they follow you to the lane are the same map with two numbers.
   */
  chaseMargin?: number;
  /** Grace before a camp that lost its target turns for home. */
  giveUpDelayMs?: number;
  /**
   * A body that is removed when it dies instead of coming back.
   *
   * There is no number that means this. `AttackableUnit.die` schedules
   * `{ reviveAfter: reviveTime }` and `update` respawns the moment that
   * counter reaches zero, so `reviveTime: 0` is not "never returns", it is
   * "returns next frame"; `Infinity` never elapses but leaves a corpse in
   * the object list for the rest of the match. A body that exists until
   * killed — a split child, a summon — is a shape the engine was missing,
   * not a duration anyone can pick.
   */
  ephemeral?: boolean;
  /** Tried in order, one per frame. A camp that declares none just swings. */
  abilities?: MonsterAbility[];
}

export interface MonsterOptions {
  game: AttackableUnitOptions['game'];
  preset?: MonsterPresetData;
}

export type MonsterPhase = (typeof Monster.PHASES)[keyof typeof Monster.PHASES];

/**
 * Floor on how close a camp has to get to its camp point to count as home.
 * The real threshold is this or the body's own radius, whichever is larger —
 * see `updateBackToCamp` for why a flat number is not reachable by a camp that
 * shares its clearing with two others.
 */
export const MONSTER_HOME_TOLERANCE = 12;

/** Extra chase distance past a camp's pit/reach, so it actually pursues a
 *  fleeing target instead of stopping at the edge of its own ground. */
export const MONSTER_CHASE_MARGIN = 350;
/** Grace after a camp's target leaves the chase leash before it turns for
 *  home, so a target that ducks out and back is still pursued. */
export const MONSTER_GIVE_UP_DELAY_MS = 2000;

/**
 * How far a fleeing body tries to get in one order, longest first.
 *
 * Three lengths rather than one because the first is a *preference*, not a
 * requirement: a body cornered against the end of its roam region has no
 * 420px hop that stays inside it, and should still take the 130px one rather
 * than stand still.
 */
export const MONSTER_FLEE_STEPS = [420, 260, 130] as const;

/**
 * Turns applied to "directly away from the threat", in radians, tried in
 * order.
 *
 * Straight away is usually not available to the camp this exists for: a crab
 * in a river cannot leave the water, and the water bends. So it fans to
 * either side — symmetric, widening — before giving up on the direction.
 */
export const MONSTER_FLEE_FAN = [0, 0.6, -0.6, 1.2, -1.2, 2.0, -2.0] as const;

/**
 * Just enough of the game context to ask one terrain question.
 *
 * Structural and optional, the shape `Vision.ts` and `DynamicTerrain.ts`
 * already use for the same reason: a headless context with no map at all is a
 * legal caller — the spell suites build one by the hundred — so this has to
 * read as "cannot answer", never as a crash.
 */
type TerrainQueryHost = {
  terrainMap?: { containsPoint?(x: number, y: number, terrainType: string): boolean };
};

/**
 * What a camp is when nobody said. Deliberately anonymous and at the origin.
 *
 * This was a specific jungle boss — its name, its art and its map's own
 * coordinates — which made an engine file depend on one map's content and put any
 * preset-less monster in the middle of that map's river. Every real camp comes
 * from map data; this exists so the constructor has something total to fall
 * back on, and a caller that reaches it has a bug worth seeing.
 */
const DEFAULT_PRESET: MonsterPresetData = {
  name: 'Quái',
  avatar: null,
  camp: { x: 0, y: 0, r: 100 },
  speed: 0,
  size: 60,
  attackRange: 100,
  reviveTime: 3000,
  health: 300,
};

/**
 * A jungle camp. Sits on its camp point until a champion damages it or walks
 * into aggro range, chases and hits that champion, then leashes home and heals
 * back to full once dragged past `camp.r`.
 */
export default class Monster extends AttackableUnit {
  /** See `Wallet` — a camp is worth a little more than a minion and takes longer. */
  goldBounty = MONSTER_BOUNTY;

  static PHASES = {
    IDLE: 'IDLE',
    ATTACK: 'ATTACK',
    BACK_TO_CAMP: 'BACK_TO_CAMP',
    /** Only a `skittish` camp is ever in this one. */
    FLEE: 'FLEE',
  };

  /** Between AttackableUnit and Champion: monsters must not paint over players. */
  zIndex = OBJECTIVE_Z_INDEX;

  name: string;
  phase: MonsterPhase = Monster.PHASES.IDLE;
  camp: { x: number; y: number; r: number };
  /** This body's own spot in the camp — see the preset's `home`. */
  home: { x: number; y: number };
  attackRange: number;
  attackInterval: number;
  damage: number;
  aggroRange: number;
  temperament: MonsterTemperament;
  roam: MonsterRoam;
  ephemeral: boolean;
  chaseMargin: number;
  giveUpDelayMs: number;
  reviveTime = 0;
  targetLock: AttackableUnit | null = null;

  /** What this camp can do besides swing, in the order it prefers to do it. */
  abilities: MonsterAbility[];
  /** ms left on each entry of `abilities`, by index. */
  _abilityCooldowns: number[];

  /** ms left before the next swing. */
  _attackCooldown = 0;
  /** ms left on the swing flash — purely cosmetic. */
  _attackFlash = 0;
  /** ms left before the next idle aggro scan. */
  _scanCooldown = 0;
  /** Grace left before a camp whose target left the chase leash turns for home. */
  _giveUpTimer = MONSTER_GIVE_UP_DELAY_MS;
  /**
   * What a fleeing camp last saw, refreshed on the same 250ms scan that picks
   * its next destination. Held only so `updateFlee` can run the give-up clock
   * every frame rather than in 250ms jumps; never a target, never attacked.
   */
  _fleeThreat: AttackableUnit | null = null;
  /** Per-frame regen applied by Stats.update(), picked per phase. */
  _idleRegen: number;
  _leashRegen: number;

  constructor({ game, preset = DEFAULT_PRESET }: MonsterOptions) {
    super({
      game,
      position: createVector(preset.home?.x ?? preset.camp.x, preset.home?.y ?? preset.camp.y),
      avatar: preset.avatar ? packAsset(preset.avatar) : undefined,
    });

    this.name = preset.name;
    this.stats.size.baseValue = preset.size;
    this.stats.speed.baseValue = preset.speed;
    this.stats.maxHealth.baseValue = preset.health;
    this.stats.health.baseValue = preset.health;
    this.stats.healthRegen.baseValue = 0;
    this.stats.visionRadius.baseValue = 0;

    // A camp with no speed of its own (a stationary boss) is scenery: it pushes units off
    // itself and never budges. One with legs takes its half like everyone else.
    this.isImmovable = preset.speed === 0;

    this.attackRange = preset.attackRange;
    this.reviveTime = preset.reviveTime;
    this.camp = preset.camp;
    this.home = preset.home ?? { x: preset.camp.x, y: preset.camp.y };
    this.attackInterval = preset.attackInterval ?? 1500;
    this.damage = preset.damage ?? Math.min(25, Math.max(3, Math.round(preset.health / 25)));
    this.aggroRange = preset.aggroRange ?? preset.attackRange + 120;
    this.temperament = preset.temperament ?? 'aggressive';
    this.roam = preset.roam ?? { kind: 'camp' };
    this.ephemeral = preset.ephemeral ?? false;
    this.chaseMargin = preset.chaseMargin ?? MONSTER_CHASE_MARGIN;
    this.giveUpDelayMs = preset.giveUpDelayMs ?? MONSTER_GIVE_UP_DELAY_MS;
    this._giveUpTimer = this.giveUpDelayMs;
    this.abilities = preset.abilities ?? [];
    this._abilityCooldowns = this.abilities.map(() => 0);

    // camps reset in ~2s when left alone, faster while walking home
    this._idleRegen = preset.health / 120;
    this._leashRegen = preset.health / 60;
  }

  update() {
    // Stats.update() (inside super.update()) is what actually applies regen, so
    // the phase rate has to be in place before we call up.
    this.stats.healthRegen.baseValue = this.isDead
      ? 0
      : this.phase === Monster.PHASES.IDLE
        ? this._idleRegen
        : this.phase === Monster.PHASES.BACK_TO_CAMP
          ? this._leashRegen
          : 0;

    super.update();

    // Buffs ran inside super.update(); undo anything that tried to move us.
    //
    // A camp with no speed of its own has no way back from a displacement, so
    // it never accepts one — exactly the contract a turret's foundation has,
    // and the same two lines. A stationary boss used to be draggable by a hook, a wall or a
    // dash-kick and then stranded for the rest of the match: past its 100px
    // camp radius `updateAttack` bounces it into BACK_TO_CAMP, a phase it can
    // never walk out of, and a camp in BACK_TO_CAMP never runs `updateIdle`
    // again — so it stopped aggroing, stopped swinging, and stopped drawing the
    // swing flash that made it look alive at all.
    if (this.isImmovable) {
      this.position.set(this.home.x, this.home.y);
      this.destination.set(this.home.x, this.home.y);
    }

    if (this.isDead) return;

    if (this._attackFlash > 0) this._attackFlash -= deltaTime;
    if (this._attackCooldown > 0) this._attackCooldown -= deltaTime;
    for (let i = 0; i < this._abilityCooldowns.length; i++) {
      if (this._abilityCooldowns[i] > 0) this._abilityCooldowns[i] -= deltaTime;
    }

    if (this.phase === Monster.PHASES.IDLE) this.updateIdle();
    else if (this.phase === Monster.PHASES.ATTACK) this.updateAttack();
    else if (this.phase === Monster.PHASES.BACK_TO_CAMP) this.updateBackToCamp();
    else if (this.phase === Monster.PHASES.FLEE) this.updateFlee();
  }

  updateIdle() {
    this._scanCooldown -= deltaTime;
    if (this._scanCooldown > 0) return;
    this._scanCooldown = 250;

    // The leash check used to live only in `updateAttack`, so it could not see
    // a camp that was moved with nothing chasing it: a spell-made wall or a hook
    // that pushed a camp out of its pit while it was idle left it standing
    // wherever it was dumped for the rest of the match. Measured against the
    // camp radius, not the arrival tolerance — camps in a shared pit hold each
    // other tens of pixels off their own points forever, and walking home over
    // that would leave the three wolves shuffling and never idle enough to
    // aggro again.
    if (this.isOutsideCamp()) {
      this.goBackToCamp();
      return;
    }

    // Camps no longer wake on proximity: a champion can walk straight through a
    // pit untouched. A camp only enters ATTACK when something damages it —
    // `takeDamage` calls `aggroOn(attacker)`. IDLE is now a genuinely passive
    // state whose only job is to hold the camp point and regen.
    //
    // A `skittish` camp is the one exception, and it is not a re-opening of
    // that rule: proximity here starts a *retreat*, never a fight. The scan
    // rides the 250ms cooldown above — which this phase already spends and
    // nothing else was using — so an aggressive camp still runs no query at
    // all and the cost of the exception is one string comparison per body per
    // quarter second.
    if (this.temperament === 'skittish') {
      const threat = this.nearestThreat();
      if (threat) this.fleeFrom(threat);
    }
  }

  /**
   * Dragged off its post: further from **its own spot** than the camp is wide.
   *
   * Measured from `home`, not from `camp`. The camp point is the slot centre,
   * and a raptor whose layout puts it 195px out from a camp of radius 100 is
   * *born* outside it — so it walked to the middle on its first idle tick,
   * having never been touched, and the pit rendered as a pile. `camp.r` stays
   * the tolerance: how far a body may wander is a property of the camp.
   */
  isOutsideCamp(): boolean {
    return !this.roamContains(this.position.x, this.position.y);
  }

  /**
   * Whether a point is somewhere this body is allowed to be — the leash
   * question and the flee-destination question, which are the same question.
   *
   * A `terrain` roam whose map cannot answer (a headless context, or a layer
   * the map does not have) falls back to the camp circle rather than to
   * "nowhere": a crab whose river was edited out from under it should behave
   * like an ordinary camp, not freeze.
   */
  roamContains(x: number, y: number): boolean {
    if (this.roam.kind === 'terrain') {
      const terrain = (this.game as TerrainQueryHost | undefined)?.terrainMap;
      if (typeof terrain?.containsPoint === 'function') {
        return terrain.containsPoint(x, y, this.roam.layer);
      }
    }
    return withinRadius({ x, y }, this.home, this.camp.r);
  }

  /**
   * The circle a camp will chase inside, measured from the camp point — wider
   * than the pit on purpose so it actually pursues rather than stopping at the
   * edge of its own ground.
   *
   * The base is `camp.r`/`aggroRange`, whichever is wider (the pit for a small camp,
   * the reach for a stationary boss), plus `MONSTER_CHASE_MARGIN`. A target — or the camp
   * itself, once it has walked out chasing — outside this for longer than
   * `MONSTER_GIVE_UP_DELAY_MS` is let go.
   */
  chaseLeashRange(): number {
    return Math.max(this.camp.r, this.aggroRange) + this.chaseMargin;
  }

  updateAttack() {
    const target = this.targetLock;
    // the original read target.position unconditionally: a damage source with
    // no attacker (a zone tick, a dead owner) put the camp into ATTACK with a
    // null lock and threw on the next frame
    // `isStealthed` here as well as in the scan: the idle scan is on a 250ms
    // interval, so vanishing mid-fight otherwise left the camp swinging at
    // something it could no longer see until the next one came round.
    if (!target || target.toRemove || target.isDead || !target.position || target.isStealthed) {
      this.goBackToCamp();
      return;
    }

    const pos = this.position;

    // Give-up leash, measured from the camp point. The camp keeps chasing while
    // it and its target are both inside `chaseLeashRange`; when either crosses
    // it — the target runs off, or the camp itself has walked too far out — a
    // delay runs before it turns for home. A player who kites just past the line
    // for a moment, or ducks out and back, is still pursued rather than dropped
    // the instant they step over it. A stationary boss (no legs) never moves, so only its
    // target leaving can start the clock.
    const leash = this.chaseLeashRange();
    const escaped =
      !withinRadius(pos, this.camp, leash) || !withinRadius(target.position, this.camp, leash);
    if (escaped) {
      this._giveUpTimer -= deltaTime;
      if (this._giveUpTimer <= 0) {
        this.goBackToCamp();
        return;
      }
    } else {
      this._giveUpTimer = this.giveUpDelayMs;
    }

    // Before the reach check, so a camp can open with an ability while it is
    // still walking in, and before the swing, so it never does both at once.
    if (this.castAbility(target)) return;

    // reach from surface to surface, otherwise a melee camp with attackRange 50
    // can never satisfy its own check against a 55px champion
    const reach =
      this.attackRange + this.stats.size.value / 2 + (target.stats?.size?.value ?? 0) / 2;
    const distance = p5.Vector.dist(pos, target.position);

    if (distance > reach) {
      // A camp with no legs cannot close a gap, so holding the lock is a
      // promise it can never keep — it lets go instead, and its next idle scan
      // is free to pick whatever did walk into reach.
      if (this.isImmovable) {
        this.goBackToCamp();
        return;
      }
      // routed: a camp whose champion stepped behind the wall of its own pit
      // used to grind into that wall until the leash radius saved it
      this.navigateTo(target.position.x, target.position.y);
    } else {
      this.stopMovement();
      // Same gate `BasicAttackController` gives champions. A camp swings on its
      // own timer, so without it a knocked-up or stunned camp kept hitting on
      // the beat right through the control that was supposed to stop it.
      if (this.canAttack && this._attackCooldown <= 0) {
        this._attackCooldown = this.attackInterval;
        this._attackFlash = 180;
        target.takeDamage(this.damage, this);
      }
    }
  }

  /**
   * The first ability that is off cooldown and close enough, or nothing.
   *
   * `canCast` rather than `canAttack`: this is the gate a champion's abilities
   * sit behind, so a stun or a knock-up landed on a camp cuts its combo the same
   * way it cuts yours. One per frame, and the caller returns straight after —
   * a camp that both quaked and bit in the same 16ms would be unreadable.
   */
  castAbility(target: AttackableUnit): boolean {
    if (!this.canCast) return false;
    // Camp abilities are written for champions; against a pet or a minion the
    // camp still basic-swings, it just does not cast on it.
    if (!(target instanceof Champion)) return false;

    for (let i = 0; i < this.abilities.length; i++) {
      if (this._abilityCooldowns[i] > 0) continue;

      const ability = this.abilities[i];
      const range = ability.range ?? this.attackRange;
      if (p5.Vector.dist(this.position, target.position) > range) continue;

      this._abilityCooldowns[i] = ability.cooldownMs;
      ability.cast(this, target);
      return true;
    }

    return false;
  }

  updateBackToCamp() {
    // Checked before the order, so the frame a camp gets home does not also
    // spend an order it is about to drop.
    //
    // "Home" scales with the body instead of being a flat 10px bullseye. Camp
    // points sit ~100px apart (the three wolves, the four raptors) while
    // `UnitCollisionSystem` holds two bodies `bodyRadius + bodyRadius` apart —
    // 55px for a greater wolf beside a wolf — so the small ones physically
    // cannot reach the exact point their preset names. A camp that never
    // arrives never leaves this phase, which means it keeps the walking-home
    // regen rate and, far worse, never runs `updateIdle` again: it stops
    // re-aggroing on proximity for the rest of the match while standing on its
    // own camp.
    const home = Math.max(MONSTER_HOME_TOLERANCE, this.stats.size.value / 2);
    if (withinRadius(this.position, this.home, home)) {
      this.phase = Monster.PHASES.IDLE;
      this.stopMovement();
      return;
    }

    // leashing home is the one walk a camp does with nothing chasing it, and
    // the one it must not fail: routed, so a pit wall cannot strand it outside.
    // `PathAgent.order` deliberately re-plans a BLOCKED agent rather than
    // swallowing this repeat, which is what stopped a dragged camp freezing
    // mid-jungle — see that method.
    this.navigateTo(this.home.x, this.home.y);
  }

  /**
   * The one gate temperament needs.
   *
   * Every path into a fight goes through here — `takeDamage` for the body
   * that was hit, `alertCamp` for its packmates — so `passive` and `skittish`
   * are enforced once, at the seam, rather than at each caller. That is the
   * same reasoning `BotBrain.mayFight` rests on, and for the same reason:
   * a rule spread over three call sites is a rule with a hole in it.
   */
  aggroOn(unit?: AttackableUnit) {
    if (!unit || unit === this) return;
    if (this.temperament === 'passive') return;
    if (this.temperament === 'skittish') {
      this.fleeFrom(unit);
      return;
    }
    this.targetLock = unit;
    this.phase = Monster.PHASES.ATTACK;
    this._giveUpTimer = this.giveUpDelayMs;
  }

  goBackToCamp() {
    this.targetLock = null;
    this._fleeThreat = null;
    this.phase = Monster.PHASES.BACK_TO_CAMP;
    this.navigateTo(this.home.x, this.home.y);
  }

  /** Turns a body away from `threat` and orders the first step of the retreat. */
  fleeFrom(threat: AttackableUnit) {
    this.targetLock = null;
    this._fleeThreat = threat;
    this.phase = Monster.PHASES.FLEE;
    this._giveUpTimer = this.giveUpDelayMs;
    const point = this.fleePoint(threat);
    this.navigateTo(point.x, point.y);
  }

  /**
   * Keeps running while something is close, then goes home.
   *
   * The destination is re-picked on the same 250ms beat the other phases scan
   * on — often enough to keep away from a champion walking after it, rarely
   * enough that this is not a pathfind per frame. The give-up clock runs on
   * `deltaTime` rather than on that beat, so `_fleeThreat` is held between
   * scans purely to answer "is anything still after me" every frame.
   */
  updateFlee() {
    this._scanCooldown -= deltaTime;
    if (this._scanCooldown <= 0) {
      this._scanCooldown = 250;
      this._fleeThreat = this.nearestThreat();
      if (this._fleeThreat) {
        const point = this.fleePoint(this._fleeThreat);
        this.navigateTo(point.x, point.y);
      }
    }

    if (this._fleeThreat) {
      this._giveUpTimer = this.giveUpDelayMs;
      return;
    }

    this._giveUpTimer -= deltaTime;
    if (this._giveUpTimer <= 0) this.goBackToCamp();
  }

  /**
   * The nearest champion inside `aggroRange`, or nothing.
   *
   * Champions of every team: a neutral camp has no side, so "enemy" is not a
   * question it can ask. The quadtree answers by bounding box, so the real
   * distance is re-checked here — a champion in a neighbouring cell is a
   * retrieve hit and not a threat.
   *
   * **Gated on sight**, through the same `visibleTo` seam every scan that
   * *picks* a unit goes through (`check-seams`' `target-vision` refuses this
   * query without it). It is not merely a rule obeyed: a camp with
   * `visionRadius = 0` still sees normally here, because `Vision.viewIsClear`
   * range-gates only *borrowed* eyes — so what the filter actually buys is
   * bush cover and walls. Standing in the brush beside a crab no longer
   * startles it, which is the behaviour anyone would expect and is not
   * something this method would have got right on its own.
   */
  nearestThreat(): AttackableUnit | null {
    if (!this.game?.objectManager) return null;

    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this.aggroRange }),
      filters: [
        PredefinedFilters.type(Champion),
        PredefinedFilters.excludeDead,
        PredefinedFilters.excludeStealthed,
        PredefinedFilters.visibleTo(this),
      ],
    }) as AttackableUnit[];

    let nearest: AttackableUnit | null = null;
    let nearestDistance = Infinity;
    for (const champion of found) {
      if (champion === this || !champion.position) continue;
      const distance = p5.Vector.dist(this.position, champion.position);
      if (distance > this.aggroRange || distance >= nearestDistance) continue;
      nearest = champion;
      nearestDistance = distance;
    }
    return nearest;
  }

  /**
   * Where to run: directly away from the threat if that is allowed, otherwise
   * the best of a widening fan (`MONSTER_FLEE_FAN`) at a shortening distance
   * (`MONSTER_FLEE_STEPS`).
   *
   * A candidate has to satisfy both halves — inside the roam region *and*
   * standable — because they refuse different things. The region says "not out
   * of the river"; the nav grid says "not inside that rock". A point can pass
   * either one alone and still be somewhere the body cannot go.
   *
   * Falls back to `home`, which the region contains by construction: a body
   * with nowhere legal to run walks back to its own spot rather than standing
   * still while something eats it.
   */
  fleePoint(threat: AttackableUnit): { x: number; y: number } {
    const away = p5.Vector.sub(this.position, threat.position);
    // Standing exactly on the threat has no "away" — any direction is as good
    // as another, and normalising a zero vector yields NaN, which is a body
    // ordered to nowhere.
    if (away.magSq() === 0) away.set(1, 0);
    away.normalize();

    const radius = this.stats.size.value / 2;
    for (const distance of MONSTER_FLEE_STEPS) {
      for (const turn of MONSTER_FLEE_FAN) {
        const direction = away.copy().rotate(turn);
        const x = this.position.x + direction.x * distance;
        const y = this.position.y + direction.y * distance;
        if (!this.roamContains(x, y)) continue;
        if (!this.canStandAt(x, y, radius)) continue;
        return { x, y };
      }
    }
    return { x: this.home.x, y: this.home.y };
  }

  /**
   * Whether a body of `radius` fits at a point.
   *
   * No navigation is a real context — every headless spell test builds one —
   * and there "anywhere" is the honest answer, which is exactly what
   * `navigateTo` already degrades to in the same situation.
   */
  canStandAt(x: number, y: number, radius: number): boolean {
    const grid = this.game?.navigation?.grid;
    if (!grid) return true;
    return grid.isWalkable(x, y, radius);
  }

  draw(options: AttackableUnitRenderOptions = {}) {
    if (this.isDead) return;
    super.draw(options);

    // swing flash
    if (this._attackFlash > 0 && this.targetLock?.position) {
      const pos = this.position;
      const dir = p5.Vector.sub(this.targetLock.position, pos);
      if (dir.magSq() > 0) {
        dir.setMag(this.animatedValues.displaySize / 2 + 14);
        push();
        stroke(255, 190, 80, Math.min(255, this._attackFlash * 1.6));
        strokeWeight(7);
        line(pos.x, pos.y, pos.x + dir.x, pos.y + dir.y);
        pop();
      }
    }
  }

  drawDir() {
    // the base draws a pointer at the mouse; a monster points at what it is hitting
    if (this.targetLock?.position && !this.isDead) {
      let pos = this.position;
      let { displaySize: size, alpha } = this.animatedValues;

      const target = p5.Vector.sub(this.targetLock.position, pos);
      if (target.magSq() === 0) return;
      target.setMag(size / 2 + 2);

      push();
      stroke(255, Math.min(alpha, 150));
      strokeWeight(4);
      line(pos.x, pos.y, pos.x + target.x, pos.y + target.y);
      pop();
    }
  }

  /**
   * A camp can only hold a champion: `targetLock` is typed that way because a
   * jungle monster chasing a minion down a lane is not a thing this game has.
   * So a taunt from anything else is simply not something a camp can obey —
   * which today is no restriction at all, since the only taunt in the game is
   * one champion's own.
   */
  forceAttackTarget(attacker: AttackableUnit): void {
    if (this.isDead || attacker.isDead || !(attacker instanceof Champion)) return;
    this.targetLock = attacker;
    this.phase = Monster.PHASES.ATTACK;
  }

  takeDamage(damage: number, attacker?: AttackableUnit) {
    if (this.isDead) return;
    // Latched before the hit lands, because the hit may kill us: what decides
    // whether the pack gets shouted at is whether *this* body was already in
    // the fight, and a corpse has had its lock cleared by `die`.
    const engagedWith = this.phase === Monster.PHASES.ATTACK ? this.targetLock : null;

    super.takeDamage(damage, attacker);

    if (!attacker) return;
    // super.takeDamage may have killed us; a corpse must not hold aggro. A camp
    // fights back against *whatever* hit it — a champion, a pet, an allied
    // minion — not champions alone, so "only attack when attacked" holds for
    // every attacker (see aggroOn / castAbility).
    if (!this.isDead) this.aggroOn(attacker);
    // A dead wolf still gets to shout: the hit that one-shot the small one is
    // exactly the hit its pack should answer, and gating the alert on survival
    // meant an opener that killed a 50hp raptor woke nothing at all.
    //
    // Only on the frame this body *joins* the fight, never on every later tick.
    // A camp standing in a damage-over-time pool takes a hit per frame, and a
    // quadtree query per frame per body is the cost this guard buys back.
    if (engagedWith !== attacker) this.alertCamp(attacker);
  }

  /**
   * Pulls the rest of the pack in on `attacker`.
   *
   * A camp is a pack, not three strangers standing near each other: hitting
   * one wolf used to wake exactly that wolf — the others watched their
   * packmate die from 50px away, because `takeDamage` is the only thing that
   * aggros a camp and it only ever aggroed the body it was called on.
   *
   * Found by query rather than by a list wired up at spawn, so this works the
   * same in a headless test as it does in a match and survives the jungle being
   * switched off and back on (`MatchDirector.jungleEnabled` rebuilds every camp
   * from scratch). The circle is measured from the *camp point*, not from this
   * body — the packmate we want is the one still sitting at home — and
   * `chaseLeashRange` is its radius because that is already this camp's
   * definition of "ground we fight over".
   *
   * Membership used to be a shared `campId` string every body in a pack
   * carried. That field is gone: a camp is now a neutral slot, and every body
   * `Game.spawnJungle()` spawns into one slot is handed the exact same `camp`
   * object (`preset.ts`'s `monsterBodyPreset`) — so `mate.camp === this.camp`
   * *is* "in this pack", with no id to keep in sync and no distance re-scan
   * against map data. A solo camp's `camp` object is never shared with
   * anything else, so this still finds nobody for it, same as before.
   *
   * Calls `aggroOn`, never `takeDamage`, so an alert cannot re-broadcast.
   */
  alertCamp(attacker: AttackableUnit) {
    if (!this.game?.objectManager) return;

    const mates = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.camp.x, y: this.camp.y, r: this.chaseLeashRange() }),
      filters: [PredefinedFilters.type(Monster)],
    });

    for (const mate of mates) {
      if (mate === this || mate === attacker) continue;
      if (mate.camp !== this.camp) continue;
      if (mate.isDead || mate.toRemove) continue;
      // A packmate already busy keeps its own target: the pack converges on
      // whoever walked in, it does not re-target as a unit every time one of
      // them is hit.
      if (mate.phase === Monster.PHASES.ATTACK && mate.targetLock) continue;
      mate.aggroOn(attacker);
    }
  }

  die(deathData: UnitDeathData) {
    // Latched before `super.die` flips it: `die` is reachable on a corpse, and
    // a reward paid on every one of those calls is the same unbounded press
    // `AttackableUnit.die` guards its bounty against.
    const firstDeath = !this.isDead;
    super.die(deathData);
    if (firstDeath && deathData.attacker) {
      for (const ability of this.abilities) ability.onKilled?.(this, deathData.attacker);
    }
    this.targetLock = null;
    this._fleeThreat = null;
    this.phase = Monster.PHASES.IDLE;
    this.stopMovement();

    // Set after `super.die` rather than instead of it: the body still dies
    // normally — its bounty is paid, its abilities' `onKilled` have run — it
    // simply is not around for the revive timer to reach. `ObjectManager`
    // retires it on its next pass.
    if (this.ephemeral) this.toRemove = true;
  }

  respawn() {
    // Belt and braces, the same guard `Minion.respawn` carries and for the
    // same reason: `toRemove` is what keeps an ephemeral body off the revive
    // path, but the object is only retired on `ObjectManager`'s *next* pass
    // while `AttackableUnit.update` runs the revive timer in this one. A
    // split child with a short `reviveTime` can therefore reach here once,
    // and coming back would undo the whole point of it.
    if (this.ephemeral) {
      this.toRemove = true;
      return;
    }

    super.respawn();
    this.targetLock = null;
    this._fleeThreat = null;
    this.phase = Monster.PHASES.IDLE;
    this._attackCooldown = 0;
    this._attackFlash = 0;
    this._abilityCooldowns = this._abilityCooldowns.map(() => 0);
    // `super.respawn()` drops every unit on a spawn point; a camp belongs on
    // its own spot — `home`, not `camp`. Using the shared camp point here is
    // what made the pile permanent: a pit's layout survived exactly until the
    // first time it was cleared, and every member came back standing on the
    // same pixel.
    this.position.set(this.home.x, this.home.y);
    this.destination.set(this.home.x, this.home.y);
  }
}
