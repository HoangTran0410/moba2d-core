import { uuidv4 } from '@/utils/index';
import { effectiveRange } from '@/game/combat/Reach';
import EventType from '@/game/enums/EventType';
import SpellState from '@/game/enums/SpellState';
import { SpellRuntime, type SpellRuntimeDelegate } from '@/game/spell/runtime/SpellRuntime';
import SpellVfx from '@/game/vfx/SpellVfx';
import {
  interruptsSuspended,
  isInterruptibleState,
  ownerInterruptReason,
  snapshotOwnerMovement,
  type OwnerMovementSnapshot,
} from '@/game/spell/runtime/CancelPolicy';
import type { TargetingRequest } from '@/game/spell/targeting/TargetResolver';
import { beginAttribution, endAttribution } from '@/game/combat/DamageAttribution';
import { isNetClient } from '@/game/net/netRole';
import type {
  CancelReason,
  CastContext,
  CastSpec,
  ResourceCommitPoint,
  SpellRuntimeState,
  TargetingMode,
  Vec2,
} from '@/game/spell/runtime/types';

/** Where a spell fires when neither the aim nor the caster points anywhere. */
const DEFAULT_FACING: Vec2 = Object.freeze({ x: 1, y: 0 });

const legacyCastSpec = (durationMs: number, targeting: TargetingMode): CastSpec => ({
  activation: 'PRESS',
  targeting,
  castTimeMs: 0,
  resource: { commitAt: 'start', refundOn: [] },
  cooldown: { startAt: 'start', durationMs },
});

const snapshotContext = (context: CastContext): CastContext =>
  Object.freeze({
    ...context,
    origin: Object.freeze({ ...context.origin }),
    cursorWorld: Object.freeze({ ...context.cursorWorld }),
    direction: Object.freeze({ ...context.direction }),
  });

export default class Spell {
  // for display in HUD
  name = this.constructor.name;
  image: any = null;
  description: any = null;
  disabled = false;
  willDrawPreview = false;

  // for spell logic
  level = 0;
  coolDown = 0;
  manaCost = 0;
  healthCost = 0;

  /**
   * Whether a completed cast of this spell counts as *using an ability* — the
   * question a spellblade-style effect ("your next attack after casting a
   * spell…") asks of the `ON_POST_CAST_SPELL` event it hears.
   *
   * True for every ordinary kit spell, which is why the default is here and
   * not on each of them. Core switches it off for the casts that merely ride
   * the spell machinery without being abilities: the basic attack
   * (`coreSpells/BasicAttack` — every attack order would otherwise arm the
   * empowerment it is supposed to consume), Hồi Thành (`preset.ts`), and a
   * held item's own passive and active (`ItemShop.buildHeldItem` — an item
   * passive is *pressed* once per life to arm it, and an item triggering
   * itself is not what anyone means by "after casting a spell").
   */
  countsAsAbilityCast = true;

  /**
   * Whether damage this ability deals is amplified by the caster's
   * `Stats.abilityPower`. True for every kit ability, which is the whole point
   * — 308 abilities across the installed packs scale off a build without one
   * of them being edited.
   *
   * **A separate flag from `countsAsAbilityCast` above, and not an oversight.**
   * That one answers "did the player just use an ability", which is a question
   * about the *cast*; this one answers "is this ability damage", which is a
   * question about the *hit*. They disagree in both directions and the cases
   * are real: a champion's own passive is not a cast (`Champion.armPassives`
   * switches it off) but the damage it deals is unmistakably ability damage,
   * while Hồi Thành is switched off in both and deals no damage at all.
   * Folding them together would have quietly excluded every passive in the
   * game from scaling, with nothing to look at.
   *
   * Core switches it off in two places: `coreSpells/BasicAttack`, whose damage
   * is a swing and already scales on `attackDamage`, and `economy/ItemShop`,
   * because an item's own abilities scale on the wearer's attack damage and
   * must not draw from both stats at once.
   */
  damageScalesWithAbilityPower = true;

  /**
   * What this ability *does*, for the bot brain — see `src/game/ai/SpellRole.ts`.
   * Optional on purpose: an untagged spell is classified from its `castSpec`,
   * so tagging is an improvement a champion can opt into, never a gate on
   * shipping one.
   */
  static aiRoles?: number;

