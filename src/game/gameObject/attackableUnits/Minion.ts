import { Circle } from '@/libs/quadtree';
import { dist, distSq, withinRadius } from '@/utils/math.utils';
import { MINION_BOUNTY } from '@/game/economy/Wallet';
import TeamId from '@/game/enums/TeamId';
import type { LaneWaypoint } from '@/game/lanes';
import { MINION_Z_INDEX, PredefinedFilters } from '@/game/managers/ObjectManager';
import MissileSpellObject from '@/game/gameObject/MissileSpellObject';
import SpellObject from '@/game/gameObject/SpellObject';
import AttackableUnit from './AttackableUnit';
import type {
  AttackableUnitOptions,
  AttackableUnitRenderOptions,
  UnitDeathData,
} from './AttackableUnit';
import Champion from './Champion';
import Monster from './Monster';
import { pickAggroTarget, type AggroLadder } from '@/game/combat/AggroPriority';

/**
 * How a minion fights and draws — core's three built-in bodies, and the only
 * three there will be until someone writes a fourth *behaviour*.
 *
 * Split out of `MinionKind` because that one field was carrying two jobs. It
 * was the minion's **identity** (which preset is this) and also its
 * **behaviour and art**: `launchAttack` branches on `!== 'melee'` to decide
 * bolt or swing, and `draw` branches on `'cannon'`/`'ranged'` for the rings.
 * The moment a map may declare a type called `siege`, those branches would
 * silently give it melee behaviour and melee art — a new minion that fights
 * like the wrong one, with nothing anywhere saying so.
 */
export type MinionStyle = 'melee' | 'ranged' | 'cannon';

/**
 * Which preset a minion is. A free string, because a map may declare its own
 * roster (`MinionTuning.types`); core's own three are `melee`, `ranged` and
 * `cannon`, and `style` is what decides how any of them actually behaves.
 */
export type MinionKind = string;

export interface MinionPresetData {
  name: string;
  kind: MinionKind;
  /** How it fights and draws. See `MinionStyle`. */
  style: MinionStyle;
  /** Overrides `MINION_BOUNTY` for this type. */
  goldBounty?: number;
  speed: number;
  size: number;
  health: number;
  /** Per swing. */
  damage: number;
  /** ms between swings. */
  attackInterval: number;
  /** Surface-to-surface reach when swinging. */
  attackRange: number;
  /** Hostiles this close make it stop walking and fight. */
  aggroRange: number;
}

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

/** World units from a waypoint that count as having reached it. */
export const WAYPOINT_TOLERANCE = 40;

/**
 * How far off its lane a minion will step to fight before giving the chase up.
 *
 * Without a leash a chase never ends: `findTarget` re-scans within `aggroRange`
 * of wherever the minion has got to, and chasing is precisely what keeps the
 * target inside that radius, so one champion could tow a whole wave across the
 * map. Measured from the lane itself (`distanceToLane`), not from the minion's
 * spawn or its current waypoint — waypoints are up to ~1500px apart, so
 * "distance to the next waypoint" is 750px in the middle of a normal segment
 * and cannot tell walking from wandering.
 *
 * 500 is comfortably past `aggroRange` (300 melee, 340 ranged), so a minion
 * still commits to anything it can legitimately see from its lane, and still
 * finishes a fight that drifts a little.
 */
export const MINION_LEASH_RANGE = 500;
/** ms between aggro scans. Re-querying the quadtree per minion per frame is the
 *  one thing on this class that would actually cost a full board its frame rate. */
export const AGGRO_SCAN_INTERVAL_MS = 200;

/**
 * Basic-attack visuals. Exported so the suite asserts the timing/speed the
 * objects are actually wired with, not a copy of the numbers — retuning one
 * should not mean editing a test.
 *
 * A champion is 55 units across and moves 180 units/sec; this is picked to
 * read as a slow, deliberate shot next to that, not a spell-speed one (a
 * long-range arrow ability and Turret's bolt both move at 780-1200 units/sec).
 */
export const RANGED_BOLT_SPEED = 360 / 60;
/** How far a minion lights fog for its team — a cheap circle, no wall raycast. */
export const MINION_FOG_REVEAL_RADIUS = 300;
/** ms of wind-up before a melee swing's damage resolves. */
export const MELEE_WINDUP_MS = 130;
/** Total ms a melee swing's visual lives, wind-up through fade. */
export const MELEE_SWING_TOTAL_MS = 300;

