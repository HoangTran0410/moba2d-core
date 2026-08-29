import BuffAddType from '@/game/enums/BuffAddType';
import Buff from '@/game/gameObject/Buff';
import { amplifiedAbilityDamage } from '@/game/combat/Amplification';
import { abilityPowerScales } from '@/game/combat/DamageAttribution';
import CombatText from '@/game/gameObject/helpers/CombatText';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';

/**
 * Absorbs incoming damage until it runs out, then expires.
 *
 *   const shield = new Shield(3000, caster, target);
 *   shield.amount = 80;
 *   target.addBuff(shield);
 *
 * Several shields can sit on one unit; they are consumed in the order applied.
 */
export default class Shield extends Buff {
  name = 'Khiên';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 5;

  /** Damage this shield can still absorb. */
  amount = 50;
  color: [number, number, number] = [255, 205, 90];

  _initialAmount = 50;

  get shieldAmount(): number {
    return this.toRemove ? 0 : this.amount;
  }

  /**
   * Ability power lands here, not at the call site.
   *
   * A shield is the third funnel `Stats.abilityPower` was designed around and
   * the second one that was never wired up (see `AttackableUnit.takeHeal`).
   * An installed pack's shield ability is the case that reported it: its
   * description already promised `30 (+200)` — the HUD rescales a tagged
   * number by the reader's ability power — and the shield it actually applied
   * was thirty. The text was right about the design and the engine was the
   * half that had not been written.
   *
   * `onCreate` rather than the caster's own code because `addBuff` runs inside
   * the cast, so `abilityPowerScales()` is still answering for the spell that
   * is applying this — which means no pack sets `amount` differently from
   * how it already did, and a shield an *item* grants is not amplified, exactly as
   * an item's damage is not.
   *
   * Before `_initialAmount`, which is what the bar draws a fraction against: a
   * shield that started at 230 and reads as 30/30 full is a worse bug than the
   * one being fixed.
   */
  onCreate(): void {
    if (abilityPowerScales()) this.amount = amplifiedAbilityDamage(this.amount, this.sourceUnit);
    this._initialAmount = this.amount;
  }

  modifyIncomingDamage(damage: number, _attacker?: AttackableUnit): number {
    if (this.toRemove || this.amount <= 0) return damage;

    const absorbed = Math.min(this.amount, damage);
    this.amount -= absorbed;

    CombatText.show(this.targetUnit, 'shield', absorbed, this.color);

    if (this.amount <= 0) this.deactivateBuff();

    return damage - absorbed;
  }

  draw(): void {
    if (this.targetUnit.isDead) return;

    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;
    // the ring thins out as the shield is chipped away
    const remaining = this._initialAmount > 0 ? this.amount / this._initialAmount : 0;

    push();
    noFill();
    stroke(this.color[0], this.color[1], this.color[2], 80 + 140 * remaining);
    strokeWeight(2 + 3 * remaining);
    circle(pos.x, pos.y, size + 10);
    pop();
  }
}