  /**
   * Pixels per frame this ability's projectile travels, for aim prediction.
   * Defaults to `MissileSpellObject`'s own 7 when absent.
   */
  static aiProjectileSpeed?: number;

  id: string = uuidv4();
  owner: any;
  game: any;
  private spellRuntime?: SpellRuntime;
  private resolvedSpec?: CastSpec;
  private spellVfx?: SpellVfx;
  private _castContext?: CastContext;
  private ownerSnapshot?: OwnerMovementSnapshot;

  constructor(owner: any) {
    this.owner = owner;
    this.game = owner?.game;
  }

  /** @deprecated New and migrated spells must use lifecycle policies. */
  get state(): SpellRuntimeState {
    return this.runtime.state;
  }

  set state(state: SpellRuntimeState) {
    this.runtime.setCompatibilityState(state);
  }

  /** @deprecated New and migrated spells must use lifecycle policies. */
  get currentCooldown(): number {
    return this.runtime.cooldownRemainingMs;
  }

  set currentCooldown(remainingMs: number) {
    this.runtime.setCompatibilityCooldown(remainingMs);
  }

  /**
   * Whether this ability is running right now — a toggle that is on, an active
   * window open, a channel under way. See `SpellRuntime.isSustaining` for why
   * it is not called `isActive` and why a windup does not count.
   *
   * Read by the HUD, which had no way to ask before: a toggle drew exactly the
   * same icon on and off, and the only ability state a player could see was
   * the cooldown wedge.
   */
  get isSustaining(): boolean {
    return this.runtime.isSustaining;
  }

  /** How long that sustain lasts, or 0 when it has no declared end. */
  get sustainDurationMs(): number {
    return this.runtime.sustainDurationMs;
  }

  /** Milliseconds left of it; 0 both when nothing runs and when it is open-ended. */
  get sustainRemainingMs(): number {
    return this.runtime.sustainRemainingMs;
  }

  /**
   * Pressing the key again turns it off, rather than doing something new.
   *
   * The HUD needs the distinction that `isSustaining` alone does not carry: a
   * bounded active window ends on its own and wants a countdown, while a
   * toggle wants a plain on/off badge and the promise that the same key is the
   * way out.
   */
  get isToggle(): boolean {
    return this.castSpec.activation === 'TOGGLE';
  }

  get castContext(): CastContext | undefined {
    return this._castContext;
  }

  /**
   * A counter this spell accumulates across casts, e.g. a stacking spell's strikes. The
   * HUD badges the icon with it, so a stacking spell shows its progress instead
   * of only flashing a number at the moment it lands. `undefined` means the
   * spell has nothing to count and gets no badge.
   */
  get stackCount(): number | undefined {
    return undefined;
  }

  /**
   * Set this spell's accumulated stacks. Absolute rather than incremental so
   * one method covers both "give me 100" and "back to zero"; symmetric with
   * `stackCount`, which is the read side.
   *
   * Default: this spell has none, so the call is refused rather than silently
   * doing nothing. Returns whether the spell accepted it.
   */
  setStackCount(_count: number): boolean {
    return false;
  }

  get aimPoint(): p5.Vector {
    if (this.spellRuntime?.state === 'CHARGING') {
      const liveAim = this.game?.worldMouse;
      // The live cursor is the *player's* charge preview, and only theirs —
      // the same owner check `onChargeUpdate` and `onRelease` below already
      // make, which this branch was missing. A bot charging a HOLD_RELEASE
      // spell read the human's pointer, which on a phone is wherever the thumb
      // rests. Read after `liveAim` so a context without a player never has to
      // answer for one. Below this, `_castContext.cursorWorld` comes first, so
      // a bot on the `BotBrain.cast` path never reaches the cursor at all.
      if (liveAim && this.owner === this.game.player) {
        return createVector(liveAim.x, liveAim.y);
      }
    }
    const aim = this._castContext?.cursorWorld ?? this.game?.worldMouse;
    return createVector(aim ? aim.x : 0, aim ? aim.y : 0);
  }

  /**
   * Runs `body` with this spell as the attribution for any damage inside it
   * that does not name a source, and for any `SpellObject` it constructs.
   *
   * Applied at the four places core hands control to the runtime — `update`,
   * `press`, `hold`, `release` — rather than at each of the seven delegate
   * callbacks below, because every one of those fires synchronously inside one
   * of these four. Four brackets that cannot miss a path beat seven that can.
   *
   * See `combat/DamageAttribution.ts`, including why this saves and restores
   * instead of assigning.
   */
  private attributed<T>(body: () => T): T {
    const previous = beginAttribution(this);
    try {
      return body();
    } finally {
      endAttribution(previous);
    }
  }