const TEAM_COLORS: Record<string, { body: number[]; trim: number[]; bar: number[] }> = {
  [TeamId.BLUE]: { body: [64, 142, 232], trim: [16, 44, 82], bar: [96, 186, 255] },
  [TeamId.RED]: { body: [226, 84, 68], trim: [86, 22, 18], bar: [255, 126, 106] },
};
const NEUTRAL_COLORS = { body: [150, 150, 160], trim: [40, 40, 48], bar: [200, 200, 210] };

/**
 * The full team palette (body/trim/bar), for anything that has to agree with a
 * minion about what a team looks like — the minimap's dots and the turret rows.
 * Exported rather than copied so a colour means the same thing everywhere.
 */
export const teamColors = (teamId: string): { body: number[]; trim: number[]; bar: number[] } =>
  TEAM_COLORS[teamId] ?? NEUTRAL_COLORS;

/** The body colour alone — the minimap's case. */
export const teamBodyColor = (teamId: string): number[] => teamColors(teamId).body;

export interface MinionOptions {
  game: AttackableUnitOptions['game'];
  position?: p5.Vector;
  teamId: string;
  /** Blue-base-first for blue, already reversed for red — see getLaneWaypoints. */
  waypoints: LaneWaypoint[];
  /** Which lane it belongs to, for debugging and for the spawner's bookkeeping. */
  lane?: string;
  preset?: MinionPresetData;
  /** Spawners hand in 1: waypoint 0 is the fountain the minion is standing on. */
  startWaypointIndex?: number;
}

export type MinionPhase = (typeof Minion.PHASES)[keyof typeof Minion.PHASES];

/**
 * A lane minion. A sibling of Monster rather than a rewrite of it: same
 * scan-on-an-interval, same swing-on-a-cooldown, same "read the phase before
 * super.update() so Stats.update() sees the right regen" ordering. What differs
 * is that a minion has somewhere to be — it walks a fixed waypoint list from its
 * own base to the enemy one, fighting whatever is in the way — and that it never
 * comes back once killed.
 */
export default class Minion extends AttackableUnit {
  /** The last hit is the whole skill, and this is what it pays. See `Wallet`. */
  goldBounty = MINION_BOUNTY;

  static PHASES = {
    WALK: 'WALK',
    ATTACK: 'ATTACK',
  };

  /**
   * Above a bare AttackableUnit, below jungle camps, turrets and champions.
   * A wave should never paint over the units the player is actually reading.
   */
  static displayZIndex = MINION_Z_INDEX;

  /** Read by spell damage multipliers (a wave-clear ability) to soften hits on a wave. */
  readonly unitType = 'minion';

  name: string;
  kind: MinionKind;
  /** How this body fights and draws — never `kind`. See `MinionStyle`. */
  style: MinionStyle;
  lane: string;
  phase: MinionPhase = Minion.PHASES.WALK;
  waypoints: LaneWaypoint[];
  waypointIndex: number;
  damage: number;
  attackInterval: number;
  attackRange: number;
  aggroRange: number;
  targetLock: AttackableUnit | null = null;

  /**
   * Whether this minion has stood on a lane waypoint yet.
   *
   * A wave does not start on its lane: it musters between the two turrets
   * nearest its own fountain — a point the active map declares
   * (`MinionSpawner.musterPoint`) — and is handed the first waypoint *ahead*
   * of that (`nextWaypointIndexFrom`), which on TOP is 955px away across the
   * corner of the base wall. The lane itself is built to
   * be walked in straight lines — see the header of `lanes.ts` — but the join
   * onto it is not part of the lane and is not built to be anything. Measured
   * against the wall polygons that opening leg ran 42px *inside* a wall on TOP
   * and 19px from a turret centre on BOT, and it did so on the previous paths
   * as well: it is the one step a minion takes that has to be routed.
   */
  joinedLane = false;

  /** ms left before the next swing. */
  _attackCooldown = 0;
  /** ms left before the next aggro scan, jittered so a wave does not scan in lockstep. */
  _scanCooldown: number;
  /** Last angle `aimAngle` had an answer for. See there. */
  _heading = 0;

