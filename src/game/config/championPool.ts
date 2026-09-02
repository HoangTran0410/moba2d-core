/**
 * Which packs' champions a random roll may land on.
 *
 * ## Why per pack, not per champion
 *
 * Three packs installed is three games' worth of champions, and "random" that
 * can hand a player a ninja when they came for a lane mage is random from the
 * wrong bag. The unit a player thinks in is the pack — *tonight I want lol
 * only* — and a pack heading in the champion picker is where that thought
 * already has a handle. A per-champion ban list is a different feature with a
 * different UI (sixty-six switches) and is not this.
 *
 * ## Stored as the exceptions
 *
 * `disabledPacks`, never the enabled ones: a pack installed tomorrow is in
 * the pool without anyone saying so, which is what "random" should mean for
 * something you just added. An empty list is every pack, and is also what a
 * missing or garbled blob reads as.
 *
 * ## The pool can never be empty
 *
 * `poolOf` falls back to every kit when the filter leaves none — a player who
 * switched off the only pack they have, or whose only enabled pack was
 * uninstalled, still gets a champion. A refused roll would be a match that
 * cannot start over a setting nobody can see from the menu.
 *
 * `localStorage` only, no imports from `src/game/` — this file is in the
 * `pregame` chunk with the rest of `config/` and is read by both the picker
 * and `preset.ts`'s roll.
 */

export const CHAMPION_POOL_KEY = 'moba2d:championPool:v1';

export interface ChampionPool {
  /** Pack ids (`manifest.id`) whose champions random skips. */
  readonly disabledPacks: readonly string[];
}

export const EMPTY_POOL: ChampionPool = Object.freeze({ disabledPacks: Object.freeze([]) });

const sanitize = (raw: unknown): ChampionPool => {
  if (!raw || typeof raw !== 'object') return EMPTY_POOL;
  const list = (raw as { disabledPacks?: unknown }).disabledPacks;
  if (!Array.isArray(list)) return EMPTY_POOL;
  const ids = [...new Set(list.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  return { disabledPacks: ids };
};

export function readChampionPool(): ChampionPool {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CHAMPION_POOL_KEY);
  } catch {
    return EMPTY_POOL;
  }
  if (!raw) return EMPTY_POOL;
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return EMPTY_POOL;
  }
}

export function writeChampionPool(pool: ChampionPool): void {
  try {
    localStorage.setItem(CHAMPION_POOL_KEY, JSON.stringify(sanitize(pool)));
  } catch {
    // Private mode or a full quota: the pool lives for this session only.
  }
}

/** Switch one pack in or out of the pool, persisted. Returns the new pool. */
export function setPackInPool(packId: string, inPool: boolean): ChampionPool {
  const current = new Set(readChampionPool().disabledPacks);
  if (inPool) current.delete(packId);
  else current.add(packId);
  const next: ChampionPool = { disabledPacks: [...current] };
  writeChampionPool(next);
  return next;
}

export const packInPool = (pool: ChampionPool, packId: string): boolean =>
  !pool.disabledPacks.includes(packId);

/**
 * The kits a roll may pick from: every kit whose pack is not disabled — or,
 * when that leaves nothing, every kit. Pure; the roll itself is the caller's.
 */
export function poolOf<T extends { packId: string }>(
  kits: readonly T[],
  disabledPacks: readonly string[]
): readonly T[] {
  if (disabledPacks.length === 0) return kits;
  const kept = kits.filter(kit => !disabledPacks.includes(kit.packId));
  return kept.length > 0 ? kept : kits;
}
