import { describe, expect, it } from 'vitest';
import {
  BURST_TARGET_HEALTH,
  isRetreatCandidate,
  type Posture,
  SCORE_ULTIMATE,
} from '@/game/ai/BotBrain';
import BotBrain from '@/game/ai/BotBrain';
import { profileFor } from '@/game/ai/Difficulty';
import { hasRole, roles, rolesOf, SpellRole, ULTIMATE_SLOT } from '@/game/ai/SpellRole';
import type { SpellRoleMask } from '@/game/ai/SpellRole';
import type Spell from '@/game/gameObject/Spell';

/**
 * `@moba2d/core/testing/bots` — is this kit *reachable* by the bot that has
 * to play it?
 *
 * ## The failure this exists for
 *
 * Reported from a real match: "sao bot ko bao giờ dùng R biến hình" — the bot
 * never pressed either transforming ultimate. Nothing was broken. The
 * ultimate was castable, in range, off cooldown, and scored a positive
 * number; it simply scored **6** while an ordinary Q scored **16**, so the Q
 * won every evaluation the Q was available for, which was nearly all of them.
 *
 * The cause is one line of `inferRoles`: a `SELF` cast with a mana cost reads
 * as `Buff | Shield`, and nothing else. That is right for a panic button and
 * wrong for every transform, steroid, spin and self-cast engage tool ever
 * written — and `scoreSpell` pays `Shield` **+20 below half health and −5
 * above**, so `Buff + Shield` comes to exactly **0** in a fight and
 * `chooseSpell` drops candidates scoring `<= 0`. The ability is not merely
 * deprioritised while fighting. It is not in the list.
 *
 * Sweeping the three shipped packs with these rules the first time found
 * **93** abilities in that shape: 65 basics that a bot can only press while
 * running away, and 28 ultimates whose single best moment is being nearly
 * dead. None of it was visible from any existing gate, and all of it was
 * discoverable only by playing a match and noticing an absence — which is the
 * hardest kind of bug to notice, because nothing happens.
 *
 * ## Why the scorer is called rather than restated
 *
 * Every number below comes out of `BotBrain.prototype.scoreSpell` itself,
 * invoked against stub scenes. A table of role weights copied into this file
 * would agree with itself however far core's tuning moved underneath it —
 * the same rule `Mitigation.test.ts` states, applied to the one function
 * whose numbers this whole file is about.
 *
 * `noise` is pinned to 0 for the run, which is what makes the comparisons
 * meaningful: `scoreSpell`'s multiplier is symmetric about 1, so removing it
 * leaves the ranking the bot would see on average.
 */

/** The scenes a spell is scored in, and which side of the fight each is. */
export type SceneName = 'poke' | 'execute' | 'chase' | 'wounded' | 'flee';

const FIGHTING: SceneName[] = ['poke', 'execute', 'chase'];
const DEFENSIVE: SceneName[] = ['wounded', 'flee'];

/**
 * The roles `scoreSpell` actually pays a number for.
 *
 * `Summon` is the one that is missing, and its absence is not obvious from
 * the enum: a spell tagged `Summon` alone scores whatever its other flags
 * score, which is nothing. That produced a real regression in this
 * repository — an ability tagged `Summon | Buff` scored 5 where the
 * inference it replaced had scored 10, so hand-tagging it made the bot use
 * it *less*. A tag that cannot move the number is a comment, and this list
 * is how a pack finds out which it wrote.
 */
export const SCORED_ROLES: SpellRoleMask = roles(
  SpellRole.Damage,
  SpellRole.Poke,
  SpellRole.Burst,
  SpellRole.Cc,
  SpellRole.Heal,
  SpellRole.Shield,
  SpellRole.Escape,
  SpellRole.Dash,
  SpellRole.Buff,
  SpellRole.Zone,
  SpellRole.Ultimate
);

export type BotRuleName =
  | 'self-cast-untagged'
  | 'unreachable'
  | 'unpaid-tag'
  | 'dead-in-combat'
  | 'panic-ultimate';

export interface BotRoleIssue {
  rule: BotRuleName;
  /** `<rule>:<spellId>`, which is exactly what `knownDebt` holds. */
  key: string;
  spellId: string;
  champion: string;
  slot: number;
  message: string;
  scores: Record<SceneName, number>;
}

export interface BotRoleKit {
  id: string;
  name?: string;
  /** The four ability ids, in kit order — Q, W, E, R. */
  spells: string[];
  /**
   * Abilities that only exist while a form holds, in Q/W/E order. Scored at
   * the slots they occupy, because that is where the bot meets them: a
   * transform's own kit is a kit, and nothing else in the build looks at it.
   */
  formSpells?: string[];
}