  update(): void {
    this.onUpdate();
    this.observeInterrupts();
    this.attributed(() => this.runtime.update(deltaTime));
    if (this.owner.isDead) {
      this.spellVfx?.dispose();
      return;
    }
    this.syncVfxPhase();
    this.spellVfx?.update(deltaTime);
  }

  drawVfx(): void {
    this.spellVfx?.draw();
  }

  /**
   * Whether this spell may be pressed while its caster is crowd-controlled.
   *
   * **False for every ability, and that is not negotiable for them.** Every
   * gate below reads `owner.canCast`, which `Stats.updateActionState` clears
   * for Stunned, Silenced, Charmed, Feared, Taunted and Suppressed — a stun
   * that did not stop casting would not be a stun.
   *
   * It exists for the one shape that is the exact opposite: an effect whose
   * *purpose* is getting out of crowd control. A Quicksilver-style cleanse
   * that refuses while you are stunned is an item that does nothing on the
   * only occasion anybody buys it, and there is no way for a pack to express
   * that without core saying it may.
   *
   * It buys past crowd control **and nothing else** — death, cooldown, mana,
   * health cost and `checkCastCondition` all still apply. This is not "this
   * spell ignores the rules"; it is one rule, named, that a spell can decline.
   */
  castableWhileControlled = false;

  /**
   * The caster can act, or this spell is one of the few allowed to act anyway.
   * See `castableWhileControlled`.
   */
  protected get casterMayCast(): boolean {
    return this.owner.canCast || this.castableWhileControlled;
  }

  /**
   * Off cooldown, paid for, and nothing about the caster in the way — "press
   * this key right now and something happens".
   *
   * The same gate `castCancelCheck` applies, minus two things it does that a
   * read-only question must not: it calls `resetCoolDown()`, and it calls
   * `checkCastCondition()`, which for the auto-locking spells means a fresh
   * quadtree scan. Callers that ask every frame (`ExecuteMarks`) do their own
   * scan anyway and would otherwise pay for two.
   */
  get isCastableNow(): boolean {
    return (
      !this.disabled &&
      this.state === SpellState.READY &&
      !!this.owner &&
      !this.owner.isDead &&
      this.casterMayCast &&
      this.canAffordMana(this.manaCost) &&
      this.owner.stats.health.value >= this.healthCost
    );
  }

  cast(): void {
    if (this.state !== SpellState.READY) return;

    const origin = { x: this.owner.position.x, y: this.owner.position.y };
    const cursorWorld = {
      x: this.game.worldMouse.x,
      y: this.game.worldMouse.y,
    };
    const dx = cursorWorld.x - origin.x;
    const dy = cursorWorld.y - origin.y;
    const length = Math.hypot(dx, dy);
    this.press(
      Object.freeze({
        spellId: this.id,
        activationId: uuidv4(),
        startedAtMs: Date.now(),
        caster: this.owner,
        origin: Object.freeze(origin),
        cursorWorld: Object.freeze(cursorWorld),
        direction: Object.freeze({
          x: length === 0 ? 0 : dx / length,
          y: length === 0 ? 0 : dy / length,
        }),
      })
    );
  }

  press(context: CastContext): boolean {
    this._castContext = snapshotContext(context);
    this.game.eventManager.emit(EventType.ON_PRE_CAST_SPELL, this);
    const accepted = this.attributed(() => this.runtime.press(this._castContext!));
    if (accepted) {
      this.snapshotOwner();
      // Casting is the third way to cancel a standing attack order, beside a
      // move order and crowd control: committing to an ability is a decision to
      // stop chasing.
      //
      // Here rather than on ON_PRE_CAST_SPELL because that event fires before
      // the runtime has ruled on the cast, so a listener cannot tell a real cast
      // from a key pressed into a cooldown. That distinction is not cosmetic:
      // an AI champion attempts a cast several times a second and is refused
      // almost every time, so cancelling on the attempt would leave the bots
      // unable to hold an attack order at all. `accepted` is the cast.
      if (this.activeCastSpec.attackOrder !== 'keep') this.owner?.basicAttack?.clear();
    }
    this.syncVfxPhase();
    return accepted;
  }

