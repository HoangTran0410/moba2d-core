import SpellObject from '@/game/gameObject/SpellObject';
import { cssColor } from '@/game/render/cssColor';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import type { DamageType } from '@/game/combat/Mitigation';
import { damageTextScale, hitFraction } from '@/game/render/hitFeedback';
import { stressTier } from '@/game/render/renderStress';

/** How long a floating number stays on screen once nothing is refreshing it. */
export const COMBAT_TEXT_LIFETIME_MS = 1000;

/**
 * And how long it stays on a machine that is drowning (`render/renderStress.ts`).
 *
 * This is the lever, and it is worth saying why it is *this* one. The obvious
 * idea is to merge harder — widen `HEADLINE_WINDOW_MS` so more hits fold into
 * one number. That saves nothing: a merge updates a number **already on the
 * board** (see `show` below), so it never changes how many are drawn, and the
 * cost here is per live object. What decides how many are alive at once is how
 * long each one lasts. Ten numbers at 24us each was 2.3ms of a 34ms frame.
 *
 * 650ms still reads: it is longer than the 400ms between two basic attacks at
 * the attack-speed cap, so a number is still on screen when its successor
 * arrives, and the arc (`COMBAT_TEXT_ARC_MS`) is unchanged — a number that dies
 * early dies mid-rise, which looks like it faded, not like it was cut off.
 */
export const COMBAT_TEXT_LIFETIME_DROWNING_MS = 650;

/**
 * How long the rise-then-fall motion takes to play out, from creation.
 *
 * Deliberately its own constant rather than reusing `COMBAT_TEXT_LIFETIME_MS`
 * at the call site, even though it is set to the same value: one is "how long
 * until this fades and dies" (resets on every merge — see `CombatText.show`)
 * and the other is "how long the arc takes" (never resets — see the class doc
 * comment). They happen to agree so a single, un-merged hit's motion looks
 * unchanged from before this file separated the two clocks; a future retune
 * of one is not a retune of the other.
 */
export const COMBAT_TEXT_ARC_MS = 1000;

/**
 * What a floating number is reporting. Drives both its format and its merge
 * key — see `CombatText.show`.
 */
export type CombatTextKind = 'damage' | 'heal' | 'shield' | 'reflect' | 'gold';

const FORMAT_BY_KIND: Record<CombatTextKind, (total: number) => string> = {
  damage: total => '-' + total,
  heal: total => '+' + total,
  shield: total => String(total),
  reflect: total => '⟲' + total,
  gold: total => '+' + total,
};

/**
 * What a bounty looks like when it floats.
 *
 * The one combat text that describes the unit it is **not** sitting above:
 * damage and heals report what happened to their owner, and this reports what
 * their owner got out of something else dying. It goes over the earner because
 * that is the person who needs to see it — a player watching a wave die had no
 * way to tell a last hit from a missed one at the moment it happened, which is
 * the whole skill a last hit is.
 *
 * Coin gold, and deliberately nowhere near the heal green it shares its `+`
 * prefix with. `bounty.test.ts` measures that distance rather than asserting
 * the literal.
 */
export const GOLD_TEXT_COLOR: readonly [number, number, number] = [255, 206, 92];

/**
 * What colour a damage number is, by the type of damage it reports.
 *
 * Damage got a type (`combat/Mitigation.ts`) and every number on screen stayed
 * the same red, so a player who had just bought armour could not tell whether
 * the hit that went through it was one armour was ever going to stop. Colour
 * is the whole signal — no glyph, no suffix: these are the most numerous things
 * on screen in a fight, and two extra characters on each of them costs more
 * legibility than the type gains.
 *
 * It lives here rather than beside the arithmetic in `Mitigation.ts` because it
 * is a rendering decision and that module is deliberately pure maths a test can
 * drive without a canvas.
 *
 * **The merge key does the other half of the work.** `show` keys on
 * `(victim, kind, colour)`, so three colours also mean a physical hit and a
 * magic hit landing on one victim stay two numbers instead of blending into a
 * single total that hides which was which.
 *
 * Chosen against what is already on screen: the heal green, and each other.
 * `damageTextColor.test.ts` measures both distances rather than asserting the
 * literals, because the failure worth catching is a retune that nudges two of
 * them together.
 */
