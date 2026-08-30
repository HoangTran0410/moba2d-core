import { Circle, Rectangle } from '@/libs/quadtree';
import VectorUtils from '@/utils/vector.utils';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import SpellObject from './SpellObject';
import AttackableUnit from './attackableUnits/AttackableUnit';
import TrailSystem from './helpers/TrailSystem';
import AssetManager, { type AssetHandle } from '@/managers/AssetManager';

/**
 * How long a homing bolt may go without getting any closer before it gives up
 * — see `MissileSpellObject.stalledChaseMs`. Three seconds of losing ground,
 * which nothing in this engine can do to a champion it is chasing.
 */
export const STALLED_CHASE_MS = 3_000;

/**
 * Base for skillshot projectiles: travels from `position` to `destination`, damages
 * enemies it overlaps on the way, and dies on arrival.
 *
 * A subclass normally only overrides `onHit`, `draw`, and the tuning fields. The
 * hooks (`onBeforeMove`, `onAfterMove`, `onArrive`, `getTrailPosition`) cover the
 * cases that bend the default flight, e.g. a boomerang that flips its destination
 * on arrival, or a tornado that widens as it travels.
 *
 * Declare `trailSystem` in the subclass, not here: subclass field initializers run
 * after this class's, so a trail built here could not read the subclass `size`.
 */
export default class MissileSpellObject extends SpellObject {
  isMissile = true;

  declare position: p5.Vector;
  declare destination: p5.Vector;
  speed = 7;
  size = 20;
  image?: AssetHandle;
  visualWidth = this.size;
  visualHeight = this.size;
  visualRotationOffset = 0;

  /** Units already hit — excluded from later queries so one unit is hit once. */
  hitTargets: AttackableUnit[] = [];
  /** Stops hitting after this many distinct units. Infinity pierces, 0 never collides. */
  maxHitCount = Infinity;
  /** False for missiles that keep flying after reaching `destination`. */
  removeOnArrive = true;
  /** False for missiles that survive their last hit, e.g. to latch onto the target. */
  removeOnMaxHit = true;

  /**
   * When a homing bolt gives up, in ms of **getting no closer**. `0` — the
   * default, and every skillshot — never gives up at all.
   *
   * ## Two wrong answers before this one
   *
   * A homing bolt re-aims every frame, so it needs *some* end besides hitting:
   * a target faster than it is a chase with no end. Each of the four homing
   * bolts in this engine grew its own, and every one of them was a duration —
   * `_life = 3000`, `4000`, `2000`, `3000`.
   *
   * A duration times a speed is a *range*, and none of them said so. The
   * turret's 4000ms at 13px a frame is 3120px of reach, so the moment a map
   * tuned `attackRange` past that, its turret fired bolts that stopped in mid
   * air a fraction of the way to a target they could perfectly well have hit:
   * "đạn của trụ đi tới 1 khoảng cách lớn nào đó là tự mất".
   *
   * Replacing it with a *distance* budget — some multiple of the shot — fixed
   * the range and kept the shape of the mistake, which the next report found
   * at once: budget the shot and you have capped the **chase**. A turret
   * firing at somebody 400px away who then ran gave up 2000px into the
   * pursuit. Both versions were a number standing in for the thing actually
   * being asked.
   *
   * ## What is actually being asked
   *
   * "Đuổi theo target khi nào tới nơi thì thôi, hoặc khi target die." Those
   * are the two ends, and neither is a distance: arrival is `removeOnArrive`,
   * and a dead target freezes `destination` at its last known point so the
   * bolt lands there and is done.
   *
   * This is not a third end beside those two — it is the case where the first
   * one is unreachable. A bolt that has not gained a pixel on its target in
   * three seconds is not flying towards anything; it is being outrun, and
   * "when it arrives" will never come. A bolt that *is* closing — however
   * slowly, and however far it has already flown — is never touched by this.
   * Every bolt in this engine outruns every champion, so in an ordinary match
   * it does not fire at all.
   */
  stalledChaseMs = 0;

  /** The closest this has ever been to its destination. */
  private closestApproach = Infinity;
  /** How long since that number last improved. */
  private stalledMs = 0;

  /** Assigned by subclasses that want a trail; registered automatically. */
  trailSystem: TrailSystem | null = null;

  constructor(owner: AttackableUnit) {
    super(owner);
    this.position = owner.position.copy();
    this.destination = owner.position.copy();
  }