export interface BotRoleFixture {
  /** The pack's spell barrel, `id -> class`. */
  spells: Readonly<Record<string, unknown>>;
  /** The playable champions, from the pack's own data half. */
  champions: readonly BotRoleKit[];
  /**
   * Findings this pack has seen and not fixed yet, as `<rule>:<spellId>`.
   *
   * Present so a pack with a large existing roster can adopt the gate today
   * and go red on the next *new* one, rather than adopting nothing. Stale
   * entries fail: a list nobody has to keep accurate stops describing the
   * pack within a release.
   */
  knownDebt?: readonly string[];
  /** Names the suite, so a multi-pack repository says which pack failed. */
  label?: string;
}

/** A stat that answers `.value`, which is all `scoreSpell` reads. */
const stat = (value: number) => ({ value, baseValue: value });

const fakeChampion = (health: number, maxHealth: number, x: number) => ({
  stats: {
    health: stat(health),
    maxHealth: stat(maxHealth),
    attackRange: stat(130),
  },
  position: { x, y: 0 },
  shieldAmount: 0,
});

interface Scene {
  name: SceneName;
  posture: Posture;
  ownerHealthPct: number;
  /** Null for a scene with nothing to fight. */
  targetHealth: number | null;
  /** Multiple of the spell's own reach, so "in range" means in *its* range. */
  distanceFactor: number;
  focus: boolean;
}

const SCENES: Scene[] = [
  // A healthy fight at the edge of the ability's own reach: the ordinary case.
  { name: 'poke', posture: 'FIGHT', ownerHealthPct: 1, targetHealth: 200, distanceFactor: 0.9, focus: true },
  // The same fight against someone finishable, which is what `Burst` is for.
  { name: 'execute', posture: 'FIGHT', ownerHealthPct: 1, targetHealth: BURST_TARGET_HEALTH - 10, distanceFactor: 0.9, focus: true },
  // Out of reach: only a `Dash` scores here at all.
  { name: 'chase', posture: 'ENGAGE', ownerHealthPct: 1, targetHealth: 200, distanceFactor: 3, focus: true },
  // Still fighting, but hurt — where `Heal`/`Shield` start paying.
  { name: 'wounded', posture: 'FIGHT', ownerHealthPct: 0.25, targetHealth: 200, distanceFactor: 0.9, focus: true },
  // Running, nothing in front: the retreat filter applies as well as the score.
  { name: 'flee', posture: 'RETREAT', ownerHealthPct: 0.2, targetHealth: null, distanceFactor: 0, focus: false },
];

const MAX_HEALTH = 600;

/**
 * One spell's score in one scene, from the engine's own function.
 *
 * The brain is a stub rather than a real `BotBrain` because building one
 * needs a champion, a game and a team view — none of which changes a single
 * term in `scoreSpell`, all of which would make this file a match harness.
 * Everything the method actually touches is here, and `reachOf` comes off the
 * prototype with it so an undeclared range falls back to `aggroRange` exactly
 * as it does in a match.
 */
function scoreIn(spell: Spell, slot: number, mask: SpellRoleMask, scene: Scene): number {
  const profile = { ...profileFor('normal'), noise: 0 };
  const owner = fakeChampion(MAX_HEALTH * scene.ownerHealthPct, MAX_HEALTH, 0);
  const brain = {
    owner,
    profile,
    posture: scene.posture,
    rng: () => 0.5,
    reachOf: (BotBrain.prototype as unknown as Record<string, unknown>).reachOf,
    scoreSpell: BotBrain.prototype.scoreSpell,
  } as unknown as BotBrain;

  let target: unknown = null;
  if (scene.targetHealth !== null) {
    const reach = (brain as unknown as { reachOf: (s: Spell, t: unknown) => number }).reachOf.call(
      brain,
      spell,
      null
    );
    target = fakeChampion(scene.targetHealth, 200, reach * scene.distanceFactor);
  }
  const view = { focusTarget: scene.focus ? target : null };

  return (
    brain.scoreSpell as unknown as (
      s: Spell,
      i: number,
      m: SpellRoleMask,
      t: unknown,
      v: unknown
    ) => number
  ).call(brain, spell, slot, mask, target, view);
}

/** What `chooseSpell` would do with this spell, scene by scene. */
function scoreAll(spell: Spell, slot: number, mask: SpellRoleMask): Record<SceneName, number> {
  const out = {} as Record<SceneName, number>;
  for (const scene of SCENES) {
    // A fleeing bot does not evaluate the whole kit — `chooseSpell` narrows it
    // to `isRetreatCandidate` first, and a spell the filter drops is not
    // scored at all rather than scored badly.
    if (scene.posture === 'RETREAT' && !isRetreatCandidate(spell, mask)) {
      out[scene.name] = Number.NEGATIVE_INFINITY;
      continue;
    }
    out[scene.name] = scoreIn(spell, slot, mask, scene);
  }
  return out;
}