export const DAMAGE_TEXT_COLOR: Record<DamageType, readonly [number, number, number]> = {
  /** Amber — steel and blood, and the one a basic attack deals. */
  PHYSICAL: [255, 146, 62],
  /** Violet — the one armour does nothing about. */
  MAGIC: [176, 122, 255],
  /**
   * Cyan, and deliberately not white.
   *
   * White is the colour League uses and it is the obvious one — nothing
   * absorbed it, so it arrives uncoloured. It fails in the one place a damage
   * type matters most: a spell description is `#eee` body text on a dark
   * panel, so "40 sát thương chuẩn" in `#f8f8f8` was the same colour as the
   * words around it. The type that mitigation cannot touch was the one type a
   * player could not see was called out.
   *
   * Cyan is the only saturated hue this palette has not already spent — red,
   * amber, violet, periwinkle and two greens are taken — and it still reads as
   * the right thing: cold, clean, nothing in the way.
   */
  TRUE: [95, 216, 245],
};

const colorKey = (textColor: string | number[]): string =>
  Array.isArray(textColor) ? textColor.join(',') : textColor;

/**
 * One live merge target per (victim, kind, color). Color is part of the key
 * because `Shield` and `DamageReflect` carry a caster-chosen color — two
 * different shields absorbing on the same unit must not blend into one
 * number that hides which spell ate what, so they key apart and only a
 * repeated hit against the *same* shield instance merges.
 *
 * A plain `WeakMap` rather than a field on `AttackableUnit`: this is display
 * bookkeeping, not unit state, and it costs nothing once the unit (and every
 * text it ever showed) is gone.
 */
const mergeTargets = new WeakMap<AttackableUnit, Map<string, CombatText>>();

/**
 * How many floating numbers bodies that are *not* champions may hold on screen
 * at once.
 *
 * The merge key is `(victim, kind, colour)`, so the live count scales with how
 * many bodies are being hit rather than how fast — which is the right bound
 * for a duel and the wrong one for a teamfight over a wave. Measured with this
 * repository's own `tests/e2e/measure-combattext-perf.mjs`: 106 minions under
 * sustained damage held **50.3 numbers on average and 63 at the peak**, and
 * what they buried was the two things a fight is actually read from — the
 * champions and the spell objects.
 *
 * `COMBAT_TEXT_PERF.md` declined a flat cap for a good reason: forty bodies
 * taking a hit is forty numbers, and trimming that trims the answer. This is
 * not a flat cap. Champions are never budgeted — a teamfight's numbers all
 * still land, however loud the wave beside it is — and the budget applies only
 * to the bodies that produce the flood, so the two cannot crowd each other
 * out. Solo farming never reaches it; an AOE over a wave is what it is for.
 */
export const MINOR_TEXT_BUDGET = 12;

/**
 * The same budget on a machine that is drowning (`render/renderStress.ts`).
 *
 * Champions stay **unbudgeted** even here, which was not the first plan. A cap
 * for them was written and then dropped once it was costed: a ten-champion
 * fight puts at most ten major numbers on screen, so a cap of eight removes
 * two of them — about 0.05ms of a 34ms frame, which is noise, in exchange for a
 * second tracking set and a second way for `isMajor` to be wrong. The two
 * levers below carry the whole saving, and a champion's numbers are the ones
 * the fight is actually read from.
 */
export const MINOR_TEXT_BUDGET_DROWNING = 6;