  /**
   * Whether this spell's countdown is a lockout — a wait before the ability can
   * be used at all — or a rhythm the ability keeps on its own.
   *
   * Every real cooldown is a lockout, and the HUD says so loudly: it greys the
   * icon and stamps the seconds left over it. The basic attack's countdown is
   * its swing interval, which is running whenever the champion is fighting, so
   * the loud treatment would leave that slot greyed out and covered in a
   * flickering "2" for the whole game. It gets the sweeping wedge and nothing
   * else, which is the part that actually reads as a rhythm.
   */
  get cooldownLocksOut(): boolean {
    return true;
  }

  hold(context: CastContext): boolean {
    return this.attributed(() => this.runtime.hold(context));
  }

  release(context: CastContext): boolean {
    this._castContext = snapshotContext(context);
    const released = this.attributed(() => this.runtime.release(this._castContext!));
    this.syncVfxPhase();
    return released;
  }

  cancel(reason: CancelReason): boolean {
    return this.runtime.cancel(reason);
  }

  castCancelCheck(): boolean {
    if (
      this.disabled ||
      this.owner.isDead ||
      !this.casterMayCast ||
      !this.canAffordMana(this.manaCost) ||
      this.owner.stats.health.value < this.healthCost ||
      !this.checkCastCondition()
    ) {
      this.resetCoolDown();
      return true;
    }

    return false;
  }

  deactivate(): void {
    this.runtime.cancel('SCENE_EXIT');
    this.resetCoolDown();
    this.spellVfx?.dispose();
  }

  /**
   * The spell is leaving its owner for good — an item sold, a kit swapped.
   *
   * Any permanent buff that declared this spell as its `sourceSpell` goes
   * with it. That is the other half of the item-passive contract: the passive
   * hangs a duration-0 buff once per life (`Champion.armPassives`), and
   * without this sweep the buff outlived the sale — a sold Giáp Gai kept
   * reflecting for the rest of the match. Over a copy, because
   * `deactivateBuff` calls out to listeners that must not mutate the list
   * under the walk.
   */
  onRemoved(): void {
    this.runtime.cancel('SCENE_EXIT');
    this.spellVfx?.dispose();
    for (const buff of [...(this.owner?.buffs ?? [])]) {
      if (buff.sourceSpell === this) buff.deactivateBuff();
    }
  }

  resetCoolDown(): void {
    this.currentCooldown = 0;
  }

  /**
   * The unit vector to fire along; never (0,0).
   *
   * Both context builders — `cast()` above and `TargetResolver.createContext`
   * — resolve an aim that landed exactly on the caster to a zero direction,
   * and every consumer then multiplies it by a range and gets nothing. It is
   * not a rare case: `AIChampion.aimPoint` falls back to `destination` when
   * there is no cursor, and a bot with `_autoMove` off leaves that parked on
   * its own feet, so it aims every spell into the ground under it. Measured on
   * a live beam ability: a beam whose start and end were the same coordinate, which
   * paints nothing and hit-tests as a dot at the caster's feet.
   *
   * The fallback is the caster's own heading and then a fixed vector, which is
   * the rule `Game.facing()` already states for the touch layer, in the same
   * words: never (0,0).
   */
  protected firingDirection(context: CastContext): Vec2 {
    const aim = context.direction;
    if (aim.x !== 0 || aim.y !== 0) return aim;

    const dx = (this.owner?.destination?.x ?? 0) - (this.owner?.position?.x ?? 0);
    const dy = (this.owner?.destination?.y ?? 0) - (this.owner?.position?.y ?? 0);
    const length = Math.hypot(dx, dy);
    if (length > 0.01) return { x: dx / length, y: dy / length };
    return DEFAULT_FACING;
  }

  // for override
  checkCastCondition(): boolean {
    return true;
  }

  onSpellCast(_context: CastContext): void {}
  onUpdate(): void {}
  onCastStart(_context: CastContext): void {}
  onChargeUpdate(_context: CastContext, _elapsedMs: number, _ratio: number): void {}
  onRelease(_context: CastContext): void {}
  onChannelTick(_context: CastContext, _tickIndex: number): void {}
  onActivate(_context: CastContext): void {}
  onRecast(_context: CastContext): void {}
  onCancel(_context: CastContext, _reason: CancelReason): void {}
  onComplete(_context: CastContext): void {}

