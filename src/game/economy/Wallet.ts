/**
 * What a champion can spend, and the only thing that holds it.
 *
 * ## Why a class and not a number on `Champion`
 *
 * Three of the rules below are the kind that get re-implemented slightly
 * differently at each call site the moment they are not in one place:
 *
 * **The displayed balance is the spendable balance.** Passive income arrives
 * as a fraction of a coin per frame, so the pool has to be a float — and the
 * moment the number on screen is *rounded* off that float, a pool at 899.5
 * offers a 900-gold item it cannot pay for, with the player looking straight
 * at a balance that says they can. `balance` floors, and nothing outside this
 * file ever sees the raw number, so the printed figure is never more than what
 * is there.
 *
 * **Nothing partially succeeds.** `spend` takes the whole cost and answers
 * true, or takes nothing and answers false. A caller that deducted first and
 * checked afterwards is how an inventory ends up holding an item nobody paid
 * for.
 *
 * **Income is per unit of time, never per frame.** The same trap
 * `Camera.smoothingFor` exists for, one system over: `balance += rate` in
 * `update()` makes a player's income a function of their refresh rate, and the
 * same match pays a 144Hz machine 2.4x what it pays a 60Hz one.
 *
 * ## Who has one
 *
 * `AttackableUnit.wallet` is `null` by default and `Champion` fills it in.
 * `Pet` nulls it again on purpose, for exactly the reason it also sets
 * `killCredit = 'none'`: a `Pet` *is* a `Champion` by inheritance, and without
 * the explicit line every decoy clone would be quietly banking its own gold.
 */

/**
 * Gold per second, to everyone, for existing.
 *
 * The floor under a player who is losing: farm dries up when a lane is lost,
 * and a game where falling behind means falling further behind with no way
 * back is one nobody finishes. Roughly League's own 2.03/s, which is a number
 * two decades of tuning arrived at.
 */
export const PASSIVE_GOLD_PER_SECOND = 2;

/** What a champion walks out of the fountain with at the start of a match. */
export const STARTING_GOLD = 500;

/**
 * What killing one of these is worth to whoever did it.
 *
 * The numbers are the shape of the economy, not a translation of anyone
 * else's: a match here is minutes rather than half an hour, and an item priced
 * for League's curve would never be reached. Sized against
 * `PASSIVE_GOLD_PER_SECOND` so a player who farms is meaningfully richer than
 * one who does not, and a player who does neither is still buying something.
 *
 * They live here rather than as a field on each unit class for the same reason
 * `Difficulty.ts` holds every knob a tier changes: an economy is a set of
 * numbers that only mean anything *relative to each other*, and one of them
 * living somewhere else is how the set gets retuned by halves.
 */
export const MINION_BOUNTY = 20;
/** A camp is worth a little more than a caster minion and takes longer to take. */
export const MONSTER_BOUNTY = 32;
export const CHAMPION_BOUNTY = 200;
/** A building. Killer-only, like everything else here — no team split yet. */
export const TURRET_BOUNTY = 150;

const isSpendable = (amount: number): boolean => Number.isFinite(amount) && amount >= 0;

export default class Wallet {
  /**
   * The real pool, fractional. Private and stays that way — see the header:
   * every reader gets the floored `balance`, so the number on screen and the
   * number the shop measures against are the same number by construction.
   */
  private _gold = 0;

  /**
   * Everything this wallet has ever taken in, spending not deducted.
   *
   * A separate question from the balance and one the balance stops being able
   * to answer the moment anything is bought. The scoreboard wants it, and so
   * does anything that has to price a sale against what was paid.
   */
  private _earnedTotal = 0;

  constructor(startingGold = 0) {
    this.earn(startingGold);
  }

  /** Whole coins, and the only number anything outside this file sees. */
  get balance(): number {
    return Math.floor(this._gold);
  }

  get earnedTotal(): number {
    return Math.floor(this._earnedTotal);
  }

  /**
   * A bounty, a grant, a cheat. Ignores anything that is not a finite,
   * non-negative amount rather than taking it: one `NaN` in here and every
   * price comparison in the shop answers false for the rest of the match, with
   * nothing on screen saying why.
   */
  earn(amount: number): void {
    if (!isSpendable(amount)) return;
    this._gold += amount;
    this._earnedTotal += amount;
  }

  /**
   * Takes `cost` if it is there, and answers whether it was.
   *
   * Measured against `balance`, the same figure the shop prints, so the two can
   * never disagree about whether something is affordable. `0` is a real price —
   * `ItemDef.cost` allows it, for a starting item or a quest reward — so it
   * succeeds rather than being treated as a nonsense amount.
   */
  spend(cost: number): boolean {
    if (!isSpendable(cost)) return false;
    if (this.balance < cost) return false;
    this._gold -= cost;
    return true;
  }

  /**
   * Passive income for `deltaMs` of match time. See the header for why this
   * takes a duration rather than being called once a frame with a fixed
   * amount.
   */
  accrue(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    this.earn((deltaMs / 1000) * PASSIVE_GOLD_PER_SECOND);
  }
}