/**
 * Live numbers currently spending that budget, per match.
 *
 * A `Set`, not a count, so a text removed by any path is caught by re-reading
 * `toRemove` rather than by every remover remembering to decrement. Keyed on
 * the game rather than held module-wide because a budget is a property of the
 * screen it is protecting: a finished match must not spend the next one's, and
 * a `WeakMap` retires each set with the `Game` that owns it.
 */
const minorTexts = new WeakMap<object, Set<CombatText>>();

/**
 * How much the combat text may give up, read off the owner's game.
 *
 * Tolerant of a game that is not a real one: the sight and hit-feedback suites
 * build owners by hand, and a number that refuses to appear in a fixture is a
 * worse bug than one that is drawn too richly on a machine nobody is playing on.
 */
function tierOf(owner: AttackableUnit): 0 | 1 | 2 {
  const game = owner.game as { renderQuality?: never; renderStressed?: boolean; deeplyStressed?: boolean } | undefined;
  if (!game) return 0;
  return stressTier(game.renderQuality, game.renderStressed, game.deeplyStressed);
}

function minorTextsOf(owner: AttackableUnit): Set<CombatText> {
  const game = owner.game as unknown as object;
  let live = minorTexts.get(game);
  if (!live) {
    live = new Set();
    minorTexts.set(game, live);
  }
  return live;
}

/**
 * Whether this body's numbers are the ones a fight is read from.
 *
 * `killCredit`, not `instanceof Champion`: it is already this codebase's
 * answer to "does this count as a champion" (`CLAUDE.md`), it is what a pack's
 * own body inherits, and it keeps this file free of a value import it has
 * never needed. Minions and monsters are `'minion'`, turrets and pets
 * `'none'`; all three are budgeted.
 */
const isMajor = (owner: AttackableUnit): boolean => owner.killCredit === 'champion';

/**
 * Closed-form "toss and fall": rises a little, then gravity wins and it
 * settles below its start, expressed as coefficients of `p` and `p*p` where
 * `p = min(elapsedMs, COMBAT_TEXT_ARC_MS) / COMBAT_TEXT_ARC_MS` — see
 * `CombatText.update`. Reproduces the shape the old per-tick integration
 * produced for a single, un-merged hit over its one lifetime (initial
 * velocity -1px/tick, gravity +0.05px/tick^2, at the fixed 60Hz sim tick):
 * peaks ~10px up around a third of the way through the arc, and ends ~30px
 * below the start once the arc completes.
 */
const ARC_LINEAR_PX = -60;
const ARC_QUADRATIC_PX = 90;

/** Peak sideways drift once the arc completes, so two numbers on one unit don't sit on identical x. */
const DRIFT_MAX_PX = 40;

/**
 * The outline every number wears — dark, not the yellow this used to draw.
 * Every floating number was red or green then, and yellow read as a rim on
 * both; the moment damage split into amber, violet and cyan
 * (`DAMAGE_TEXT_COLOR`) the same yellow started muddying the two warm ones
 * into each other, which is exactly the distinction it now has to keep.
 * Near-black instead of pure black so it still reads as an outline rather
 * than a shadow.
 */
const OUTLINE_CSS = 'rgb(16, 12, 20)';

/** Screen-space size of a number nothing has made bigger. */
const BASE_TEXT_SIZE = 20;
/**
 * The "punch": a number lands oversized and settles to its size over this
 * long, reset on every merge so sustained fire keeps pulsing. Rhythm and size
 * are how a crit is told apart — colour is spoken for (`DAMAGE_TEXT_COLOR`).
 */
export const PUNCH_MS = 120;
const PUNCH_SCALE = 0.35;

/** What the headline should be drawn at. Only damage weighs itself against the pool. */
const sizeFor = (
  owner: AttackableUnit,
  kind: CombatTextKind,
  amount: number,
  crit: boolean
): number =>
  kind === 'damage'
    ? BASE_TEXT_SIZE *
      damageTextScale(hitFraction(amount, owner.stats?.maxHealth?.value ?? 0), crit)
    : BASE_TEXT_SIZE;