  constructor({
    game,
    position,
    teamId,
    waypoints,
    lane = '',
    preset = MinionPresets.melee,
    startWaypointIndex = 0,
  }: MinionOptions) {
    super({
      game,
      position: position ?? createVector(waypoints[0]?.x ?? 0, waypoints[0]?.y ?? 0),
      teamId,
      visionRadius: 0,
    });

    this.name = preset.name;
    this.kind = preset.kind;
    this.style = preset.style;
    if (preset.goldBounty !== undefined) this.goldBounty = preset.goldBounty;
    this.lane = lane;
    this.waypoints = waypoints;
    this.waypointIndex = Math.min(startWaypointIndex, Math.max(0, waypoints.length - 1));

    this.stats.size.baseValue = preset.size;
    this.stats.speed.baseValue = preset.speed;
    this.stats.maxHealth.baseValue = preset.health;
    this.stats.health.baseValue = preset.health;
    this.stats.healthRegen.baseValue = 0;
    this.stats.manaRegen.baseValue = 0;
    // no vision: FogOfWar only queries the player's own team for sight sources,
    // so this would be dead weight in the quadtree's display boxes
    this.stats.visionRadius.baseValue = 0;

    this.damage = preset.damage;
    this.attackInterval = preset.attackInterval;
    this.attackRange = preset.attackRange;
    this.aggroRange = preset.aggroRange;
    this._scanCooldown = Math.random() * AGGRO_SCAN_INTERVAL_MS;

    // animatedValues start at 10 and lerp; a wave popping in from a dot looks
    // like a bug when four of them spawn at once
    this.animatedValues.size = preset.size;
    this.animatedValues.displaySize = preset.size;
  }

  update() {
    super.update();
    if (this.isDead) return;

    if (this._attackCooldown > 0) this._attackCooldown -= deltaTime;

    this._scanCooldown -= deltaTime;
    if (this._scanCooldown <= 0) {
      this._scanCooldown = AGGRO_SCAN_INTERVAL_MS;
      const wasAttacking = this.phase === Minion.PHASES.ATTACK;
      // Leashed: too far off the lane to still be fighting, whatever is in
      // range. Checked before the scan so a minion already out of position
      // cannot re-acquire the target that dragged it there.
      const leashed = this.distanceToLane() > MINION_LEASH_RANGE;
      // The lock is *carried into* the scan rather than thrown away by it, so
      // a minion finishes what it started and only a better rung of the ladder
      // takes it off — `combat/AggroPriority`. `updateAttack` drops a stale
      // lock every frame, which is what makes "am I still holding one" a fair
      // question to ask here once every scan.
      this.targetLock = leashed ? null : this.findTarget(this.targetLock);
      this.phase = this.targetLock ? Minion.PHASES.ATTACK : Minion.PHASES.WALK;
      if (wasAttacking && this.phase === Minion.PHASES.WALK) this.resyncWaypoint();
    }

    if (this.phase === Minion.PHASES.ATTACK) this.updateAttack();
    else this.updateWalk();
  }