  /**
   * How a thumb (or the mouse) aims this spell — see `docs/ADDING_SPELLS.md`.
   * Only read by the default `castSpec` below; a spell that overrides
   * `castSpec` itself (the typed-lifecycle spells) puts `targeting` straight
   * into its own spec and this field is never consulted for it.
   *
   * There used to be no such field: the default `castSpec` simply hardcoded
   * `targeting: 'DIRECTION'`, silently, for every one of the ~69 spells that
   * had not been migrated onto their own `castSpec`. DIRECTION is the one
   * mode that discards a drag's distance, so on touch every one of those
   * spells flew to its absolute maximum range no matter where the thumb let
   * go — including placed effects like a ground-mark ability, which should have stopped
   * wherever it was aimed. `castSpec` now throws instead of guessing, so a
   * legacy spell subclass must set this explicitly to what it actually does.
   * The `targeting-mode-declared` seam (`npm run check-seams`) fails the build for any
   * spell file that doesn't (mirrors `tests/game/buffs/Ground.test.ts`, which
   * does the same for `owner.teleportTo`).
   */
  protected targetingMode?: TargetingMode;

  get castSpec(): Readonly<CastSpec> {
    if (!this.targetingMode) {
      throw new Error(
        `${this.constructor.name} has no targeting mode. Set \`targetingMode\` to 'SELF' | ` +
          "'DIRECTION' | 'POINT' | 'UNIT', or override `castSpec` yourself — see docs/ADDING_SPELLS.md."
      );
    }
    return legacyCastSpec(this.coolDown, this.targetingMode);
  }

  /**
   * The spec the runtime was actually built from. `castSpec` is a getter that
   * rebuilds its object on every read, so anything that must agree with the
   * live runtime — the interrupt form, the attack-order rule — has to read the
   * copy the runtime kept rather than a fresh one.
   */
  protected get activeCastSpec(): Readonly<CastSpec> {
    void this.runtime;
    return this.resolvedSpec as CastSpec;
  }

  /**
   * The one expression in the codebase that reads the match's cooldown rule.
   * Read through `reducedCooldown` every time a countdown starts, never cached:
   * `MatchDirector.seedRules` mutates this same object mid-match so a slider
   * drag reaches spells that already exist, and anything holding a copy of the
   * multiplier would keep the rule the match was booted with.
   */
  private get cooldownMultiplier(): number {
    const rule = this.game?.matchRules?.cooldownMultiplier ?? 1;
    // **Only real ability casts.** `countsAsAbilityCast` is already the flag
    // that means "the player used an ability" rather than "a spell object ran",
    // which is exactly the question a cooldown-reduction stat is asking, so it
    // is reused here rather than a second flag being invented beside it. It
    // keeps the three casts that merely ride the spell machinery out: the basic
    // attack, whose rhythm is `stats.attackSpeed` and whose timer belongs to
    // its controller; Hồi Thành, which is a fixed channel and not an ability;
    // and a held item's own passive and active, so one purchase cannot shorten
    // another's.
    //
    // Note this is the opposite reuse decision from
    // `damageScalesWithAbilityPower`, which needed a flag of its own — and for
    // the reason given there: that one is a question about a *hit*, and this one
    // is a question about a *cast*, which is what `countsAsAbilityCast` has
    // always answered.
    if (!this.countsAsAbilityCast) return rule;
    const reduction = this.owner?.stats?.cooldownReduction?.value;
    if (!Number.isFinite(reduction) || reduction <= 0) return rule;
    // `Stats.cooldownReduction` is capped at `MAX_COOLDOWN_REDUCTION` and
    // floored at 0, so this cannot reach a zero or negative duration; the guard
    // above is for a hand-built stat block in a pack's own tests.
    return rule * Math.max(0, 1 - (reduction as number));
  }