/**
 * Hits landing within this long of the first hit of a group are one
 * *headline* — see "The headline and the total" on the class. Long enough to
 * fold a multi-projectile spell or an aura's same-frame ticks into one
 * number; short enough that two basic attacks (400ms apart at the attack
 * speed cap) are two.
 */
export const HEADLINE_WINDOW_MS = 150;
/** The total line, relative to the headline: smaller and quieter, a footnote. */
const TOTAL_TEXT_SCALE = 0.6;
const TOTAL_TEXT_ALPHA = 0.75;
const TOTAL_PREFIX = '∑ ';

/** Presentation options `show` accepts beside the number. */
export interface CombatTextOptions {
  /** A crit hit: bigger, heavier outline, and it marks the merged text for good. */
  crit?: boolean;
}

/**
 * Extra clearance the arc's rest point keeps above the unit's health bar, in
 * screen-space px (scaled like the bar itself — see `Camera.constantSize`).
 *
 * Real League anchors its floating numbers above the health bar, not over
 * the character model (a live match's own forum complaint was text that
 * "floats behind the health bar" — same failure mode this avoids, different
 * cause). `AttackableUnit.drawHealthBar` already sits `(6 + 15) * k` above
 * `size / 2`; this is the further gap on top of that, clearing both the bar
 * and its "12 / 100" label so a merged, still-climbing number never has to
 * fight the avatar or the bar for the same few pixels.
 */
const HEALTH_BAR_CLEARANCE_PX = 20;

