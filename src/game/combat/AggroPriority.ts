/**
 * What a turret or a wave shoots at, and how long it keeps shooting it.
 *
 * ## The problem this exists for
 *
 * Both of the units that pick their own targets — `structures/Turret` and
 * `attackableUnits/Minion` — did it the same two ways: nearest minion,
 * otherwise nearest of whatever else. The turret had one rule on top of that
 * (an enemy champion hitting an ally under it) and the wave had none at all.
 *
 * That produced two behaviours players read as bugs rather than as rules.
 * A wave never peeled for its own carry: stand behind your minions, hit the
 * enemy laner, and their minions carried on trading with yours. And **nothing
 * held a target**: both re-picked "nearest" on every scan, so a minion the
 * turret had taken to 10% health walked one pixel further out than its
 * neighbour and the tower started again on a full-health one. Shots landed
 * everywhere and killed nothing.
 *
 * ## The ladder
 *
 * The rule the source game actually uses is a ladder of *(who is attacking,
 * whom are they attacking)* pairs, then nearest-by-kind as the floor. A
 * turret's ladder is the wave's with the middle removed:
 *
 * | | turret | minion |
 * |---|---|---|
 * | enemy champion hitting an allied champion | 1 | 1 |
 * | enemy minion hitting an allied champion | 2 | 2 |
 * | enemy minion hitting an allied minion | — | 3 |
 * | anything else hitting an allied minion | — | 4 |
 * | nearest minion | 3 | 5 |
 * | nearest champion | 4 | 6 |
 *
 * So the rules are data, not code: each caller passes its own ordered list and
 * the arithmetic here is shared. The `attacker`/`victim` tests are predicates
 * rather than constructors on purpose — `Minion` cannot import `Turret` to
 * write `instanceof Turret`, because `Turret` imports `Minion`, and rule 4 is
 * the row that wants it. Its predicate is "anything else that is already a
 * legal candidate", which a turret is the reason for and a hostile pet
 * satisfies too; a pet shelling your wave is a thing the wave should answer.
 *
 * ## Holding
 *
 * A target is kept while it is still worth keeping, and only a **better rung**
 * takes it away. Not merely a different one: two enemies both hitting allies
 * would otherwise trade the aggro back and forth every scan as they move, which
 * is the thrash this replaces wearing a new hat.
 *
 * Nothing here knows what "still worth keeping" means — dead, out of range, out
 * of sight and untargetable are the caller's own predicates, which it already
 * has to re-check every frame rather than every scan. This module is passed the
 * answer.
 *
 * ## Why the held rung is remembered rather than recomputed
 *
 * A rung is read off `recentAttacker`, and `recentAttacker` is **one slot**: the
 * last enemy to have hit that ally, aged out after `RECENT_ATTACKER_MS`. In a
 * wave against a wave, every allied minion is being hit by two or three enemies
 * at once, so that slot is rewritten several times a second and the answer to
 * "is the thing I am shooting still marked?" flips to *no* the moment one of its
 * neighbours lands the next swing.
 *
 * Recomputing the held rung from that slot therefore said `Infinity` — on no
 * rung at all — for a target that was, in fact, still hitting an ally. Every
 * other attacker sat on rung 3, `3 < Infinity`, and the whole wave swapped
 * targets on every scan: shots spread over five bodies, nothing died, and with
 * the minion silhouettes turning to face what they fight it was visible as a
 * lane of minions spinning in place. It was there before they turned; there was
 * simply nothing on screen that could show it.
 *
 * So the caller hands back the rung its target was *taken* on and passes it in
 * again next scan. The remembered rung is only ever improved, never degraded —
 * `min` against what the target is marked at now — so a held target that starts
 * hitting a champion climbs, and one whose victim was hit by somebody else does
 * not fall.
 *
 * This is the source game's rule, which is a rule about *events* and not about a
 * scan: a minion retargets when its target dies, when its target leaves range,
 * or when something lands on a strictly higher rung. Not when the rungs it is
 * already on get reshuffled underneath it.
 */

/** The little a ladder needs to know about a unit. */
export interface AggroCandidate {
  position: { x: number; y: number };
  isDead: boolean;
  /** The last enemy to damage it — `AttackableUnit.recentAttacker`. */
  recentAttacker: unknown;
}

/** One rung: "something matching `attacker` is hitting something matching `victim`". */
export interface AggroRule<T> {
  attacker: (unit: T) => boolean;
  victim: (ally: T) => boolean;
}

export interface AggroLadder<T> {
  /** Ordered rungs. The first one that matches anything wins. */
  defend: AggroRule<T>[];
  /** The floor, in order: nearest candidate matching each, first non-empty wins. */
  nearest: ((unit: T) => boolean)[];
}

const squaredDistance = (
  from: { x: number; y: number },
  to: { x: number; y: number }
): number => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dx * dx + dy * dy;
};

