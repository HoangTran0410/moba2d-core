import BuffAddType from '@/game/enums/BuffAddType';
import type { AssetHandle } from '@/managers/AssetManager';
import type { GameObjectRuntimeContext } from './GameObject';
import type AttackableUnit from './attackableUnits/AttackableUnit';
import type { OnHitEvent } from '@/game/combat/OnHit';
import type Spell from './Spell';
import { currentAttribution } from '@/game/combat/DamageAttribution';

export type BuffConstructorArgs = [
  duration: number,
  sourceUnit: AttackableUnit,
  targetUnit: AttackableUnit,
];
export type BuffConstructor<TBuff extends Buff = Buff> = abstract new (
  ...args: BuffConstructorArgs
) => TBuff;
export type BuffStackId = string | BuffConstructor;

export default class Buff {
  name = this.constructor.name;

  /**
   * Whether damage this buff deals is amplified by its owner's
   * `Stats.abilityPower` — inherited, once, from whatever was running when the
   * buff was constructed.
   *
   * A buff is its own attribution while it ticks (`combat/DamageAttribution.ts`
   * brackets `update` and `onDamageTaken` with it, so a damage-over-time names
   * itself in the death recap). That is the right answer for the *name* and
   * the wrong one for the *scaling*: by the time it ticks, the cast that
   * applied it returned frames ago and there is nothing left to ask. Reading it
   * here — in a field initialiser, so it runs inside the applying spell's own
   * bracket — is what makes a poison an ability applied amplified and a poison
   * an item applied not, without either of them knowing the stat exists.
   */
  readonly damageScalesWithAbilityPower: boolean =
    currentAttribution()?.damageScalesWithAbilityPower === true;
  description: string | null = null;
  image: AssetHandle | null | undefined = null;

  /**
   * Whether this buff appears on the HUD's buff row and on the overhead strip
   * above the champion. The mechanic runs either way — this is display only.
   *
   * Default true. A permanent armed state — an item passive that is simply
   * always on while the item is held — sets false: the inventory slot already
   * shows the item, and six of them wallpaper both bars with icons whose
   * "remaining time" means nothing. A buff with a state worth glancing at
   * (a charge armed, a stack count climbing) stays visible.
   */
  hudVisible = true;

  buffAddType = BuffAddType.REPLACE_EXISTING;
  maxStacks = 1;

  /**
   * Identity used to decide which existing buffs this one stacks with or
   * replaces. Defaults to the class itself, which is what you want for a buff
   * that means one thing (Stun, Root).
   *
   * Set it when several unrelated spells apply the same generic buff class —
   * two bare `StatAmp`s or `DamageOverTime`s would otherwise fight over one
   * slot, so each spell should tag its own, e.g. `buff.stackId = 'ignite'`.
   */
  stackId: BuffStackId;
  timeElapsed = 0;
  toRemove = false;

  /**
   * When true, `AttackableUnit.drawBuffs()` calls `.draw()` on only the
   * *first* live buff sharing this instance's `stackId` each pass, and skips
   * every later one outright — a property read and a `Set` check, not a
   * function call.
   *
   * For a buff that paints its own visual per instance (a spinning icon over
   * the character, an aura ring), leave this `false` — the default, so every
   * existing buff draws exactly as before. Opt in when a *stack* is a data
   * count, not a drawable: a permanent growth stack is one buff instance per
   * kill (so `addBuff`'s grouping and a stat readout can count them), while
   * the ring it paints around its wearer already meant *one* stack's whole
   * drawn output. Before this flag, all of them still got their own `.draw()`
   * call — 999 calls a frame to paint one ring is a real, measured cost at
   * the stack counts a cheat can reach. The two buffs that opt in today are
   * both content, and both live in a pack rather than here; the cost, the
   * flag and the skip are the engine's
   * (`.superpowers/perf-healthbar-report.md`).
   */
  singleRepresentativeDraw = false;

  /**
   * When true, `AttackableUnit.addBuff()` increments `stacks` on the
   * existing live instance sharing this buff's `stackId` instead of pushing
   * a new one — one instance, a counter, rather than N instances carrying
   * identical bonuses.
   *
   * Correct only for a stack that is **permanent and uniform**: no per-stack
   * duration, no per-stack source, every stack worth exactly the same as
   * every other. A buff with a real per-stack expiry (a 10-stack Speedup
   * whose stacks were applied at different moments and must wear off at
   * different moments) needs the array — that is a list of expiry times
   * wearing a different name, and collapsing it into a counter would delete
   * information the model actually needs. Leave this `false` (the default)
   * for anything with a per-stack timer; opt in only where `duration` is a
   * single shared "how long since the last stack" clock, not N independent
   * ones. The two buffs that opt in today are both permanent stat stacks
   * shipped by a content pack — core defines the mechanism and names no
   * content, which is why this paragraph describes the shape rather than
   * pointing at two classes that are not in this repository's `src/`.
   */
  countedStacks = false;
  /**
   * How many stacks this instance is worth. 1 for an ordinary buff, and for
   * a single fresh application of a counted one — `addBuff()` adds a new
   * instance's `stacks` into the existing instance's `stacks` when
   * `countedStacks` is set, rather than treating the new instance as a
   * second drawable/timer. A `StatAmp` scales its modifier by this number
   * unconditionally (see `StatAmp.ts`), which is a no-op for every buff that
   * never touches it — it stays at the default of 1.
   */
  stacks = 1;

