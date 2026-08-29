import MissileSpellObject from '@/game/gameObject/MissileSpellObject';
import SpellObject from '@/game/gameObject/SpellObject';
import type AttackableUnit from './AttackableUnit';

/**
 * What a camp's basic attack looks like, and how its damage travels.
 *
 * Until this existed a monster's swing was `target.takeDamage()` on the frame
 * the cooldown allowed it, plus a 180ms line drawn from the body to whatever
 * it was hitting. That reads as nothing at all past melee range: a boss camp
 * with an `attackRange` in the hundreds "shot" you with a thin stroke and a
 * health bar that dropped, and nothing in between. Minions had solved this
 * long before (`Minion.launchAttack`: `MinionBolt` and `MinionSwing`, damage
 * resolved on arrival); camps simply never got it.
 *
 * The three styles are the three shapes a camp in this game actually needs:
 *
 * - `melee` — claws. Wind-up, then a fan of slashes that lands on contact.
 * - `ranged` — a spat projectile that travels and damages on arrival.
 * - `breath` — a cone that opens from the body's mouth to its target, for a
 *   camp a pack wants read as a boss rather than as a big animal.
 *
 * Every one of them resolves damage **exactly once**, at its own strike
 * instant, and re-checks the target (and the attacker) right before it does —
 * the same discipline `MinionSwing.strike` and `MinionBolt.onArrive` follow,
 * and the reason a target that dies or blinks out mid-animation takes nothing
 * phantom.
 *
 * These live beside `Monster` rather than inside it, unlike `MinionBolt` in
 * `Minion.ts`: three classes of pure paint is more than that file should
 * carry on top of five behaviour phases, and none of them reads anything off
 * `Monster` that `AttackableUnit` does not already have.
 */
export type MonsterAttackStyle = 'melee' | 'ranged' | 'breath';

/**
 * Reach at or below which a camp that declared no style swings rather than
 * fires.
 *
 * The default has to be derived from something, because every camp in every
 * pack predates the field — and reach is the honest signal: a body whose
 * `attackRange` is about its own size fights by touching you. Core's own
 * A pack's farm camps sit at a reach of tens of pixels and its bosses in the
 * hundreds, with nothing in between, so the split lands cleanly and no pack
 * has to be edited for its camps to stop dealing damage from nowhere.
 */
export const MONSTER_MELEE_REACH = 100;

/** Wind-up before a claw lands, and the whole animation's life. */
export const CLAW_WINDUP_MS = 160;
export const CLAW_TOTAL_MS = 380;

/** World units per frame at 60fps, a shade faster than a minion's bolt. */
export const SPIT_SPEED = 420 / 60;

/** The cone opens over the wind-up, burns, then fades. */
export const BREATH_WINDUP_MS = 240;
export const BREATH_TOTAL_MS = 620;

/** Half-angle of the breath cone, radians. */
export const BREATH_HALF_ANGLE = 0.42;

/** Half-angle of one claw arc, radians. */
export const CLAW_ARC_HALF_ANGLE = 0.23;

/** Where the three claw arcs sit relative to the aim line, radians. */
const CLAW_OFFSETS = [-0.36, 0, 0.36] as const;

/** The old flash colour, kept as the default so an undeclared camp is unchanged. */
export const DEFAULT_MONSTER_ATTACK_COLOR: readonly number[] = Object.freeze([255, 190, 80]);

/** Unit vector from `from` to `to`, or `{x: 1, y: 0}` when they coincide. */
const aim = (
  from: { x: number; y: number },
  to: { x: number; y: number }
): { x: number; y: number } => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
};

/**
 * Whether this attack may still land: both bodies alive, the target takeable,
 * and the target still inside the reach the swing was started at.
 *
 * Shared because getting it wrong is silent in both directions — skip it and
 * a camp damages a corpse from across the map, over-tighten it and the camp
 * appears to swing through people.
 */
const stillLands = (
  owner: AttackableUnit,
  target: AttackableUnit | null,
  reach: number
): target is AttackableUnit => {
  if (!target || target.isDead || target.toRemove || !target.targetable) return false;
  if (owner.isDead) return false;
  return p5.Vector.dist(owner.position, target.position) <= reach;
};

/**
 * A camp's claws: a short wind-up, then three slashes fanned across the
 * target's side, landing together on contact.
 *
 * Three rather than `MinionSwing`'s one arc because a camp is the thing you
 * fight for ten seconds while deciding whether to keep fighting it — the
 * swing has to be legible at a glance from the edge of the screen, and one
 * thin arc on a 100px body is not.
 */
