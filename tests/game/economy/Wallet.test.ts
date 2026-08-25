import { describe, expect, it } from 'vitest';
import Wallet, { PASSIVE_GOLD_PER_SECOND } from '@/game/economy/Wallet';

/**
 * What a champion can spend, and the two rules that keep the shop honest.
 *
 * **The displayed balance is the spendable balance.** Income arrives as a
 * fraction of a coin per frame, so the pool is a float internally — but a shop
 * that prints 899 and then accepts a 900 purchase (because the pool is really
 * at 899.7) is a shop that lies, and one that prints 900 and refuses is worse.
 * `balance` floors, `spend` measures against `balance`, and nothing else may
 * read the raw number.
 *
 * **Nothing goes negative and nothing partially succeeds.** `spend` either
 * takes the whole cost and answers true, or takes nothing and answers false.
 */
describe('Wallet', () => {
  it('starts wherever it is told to', () => {
    expect(new Wallet(500).balance).toBe(500);
    expect(new Wallet().balance).toBe(0);
  });

  it('adds what it earns', () => {
    const wallet = new Wallet(100);
    wallet.earn(20);
    wallet.earn(20);
    expect(wallet.balance).toBe(140);
  });

  it('ignores a nonsense grant rather than poisoning the pool', () => {
    // One NaN in here and every price comparison in the shop answers false
    // forever, with nothing in the UI saying why.
    const wallet = new Wallet(100);
    wallet.earn(Number.NaN);
    wallet.earn(Number.POSITIVE_INFINITY);
    wallet.earn(-50);
    expect(wallet.balance).toBe(100);
  });

  it('spends the whole cost or none of it', () => {
    const wallet = new Wallet(100);
    expect(wallet.spend(40)).toBe(true);
    expect(wallet.balance).toBe(60);
    expect(wallet.spend(61), 'a purchase it could not afford went through').toBe(false);
    expect(wallet.balance).toBe(60);
  });

  it('always affords exactly what it says it has, over a fractional pool', () => {
    // The failure this pins: rounding the displayed balance instead of
    // flooring it. Income is fractional, so a pool at 3.5 rounds to 4 — and
    // then the shop offers a 4-gold item the wallet cannot pay for, with the
    // player looking straight at a balance that says they can.
    const wallet = new Wallet(0);
    wallet.accrue(1_750); // 3.5 at 2/second
    expect(wallet.balance).toBe(3);
    expect(wallet.spend(wallet.balance), 'could not afford its own displayed balance').toBe(true);
  });

  it('refuses one coin more than it says it has', () => {
    const wallet = new Wallet(0);
    wallet.accrue(1_750);
    expect(wallet.spend(4)).toBe(false);
    expect(wallet.balance).toBe(3);
  });

  it('never spends a nonsense amount', () => {
    const wallet = new Wallet(100);
    expect(wallet.spend(-40)).toBe(false);
    expect(wallet.spend(Number.NaN)).toBe(false);
    expect(wallet.balance).toBe(100);
  });

  it('accepts a free purchase', () => {
    // `cost: 0` is legal on an `ItemDef` — a starting item, a quest reward —
    // and a wallet that refused it would make that unbuyable.
    const wallet = new Wallet(0);
    expect(wallet.spend(0)).toBe(true);
  });

  describe('passive income', () => {
    it('accrues by the second, not by the frame', () => {
      // The trap `Camera.smoothingFor` exists for, one system over: a per-frame
      // grant makes a player's income a function of their refresh rate, so the
      // same match pays a 144Hz machine 2.4x what it pays a 60Hz one.
      const wallet = new Wallet(0);
      wallet.accrue(1_000);
      expect(wallet.balance).toBe(PASSIVE_GOLD_PER_SECOND);
    });

    it('pays the same over a second however that second is chopped up', () => {
      const oneStep = new Wallet(0);
      oneStep.accrue(1_000);

      const manySteps = new Wallet(0);
      // 16.67ms is a real 60Hz frame — deliberately not a divisor of 1000, so
      // the fractional carry is actually exercised rather than the arithmetic
      // landing on whole coins by luck.
      for (let i = 0; i < 60; i++) manySteps.accrue(1_000 / 60);

      expect(manySteps.balance).toBe(oneStep.balance);
    });

    it('does not pay for a frame that took no time, or negative time', () => {
      const wallet = new Wallet(0);
      wallet.accrue(0);
      wallet.accrue(-5_000);
      expect(wallet.balance).toBe(0);
    });
  });

  it('remembers what it has earned in total, which spending does not undo', () => {
    // The shop's sell price and the scoreboard both want "how much has this
    // champion had", which the current balance stops answering the moment
    // anything is bought.
    const wallet = new Wallet(0);
    wallet.earn(300);
    wallet.spend(250);
    expect(wallet.balance).toBe(50);
    expect(wallet.earnedTotal).toBe(300);
  });

  it('counts a starting grant as earned, so the total is never behind the balance', () => {
    const wallet = new Wallet(500);
    expect(wallet.earnedTotal).toBe(500);
  });
});