  /**
   * Cooldown reduction's seam — the only place a match-wide rule turns a
   * spell's tuning number into the number that actually gets counted down.
   *
   * Both ways a cooldown can start pass through it:
   *
   * - The runtime's. Whether the duration comes from the base `castSpec`
   *   (`legacyCastSpec(this.coolDown)`) or from a spell's own `get castSpec()`
   *   override — which invariably still writes `durationMs: this.coolDown` —
   *   `SpellRuntime` asks for it through the `cooldownDurationMs` delegate hook
   *   at the moment the countdown starts. It has to be asked *then* rather than
   *   folded into the spec: the runtime resolves its spec exactly once, on the
   *   first cast, so a multiplier baked in there is the multiplier that spell
   *   would keep for the rest of the match. The HUD reads `effectiveCoolDownMs`
   *   fresh every frame, so that bug showed as a ring counting down a duration
   *   the spell no longer used, curable only by picking a different spell —
   *   which builds a new instance.
   * - A spell's own, for the ones that set a cooldown mid-cast rather than
   *   letting the runtime start it: a recast phase ending (a second-cast kick,
   *   a shadow-swap ability's own
   *   swap, a delayed detonation), a hit-shortened cooldown (a spell that
   *   refunds on a landed hit), a
   *   partial refund (a channel's early cancel, a charge ability's cancel). Those write
   *   `this.currentCooldown = this.reducedCooldown(<tuning number>)`, which is
   *   the same call by hand.
   *
   * It cannot instead be a `coolDown` getter/setter pair on this class: about
   * a third of spells declare `coolDown = SOME_CONSTANT;` as a class field in
   * their own subclass body, and native class fields use *define* semantics —
   * that assignment creates its own own-property on the instance and quietly
   * shadows any accessor `Spell` declares under the same name, so a parent
   * getter would simply never run for them. Taking the duration as an argument
   * sidesteps that trap entirely.
   *
   * Not every mid-cast countdown is a cooldown: a recast window ("you have N
   * ms to press the key again") is a fixed input window and must stay raw, or
   * cooldown reduction would silently shorten the player's reaction time.
   * `tests/game/spells/MatchRules.test.ts` audits which is which.
   */
  protected reducedCooldown(durationMs: number): number {
    return durationMs * this.cooldownMultiplier;
  }

  /**
   * The cooldown this spell will actually run, after match rules (cooldown
   * reduction) are applied. `coolDown` stays the spell's own tuning number —
   * retuning it is still "edit the constant", not "edit a formula" — so
   * anything that displays a cooldown to the player (a HUD ring, a tooltip)
   * should read this instead.
   */
  get effectiveCoolDownMs(): number {
    return this.reducedCooldown(this.castSpec.cooldown.durationMs);
  }

  /**
   * What any mana amount actually costs, after match rules (URF: `manaFree`).
   * The single expression of that rule in the codebase — `effectiveManaCost`
   * below and `spendMana` further down are both this function, so URF stays a
   * single flip rather than a per-spell edit.
   *
   * Takes an amount rather than reading `manaCost` because a spell's own cost
   * is not the only mana it charges: an upkeep tick (a channel that drains over
   * time) or a half
   * refund (three of this pack's charge-cancel spells) has to run through the same rule,
   * and before this existed the upkeep quietly did not.
   */
  effectiveMana(amount: number): number {
    // A LAN client's mana is snapshot truth, and its casts are replayed
    // visuals of decisions the host already priced — so on a net client every
    // cost is 0, exactly the way URF's manaFree works and through the same
    // single expression of the rule. Without this a puppet's cast event
    // would be refused whenever the 15Hz mana snapshot lags the host's spend.
    if (isNetClient()) return 0;
    return this.game?.matchRules?.manaFree ? 0 : amount;
  }

  /**
   * The mana this spell actually charges for one cast, after match rules.
   * `manaCost` stays the spell's own tuning number; every consumption/refund
   * path below reads through here instead.
   *
   * Three spells in this pack deduct a second,
   * cancel-triggered half-refund of their own mana cost outside this base
   * class's commit/refund path; they read this getter directly rather than
   * `manaCost` for the same reason.
   */
  get effectiveManaCost(): number {
    return this.effectiveMana(this.manaCost);
  }

  /**
   * Whether the caster can pay `amount` mana, priced by the rules in force.
   * Under URF everything is affordable, including on an empty pool — a channel
   * that costs nothing must not end for lack of what it is not spending.
   */
  protected canAffordMana(amount: number): boolean {
    return this.owner.stats.mana.value >= this.effectiveMana(amount);
  }