export class MonsterClaw extends SpellObject {
  target: AttackableUnit | null;
  damage = 0;
  /** Surface-to-surface reach, re-checked at the strike instant. */
  reach = 60;
  color: number[] = [...DEFAULT_MONSTER_ATTACK_COLOR];
  age = 0;
  struck = false;

  constructor(owner: AttackableUnit, target: AttackableUnit) {
    super(owner);
    this.target = target;
  }

  update() {
    this.age += deltaTime;
    this.position.set(this.owner.position.x, this.owner.position.y);

    if (!this.struck && this.age >= CLAW_WINDUP_MS) {
      this.struck = true;
      this.strike();
    }
    if (this.age >= CLAW_TOTAL_MS) this.toRemove = true;
  }

  strike(): void {
    if (!stillLands(this.owner, this.target, this.reach)) return;
    this.target.takeDamage(this.damage, this.owner);
  }

  draw() {
    const pos = this.owner.position;
    const direction = this.target ? aim(pos, this.target.position) : { x: 1, y: 0 };
    const angle = Math.atan2(direction.y, direction.x);
    const bodyRadius = this.owner.stats.size.value / 2;
    const [r, g, b] = this.color;

    push();
    translate(pos.x, pos.y);
    rotate(angle);
    noFill();

    if (this.age < CLAW_WINDUP_MS) {
      // wind-up: the claws draw back and brighten, so the hit is telegraphed
      const charge = this.age / CLAW_WINDUP_MS;
      stroke(r, g, b, 40 + 120 * charge);
      strokeWeight(3);
      for (const offset of CLAW_OFFSETS) {
        const inner = bodyRadius * 0.35;
        const outer = bodyRadius * (0.55 + 0.2 * charge);
        line(
          Math.cos(offset) * inner,
          Math.sin(offset) * inner,
          Math.cos(offset) * outer,
          Math.sin(offset) * outer
        );
      }
      pop();
      return;
    }

    // strike: three arcs sweeping out past the body and fading together
    const swept = constrain(
      (this.age - CLAW_WINDUP_MS) / (CLAW_TOTAL_MS - CLAW_WINDUP_MS),
      0,
      1
    );
    const fade = 1 - swept;
    const inner = bodyRadius * 0.7 + this.reach * 0.25 * swept;
    const outer = bodyRadius + this.reach * (0.45 + 0.5 * swept);

    for (let index = 0; index < CLAW_OFFSETS.length; index += 1) {
      const offset = CLAW_OFFSETS[index];
      const leads = index === 1;
      // the middle slash leads, the outer two trail it by a hair
      const lead = constrain(swept * 1.25 - (leads ? 0 : 0.12), 0, 1);
      const radius = inner + (outer - inner) * lead;
      stroke(r, g, b, 230 * fade * (leads ? 1 : 0.75));
      strokeWeight(leads ? 7 : 4);
      arc(0, 0, radius * 2, radius * 2, offset - CLAW_ARC_HALF_ANGLE, offset + CLAW_ARC_HALF_ANGLE);
    }

    stroke(255, 255, 255, 200 * fade);
    strokeWeight(2);
    arc(0, 0, outer * 2, outer * 2, -CLAW_ARC_HALF_ANGLE, CLAW_ARC_HALF_ANGLE);

    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.owner.stats.size.value + this.reach + 40) * 2);
  }
}

/**
 * A camp's spat projectile: travels to whatever it was aimed at and damages it
 * on arrival, nothing on the way.
 *
 * `maxHitCount = 0` switches `MissileSpellObject`'s in-flight collision off
 * entirely — the same setting `MinionBolt` and `TurretBolt` use — so this can
 * only ever hit the one body it was fired at, once, at the end. A camp's
 * basic attack becoming an accidental skillshot that clips a passing minion
 * is not a buff anyone asked for.
 */
export class MonsterSpit extends MissileSpellObject {
  speed = SPIT_SPEED;
  size = 22;
  maxHitCount = 0;
  removeOnArrive = true;
  damage = 0;
  target: AttackableUnit | null = null;
  color: number[] = [...DEFAULT_MONSTER_ATTACK_COLOR];
  /** Fizzles on its own if it somehow never arrives. */
  _life = 3_000;

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
    const [r, g, b] = this.color;
    // The echoes are laid along the flight line rather than a stored history:
    // a camp has at most a handful of these alive, but a position buffer per
    // projectile is state to keep correct for a tail nobody can measure.
    const back = aim(this.destination, pos);
    const echoes = [1.1, 2.0, 2.9];

