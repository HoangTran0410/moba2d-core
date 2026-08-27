import AssetManager from '@/managers/AssetManager';
import Spell from '@/game/gameObject/Spell';
import {
  CURSOR_ACQUISITION_RADIUS,
  FALLBACK_CHASE_MARGIN,
  findAttackTargetNearPoint,
} from '@/game/combat/AttackTargeting';
import { DEFAULT_CHAMPION_ATTACK } from '@/game/gameObject/attackableUnits/Champion';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import type BasicAttackController from '@/game/combat/BasicAttackController';
import type { CastContext, CastSpec, Vec2 } from '@/game/spell/runtime/types';

/**
 * The basic attack, as an ability.
 *
 * "Đánh thường cũng là 1 dạng spell" — the champion's own attack is a spell like
 * every other, so it lives in a spell slot instead of in a private key binding.
 * `SpellHotKeys[0]` is already `A` and slot 0 is already the internal slot, so
 * putting this class there is what makes `A` order an attack: the press travels
 * the same SpellInputController path as Q/W/E/R, and the HUD gives the slot an
 * icon, a tooltip and a timer for free.
 *
 * It owns none of the fighting. Acquisition is `findAttackTargetNearPoint`, the
 * standing order and the chase and the swing timer are BasicAttackController,
 * the delivery is combat/BasicAttack.ts, and an on-hit passive hangs off
 * `EventType.ON_ATTACK_HIT` (see an on-hit passive ability). All this class does is turn a key
 * press into an order.
 *
 * Made to be subclassed. A champion with an attack of its own overrides
 * `acquisitionRadius` or `acquire`, or `order` for something stranger, and puts
 * the subclass in its preset — the machinery underneath is unchanged, which is
 * the whole point of the attack being a spell.
 */
export default class BasicAttack extends Spell {
  name = 'Đánh Thường (Basic Attack)';
  image = AssetManager.get('spell_basic_attack');
  description =
    `Đánh <span class="buff">kẻ địch gần con trỏ nhất</span> trong vòng ` +
    `<span>${CURSOR_ACQUISITION_RADIUS}</span> đơn vị. Không có ai ở đó thì đánh kẻ gần mình nhất ` +
    `trong <span class="buff">tầm với</span>, để vừa chạy vừa bắn. Bấm vào <span class="buff">đất ` +
    `trống</span> thì tướng đi tới đó và tự khai hỏa vào kẻ địch đầu tiên gặp trên đường ` +
    `(attack-move). Tướng tự đuổi và đánh liên tục tới khi mục tiêu chết hoặc bạn ra lệnh khác. ` +
    `Nhịp đánh và sát thương lấy từ chỉ số của tướng.`;

  /**
   * Display only, and refreshed from the live swing timer every frame by
   * `onUpdate`. The starting value is the default champion profile so the
   * picker — which builds one ownerless instance of every spell just to read its
   * name, icon and tooltip — shows a real interval instead of `0s`.
   */
  coolDown = 1_000 / DEFAULT_CHAMPION_ATTACK.attacksPerSecond;
  manaCost = 0;

  // An attack order is not an ability cast: a spellblade-style "after casting
  // a spell, your next attack…" must never be armed by the attack itself.
  countsAsAbilityCast = false;

  // Nor is a swing ability damage: it scales on `attackDamage`, which items
  // already pay for handsomely, and drawing from `abilityPower` as well would
  // make one build buy both halves — see `Spell.damageScalesWithAbilityPower`.
  damageScalesWithAbilityPower = false;

  /** How far from the cursor a press reaches. Override for a per-champion feel. */
  get acquisitionRadius(): number {
    return CURSOR_ACQUISITION_RADIUS;
  }

  /**
   * How far from the *champion* a press reaches once the cursor came up empty.
   *
   * Derived rather than tuned, from the two numbers that already bound an
   * attack order:
   *
   *   - the champion's own reach, so the fallback is "someone I can shoot",
   *     which is what makes this a kiting key and not a charge key. It is the
   *     live stat, so a champion's own range-boosting passive lengthens the fallback the same
   *     frame it lengthens the swing;
   *   - `visionRadius`, so the champion never *picks for itself* something at
   *     the edge of the world. The chase, once ordered, is leashed by sight
   *     alone (`BasicAttackController.canKeep`) — this clamp is about what an
   *     aimless press may choose, not about how far a chosen chase may go.
   */
  get fallbackRadius(): number {
    const owner = this.owner as AttackableUnit | undefined;
    if (!owner) return 0;
    const reach = owner.stats.attackRange.value + owner.stats.size.value / 2;
    return Math.min(reach + FALLBACK_CHASE_MARGIN, owner.stats.visionRadius.value);
  }