/**
 * A floating damage/heal/shield/reflect number over a unit's head.
 *
 * ## Why it merges, and the rule
 *
 * A fast attacker, a multi-hit spell or a crowded fight used to spawn one of
 * these *per event* — a teamfight with several champions trading blows could
 * have 150-200 alive at once, each animating, drawing and eventually being
 * GC'd, on top of the object churn itself. Nobody reads 200 overlapping
 * numbers; what a player actually wants is "how much am I taking right now."
 *
 * `CombatText.show(owner, kind, amount, textColor)` is the one door in. It
 * merges **per victim (`owner`) and per `kind`** — two units each taking 15
 * are two numbers over two heads, never one 30 floating between them — and
 * only while a live text of that exact (owner, kind, color) is still on
 * screen: the first hit in a burst shows immediately (no added latency on
 * the number a player is actually watching), and every hit that lands before
 * it fades **adds to the same instance's running total and puts it back to a
 * fresh `COMBAT_TEXT_LIFETIME_MS`**, rather than spawning another object.
 * Sustained fire keeps one number alive and climbing for as long as the fire
 * continues; it only starts to fade once a full lifetime passes with nothing
 * new to add.
 *
 * ## Two clocks, not one — and the bug that came from conflating them
 *
 * A merge resets `age` (fade + removal) but must leave the *arc* — where the
 * number sits on its rise-then-fall path — alone, or every hit pops the text
 * back to the unit's feet and restarts the climb. The first version of this
 * got that half right and then broke a different way: the arc was driven by
 * integrating `velocity`/`gravity` into `movedVector` every tick, with
 * nothing bounding it. A single un-merged hit is only ever alive for one
 * `lifeTime`, so the integration was accidentally bounded by how long the
 * object existed — but a merged text under sustained fire never dies (`age`
 * keeps getting reset before it crosses `lifeTime`), so `velocity` kept
 * accumulating `gravity` for as long as the fire lasted. A few seconds of
 * continuous hits and the text was in free fall, off the bottom of the
 * screen. Reported from a phone: "nó bay xuống hoài luôn, ra khỏi viewport
 * luôn."
 *
 * The fix is a second clock. `elapsedMs` is time since this instance was
 * *created* — a merge never resets it, unlike `age` — and the arc is a
 * closed-form function of `min(elapsedMs, COMBAT_TEXT_ARC_MS)`, not an
 * integrated velocity, so it cannot run away by construction: past
 * `COMBAT_TEXT_ARC_MS` the position is simply constant. A single hit's
 * motion is unchanged (it dies at `age > COMBAT_TEXT_LIFETIME_MS`, which
 * equals `COMBAT_TEXT_ARC_MS`, so the clamp is never actually reached before
 * removal). A merged text under sustained fire plays the same rise-and-fall
 * once, then holds at the settled position while its running total keeps
 * climbing; when the fire stops, `age` resumes counting up from its last
 * reset and the held number fades from wherever it is.
 *
 * A fixed flush tick (accumulate for ~200-250ms, emit once) was the other
 * option on the table for the *merge* rule and was rejected: it would buy
 * the same object-count reduction — the steady-state is one live text per
 * (victim, kind) either way — at the cost of up to one tick of latency on an
 * isolated hit, which reads as input lag on the number a player is most
 * likely to be watching: their own. Merging into a still-alive text gets the
 * same reduction with no added latency and no scheduler; its effective
 * window is `COMBAT_TEXT_LIFETIME_MS` itself rather than a second constant
 * to keep in sync with it.
 *
 * No separate cap on top: merging already bounds live count to one text per
 * unit currently taking a given kind of event, which is bounded by the
 * number of units on the map (`MinionSpawner.MINION_LIVE_CAP` plus the
 * roster) rather than by event rate — an AOE hitting forty units still shows
 * forty numbers, one each, which is the correct answer, not something a cap
 * should be trimming.
 *
 * ## The headline and the total
 *
 * Merging answers "how much am I taking" and, on its own, destroys "how much
 * was *that*": a crit landing on a running total of 300 reads as 352 — the
 * player can see neither the crit nor the total for what they are. Reported
 * from a phone on the day crits got a size of their own.
 *
 * So one text carries two numbers, and the object count stays exactly what
 * the merge rule bought. The **headline** (`recent`, drawn as `text`) is the
 * sum of the hits that landed within `HEADLINE_WINDOW_MS` of the first hit of
 * the current group; a hit landing later than that opens a new group and the
 * headline *replaces* itself rather than climbing. Size and crit styling
 * follow the headline, so a crit is drawn at the crit's own number and a
 * chain of pokes never grows into the picture of a single big blow. The
 * **total** (`amount`, drawn as `totalText`) is everything since this text
 * was born, and is only drawn once a second group has opened — a lone hit is
 * one number, exactly as before. The text still fades a lifetime after the
 * last hit, so the total's window is the burst of combat itself, not a
 * constant to tune.
 */
export default class CombatText extends SpellObject {
  lifeTime: number;
  age: number;
  /** Time since this instance was *created*. Never reset by a merge — see above. */
  elapsedMs: number;
  /** Current screen-space offset from `owner.position`, refreshed each `update()`. */
  offsetX: number;
  offsetY: number;
  /** This instance's fixed sideways drift target, reached once the arc completes. */
  driftTargetX: number;
  textSize: number;
  textColor: string | number[];
  text: string;
  /** Everything since this text was born, before `FORMAT_BY_KIND`. See "The headline and the total". */
  amount = 0;
  /** The headline group's sum — what `text` shows. */
  recent = 0;
  /** `amount`, formatted, for the total line. */
  totalText = '';
  /** Ms since the current headline group opened. Simulation clock, like `age`. */
  groupAgeMs = 0;
  /** Headline groups so far; the total line is drawn from the second on. */
  groups = 1;
  /** A crit landed in the current headline group. Reset when a new group opens. */
  crit = false;
  /** Ms of landing "punch" left; see `PUNCH_MS`. */
  punchMs = 0;

  constructor(owner: AttackableUnit) {
    super(owner);
    // Read once, at birth: a number that changed its own remaining life halfway
    // through because the machine hiccuped would fade at a rate that has nothing
    // to do with the hit it is reporting.
    this.lifeTime =
      tierOf(owner) >= 2 ? COMBAT_TEXT_LIFETIME_DROWNING_MS : COMBAT_TEXT_LIFETIME_MS;
    this.age = 0;
    this.elapsedMs = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.driftTargetX = random(-DRIFT_MAX_PX, DRIFT_MAX_PX);
    this.textSize = BASE_TEXT_SIZE;
    this.textColor = 'white';
    this.text = '';
  }

