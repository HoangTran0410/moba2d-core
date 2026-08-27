import { describe, expect, it } from 'vitest';
import { Stat } from '@/game/gameObject/Stats';
import { setComposedValue } from '@/game/net/ClientSession';

/**
 * A snapshot carries the host's *composed* stat — the number after every
 * modifier — and the client has to end up displaying exactly that.
 *
 * Storing it in `baseValue` was right for as long as a client's champion had
 * no modifiers of its own. Items broke that: the belt's health is added on the
 * host, folded into the number that crosses, and then added *again* on the
 * client that now owns a real `HeldItem`. Every expectation here is written
 * out by hand rather than computed from `Stat` itself — an inverse checked
 * against the formula it inverts agrees with itself however wrong both are.
 */
describe('writing a host stat onto a client that has modifiers of its own', () => {
  it('lands the composed value on the host number, not the base', () => {
    const stat = new Stat(500);
    stat.flatBonus = 200; // a Giant's Belt the client now really wears
    expect(stat.value).toBe(700);

    // The host reports 900: its own 700 base + the same belt's 200.
    setComposedValue(stat, 900);
    expect(stat.value).toBe(900);
    // and it got there by moving the base, not by ignoring the belt
    expect(stat.baseValue).toBe(700);
  });

  it('inverts the percentage layers too', () => {
    const stat = new Stat(100);
    stat.baseBonus = 20;
    stat.percentBaseBonus = 0.5; // (base + 20) * 1.5
    stat.flatBonus = 10;
    stat.percentBonus = 0.25; // (… + 10) * 1.25
    // (100 + 20) * 1.5 + 10 = 190, * 1.25 = 237.5
    expect(stat.value).toBe(237.5);

    setComposedValue(stat, 500);
    expect(stat.value).toBeCloseTo(500, 10);
  });

  it('is a plain assignment when the champion has no modifiers at all', () => {
    // The overwhelming case — every unit that is not a champion — must not
    // drift by a floating-point hair away from what the host sent.
    const stat = new Stat(0);
    setComposedValue(stat, 1234);
    expect(stat.baseValue).toBe(1234);
    expect(stat.value).toBe(1234);
  });

  it('falls back rather than dividing by zero on a -100% modifier', () => {
    // No base produces the target when the value is scaled to nothing; the
    // point is that it answers at all instead of writing NaN into a health bar.
    const stat = new Stat(300);
    stat.percentBonus = -1;
    setComposedValue(stat, 250);
    expect(Number.isNaN(stat.baseValue)).toBe(false);
  });
});