  /**
   * Bill the caster `amount` mana. The only sanctioned way for a spell to
   * spend mana outside the base class's own commit path, and the reason
   * `tests/game/spells/mana-spend-seam.test.ts` can forbid spell files from
   * touching a mana stat at all: check and deduction are one call, both priced
   * through `effectiveMana`, so neither half can be written without the rule.
   * Returns false — having spent nothing — when the pool is short.
   *
   * A sibling of `changeResource` rather than a change to it: that one is the
   * raw writer, shared with health (which URF does not touch) and with the
   * refund direction, and its three existing callers hand it an amount they
   * have already priced. Folding the rule in there would apply it twice on one
   * path and wrongly on another.
   */
  protected spendMana(amount: number): boolean {
    if (!this.canAffordMana(amount)) return false;
    this.changeResource(this.owner.stats.mana, -this.effectiveMana(amount));
    return true;
  }

  get targetingRequest(): Readonly<TargetingRequest> {
    return {};
  }

  protected playImpactVfx(context: CastContext): void {
    this.spellVfx?.impact(context);
  }

  /**
   * Moves the caster instantly — a blink, a shadow swap, anything that teleports.
   *
   * The single place a champion may relocate itself, so grounding is enforced
   * once here instead of in each spell. Self-propelled dashes get the same rule
   * inside the Dash buff; between the two, a spell has to opt into neither and
   * a new one cannot forget. `tests/game/buffs/Ground.test.ts` fails the build
   * if a spell reaches for `owner.teleportTo` directly and bypasses this.
   *
   * Returns false when the blink was refused, so a recast can tell.
   */
  protected blinkOwnerTo(x: number, y: number): boolean {
    if (this.owner.grounded) return false;
    this.owner.teleportTo(x, y);
    return true;
  }

  private get runtime(): SpellRuntime {
    if (!this.spellRuntime) {
      const spec = this.castSpec as CastSpec;
      this.resolvedSpec = spec;
      this.spellVfx = new SpellVfx(spec.vfx, spec.sfx);
      const delegate: SpellRuntimeDelegate = {
        canStart: context => this.canStart(context),
        commitResource: (context, point) => this.commitResource(context, point),
        refundResource: (context, reason) => this.refundResource(context, reason),
        onCastStart: context => {
          this.spellVfx?.castStart(context);
          this.onCastStart(context);
        },
        onChargeUpdate: (context, elapsedMs, ratio) => {
          let liveContext = context;
          if (
            this.activeCastSpec.activation === 'HOLD_RELEASE' &&
            this.game?.worldMouse &&
            this.owner === this.game.player
          ) {
            const dx = this.game.worldMouse.x - this.owner.position.x;
            const dy = this.game.worldMouse.y - this.owner.position.y;
            const dist = Math.hypot(dx, dy) || 1;
            liveContext = {
              ...context,
              cursorWorld: { x: this.game.worldMouse.x, y: this.game.worldMouse.y },
              direction: { x: dx / dist, y: dy / dist },
            };
          }
          this.onChargeUpdate(liveContext, elapsedMs, ratio);
        },
        onRelease: context => {
          let liveContext = context;
          if (
            this.activeCastSpec.activation === 'HOLD_RELEASE' &&
            this.game?.worldMouse &&
            this.owner === this.game.player
          ) {
            const dx = this.game.worldMouse.x - this.owner.position.x;
            const dy = this.game.worldMouse.y - this.owner.position.y;
            const dist = Math.hypot(dx, dy) || 1;
            liveContext = {
              ...context,
              cursorWorld: { x: this.game.worldMouse.x, y: this.game.worldMouse.y },
              direction: { x: dx / dist, y: dy / dist },
            };
          }
          this.spellVfx?.release(liveContext);
          this.onRelease(liveContext);
          this.onSpellCast(liveContext);
          this.game.eventManager.emit(EventType.ON_POST_CAST_SPELL, this);
        },
        onChannelTick: (context, tickIndex) => this.onChannelTick(context, tickIndex),
        onActivate: context => {
          this.spellVfx?.activate(context);
          this.onActivate(context);
        },
        onRecast: context => this.onRecast(context),
        onCancel: (context, reason) => {
          this.spellVfx?.cancel(context);
          this.onCancel(context, reason);
        },
        onComplete: context => {
          this.spellVfx?.complete();
          this.onComplete(context);
        },
        cooldownDurationMs: durationMs => this.reducedCooldown(durationMs),
      };
      this.spellRuntime = new SpellRuntime(spec, delegate);
    }
    return this.spellRuntime;
  }

  private canStart(_context: CastContext): boolean {
    return !this.castCancelCheck();
  }