  /** See the class doc comment for the merge rule this implements. */
  static show(
    owner: AttackableUnit,
    kind: CombatTextKind,
    amount: number,
    textColor: string | number[],
    options?: CombatTextOptions
  ): void {
    amount = Math.round(amount);
    if (amount === 0) return;
    const crit = options?.crit === true;

    const key = kind + '|' + colorKey(textColor);
    const byKey = mergeTargets.get(owner);
    const existing = byKey?.get(key);
    if (existing && !existing.toRemove) {
      existing.amount += amount;
      existing.totalText = FORMAT_BY_KIND[kind](existing.amount);
      existing.age = 0;
      if (existing.groupAgeMs > HEADLINE_WINDOW_MS) {
        // A new group: the headline is *this* hit, not the pile it joined.
        existing.recent = amount;
        existing.crit = crit;
        existing.groupAgeMs = 0;
        existing.groups += 1;
      } else {
        existing.recent += amount;
        existing.crit ||= crit;
      }
      existing.text = FORMAT_BY_KIND[kind](existing.recent);
      // Size follows the headline: "how hard was that", not "how much so far".
      existing.textSize = sizeFor(owner, kind, existing.recent, existing.crit);
      existing.punchMs = PUNCH_MS;
      return;
    }

    // Nothing above this line is gated: a *merge* costs no new object and only
    // makes a number already on screen more accurate, so a budgeted body whose
    // text is still alive keeps counting up regardless.
    const major = isMajor(owner);
    const live = major ? null : minorTextsOf(owner);
    if (live) {
      const budget = tierOf(owner) >= 2 ? MINOR_TEXT_BUDGET_DROWNING : MINOR_TEXT_BUDGET;
      if (live.size >= budget) {
        for (const text of live) if (text.toRemove) live.delete(text);
      }
      if (live.size >= budget) return;
    }

    const combatText = new CombatText(owner);
    combatText.amount = amount;
    combatText.recent = amount;
    combatText.text = FORMAT_BY_KIND[kind](amount);
    combatText.totalText = combatText.text;
    combatText.textColor = textColor;
    combatText.crit = crit;
    combatText.textSize = sizeFor(owner, kind, amount, crit);
    combatText.punchMs = PUNCH_MS;

    let targets = byKey;
    if (!targets) {
      targets = new Map();
      mergeTargets.set(owner, targets);
    }
    targets.set(key, combatText);
    live?.add(combatText);

    owner.game.objectManager.addObject(combatText);
  }

  update(): void {
    this.elapsedMs += deltaTime;
    // p = 0 at creation, 1 once the arc has fully played out. Clamped rather
    // than integrated, so holding this instance alive past COMBAT_TEXT_ARC_MS
    // (a merge keeps refreshing `age` without touching `elapsedMs`) cannot
    // push the position past where the arc ends — see the class doc comment.
    const arcProgress = Math.min(this.elapsedMs, COMBAT_TEXT_ARC_MS) / COMBAT_TEXT_ARC_MS;
    this.offsetY = ARC_LINEAR_PX * arcProgress + ARC_QUADRATIC_PX * arcProgress * arcProgress;
    this.offsetX = this.driftTargetX * arcProgress * arcProgress;

    if (this.punchMs > 0) this.punchMs -= deltaTime;
    this.groupAgeMs += deltaTime;

    this.age += deltaTime;
    if (this.age > this.lifeTime) {
      this.toRemove = true;
      // Hands the budget back on the ordinary path; the lazy sweep in `show`
      // is what covers a text removed by any other one.
      minorTexts.get(this.owner.game as unknown as object)?.delete(this);
    }
  }