  /**
   * Shortest distance from this minion to the lane polyline it walks — the
   * segments between consecutive waypoints, not the waypoints themselves. See
   * `MINION_LEASH_RANGE` for why the distinction matters.
   */
  distanceToLane(): number {
    const path = this.waypoints;
    if (path.length === 0) return 0;
    if (path.length === 1) return dist(this.position.x, this.position.y, path[0].x, path[0].y);

    const { x, y } = this.position;
    let best = Infinity;
    for (let i = 0; i + 1 < path.length; i++) {
      const ax = path[i].x;
      const ay = path[i].y;
      const dx = path[i + 1].x - ax;
      const dy = path[i + 1].y - ay;
      const lengthSq = dx * dx + dy * dy;
      const t =
        lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSq));
      const d = dist(x, y, ax + t * dx, ay + t * dy);
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * Re-aims at the nearest waypoint *ahead of* the one already reached, after
   * a chase has moved the minion somewhere its stored index no longer
   * describes.
   *
   * `waypointIndex` only advances when the minion gets within
   * `WAYPOINT_TOLERANCE` of a waypoint, so a minion pulled off its lane at
   * index 1 comes back still aiming at index 1 — which, for a minion dragged
   * to mid, means walking all the way back past its own fountain before
   * setting off again. That is the reported bug, reproduced: a minion parked
   * at (3100,3400) headed for (350,4710), 3046px behind it, while waypoint 3
   * sat 2472px ahead.
   *
   * Never searches backwards from the current index: the lane is a route from
   * one base to the other, and a minion that has passed a waypoint has passed
   * it. Picking the global nearest would let a minion shoved back down its own
   * lane un-walk progress it had already made.
   */
  resyncWaypoint(): void {
    const { x, y } = this.position;
    let best = this.waypointIndex;
    let bestDistSq = Infinity;
    for (let i = this.waypointIndex; i < this.waypoints.length; i++) {
      const dSq = distSq(x, y, this.waypoints[i].x, this.waypoints[i].y);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = i;
      }
    }
    this.waypointIndex = best;
  }

  updateWalk() {
    const waypoint = this.currentWaypoint;
    if (!waypoint) {
      this.stopMovement();
      return;
    }

    const reached = withinRadius(this.position, waypoint, WAYPOINT_TOLERANCE);
    if (reached) {
      this.joinedLane = true;
      if (this.waypointIndex < this.waypoints.length - 1) this.waypointIndex += 1;
    }

    const next = this.currentWaypoint;
    if (!next) return;
    // Routed until it is standing on the lane, straight-line after — see
    // `joinedLane`. `navigateTo` only bumps `movementRevision` when the
    // destination actually changes, so asking every frame is free, and it
    // degrades to `moveTo` in a context with no navigation at all.
    if (this.joinedLane) this.moveTo(next.x, next.y);
    else this.navigateTo(next.x, next.y);
  }

  updateAttack() {
    const target = this.targetLock;
    // a lock can go stale between scans: the target dies, gets removed, or is
    // made untargetable by a buff. Monster hit exactly this and threw on the
    // next frame reading target.position off a corpse.
    // `isStealthed` alongside the stale-lock checks, not only in the scan: the
    // scan runs every AGGRO_SCAN_INTERVAL_MS, so vanishing in front of a wave
    // still bought a fifth of a second of being hit by something that could no
    // longer see you.
    if (!target || target.toRemove || target.isDead || !target.position || target.isStealthed) {
      this.targetLock = null;
      this.phase = Minion.PHASES.WALK;
      return;
    }

    // surface to surface, otherwise a 40px reach can never satisfy its own check
    // against two 34px bodies standing next to each other
    const reach = this.reachTo(target);
    const distance = p5.Vector.dist(this.position, target.position);

    if (distance > reach) {
      // close the gap, but only inside the radius that made us stop: a minion
      // that chases past it would leave the lane and its wall clearance behind
      this.moveTo(target.position.x, target.position.y);
    } else {
      this.stopMovement();
      // `canAttack` because a minion swings on its own timer instead of through
      // `BasicAttackController`, which is where champions get this gate. Without
      // it a wave lifted by a knock-up or held by a slowing zone kept swinging on the
      // beat all the way up — the buff and its status flags applied correctly,
      // so the crowd control simply read as doing nothing. The cooldown is only
      // spent on a swing that actually happens, so the wave resumes the frame it
      // lands rather than firing a banked volley.
      if (this.canAttack && this._attackCooldown <= 0) {
        this._attackCooldown = this.attackInterval;
        this.launchAttack(target, reach);
      }
    }
  }

  /** Surface-to-surface reach: this minion's own radius plus the target's. */
  reachTo(target: AttackableUnit): number {
    return this.attackRange + this.stats.size.value / 2 + (target.stats?.size?.value ?? 0) / 2;
  }

  /**
   * Damage used to land the instant the cooldown allowed a swing, which made a
   * whole wave fighting unreadable — a dozen simultaneous instant hits with only
   * a 160-220ms flash to show for them. Now it lands on arrival: a slow homing
   * bolt for the caster line, a wind-up-then-strike swing for the front line.
   * Both objects re-validate the target (and this minion) right before damage
   * actually applies, so a target that dies or leaves takes nothing phantom.
   */
  launchAttack(target: AttackableUnit, reach: number): void {
    if (this.style !== 'melee') {
      const bolt = new MinionBolt(this);
      bolt.target = target;
      bolt.damage = this.damage;
      bolt.color = this.colors.bar;
      bolt.position.set(this.position.x, this.position.y);
      bolt.destination.set(target.position.x, target.position.y);
      this.game.objectManager.addObject(bolt);
    } else {
      const swing = new MinionSwing(this, target);
      swing.damage = this.damage;
      swing.reach = reach;
      swing.color = this.colors.bar;
      this.game.objectManager.addObject(swing);
    }
  }

  /**
   * A wave's ladder, in the source game's own order.
   *
   * The floor is what this method used to be in its entirety — nearest minion,
   * else nearest of anything else hostile — and that ordering is still what
   * makes a wave fight the other wave instead of peeling off after whichever
   * champion wandered past. What is above the floor is new, and it is the
   * thing players mean by "the minions turned on me": hit an enemy champion
   * while their wave is in range and their wave answers, whatever it was doing.
   *
   * Rung 4 is written as "anything else already in the candidate set" rather
   * than as `instanceof Turret`, and cannot be written the other way: `Turret`
   * imports this module, so this module cannot import `Turret`. A tower
   * shelling the wave is the case it exists for; a hostile `Pet` doing the
   * same also satisfies it, which is the right answer for the same reason.
   * `Monster` never reaches it — the query below excludes the whole class.
   */
  private static readonly LADDER: AggroLadder<AttackableUnit> = {
    defend: [
      { attacker: unit => unit instanceof Champion, victim: ally => ally instanceof Champion },
      { attacker: unit => unit instanceof Minion, victim: ally => ally instanceof Champion },
      { attacker: unit => unit instanceof Minion, victim: ally => ally instanceof Minion },
      {
        attacker: unit => !(unit instanceof Champion) && !(unit instanceof Minion),
        victim: ally => ally instanceof Minion,
      },
      { attacker: unit => unit instanceof Champion, victim: ally => ally instanceof Minion },
    ],
    nearest: [unit => unit instanceof Minion, () => true],
  };

  /**
   * What this minion should be hitting.
   *
   * Jungle camps are excluded outright: a lane minion has no business clearing
   * the jungle, and the camps leash anyway so it would be a fight nobody wins.
   *
   * @param current The lock being carried in, or null. Only a better rung of
   *   the ladder takes it away — see `combat/AggroPriority`.
   */
  findTarget(current: AttackableUnit | null = null): AttackableUnit | null {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: this.aggroRange,
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.teamId),
        PredefinedFilters.excludeType(Monster),
        // a champion in a bush is not a target a minion can pick — see the
        // filter's own comment for the rule and its one deliberate looseness
        PredefinedFilters.excludeStealthed,
        PredefinedFilters.visibleTo(this),
      ],
    }) as AttackableUnit[];

    // The quadtree answers by bounding box, so the circle is re-checked here.
    const candidates: AttackableUnit[] = [];
    for (const unit of found) {
      if (unit === this) continue;
      if (p5.Vector.dist(this.position, unit.position) > this.aggroRange) continue;
      candidates.push(unit);
    }

    // Nothing in range is the state a minion spends most of its walk in, and
    // it means there is nothing to defend either — so the ally query below
    // never runs for a wave with an empty lane in front of it.
    if (candidates.length === 0) return null;

    const held = !!current && candidates.includes(current);

    return pickAggroTarget<AttackableUnit>({
      origin: this.position,
      current: held ? current : null,
      held,
      candidates,
      allies: this.alliesInRange(),
      ladder: Minion.LADDER,
    });
  }

  /**
   * The allied champions and minions near enough for this one to answer for.
   *
   * No vision filter, unlike the hostile query: you always see your own team,
   * and an ally taking hits from something *this* minion cannot see is still
   * an ally taking hits — the ladder refuses that attacker anyway, because a
   * rung only counts when the attacker is in the candidate set.
   */
  private alliesInRange(): AttackableUnit[] {
    return this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this.aggroRange }),
      filters: [
        PredefinedFilters.includeTypes([Champion, Minion]),
        PredefinedFilters.teamId(this.teamId),
        PredefinedFilters.excludeDead,
      ],
    }) as AttackableUnit[];
  }

  /**
   * A minion fights whatever `targetLock` names, and `update` re-picks that
   * every retarget tick — so a taunt has to keep writing it, which `Taunt` does.
   */
  forceAttackTarget(attacker: AttackableUnit): void {
    if (this.isDead || attacker.isDead) return;
    this.targetLock = attacker;
    this.phase = Minion.PHASES.ATTACK;
  }

  takeDamage(damage: number, attacker?: AttackableUnit) {
    if (this.isDead) return;
    super.takeDamage(damage, attacker);
    // super.takeDamage may have killed us; a corpse must not pick a fight. Only
    // swap targets when we have none — otherwise a wave under turret fire would
    // drop the minion it was killing every time a bolt landed.
    if (this.isDead || this.targetLock) return;
    if (!attacker || attacker instanceof Monster) return;
    if (attacker.teamId === this.teamId || attacker.isDead) return;
    this.targetLock = attacker;
    this.phase = Minion.PHASES.ATTACK;
  }

  /**
   * Minions are spent, not benched. AttackableUnit.update() runs a respawn timer
   * off `deathData`, so retiring the object outright is the only way to stay off
   * that path — a minion that respawned would come back at the enemy fountain
   * (randomSpawnPoint picks either one) with a lane it had already walked.
   */
  die(deathData: UnitDeathData) {
    super.die(deathData);
    this.targetLock = null;
    this.stopMovement();
    this.toRemove = true;
  }

  /** Belt and braces: nothing should reach this, and if it does it must not revive. */
  respawn() {
    this.toRemove = true;
  }

  // ---------------------------------------------------------------- rendering

  get currentWaypoint(): LaneWaypoint | undefined {
    return this.waypoints[this.waypointIndex];
  }

  get colors() {
    return TEAM_COLORS[this.teamId] ?? NEUTRAL_COLORS;
  }

  /**
   * Which way this body is pointing.
   *
   * Nothing on `AttackableUnit` answers this for a minion: `drawDir` is the
   * champion's mouse heading and this class overrides it to nothing, and
   * `moveTo` leaves no facing behind it. Two of the three silhouettes below
   * are asymmetric and need one, so it is derived rather than stored — what
   * it is hitting if it is hitting anything, else the waypoint it is walking
   * at.
   *
   * The last answer is kept and reused when there is no aim at all, so a
   * minion standing on its final waypoint with nothing in range holds the
   * heading it arrived on instead of snapping east.
   */
  aimAngle(): number {
    const lock = this.targetLock;
    const aim = lock && !lock.isDead && lock.position ? lock.position : this.currentWaypoint;
    if (aim) {
      const dx = aim.x - this.position.x;
      const dy = aim.y - this.position.y;
      if (dx !== 0 || dy !== 0) this._heading = Math.atan2(dy, dx);
    }
    return this._heading;
  }

  /**
   * Team colour directly rather than `isAllied`, so both sides keep their own
   * stable map identity regardless of which team the local player belongs to.
   *
   * Hand-drawn on purpose — no avatar, no particle system, no trail. There can
   * be dozens of these on screen and each one has to stay a handful of
   * draw calls.
   *
   * ## Three silhouettes, not three decorations on one silhouette
   *
   * All three used to be the same disc wearing a different ring: a caster was
   * a disc with one ring, a cannon a disc with two. At the zoom a lane is
   * actually played at, one ring against two is not a difference anybody reads
   * — and the cannon is the body a player most needs to pick out of a wave,
   * being the one worth three times the gold and the one that shells a turret.
   *
   * So each style now has its own *shape*, which survives being small: the
   * front line is a round body with a blade out front, the back line is a
   * smaller body carrying a lit orb, and the siege body is a wheeled cart with
   * a barrel. Everything is drawn in a frame rotated to `aimAngle`, which is
   * what makes the last two read as facing something rather than as ornaments.
   *
   * The cart costs about nine calls against the other two's four. It is at
   * most one per wave per lane — three on the board in an ordinary minute
   * against forty of the others — so it is the one body that can afford them.
   */
  draw({ compactUnits = false }: AttackableUnitRenderOptions = {}) {
    if (this.isDead) return;

    const size = this.stats.size.value;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.aimAngle());
    noStroke();

    if (this.style === 'cannon') this.drawCart(size);
    else if (this.style === 'ranged') this.drawCaster(size);
    else this.drawSoldier(size);

    pop();

    // the swing/bolt objects spawned by launchAttack() draw themselves as
    // separate objects now, so there is nothing left to flash here
    // buffs land on minions like they do on anyone else — a stunned minion with
    // no visual reads as a stuck one. Free when the list is empty, which it
    // usually is
    this.drawBuffs(compactUnits);
    this.drawHealthBar();
  }

  /**
   * The front line: a round body, a shield plate across the leading edge and a
   * short blade past it. The disc is what every minion used to be, kept here
   * because this is the body a player reads as "the ordinary one".
   *
   * Drawn in the rotated frame, so `+x` is forward.
   */
  private drawSoldier(size: number): void {
    const { body, trim } = this.colors;

    fill(trim[0], trim[1], trim[2], 200);
    circle(0, 0, size * 1.12);
    fill(body[0], body[1], body[2]);
    circle(0, 0, size);

    // blade — a bright wedge past the front, the one thing that says which way
    // this is facing
    fill(238, 242, 250, 235);
    triangle(size * 0.34, -size * 0.11, size * 0.34, size * 0.11, size * 0.82, 0);

    // shield boss, offset off the axis so the blade is not drawn through it
    fill(trim[0], trim[1], trim[2], 245);
    circle(size * 0.2, size * 0.24, size * 0.34);
  }

  /**
   * The back line: a smaller body with a lit orb held out in front of it, on a
   * staff. Smaller *and* a different shape — a caster that was only smaller
   * would be a melee minion at range, which is what the old ring amounted to.
   *
   * The orb breathes on `frameCount` rather than on any state of this minion,
   * so a whole back line does not pulse in lockstep only by accident: each
   * body offsets the phase by its own attack cooldown, which is already
   * jittered per minion.
   */
  private drawCaster(size: number): void {
    const { body, trim } = this.colors;
    const orbX = size * 0.5;
    const orbY = -size * 0.26;
    const breath = 1 + 0.12 * Math.sin(frameCount * 0.08 + this._scanCooldown);

    fill(trim[0], trim[1], trim[2], 200);
    circle(0, 0, size * 1.02);
    fill(body[0], body[1], body[2]);
    circle(0, 0, size * 0.88);

    stroke(228, 220, 200, 210);
    strokeWeight(Math.max(1.5, size * 0.07));
    line(size * 0.06, size * 0.1, orbX, orbY);
    noStroke();

    fill(255, 235, 190, 110);
    circle(orbX, orbY, size * 0.44 * breath);
    fill(255, 255, 255, 235);
    circle(orbX, orbY, size * 0.2);
  }

  /**
   * The siege body: a wheeled cart with a barrel out front.
   *
   * Wheels are drawn first so the chassis sits over them, which is the whole
   * trick that makes four dark circles read as running gear rather than as
   * four dots. The barrel reaches past the chassis, which is why this style
   * widens its own display box — see `getDisplayBoundingBox`.
   */
  private drawCart(size: number): void {
    const { body, trim } = this.colors;
    const halfLength = size * 0.52;
    const halfWidth = size * 0.34;
    const wheel = size * 0.32;
    const axle = halfWidth + wheel * 0.34;

    fill(26, 28, 36, 240);
    circle(-halfLength * 0.5, -axle, wheel);
    circle(-halfLength * 0.5, axle, wheel);
    circle(halfLength * 0.45, -axle, wheel);
    circle(halfLength * 0.45, axle, wheel);

    // chassis, trim first as a border the body sits inside
    const lip = size * 0.07;
    fill(trim[0], trim[1], trim[2], 235);
    quad(
      -halfLength - lip,
      -halfWidth - lip,
      halfLength + lip,
      -halfWidth - lip,
      halfLength + lip,
      halfWidth + lip,
      -halfLength - lip,
      halfWidth + lip
    );
    fill(body[0], body[1], body[2]);
    quad(
      -halfLength,
      -halfWidth,
      halfLength,
      -halfWidth,
      halfLength,
      halfWidth,
      -halfLength,
      halfWidth
    );

    // barrel, tapering forward, with a lit muzzle
    const muzzle = size * 0.92;
    fill(52, 56, 70, 245);
    quad(
      halfLength * 0.2,
      -size * 0.15,
      muzzle,
      -size * 0.1,
      muzzle,
      size * 0.1,
      halfLength * 0.2,
      size * 0.15
    );
    fill(255, 215, 120, 235);
    circle(muzzle, 0, size * 0.22);
  }

  /** Lights a cheap circle for the player team; minions carry no combat sight. */
  get fogRevealRadius(): number {
    return MINION_FOG_REVEAL_RADIUS;
  }

  /** Points at whatever it is hitting. The base class points at the mouse. */
  drawDir() {}

  /** Tiny, and no readout — champion-sized bars across a full board are a wall of text. */
  drawHealthBar() {
    const pos = this.position;
    const size = this.stats.size.value;
    const w = 30;
    const h = 4;
    const x = pos.x - w / 2;
    const y = pos.y - size * 0.72 - h;
    const percent = Math.max(0, Math.min(1, this.stats.health.value / this.stats.maxHealth.value));

    push();
    noStroke();
    fill(10, 12, 16, 210);
    rect(x - 1, y - 1, w + 2, h + 2);
    const { bar } = this.colors;
    fill(bar[0], bar[1], bar[2]);
    rect(x, y, w * percent, h);
    pop();
  }

  getDisplayBoundingBox() {
    // the base sizes an allied unit's box by its vision radius; a minion grants
    // no vision, so its box is just its body — except the cart, whose barrel
    // reaches nearly a full body length past its centre and would be culled at
    // the screen edge a beat before the rest of it (`drawCart`).
    const spread = this.style === 'cannon' ? 2.3 : 1.4;
    return this.squareDisplayBoundingBox(this.stats.size.value * spread);
  }
}

