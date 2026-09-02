import GameObject from './GameObject';
import { currentAttribution, type DamageAttributable } from '@/game/combat/DamageAttribution';
import type Buff from './Buff';
import type AttackableUnit from './attackableUnits/AttackableUnit';
import type { GameObjectRuntimeContext } from './GameObject';
import type ParticleSystem from './helpers/ParticleSystem';

export default class SpellObject extends GameObject {
  declare game: GameObjectRuntimeContext;
  isMissile = false;
  owner: AttackableUnit;
  destination!: p5.Vector;

  /**
   * The spell this object belongs to, for damage it deals without naming one.
   *
   * Stamped from whatever was casting when this was constructed, which is the
   * object's own spell for the overwhelming majority of them — 34 of the dota
   * pack's 40 spells and 226 of the lol pack's 268 build their object inside
   * `onSpellCast`. A pack sets nothing and overrides nothing; see
   * `combat/DamageAttribution.ts` for why the link has to be made here rather
   * than passed down.
   *
   * `null` for an object built outside a cast — a child spawned by another
   * object's `update()` inherits that object's attribution instead, through
   * `ObjectManager.update()`'s own bracket, and one built from nowhere simply
   * falls back to the damage-type label the recap used before.
   */
  attributedTo: DamageAttributable | null = currentAttribution();

  /** The body this effect rides on, once `attachTo` has been called. */
  _anchorUnit: AttackableUnit | null = null;
  /** The instance in `_anchorUnit.buffs` this effect shadows, if it shadows one. */
  _anchorBuff: Buff | null = null;
  _anchorWatchesBuff = false;
  /** Latched the first time the anchor goes: losing it once is losing it for good. */
  _anchorReleased = false;

  constructor(owner: AttackableUnit) {
    super({
      game: owner.game,
      position: owner.position.copy(),
      teamId: owner.teamId,
    });
    this.owner = owner;
  }

  /**
   * Ties this object's life to the body it rides on. Effects that read a unit's
   * position every frame — a shell, a cloak, orbiting art, a tether, a mark —
   * belong to that body: left to their own clock they keep drawing on the
   * corpse and then jump to wherever the unit respawns.
   *
   * Pass the buff the effect shadows when there is one and the object also ends
   * with the buff. `addBuff` does not always keep the instance it was handed:
   * `RENEW_EXISTING` renews the buff already on the unit and drops the new one,
   * and a full stack pool evicts its oldest member. Only buffs sitting inside
   * `unit.buffs` get `update()` called, so a dropped instance never advances its
   * `timeElapsed` and never flips `toRemove` — shadowing it would wait forever.
   * Resolve whatever actually landed instead, and treat "nothing landed" (which
   * is what `addBuff` does on a corpse) as an attachment already over.
   *
   * Call it when the effect latches on, not before: a projectile still in
   * flight is cast into the world and is allowed to outlive its caster.
   */
  /**
   * An effect glued to a body is seen exactly when that body is.
   *
   * Reading `attachTo`'s own anchor rather than a second field: "which unit
   * does this ride" is a question this class already answers, and a separate
   * `visionAnchor` to set would be one more thing to forget on the effect
   * that most needs it.
   */
  override get visionAnchor(): AttackableUnit | null {
    return this._anchorUnit;
  }

  attachTo(unit: AttackableUnit, buff?: Buff | null): this {
    this._anchorUnit = unit;
    this._anchorWatchesBuff = buff !== undefined;
    this._anchorBuff = buff ? SpellObject.liveBuffOn(unit, buff) : null;
    this._anchorReleased = false;
    return this;
  }

  /** The instance the unit actually ticks, which is not always the one applied. */
  static liveBuffOn(unit: AttackableUnit, buff: Buff): Buff | null {
    if (unit.buffs.includes(buff)) return buff;
    return unit.buffs.find(candidate => candidate.stackId === buff.stackId) ?? null;
  }

  /**
   * True once the anchor is gone: dead, dropped from the world, or out of buff.
   *
   * The verdict latches, because death is not permanent here. A corpse revives
   * somewhere else on the map and `isDead` flips back to false, so an effect
   * that only asked "is my unit dead right now?" would reattach to the new body
   * and reappear at the spawn point. It also keeps this honest whatever the buff
   * layer does on death: whether a corpse drops its buffs immediately or lets
   * them keep ticking, an effect released once is never picked back up.
   */
  get attachmentLost(): boolean {
    if (this._anchorReleased) return true;
    const unit = this._anchorUnit;
    if (!unit) return false;
    const lost =
      unit.isDead ||
      unit.toRemove ||
      (this._anchorWatchesBuff && (!this._anchorBuff || this._anchorBuff.toRemove));
    if (lost) this._anchorReleased = true;
    return lost;
  }

  /**
   * Drops this object when its anchor is gone, and reports whether it did, so a
   * subclass can open its own `update()` with
   * `if (this.dropIfAttachmentLost()) return;` and skip the rest of the frame.
   */
  dropIfAttachmentLost(): boolean {
    if (!this.attachmentLost) return false;
    this.toRemove = true;
    return true;
  }

  /** Effects with no update of their own still honour their attachment. */
  update(): void {
    this.dropIfAttachmentLost();
  }

  /** Particle systems whose lifetime this effect has taken responsibility for. */
  _ownedParticles: ParticleSystem[] = [];

  /**
   * Registers a particle system for the whole of this effect's life, instead of
   * only for as long as it happens to hold particles.
   *
   * `ParticleSystem.autoRemoveIfEmpty` defaults to true and `update()` applies it
   * on the very first frame, which is right for a burst emitted at the moment of
   * spawn and wrong for every effect that emits *later*: a thrown pole's dust
   * on landing ~180ms in, a sweep's strike at
   * 200ms, a sphere's arming two seconds later. All of those deleted
   * their own system before reaching their emit point, so the impact they exist
   * for never appeared — silently, because nothing errors and the damage lands.
   *
   * Ownership is handed back in `onRemoved`, so whatever is still in the air when
   * the effect ends drains and then removes itself as normal.
   *
   *   particleSystem = PredefinedParticleSystems.smoke([150, 115, 65]);
   *   onAdded() { this.useParticles(this.particleSystem); }
   */
  useParticles<T extends ParticleSystem>(system: T): T {
    system.autoRemoveIfEmpty = false;
    this._ownedParticles.push(system);
    this.game.objectManager.addObject(system);
    return system;
  }

  onRemoved(): void {
    for (const system of this._ownedParticles) system.autoRemoveIfEmpty = true;
    this._ownedParticles.length = 0;
  }
}