const best = (scores: Record<SceneName, number>, names: SceneName[]): number =>
  Math.max(...names.map(name => scores[name]));

/** The stub owner the catalogue generator already constructs every spell with. */
const OWNER_STUB = { game: { matchRules: { cooldownMultiplier: 1, manaFree: false } } };

/**
 * Every finding, for a whole pack. `describeBotRoles` is the usual entry
 * point; this one is exported for a pack that wants to print the table.
 */
export function botRoleIssues(fixture: BotRoleFixture): BotRoleIssue[] {
  const issues: BotRoleIssue[] = [];

  for (const kit of fixture.champions) {
    const label = kit.name ?? kit.id;
    const entries: { id: string; slot: number }[] = [
      ...kit.spells.map((id, index) => ({ id, slot: index + 1 })),
      ...(kit.formSpells ?? []).map((id, index) => ({ id, slot: index + 1 })),
    ];

    for (const { id, slot } of entries) {
      const SpellClass = fixture.spells[id] as (new (owner: unknown) => Spell) & {
        aiRoles?: SpellRoleMask;
      };
      if (typeof SpellClass !== 'function') continue;

      let spell: Spell;
      try {
        spell = new SpellClass(OWNER_STUB);
      } catch {
        // Construction is the catalogue generator's gate, not this one's.
        continue;
      }

      const tagged = SpellClass.aiRoles !== undefined;
      const mask = rolesOf(spell, slot);
      const scores = scoreAll(spell, slot, mask);
      const add = (rule: BotRuleName, message: string): void => {
        issues.push({ rule, key: `${rule}:${id}`, spellId: id, champion: label, slot, message, scores });
      };

      let targeting: string | null = null;
      try {
        targeting = spell.castSpec.targeting;
      } catch {
        // A spell that declares neither `castSpec` nor `targetingMode` throws
        // here by design; that is `ADDING_SPELLS.md`'s error, not this rule's.
      }

      if (targeting === 'SELF' && spell.manaCost > 0 && !tagged) {
        add(
          'self-cast-untagged',
          `${label} ${id} is a costed SELF cast with no \`static aiRoles\`, so ` +
            '`inferRoles` calls it `Buff | Shield` — the panic-button mask. Say what it does.'
        );
      }

      if (tagged && !hasRole(SpellClass.aiRoles as SpellRoleMask, SCORED_ROLES)) {
        add(
          'unpaid-tag',
          `${label} ${id} declares \`aiRoles\` that \`scoreSpell\` pays nothing for, ` +
            'so the tag lowers the score to whatever the slot bonus is. See `SCORED_ROLES`.'
        );
      }

      if (best(scores, [...FIGHTING, ...DEFENSIVE]) <= 0) {
        add(
          'unreachable',
          `${label} ${id} scores <= 0 in every scene, and \`chooseSpell\` drops those — ` +
            'the bot can never press it at all.'
        );
      } else if (best(scores, FIGHTING) <= 0) {
        add(
          'dead-in-combat',
          `${label} ${id} scores <= 0 in every fighting scene (best ` +
            `${best(scores, DEFENSIVE)} while hurt or fleeing), so a bot only presses it ` +
            'once it has already decided to leave.'
        );
      }

      if (slot === ULTIMATE_SLOT && best(scores, FIGHTING) < best(scores, DEFENSIVE)) {
        add(
          'panic-ultimate',
          `${label} ${id} scores ${best(scores, FIGHTING)} fighting against ` +
            `${best(scores, DEFENSIVE)} hurt or fleeing, so its best moment is nearly dying. ` +
            `An ultimate carries +${SCORE_ULTIMATE} already; what it needs is a role a fight pays for.`
        );
      }
    }
  }

  return issues;
}

/**
 * Registers the shared suite. Call it at the top level of the pack's own
 * `botRoles.test.ts`, then write that pack's own expectations underneath.
 */
export function describeBotRoles(fixture: BotRoleFixture): void {
  describe(fixture.label ?? 'the bot can reach this kit', () => {
    const issues = botRoleIssues(fixture);
    const debt = new Set(fixture.knownDebt ?? []);

    it('has a roster to sweep', () => {
      expect(fixture.champions.length).toBeGreaterThan(0);
      expect(Object.keys(fixture.spells).length).toBeGreaterThan(0);
    });

    it('leaves no ability the bot cannot reach', () => {
      const fresh = issues.filter(issue => !debt.has(issue.key));
      expect(fresh.map(issue => `${issue.key} — ${issue.message}`)).toEqual([]);
    });

    it('keeps the debt list honest', () => {
      // A licence for something already fixed is a licence that will quietly
      // cover the next regression with the same name.
      const live = new Set(issues.map(issue => issue.key));
      const stale = [...debt].filter(key => !live.has(key));
      expect(stale, 'fixed — delete these from `knownDebt`').toEqual([]);
    });
  });
}