/**
 * A ranged minion's basic attack: a small bolt that homes on its target and
 * damages it on arrival — nothing on the way, nothing if the target is gone
 * by the time it gets there. Mirrors TurretBolt (Turret.ts): `maxHitCount = 0`
 * switches MissileSpellObject's in-flight collision off entirely, so this can
 * only ever hit the one unit it was fired at, and only once, at the end.
 *
 * No trail, no particle system — up to two dozen of these can be in flight at
 * once during a big wave fight.
 */
export class MinionBolt extends MissileSpellObject {
  speed = RANGED_BOLT_SPEED;
  size = 14;
  maxHitCount = 0;
  removeOnArrive = true;
  damage = 0;
  target: AttackableUnit | null = null;
  color: number[] = [255, 235, 190];
  /** Fizzles on its own if it somehow never arrives. */
  _life = 2_000;

  onBeforeMove() {
    this._life -= deltaTime;
    if (this._life <= 0) {
      this.toRemove = true;
      return;
    }
    if (this.target && !this.target.isDead && !this.target.toRemove) {
      this.destination.set(this.target.position.x, this.target.position.y);
    }
  }

  onArrive() {
    const target = this.target;
    if (target && !target.isDead && !target.toRemove && target.targetable && !this.owner.isDead) {
      target.takeDamage(this.damage, this.owner);
    }
  }