    push();
    noStroke();
    for (let index = 0; index < echoes.length; index += 1) {
      const step = echoes[index];
      fill(r, g, b, 70 - index * 20);
      circle(
        pos.x + back.x * this.size * step,
        pos.y + back.y * this.size * step,
        this.size * (0.8 - index * 0.18)
      );
    }
    fill(r, g, b, 110);
    circle(pos.x, pos.y, this.size * 1.7);
    fill(r, g, b, 235);
    circle(pos.x, pos.y, this.size);
    fill(255, 255, 255, 230);
    circle(pos.x, pos.y, this.size * 0.42);
    pop();
  }
}

/**
 * A cone of fire opening from the body's mouth to its target.
 *
 * **Single-target on purpose.** The cone is aimed art over a basic attack, not
 * a new area effect: it damages the one body the camp was swinging at, and an
 * ally standing inside the paint takes nothing. Making it hit everything it
 * covers would silently multiply a boss camp's damage output by however many
 * people are contesting it — a balance change wearing a graphics change's
 * clothes.
 */
export class MonsterBreath extends SpellObject {
  target: AttackableUnit | null;
  damage = 0;
  /** Surface-to-surface reach, re-checked at the strike instant. */
  reach = 320;
  color: number[] = [...DEFAULT_MONSTER_ATTACK_COLOR];
  age = 0;
  struck = false;

  constructor(owner: AttackableUnit, target: AttackableUnit) {
    super(owner);
    this.target = target;
  }

  update() {
    this.age += deltaTime;
    this.position.set(this.owner.position.x, this.owner.position.y);

    if (!this.struck && this.age >= BREATH_WINDUP_MS) {
      this.struck = true;
      this.strike();
    }
    if (this.age >= BREATH_TOTAL_MS) this.toRemove = true;
  }

  strike(): void {
    if (!stillLands(this.owner, this.target, this.reach)) return;
    this.target.takeDamage(this.damage, this.owner);
  }

  draw() {
    const pos = this.owner.position;
    const direction = this.target ? aim(pos, this.target.position) : { x: 1, y: 0 };
    const angle = Math.atan2(direction.y, direction.x);
    const bodyRadius = this.owner.stats.size.value / 2;
    const [r, g, b] = this.color;

    // How far the target actually is, so the cone stops on it rather than
    // always painting the camp's full reach into the wall behind it.
    const span = this.target
      ? Math.min(this.reach, p5.Vector.dist(pos, this.target.position))
      : this.reach;

    push();
    translate(pos.x, pos.y);
    rotate(angle);
    noStroke();

    if (this.age < BREATH_WINDUP_MS) {
      // wind-up: a glow gathering at the mouth
      const charge = this.age / BREATH_WINDUP_MS;
      fill(r, g, b, 40 + 150 * charge);
      circle(bodyRadius * 0.85, 0, 10 + 26 * charge);
      fill(255, 255, 255, 120 * charge);
      circle(bodyRadius * 0.85, 0, 5 + 12 * charge);
      pop();
      return;
    }

    const burn = constrain(
      (this.age - BREATH_WINDUP_MS) / (BREATH_TOTAL_MS - BREATH_WINDUP_MS),
      0,
      1
    );
    // Reaches full length in the first third of the burn, then holds and fades
    const length = bodyRadius + (span - bodyRadius) * constrain(burn * 3, 0, 1);
    const fade = 1 - constrain((burn - 0.35) / 0.65, 0, 1);
    // Deterministic flicker — `random()` here would make every frame of every
    // test that draws a breath a different picture for no gain.
    const flicker = 1 + 0.08 * Math.sin(this.age * 0.05);

    const cone = (halfAngle: number, reach: number, paint: number[]) => {
      fill(paint[0], paint[1], paint[2], paint[3]);
      beginShape();
      vertex(bodyRadius * 0.6, 0);
      for (let i = 0; i <= 8; i++) {
        const a = -halfAngle + 2 * halfAngle * (i / 8);
        vertex(Math.cos(a) * reach, Math.sin(a) * reach);
      }
      endShape(CLOSE);
    };

    // Three layers: a wide faint mantle, the body of the flame, and a pale
    // core. The core is deliberately not the camp's own colour — fire reads as
    // fire because its centre is hotter than its edge.
    cone(BREATH_HALF_ANGLE * flicker, length, [r, g, b, 90 * fade]);
    cone(BREATH_HALF_ANGLE * 0.62 * flicker, length * 0.94, [r, g, b, 140 * fade]);
    cone(BREATH_HALF_ANGLE * 0.26, length * 0.8, [255, 245, 220, 180 * fade]);

    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.reach + this.owner.stats.size.value) * 2);
  }
}