  private commitResource(_context: CastContext, _point: ResourceCommitPoint): boolean {
    // Not `spendMana` + a health check: the two resources commit atomically,
    // so both have to clear before either moves.
    if (!this.canAffordMana(this.manaCost) || this.owner.stats.health.value < this.healthCost) {
      return false;
    }
    this.changeResource(this.owner.stats.mana, -this.effectiveManaCost);
    this.changeResource(this.owner.stats.health, -this.healthCost);
    return true;
  }

  private refundResource(_context: CastContext, _reason: CancelReason): void {
    this.changeResource(this.owner.stats.mana, this.effectiveManaCost);
    this.changeResource(this.owner.stats.health, this.healthCost);
  }

  protected changeResource(
    resource: { value: number; baseValue?: number; current?: number },
    amount: number
  ): void {
    if (typeof resource.baseValue === 'number') resource.baseValue += amount;
    else if (typeof resource.current === 'number') resource.current += amount;
    else resource.value += amount;
  }

  /**
   * Watches the caster and hands the runtime whatever went wrong. Which of
   * those the spell actually dies of is the form's decision, made in
   * `SpellRuntime.canInterrupt` — see `CancelPolicy`.
   */
  private observeInterrupts(): void {
    if (!isInterruptibleState(this.runtime.state)) return;
    if (interruptsSuspended(this.owner, this.activeCastSpec.suspendedBy)) return;

    const reason = ownerInterruptReason(this.owner, this.ownerSnapshot);
    if (reason) this.runtime.cancel(reason);
  }

  private snapshotOwner(): void {
    this.ownerSnapshot = snapshotOwnerMovement(this.owner);
  }

  private syncVfxPhase(): void {
    if (this.runtime.state === 'CHANNELING' && this._castContext) {
      this.spellVfx?.channel(this._castContext);
    }
  }

  /**
   * The reach this spell declares, before any body-size correction.
   *
   * Public because the bot brain needs the same number `previewRadius` draws a
   * ring from, and `previewRadius` is `protected` *and* applies the `UNIT`
   * correction — which the brain must apply itself, per target, through
   * `Reach.effectiveRange`.
   */
  get declaredRange(): number | undefined {
    const declared =
      this.targetingRequest?.range ??
      (this as { range?: number }).range ??
      (this as { castRange?: number }).castRange;
    return typeof declared === 'number' && declared > 0 ? declared : undefined;
  }

  /**
   * The reach this spell should draw as its preview when nobody passes one.
   *
   * Same resolution order as `touchAimRange` in `src/game/input/SpellAim.ts`, on
   * purpose: the ring the mouse player reads and the telegraph the thumb player
   * drags must be the same number, or one of them is lying. The difference is the
   * fallback — the touch layer guesses `DEFAULT_TOUCH_AIM_RANGE` because a drag
   * has to go *somewhere*, while a preview that has nothing to state is better
   * off drawing nothing than drawing a confident 600px circle that is wrong.
   *
   * `UNIT` casts go through `TargetResolver`, which applies the body-size
   * correction from `Reach`; the ring has to take the same correction or it
   * shows a reach the cast will refuse. `POINT` and `DIRECTION` keep the authored
   * number — the far end of a point cast is ground, and ground has no body.
   */
  protected get previewRadius(): number | undefined {
    const declared = this.declaredRange;
    if (declared === undefined) return undefined;
    return this.castSpec.targeting === 'UNIT' ? effectiveRange(declared, this.owner) : declared;
  }

  /**
   * The range ring under the caster.
   *
   * Called with no argument from `Game.draw`, and it used to draw nothing at all
   * in that case — so every spell that did not override this (about seventy of
   * them, including eleven of the twelve abilities across three whole kits) gave
   * the player no way to know how far it reached short of casting it and
   * watching. Falling back to the declared reach makes the ring the default
   * rather than an opt-in.
   */
  drawPreview(radius?: number): void {
    const r = radius ?? this.previewRadius;
    if (!r) return;

    push();
    noFill();
    // a dark backing stroke so the ring survives being drawn over pale ground
    stroke(20, 25, 40, 120);
    strokeWeight(4);
    circle(this.owner.position.x, this.owner.position.y, r * 2);
    stroke(225, 235, 255, 150);
    strokeWeight(2);
    circle(this.owner.position.x, this.owner.position.y, r * 2);
    pop();
  }
}