  onAdded() {
    if (this.trailSystem && this.owner.game.objectManager.addObject) {
      this.owner.game.objectManager.addObject(this.trailSystem);
    }
  }

  update() {
    // A missile in flight never attaches, so this is a no-op for it; missiles
    // that latch onto a body (a hooked bandage, a chained lantern) call attachTo
    // when they land and get dropped here the moment that body is gone.
    if (this.dropIfAttachmentLost()) return;

    this.onBeforeMove();

    const previousPosition = this.position.copy();
    VectorUtils.moveVectorToVector(this.position, this.destination, this.speed);
    if (this.hasArrived(previousPosition, this.position)) {
      this.onArrive();
      if (this.removeOnArrive) this.toRemove = true;
      if (this.shouldStopAfterArrival()) return;
    }

    // Checked after arrival, never before: a bolt that lands on the frame it
    // would have given up has hit, not given up.
    if (this.givingUpOnAChaseItCannotWin()) {
      this.toRemove = true;
      return;
    }

    this.onAfterMove();

    if (this.trailSystem) this.trailSystem.addTrail(this.getTrailPosition());

    this.checkCollision();
  }

  checkCollision() {
    // 0 means the missile never collides in flight, e.g. a bolt homing on one target
    if (this.maxHitCount <= 0) return;

    if (this.hitTargets.length >= this.maxHitCount) {
      if (this.removeOnMaxHit) this.toRemove = true;
      return;
    }

    for (const enemy of this.queryEnemies()) {
      this.hitTargets.push(enemy);
      this.onHit(enemy);

      if (this.hitTargets.length >= this.maxHitCount) {
        if (this.removeOnMaxHit) this.toRemove = true;
        break;
      }
    }
  }

  queryEnemies(): AttackableUnit[] {
    return (
      this.owner.game.objectManager.queryObjects?.({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.size / 2,
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.excludeObjects(this.hitTargets),
        ],
      }) ?? []
    );
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.size / 2,
      y: this.position.y - this.size / 2,
      w: this.size,
      h: this.size,
      data: this,
    });
  }

  draw(): void {
    if (!this.image) return;
    const angle = Math.atan2(
      this.destination.y - this.position.y,
      this.destination.x - this.position.x
    );
    push();
    translate(this.position.x, this.position.y);
    rotate(angle + this.visualRotationOffset);
    if (this.image.status === 'ready') {
      imageMode(CENTER);
      image(AssetManager.renderable(this.image), 0, 0, this.visualWidth, this.visualHeight);
    } else {
      if (this.image.status === 'idle' && this.image.key) {
        void AssetManager.ensure(this.image.key).catch(() => undefined);
      }
      stroke(235, 225, 170, 230);
      strokeWeight(Math.max(3, this.visualHeight / 5));
      line(-this.visualWidth / 2, 0, this.visualWidth / 2, 0);
    }
    pop();
  }

  /**
   * Whether this bolt is being outrun, and has been for `stalledChaseMs`.
   *
   * Only while it is actually flying: `BasicAttackBolt` rides its owner at
   * `speed = 0` through the wind-up, where the gap to a moving target changes
   * for reasons that have nothing to do with the shot.
   *
   * The pixel of slack is against float jitter — without it a bolt closing by
   * a millionth of a unit a frame counts as progress for ever, which is the
   * one thing this must not be talked out of.
   */
  private givingUpOnAChaseItCannotWin(): boolean {
    if (this.stalledChaseMs <= 0 || this.speed <= 0) return false;
    const gap = this.position.dist(this.destination);
    if (gap < this.closestApproach - 1) {
      this.closestApproach = gap;
      this.stalledMs = 0;
      return false;
    }
    this.stalledMs += deltaTime;
    return this.stalledMs >= this.stalledChaseMs;
  }

  // for override
  onBeforeMove(): void {}
  /** Runs after the step, before collision — for visuals that track distance travelled. */
  onAfterMove(): void {}
  /** Preserves the original strict endpoint arrival rule for ordinary missiles. */
  protected hasArrived(_previousPosition: p5.Vector, position: p5.Vector): boolean {
    return position.dist(this.destination) < this.speed;
  }
  /** Homing missiles stop after arrival; ordinary missiles finish their terminal hooks. */
  protected shouldStopAfterArrival(): boolean {
    return false;
  }
  onArrive(): void {}
  onHit(_enemy: AttackableUnit): void {}
  getTrailPosition(): p5.Vector {
    return this.position;
  }
}