  statusFlagsToEnable = 0;
  statusFlagsToDisable = 0;

  duration = 0;
  sourceUnit: AttackableUnit;
  targetUnit: AttackableUnit;
  game: GameObjectRuntimeContext;

  /**
   * The spell whose *presence* this buff depends on, or null for the default —
   * a buff that stands on its own once applied (every timed effect).
   *
   * Set it on a permanent buff hung by something removable: an item passive's
   * on-hit or reflect, a kit passive's aura. `Spell.onRemoved` deactivates
   * every buff on its owner that names it here, which is what makes selling
   * the item (or swapping the kit) actually take the effect away — before
   * this existed, a sold Giáp Gai kept its spikes for the rest of the match.
   */
  sourceSpell: Spell | null = null;

  _deactivateListeners: (() => void)[] = [];
  _created = false;
  _deactivated = false;
  _activated = false;

  constructor(...[duration, sourceUnit, targetUnit]: BuffConstructorArgs) {
    this.stackId = new.target;
    this.duration = duration;
    this.sourceUnit = sourceUnit;
    this.targetUnit = targetUnit;
    this.game = targetUnit.game;
  }

  activateBuff(): void {
    if (!this._created) {
      this.onCreate();
      this._created = true;
    }
    if (this._activated) return;
    this.onActivate();
    this._activated = true;
  }

  deactivateBuff(): void {
    if (this._deactivated) return;
    this._deactivated = true;
    this.toRemove = true;
    this.onDeactivate();
    for (const listener of this._deactivateListeners) {
      listener?.();
    }
  }

  renewBuff(): void {
    if (this._deactivated) {
      this.onActivate(); // re-activate
      this._deactivated = false;
    }
    this.timeElapsed = 0;
    this.toRemove = false;
  }

  update(): void {
    this.onUpdate();

    this.timeElapsed += deltaTime;
    if (this.duration && this.timeElapsed >= this.duration) {
      this.deactivateBuff();
    }
  }

  // for override
  onCreate(): void {}
  onUpdate(): void {}
  onActivate(): void {}
  onDeactivate(): void {}
  draw(): void {}
  /**
   * `countedStacks` only: called on an already-active instance right after
   * `AttackableUnit.addBuff()` changes `stacks` on it (never on the first
   * stack, which goes through `onCreate`/`onActivate` instead, already
   * reading the starting `stacks` value). Override to rescale whatever the
   * stack count drives — `StatAmp` rebuilds and re-applies its modifier.
   */
  onStacksChanged(): void {}

  /**
   * Runs before damage reaches the target's health. Return what should get
   * through: less for shields and damage reduction, more for amplification.
   * Every buff on the unit sees the damage in turn.
   */
  modifyIncomingDamage(damage: number, _attacker?: AttackableUnit): number {
    return damage;
  }

  /**
   * Called once damage has been mitigated and applied, whatever the outcome —
   * including a hit a shield swallowed whole.
   *
   * `swung` is what arrived before anything ate it; `landed` is what actually
   * reached health. It cannot change either, and that is the point: a buff that
   * *reacts* to being hit (a thorns-style spike counter, a shield's own burn
   * effect) has no
   * business being a link in the mitigation chain, where the answer depends on
   * whether some other buff was added before or after it. Two shields on one
   * unit put a reflect behind them and it silently stopped firing.
   */
  onDamageTaken(_swung: number, _landed: number, _attacker?: AttackableUnit): void {}

  /**
   * Called once per basic attack the *owner of this buff* lands — the on-hit
   * seam, walked by `combat/OnHit.ts`'s `applyOnHitEffects` from
   * `landBasicAttack` after the swing's own damage has been applied.
   *
   * The effect deals its own damage (`hit.victim.takeDamage(..., 'MAGICAL')`),
   * heals, refunds — nothing is folded back into the swing, so each payload
   * carries its own damage type through mitigation. An effect that
   * *re-applies* on-hits (a phantom hit, a side bolt, a doubling) must mark
   * what it starts `echo: true` and refuse to act when `hit.echo` is already
   * true — see `OnHit.ts`'s header for why that pair of rules is what makes
   * every stack of propagators terminate.
   */
  onHit(_hit: OnHitEvent): void {}

  /**
   * Damage this buff can still absorb, drawn as a grey overlay on the health
   * bar. Anything that soaks damage should report it here so the player can see
   * how much cushion is left; the health bar never has to know the class.
   */
  get shieldAmount(): number {
    return 0;
  }

  addDeactivateListener(listener: () => void): void {
    this._deactivateListeners.push(listener);
  }
}