  draw() {
    const pos = this.position;
    push();
    noStroke();
    fill(this.color[0], this.color[1], this.color[2], 90);
    circle(pos.x, pos.y, this.size * 1.8);
    fill(255, 255, 255, 220);
    circle(pos.x, pos.y, this.size * 0.55);
    pop();
  }
}

/**
 * The melee minion's basic attack: a short wind-up, then a fan-shaped swipe
 * that lands on contact. Not a MissileSpellObject — nothing travels — but the
 * same discipline applies: damage resolves exactly once, at the strike
 * instant, and only if the target (and this minion) are still valid then.
 */
export class MinionSwing extends SpellObject {
  target: AttackableUnit | null;
  damage = 0;
  /** Surface-to-surface reach, re-checked at the strike instant. */
  reach = 40;
  color: number[] = [255, 220, 160];
  age = 0;
  struck = false;

  constructor(owner: AttackableUnit, target: AttackableUnit) {
    super(owner);
    this.target = target;
  }

  update() {
    this.age += deltaTime;
    this.position.set(this.owner.position.x, this.owner.position.y);

    if (!this.struck && this.age >= MELEE_WINDUP_MS) {
      this.struck = true;
      this.strike();
    }
    if (this.age >= MELEE_SWING_TOTAL_MS) this.toRemove = true;
  }