/**
 * The best rung any candidate currently sits on, and who sits on it.
 *
 * One pass over the allies, because a rung is a fact about *the ally being
 * hit* — `recentAttacker` points from victim to attacker and there is no index
 * the other way. Ties inside a rung go to whoever is nearest the scanner,
 * which is the only tiebreak that does not depend on iteration order.
 *
 * `rank` is the rung's index, so smaller is better and `Infinity` is "on no
 * rung at all". Exported for the hold comparison, which needs to ask the same
 * question about a target it already holds.
 */
export function markedTarget<T extends AggroCandidate>(
  origin: { x: number; y: number },
  candidates: readonly T[],
  allies: readonly T[],
  ladder: AggroLadder<T>
): { unit: T; rank: number } | null {
  if (ladder.defend.length === 0 || candidates.length === 0) return null;

  // A rung only counts when the attacker is something this scanner could
  // actually shoot: an ally hit from out of range, from stealth or from across
  // a wall must not aim the tower at a unit it will then refuse to fire on.
  const shootable = new Set<unknown>(candidates);

  let best: { unit: T; rank: number } | null = null;
  let bestDistance = Infinity;

  for (const ally of allies) {
    if (ally.isDead) continue;
    const attacker = ally.recentAttacker as T | null;
    if (!attacker || !shootable.has(attacker)) continue;

    for (let rank = 0; rank < ladder.defend.length; rank++) {
      // Past the rung we already hold: a worse pairing cannot win, and the
      // rungs are ordered, so there is nothing further down worth testing.
      // `>` and not `>=` — an equal rung still gets to argue on distance.
      if (best && rank > best.rank) break;
      const rule = ladder.defend[rank];
      if (!rule.attacker(attacker) || !rule.victim(ally)) continue;

      const distance = squaredDistance(origin, attacker.position);
      if (!best || rank < best.rank || distance < bestDistance) {
        best = { unit: attacker, rank };
        bestDistance = distance;
      }
      break;
    }
  }

  return best;
}

/** The floor of the ladder: nearest candidate of the first kind that has one. */
export function nearestTarget<T extends AggroCandidate>(
  origin: { x: number; y: number },
  candidates: readonly T[],
  ladder: AggroLadder<T>
): T | null {
  for (const matches of ladder.nearest) {
    let best: T | null = null;
    let bestDistance = Infinity;
    for (const unit of candidates) {
      if (!matches(unit)) continue;
      const distance = squaredDistance(origin, unit.position);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = unit;
    }
    if (best) return best;
  }
  return null;
}

/** A pick, and the rung it was made on. `Infinity` is the nearest-body floor. */
export interface AggroChoice<T> {
  unit: T;
  rank: number;
}

export interface AggroPick<T> {
  origin: { x: number; y: number };
  /** What is being shot at right now, or null. */
  current: T | null;
  /** Whether `current` is still shootable — the caller's own predicate. */
  held: boolean;
  /**
   * The rung `current` was taken on — `AggroChoice.rank` from the call that
   * produced it, kept by the caller between scans. Defaults to the floor, which
   * is what a target acquired by any other route (a taunt, a hit taken while
   * idle) sits on. See the header for why this is not recomputed here.
   */
  currentRank?: number;
  /** Hostile, in range, visible, targetable. Everything the scanner may shoot. */
  candidates: readonly T[];
  /** Friendly units the ladder defends. Empty is legal and skips the rungs. */
  allies: readonly T[];
  ladder: AggroLadder<T>;
}

/**
 * The whole decision: defend a rung, else keep what you have, else take the
 * nearest.
 *
 * The middle line is the one that changes how a lane looks. A held target is
 * only given up to a *better* rung — never to a nearer body of the same kind —
 * so a turret finishes the minion it started and a wave finishes the minion it
 * started, which is what makes last-hitting under tower a skill rather than a
 * coin flip.
 */
export function pickAggroTarget<T extends AggroCandidate>({
  origin,
  current,
  held,
  currentRank = Infinity,
  candidates,
  allies,
  ladder,
}: AggroPick<T>): AggroChoice<T> | null {
  const marked = markedTarget(origin, candidates, allies, ladder);

  // What rung the held target is on, so "better" is a comparison and not a
  // guess. The remembered rung against what it is marked at *now*, whichever is
  // better — climbing is a real change of situation, falling is the volatile
  // `recentAttacker` slot moving on. See the header.
  const heldRank =
    held && current
      ? Math.min(currentRank, markedTarget(origin, [current], allies, ladder)?.rank ?? Infinity)
      : Infinity;

  if (marked && marked.rank < heldRank) return marked;
  if (held && current) return { unit: current, rank: heldRank };
  const floor = nearestTarget(origin, candidates, ladder);
  return floor ? { unit: floor, rank: Infinity } : null;
}
