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
 * The economy's own numbers, defined in `game/config/tuningDefaults.ts` and
 * re-exported here, where every caller already looks for them.
 *
 * They moved because `config/mapTuning.ts` has to read them and that file is
 * pinned to the `pregame` chunk — importing them from this module put the
 * whole match chunk on the menu's first paint, which `chunks:check` reported
 * as `pregame statically imports game`. See the defaults module's own header.
 */
import { PASSIVE_GOLD_PER_SECOND } from '@/game/config/tuningDefaults';
export {
  CHAMPION_BOUNTY,
  MINION_BOUNTY,
  MONSTER_BOUNTY,
  PASSIVE_GOLD_PER_SECOND,
  STARTING_GOLD,
  TURRET_BOUNTY,
} from '@/game/config/tuningDefaults';

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

  /**
   * Gold per second this purse earns for existing.
   *
   * An instance field rather than a module read, so a map may set the pace of
   * its own economy (`EconomyTuning.passiveGoldPerSecond`). Defaulted to the
   * constant, so a `new Wallet(500)` written before this existed behaves
   * exactly as it did.
   */
  passivePerSecond: number;

  constructor(startingGold = 0, passivePerSecond = PASSIVE_GOLD_PER_SECOND) {
    this.passivePerSecond = passivePerSecond;
    this.earn(startingGold);
  }

  /** Whole coins, and the only number anything outside this file sees. */
  get balance(): number {
    return Math.floor(this._gold);
  }

  /**
   * Overwrite the balance outright — the LAN client's only write.
   *
   * A client's wallet is not a wallet: nothing it does earns or spends,
   * because every purchase crosses to the host and every bounty is paid into
   * the host's copy. What arrives is a number, and `earn`/`spend` are the
   * wrong doors for it — `earn` would inflate `earnedTotal` (a scoreboard
   * figure the host already owns) and `spend` would refuse the very case that
   * matters, a balance correcting downwards past what this copy thinks it has.
   */
  syncTo(balance: number): void {
    this._gold = balance;
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
    this.earn((deltaMs / 1000) * this.passivePerSecond);
  }
}
