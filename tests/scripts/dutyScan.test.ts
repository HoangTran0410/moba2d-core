import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain .mjs tool, deliberately not part of the TS build.
import { scanSource } from '../../scripts/duty-scan.mjs';

/**
 * The duty-cycle reader, held to the mistakes it was written from.
 *
 * `scripts/duty-scan.mjs` exists because capping twenty-four cooldowns to the
 * practice room's pace raised every one of those abilities' *uptime* — a duty
 * cycle is duration over cooldown and only one of the two numbers moved. The
 * first version of this scan ranked by constant names alone and its top five
 * were all wrong, in three distinct ways. Each of those three is a test here,
 * because a ranking whose top rows are noise is one nobody reads.
 */
describe('duty-scan', () => {
  it('reads a self-buff against the cooldown that actually gates it', () => {
    const row = scanSource(`
      export const E_DURATION_MS = 14_000;
      export const E_COOLDOWN_MS = 16_000;
      export default class Slark_E extends Spell {
        coolDown = E_COOLDOWN_MS;
        onSpellCast() {
          this.owner.addBuff(new Armed(E_DURATION_MS, this.owner, this.owner));
        }
      }
    `);
    expect(row.durationMs).toBe(14_000);
    expect(row.cooldownMs).toBe(16_000);
    expect(row.uptime).toBeCloseTo(0.875, 3);
  });

  it('ignores a constant that is named like a cooldown but is not the one', () => {
    // The real shape: an internal proc timer sitting beside the real cooldown.
    // Ranked by name this ability read as 857% up, and it is 43%.
    const row = scanSource(`
      export const E_DURATION_MS = 6_000;
      export const E_SPIN_COOLDOWN_MS = 700;
      export const E_COOLDOWN_MS = 14_000;
      export default class Axe_E extends Spell {
        coolDown = E_COOLDOWN_MS;
        onSpellCast() {
          this.owner.addBuff(new Armed(E_DURATION_MS, this.owner, this.owner));
        }
      }
    `);
    expect(row.cooldownMs).toBe(14_000);
    expect(row.uptime).toBeCloseTo(6 / 14, 2);
  });

  it("counts the cycle as duration plus cooldown when the clock starts at the end", () => {
    // An 18s state on a 10s cooldown is not 180% up. `startAt: 'end'` means the
    // cooldown begins when the state does not.
    const row = scanSource(`
      export const R_DURATION_MS = 18_000;
      export const R_COOLDOWN_MS = 10_000;
      export default class Sasuke_R extends Spell {
        coolDown = R_COOLDOWN_MS;
        get castSpec() {
          return { cooldown: { startAt: 'end', durationMs: R_COOLDOWN_MS } };
        }
        onSpellCast() {
          this.owner.addBuff(new Cloak(R_DURATION_MS, this.owner, this.owner));
        }
      }
    `);
    expect(row.startAt).toBe('end');
    expect(row.uptime).toBeCloseTo(18 / 28, 2);
  });

  it('does not count a debuff put on the victim as the caster being up', () => {
    // A four-second poison on a four-second cooldown is an ability that is
    // always *available*, which is a different sentence.
    const row = scanSource(`
      export const POISON_DURATION_MS = 4_000;
      export default class Teemo_E extends Spell {
        coolDown = 4_000;
        onHit(victim) {
          victim.addBuff(new DamageOverTime(POISON_DURATION_MS, this.owner, victim));
        }
      }
    `);
    expect(row).toBeNull();
  });

  it('reads a toggle that states its own length instead of wearing a buff', () => {
    const row = scanSource(`
      export default class Naruto_W extends Spell {
        coolDown = 12_000;
        get castSpec() {
          return { active: { maxDurationMs: 6_000, recasts: 1 } };
        }
      }
    `);
    expect(row.uptime).toBeCloseTo(0.5, 3);
  });

  it('says nothing about an ability with no cooldown to divide by', () => {
    expect(scanSource(`export class Passive extends Buff { name = 'x'; }`)).toBeNull();
  });
});