  /**
   * Instant, and never on cooldown of its own: the real gate is the swing timer
   * inside BasicAttackController, which is already running whether or not
   * anybody pressed anything. A press with nobody near the cursor has to stay
   * free, otherwise a miss would lock the key.
   */
  get castSpec(): Readonly<CastSpec> {
    return BASIC_ATTACK_CAST_SPEC;
  }

  /**
   * Deliberately not `super.castCancelCheck()`: that gate is `canCast`, and a
   * silence stops abilities without stopping swings. The gate for a swing is
   * `canAttack`, which is what a disarm and every controlling crowd control
   * clear. There is no resource to check — an attack costs nothing.
   */
  castCancelCheck(): boolean {
    const owner = this.owner as AttackableUnit | undefined;
    return this.disabled || !owner || owner.isDead || !owner.canAttack;
  }

  /**
   * The swing timer, live, so the HUD shows the real thing. `coolDown` is the
   * interval derived from `stats.attackSpeed` and `currentCooldown` is the
   * countdown the controller is actually running, which means an attack speed
   * buff shortens the wedge on the icon the same frame it shortens the swing.
   * Faking a static number here would have drifted from the timer immediately.
   */
  onUpdate(): void {
    const controller = this.controller;
    if (controller) this.coolDown = controller.intervalMs;
  }

  get currentCooldown(): number {
    return this.controller?.cooldownMs ?? 0;
  }

  /**
   * Ignored on purpose. The swing timer belongs to the controller, and a spell
   * level reset (`Spell.resetCoolDown`, which every refused cast runs) must not
   * hand back a swing.
   */
  set currentCooldown(_remainingMs: number) {}

  /** A swing rhythm, not a wait. See `Spell.cooldownLocksOut`. */
  get cooldownLocksOut(): boolean {
    return false;
  }

  onSpellCast(context: CastContext): void {
    const target = this.acquire(context.cursorWorld);
    if (target) this.order(target);
    else this.attackMove(context.cursorWorld);
  }

  /**
   * Empty ground is an order too — the source game's attack-move. The champion
   * walks to the point, sweeping as it goes, and opens fire on the first
   * visible enemy the sweep meets; see `BasicAttackController.orderAttackMove`.
   * A press into open ground used to be a silent no-op, which read as the key
   * failing exactly when the player asked for aggression.
   */
  protected attackMove(cursor: Vec2): void {
    this.controller?.orderAttackMove(cursor.x, cursor.y);
  }

  /**
   * The enemy this press picked, or null for "nothing there" — attack-move.
   *
   * Two passes, in this order, and the order is the whole design: whatever the
   * player is pointing at wins, and only when they are pointing at empty ground
   * does the champion pick for itself. Aim is never overruled — it is only
   * answered when there was none.
   */
  protected acquire(cursor: Vec2): AttackableUnit | null {
    const owner = this.owner as AttackableUnit | undefined;
    if (!owner) return null;
    const aimed = findAttackTargetNearPoint(owner, cursor, this.acquisitionRadius);
    if (aimed) return aimed;
    return findAttackTargetNearPoint(owner, owner.position, this.fallbackRadius);
  }

  /** Hands the target to the champion, which owns the standing order. */
  protected order(target: AttackableUnit): void {
    this.controller?.order(target);
  }

  /** Undefined for the ownerless instances the spell picker builds. */
  protected get controller(): BasicAttackController | undefined {
    return (this.owner as { basicAttack?: BasicAttackController } | undefined)?.basicAttack;
  }

  /** Hovering the slot shows the champion's reach, not a fixed number. */
  drawPreview(): void {
    const owner = this.owner as AttackableUnit | undefined;
    if (!owner?.position) return;
    push();
    noFill();
    stroke(255, 220, 160, 120);
    strokeWeight(2);
    circle(
      owner.position.x,
      owner.position.y,
      (owner.stats.attackRange.value + owner.stats.size.value / 2) * 2
    );
    pop();
  }
}

const BASIC_ATTACK_CAST_SPEC: Readonly<CastSpec> = Object.freeze({
  activation: 'PRESS',
  // POINT rather than UNIT: the target is picked by proximity to the cursor
  // inside a radius, which is not the "cursor is touching the body" test
  // TargetResolver applies, and it has to respect the fog of war on top.
  targeting: 'POINT',
  castTimeMs: 0,
  resource: Object.freeze({ commitAt: 'start', refundOn: [] }),
  cooldown: Object.freeze({ startAt: 'start', durationMs: 0 }),
  // The one spell that must not clear the standing attack order when it is
  // cast, because casting it *is* the order. Everything else drops it — see
  // `Spell.press` and the table in docs/ADDING_SPELLS.md.
  attackOrder: 'keep',
} as CastSpec);
