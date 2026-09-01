import { describe, expect, it } from 'vitest';

/**
 * `@moba2d/core/testing/tempo` — how long a pack makes a player wait.
 *
 * ## Why core states this and not each pack
 *
 * moba2d is a fast game, and that is a property of the *engine*, not of any
 * one pack: `castIntervalMs` for the hardest bot is 550ms, a lane creep dies
 * to two abilities, and a champion crosses the map in seconds. A pack that
 * puts a ninety-second cooldown on an ultimate is not making a slower
 * champion, it is making a champion who is a basic-attacker for a minute and
 * a half — and nothing in a pack's own build would ever say so.
 *
 * The band is measured, not invented. The reference pack ships **67
 * ultimates and 239 basics**, and across all of them:
 *
 *   ultimates  3–10s   (median 10, and not one above 10)
 *   basics     0–12s   (median 8, 90th percentile 10)
 *
 * Those two ceilings are the constants below. A pack that wants a different
 * pace passes its own — but it has to pass them, in its own test file, where
 * the number is visible and someone can disagree with it.
 *
 * ## What this cannot see
 *
 * Uptime, which is the number that actually matters for a buff: a 9-second
 * Sage Mode on a 10-second cooldown is a permanent buff wearing a cooldown's
 * clothes. Durations live in each spell's own constants and no generated file
 * carries them, so that stays a judgement for whoever retunes the cooldown.
 * Bringing an ability *into* this band is exactly the moment to check it.
 */

/** Longest cooldown an ultimate may declare, in ms. */
export const MAX_ULTIMATE_COOLDOWN_MS = 10_000;
/** Longest cooldown a Q, W or E may declare, in ms. */
export const MAX_BASIC_COOLDOWN_MS = 12_000;

export interface TempoIssue {
  spellId: string;
  champion: string;
  slot: number;
  coolDownMs: number;
  message: string;
}

export interface TempoFixture {
  /** The pack's `generated/spellCatalog.ts`. */
  spellCatalog: Readonly<Record<string, { coolDownMs?: number }>>;
  /** The playable champions, in kit order — Q, W, E, R. */
  champions: readonly { id: string; name?: string; spells?: readonly string[] }[];
  /** Abilities that only exist inside a form, scored as basics. */
  formSpells?: readonly string[];
  maxUltimateMs?: number;
  maxBasicMs?: number;
  label?: string;
}

export function tempoIssues(fixture: TempoFixture): TempoIssue[] {
  const maxUltimate = fixture.maxUltimateMs ?? MAX_ULTIMATE_COOLDOWN_MS;
  const maxBasic = fixture.maxBasicMs ?? MAX_BASIC_COOLDOWN_MS;
  const issues: TempoIssue[] = [];

  const check = (id: string, champion: string, slot: number): void => {
    const coolDownMs = fixture.spellCatalog[id]?.coolDownMs;
    if (typeof coolDownMs !== 'number') return;
    const ceiling = slot === 4 ? maxUltimate : maxBasic;
    if (coolDownMs <= ceiling) return;
    issues.push({
      spellId: id,
      champion,
      slot,
      coolDownMs,
      message:
        `${champion} ${id} sits on ${coolDownMs / 1_000}s, over the ` +
        `${ceiling / 1_000}s ceiling for ${slot === 4 ? 'an ultimate' : 'a basic ability'}. ` +
        'The reference pack has nothing above 10s on an ultimate and nothing above 12s anywhere.',
    });
  };

  for (const champion of fixture.champions) {
    const label = champion.name ?? champion.id;
    (champion.spells ?? []).forEach((id, index) => check(id, label, index + 1));
  }
  for (const id of fixture.formSpells ?? []) check(id, 'form', 1);

  return issues;
}

/** Registers the shared suite at the top level of a pack's own test file. */
export function describeTempo(fixture: TempoFixture): void {
  describe(fixture.label ?? 'the pack keeps the game fast', () => {
    it('has a roster to measure', () => {
      expect(fixture.champions.length).toBeGreaterThan(0);
    });

    it('leaves nobody standing around waiting for a cooldown', () => {
      expect(tempoIssues(fixture).map(issue => issue.message)).toEqual([]);
    });
  });
}