  strike(): void {
    const target = this.target;
    if (!target || target.isDead || target.toRemove || !target.targetable || this.owner.isDead) {
      return;
    }
    // the target (or this minion) may have drifted during the wind-up
    if (p5.Vector.dist(this.owner.position, target.position) > this.reach) return;
    target.takeDamage(this.damage, this.owner);
  }

  draw() {
    const target = this.target;
    const pos = this.owner.position;
    let dirX = 1;
    let dirY = 0;
    if (target) {
      const dx = target.position.x - pos.x;
      const dy = target.position.y - pos.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        dirX = dx / len;
        dirY = dy / len;
      }
    }
    const angle = Math.atan2(dirY, dirX);
    const bodyRadius = this.owner.stats.size.value / 2;

    push();
    translate(pos.x, pos.y);
    rotate(angle);
    noStroke();

    if (this.age < MELEE_WINDUP_MS) {
      // wind-up: a small glow pulling back, brightening as the swing charges
      const windupRatio = this.age / MELEE_WINDUP_MS;
      fill(this.color[0], this.color[1], this.color[2], 60 + 100 * windupRatio);
      circle(-bodyRadius * 0.5, 0, 6 + 6 * windupRatio);
    } else {
      // strike: a wide fan swipe sweeping past the attacker, fading through
      // the rest of the swing's life
      const strikeRatio = constrain(
        (this.age - MELEE_WINDUP_MS) / (MELEE_SWING_TOTAL_MS - MELEE_WINDUP_MS),
        0,
        1
      );
      const fade = 1 - strikeRatio;
      const innerR = bodyRadius * 0.6;
      const outerR = bodyRadius + this.reach * 0.9;
      const half = 0.6;

      fill(this.color[0], this.color[1], this.color[2], 200 * fade);
      beginShape();
      for (let i = 0; i <= 4; i++) {
        const a = -half + 2 * half * (i / 4);
        vertex(cos(a) * outerR, sin(a) * outerR);
      }
      for (let i = 4; i >= 0; i--) {
        const a = -half + 2 * half * (i / 4);
        vertex(cos(a) * innerR, sin(a) * innerR);
      }
      endShape(CLOSE);

      noFill();
      stroke(255, 255, 255, 220 * fade);
      strokeWeight(2);
      arc(0, 0, outerR * 2, outerR * 2, -half, half);
    }

    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.reach + 20) * 2);
  }
}