  /**
   * Native context, not p5 — these are the most numerous drawn things in any
   * fight, and each one used to spend thirteen p5 calls per frame. The fade
   * rides `globalAlpha` rather than being baked into per-frame rgba strings:
   * alpha changes every frame, so composing it into the colour would defeat
   * `cssColor`'s cache — and `globalAlpha` also applies unchanged to a
   * `textColor` that arrives as a css string instead of an rgb triple.
   */
  draw(): void {
    const ctx = drawingContext;
    // The p5 version was `map(age, 0, lifeTime, 255, 10)` — a fade that ends
    // near-invisible rather than at zero, kept exactly.
    const alpha = Math.max(0, 255 - (245 * this.age) / this.lifeTime);
    const size = this.owner.stats.size.value;
    const zoomFactor = this.game?.camera?.constantSize?.(1) ?? 1;
    // Rest point above the health bar, not the character model — see
    // HEALTH_BAR_CLEARANCE_PX. AttackableUnit.drawHealthBar's own bar sits
    // `(6 + 15) * k` above `size / 2`; this adds a further gap on top of
    // that so the number starts clear of both the bar and its "12 / 100"
    // label, then the arc (offsetX/offsetY) plays out from there exactly as
    // it did before this line existed.
    const restY = this.owner.position.y - size / 2 - HEALTH_BAR_CLEARANCE_PX * zoomFactor;
    const x = this.owner.position.x + this.offsetX;
    const y = restY + this.offsetY;

    ctx.save();
    ctx.globalAlpha = alpha / 255;
    // p5's defaults, stated: nothing in the draw loop leaves another
    // alignment behind, but this must not depend on that staying true.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    // A heavier outline is the crit's second tell, beside its size.
    ctx.lineWidth = this.crit ? 3 : 2;
    ctx.strokeStyle = OUTLINE_CSS;
    ctx.fillStyle = Array.isArray(this.textColor)
      ? cssColor(this.textColor[0], this.textColor[1], this.textColor[2])
      : this.textColor;
    // Lands oversized and settles — see PUNCH_MS.
    const punch = this.punchMs > 0 ? 1 + PUNCH_SCALE * Math.min(1, this.punchMs / PUNCH_MS) : 1;
    // An overlay, not the world: a damage number is the same size on screen at
    // every zoom. See Camera.constantSize.
    const headlineSize = this.textSize * punch * zoomFactor;
    ctx.font = `bold ${headlineSize}px sans-serif`;
    // Outline first, glyph over it — the order p5 painted the two in.
    ctx.strokeText(this.text, x, y);
    ctx.fillText(this.text, x, y);

    if (this.showsTotal) {
      // The footnote: above the headline (the arc carries both away from the
      // bar, so above is the side with room), smaller, quieter, never punched
      // and never in the crit's heavy outline — the total is context, and the
      // headline is the news.
      ctx.globalAlpha = (alpha * TOTAL_TEXT_ALPHA) / 255;
      ctx.lineWidth = 2;
      ctx.font = `bold ${BASE_TEXT_SIZE * TOTAL_TEXT_SCALE * zoomFactor}px sans-serif`;
      const totalY = y - headlineSize * 0.95;
      ctx.strokeText(TOTAL_PREFIX + this.totalText, x, totalY);
      ctx.fillText(TOTAL_PREFIX + this.totalText, x, totalY);
    }
    ctx.restore();
  }

  /**
   * The total line earns its place only once there is more than one headline to
   * sum — and only on a machine that can afford the footnote.
   *
   * It is the second stroke-and-fill pair of the draw, with its own font and
   * alpha — roughly half of what a floating number costs. What is lost is
   * context, not news: the headline still says what the last hit did, and the
   * running total is the thing a player reconstructs anyway from a health bar
   * that is already there.
   */
  get showsTotal(): boolean {
    return this.groups >= 2 && tierOf(this.owner) < 2;
  }
}
