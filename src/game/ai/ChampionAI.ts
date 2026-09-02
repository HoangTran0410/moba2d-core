import { contentRegistry } from '@/content/registry';
import type { BotBrain, Posture } from '@/game/ai/BotBrain';
import type { TeamView } from '@/game/ai/TeamBlackboard';
import type { SpellRoleMask } from '@/game/ai/SpellRole';
import type AIChampion from '@/game/gameObject/attackableUnits/AIChampion';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import type Spell from '@/game/gameObject/Spell';
import type { Vec2 } from '@/game/spell/runtime/types';

/**
 * A champion's own opinion, laid over the shared brain.
 *
 * `BotBrain` plays every champion the same way: it knows "this spell does
 * damage, reaches 500, costs 40 mana" and nothing about *why* a kit exists —
 * that one champion farms a spell on minions, another places a wall to block
 * a path rather than to land on a body, a third should only ultimate after
 * a mark has landed. Everything the brain believes about a spell comes from
 * `inferRoles` reading the `castSpec`, and the shape of a spell is a poor
 * witness: a self-cast ultimate that costs mana reads as a defensive buff,
 * and a fleeing bot once pressed exactly that — a blink *onto* its pursuer.
 *
 * This is the place to be told. The brain still decides; at each of four
 * decision points it asks the champion first, and the champion answers or
 * returns `undefined`, which means "no opinion" and leaves the shared answer
 * standing. No hook may *add* a cast, a query or a move order — they only
 * answer the question the brain was already asking — so every fix to the
 * shared brain keeps benefiting the whole roster.
 *
 * **Where the opinions live: in the pack, never here.** Core ships no
 * Riot-named anything (`vocabularyBoundary.test.ts`), so a champion's AI is
 * part of its pack's code half — `ContentPackCode.championAI`, keyed by the
 * pack's own champion id, qualified at install exactly as a spell is
 * (`PackRegistry.championAIFor`). The bot reaches it through
 * `Champion.championId`, which `preset.ts` stamps from the catalogue row a
 * kit was built from; a hand-built kit has no champion and gets no opinion.
 *
 * **A bot can change champion mid-match.** `AIChampion.respawn` re-rolls the
 * preset by default, so the lookup is by *current* id on every think tick
 * (one string compare), and the scratch `state` is dropped whenever the id
 * changes — a stack counter left over from the last life's champion is
 * readable garbage.
 *
 * Spell roles are deliberately *not* part of this interface: a role is a
 * property of the spell, and `Spell.aiRoles` already carries it.
 */
export interface ChampionAI {
  /**
   * Adjust a spell's score. `situation.baseScore` is the brain's own number
   * **before** the difficulty noise is applied; the number returned replaces
   * it and the noise is still multiplied on afterwards, so a champion with an
   * opinion is not accidentally immune to the difficulty knob.
   * `undefined` keeps the brain's score.
   */
  scoreSpell?(context: AIContext, situation: SpellSituation): number | undefined;
  /** Where to aim a chosen spell. `undefined` uses the brain's own prediction. */
  aim?(context: AIContext, situation: SpellSituation): Vec2 | undefined;
  /** Override the posture the FSM just chose. `undefined` keeps it. */
  posture?(context: AIContext, suggested: Posture): Posture | undefined;
  /** Called after a successful press. Bookkeeping only — combos write `state` here and read it in `scoreSpell`. */
  onCast?(context: AIContext, situation: SpellSituation): void;
}

export interface AIContext {
  readonly brain: BotBrain;
  readonly owner: AIChampion;
  readonly view: TeamView;
  readonly nowMs: number;
  /** This bot's scratch memory. Emptied on respawn and whenever the champion changes. */
  readonly state: Record<string, unknown>;
  /** The brain's own random source — never `Math.random` in this directory. */
  readonly rng: () => number;
}

export interface SpellSituation {
  readonly spell: Spell;
  readonly slotIndex: number;
  readonly mask: SpellRoleMask;
  readonly target: AttackableUnit | null;
  /** The brain's score before noise; for `aim`/`onCast`, the chosen spell's noised score. */
  readonly baseScore: number;
}

/** Where a bot looks its champion up. Replaceable, so a suite can hand a brain an opinion without installing a pack. */
export const championAISource = {
  lookup: (championId: string): ChampionAI | undefined => contentRegistry().championAIFor(championId),
};

/**
 * One bot's standing opinion: which champion it is currently asking, that
 * champion's scratch state, and whether the AI has been switched off for
 * throwing. A `ChampionAI` that throws disables *itself* for the rest of the
 * match after one warning — a badly written champion breaks its own play,
 * never the game loop.
 */
export class ChampionOpinion {
  private ai: ChampionAI | null = null;
  private forId: string | null = null;
  private broken = false;
  state: Record<string, unknown> = {};

  constructor(private readonly lookup: (championId: string) => ChampionAI | undefined) {}

  /** Re-resolve when the champion changed; one string compare when it did not. */
  refresh(championId: string | undefined): void {
    const id = championId ?? null;
    if (id === this.forId) return;
    this.forId = id;
    this.ai = id ? (this.lookup(id) ?? null) : null;
    this.state = {};
    this.broken = false;
  }

  /** A new life starts with an empty notebook. */
  reset(): void {
    this.state = {};
  }

  get active(): boolean {
    return this.ai !== null && !this.broken;
  }

  scoreSpell(context: AIContext, situation: SpellSituation): number | undefined {
    const ai = this.usable();
    if (!ai?.scoreSpell) return undefined;
    const answer = this.guard('scoreSpell', () => ai.scoreSpell!(context, situation));
    return typeof answer === 'number' && Number.isFinite(answer) ? answer : undefined;
  }

  aim(context: AIContext, situation: SpellSituation): Vec2 | undefined {
    const ai = this.usable();
    if (!ai?.aim) return undefined;
    const answer = this.guard('aim', () => ai.aim!(context, situation));
    return answer && Number.isFinite(answer.x) && Number.isFinite(answer.y) ? answer : undefined;
  }

  posture(context: AIContext, suggested: Posture): Posture | undefined {
    const ai = this.usable();
    if (!ai?.posture) return undefined;
    return this.guard('posture', () => ai.posture!(context, suggested)) ?? undefined;
  }

  onCast(context: AIContext, situation: SpellSituation): void {
    const ai = this.usable();
    if (!ai?.onCast) return;
    this.guard('onCast', () => ai.onCast!(context, situation));
  }

  private usable(): ChampionAI | null {
    return this.broken ? null : this.ai;
  }

  private guard<T>(hook: string, call: () => T): T | undefined {
    try {
      return call();
    } catch (error) {
      this.broken = true;
      console.warn(`[ChampionAI ${this.forId}] ${hook} threw; this champion's AI is off for the rest of the match`, error);
      return undefined;
    }
  }
}
