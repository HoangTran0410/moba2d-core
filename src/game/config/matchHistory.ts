/**
 * What a match leaves behind, and what the matches add up to.
 *
 * ## Why there is a history at all in a game with no end
 *
 * This is a practice room: a match ends when the player leaves it, and every
 * number `MatchTally` counted left with them. Nothing said *you have played
 * this champion eleven evenings and your KDA is climbing*, which is the one kind of
 * progress a sandbox can honestly offer — no win to record, but a self to
 * compare against. So: one summary per match, kept on the device, and a
 * running total per champion the picker can wear as a badge.
 *
 * ## The ring and the archive
 *
 * `records` is the last `HISTORY_CAP` matches, newest first. A match is
 * written by id (`Game.matchId`), so the recorder can save the *same* match
 * every thirty seconds and once more on the way out without counting it
 * twice — the second write replaces the first. When a record falls off the
 * end of the ring its numbers are folded into `archive[championId]`, so the
 * mastery total never forgets a match the list no longer shows:
 * `masteryOf` is the archive plus whatever is still in the ring.
 *
 * ## What counts as a match
 *
 * `qualifies`: thirty seconds of match time, or any kill, death or assist. A
 * restart ten seconds in — the wrong map, the wrong mode — is not an evening
 * anyone wants on their record, and a bare restart would otherwise write one
 * every time.
 *
 * `localStorage` only, no imports from `src/game/`: this is in the `pregame`
 * chunk beside the other stores, because the picker reads it before any
 * match exists.
 */

export const MATCH_HISTORY_KEY = 'moba2d:matchHistory:v1';

/** How many matches the list keeps. Older ones live on in the archive only. */
export const HISTORY_CAP = 40;

/** Under this much match time, with nothing happening, a match is not recorded. */
export const MIN_RECORDED_MS = 30_000;

export interface MatchRecord {
  /** `Game.matchId` — what makes a save idempotent. */
  id: string;
  /** Wall clock (`Date.now()`) of the last save. */
  endedAt: number;
  /** `Game.matchTimeMs` at the last save — unpaused match time. */
  durationMs: number;
  mapId: string;
  /** `MatchModeId`, as a string so this module needs no import for it. */
  mode: string;
  /** Qualified champion id, or null for a hand-built kit. */
  championId: string | null;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  /** Minions killed. */
  cs: number;
  damage: number;
  /** Gold earned over the match — `Wallet.earnedTotal`. */
  gold: number;
  bestStreak: number;
  bestMulti: number;
  bots: number;
}

export interface MasteryStats {
  matches: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damage: number;
  playMs: number;
  bestStreak: number;
  bestMulti: number;
  points: number;
  lastPlayedAt: number;
}

export interface MatchHistory {
  /** Newest first. */
  records: MatchRecord[];
  /** Per `championId`: what fell off the ring. */
  archive: Record<string, MasteryStats>;
}

export const EMPTY_HISTORY: MatchHistory = Object.freeze({
  records: Object.freeze([]) as unknown as MatchRecord[],
  archive: Object.freeze({}),
});

// ------------------------------------------------------------------ sanitise

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

const sanitizeRecord = (raw: unknown): MatchRecord | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Record<keyof MatchRecord, unknown>>;
  const id = str(r.id);
  if (!id) return null;
  return {
    id,
    endedAt: num(r.endedAt),
    durationMs: Math.max(0, num(r.durationMs)),
    mapId: str(r.mapId),
    mode: str(r.mode, 'classic'),
    championId: typeof r.championId === 'string' && r.championId ? r.championId : null,
    championName: str(r.championName, '?'),
    kills: num(r.kills),
    deaths: num(r.deaths),
    assists: num(r.assists),
    cs: num(r.cs),
    damage: num(r.damage),
    gold: num(r.gold),
    bestStreak: num(r.bestStreak),
    bestMulti: num(r.bestMulti),
    bots: num(r.bots),
  };
};

const sanitizeStats = (raw: unknown): MasteryStats | null => {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<Record<keyof MasteryStats, unknown>>;
  return {
    matches: num(s.matches),
    kills: num(s.kills),
    deaths: num(s.deaths),
    assists: num(s.assists),
    cs: num(s.cs),
    damage: num(s.damage),
    playMs: num(s.playMs),
    bestStreak: num(s.bestStreak),
    bestMulti: num(s.bestMulti),
    points: num(s.points),
    lastPlayedAt: num(s.lastPlayedAt),
  };
};

export const sanitizeMatchHistory = (raw: unknown): MatchHistory => {
  if (!raw || typeof raw !== 'object') return { records: [], archive: {} };
  const source = raw as { records?: unknown; archive?: unknown };
  const records: MatchRecord[] = [];
  const seen = new Set<string>();
  if (Array.isArray(source.records)) {
    for (const item of source.records) {
      const record = sanitizeRecord(item);
      if (!record || seen.has(record.id)) continue;
      seen.add(record.id);
      records.push(record);
    }
  }
  records.sort((a, b) => b.endedAt - a.endedAt);
  const archive: Record<string, MasteryStats> = {};
  if (source.archive && typeof source.archive === 'object') {
    for (const [id, value] of Object.entries(source.archive as Record<string, unknown>)) {
      const stats = sanitizeStats(value);
      if (id && stats) archive[id] = stats;
    }
  }
  return { records: records.slice(0, HISTORY_CAP), archive };
};

// -------------------------------------------------------------------- storage

export function readMatchHistory(): MatchHistory {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(MATCH_HISTORY_KEY);
  } catch {
    return { records: [], archive: {} };
  }
  if (!raw) return { records: [], archive: {} };
  try {
    return sanitizeMatchHistory(JSON.parse(raw));
  } catch {
    return { records: [], archive: {} };
  }
}

export function writeMatchHistory(history: MatchHistory): void {
  try {
    localStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Private mode or a full quota: this evening is not remembered.
  }
}

export function clearMatchHistory(): void {
  try {
    localStorage.removeItem(MATCH_HISTORY_KEY);
  } catch {
    // Nothing to clear, or nowhere to clear it from.
  }
}

// -------------------------------------------------------------------- mastery

/**
 * What one match is worth. Kills and assists carry it, time played keeps a
 * quiet farming evening from being worth nothing, deaths cost a little, and
 * the floor means every recorded match moves the bar — the bar is for having
 * played, not for having played well.
 */
export function masteryPoints(record: MatchRecord): number {
  const minutes = record.durationMs / 60_000;
  const raw =
    20 + 10 * record.kills + 5 * record.assists + 0.5 * record.cs + 3 * minutes - 4 * record.deaths;
  return Math.max(20, Math.round(raw));
}

/** Points at which each level begins; the index is the level minus one. */
export const MASTERY_THRESHOLDS: readonly number[] = Object.freeze([
  0, 300, 800, 1600, 3000, 5000, 8000,
]);

export const MASTERY_MAX_LEVEL = MASTERY_THRESHOLDS.length;

export function masteryLevel(points: number): number {
  let level = 0;
  for (const threshold of MASTERY_THRESHOLDS) if (points >= threshold) level++;
  return Math.max(1, level);
}

/** Points still needed for the next level, or null at the top. */
export function masteryToNext(points: number): number | null {
  const level = masteryLevel(points);
  if (level >= MASTERY_MAX_LEVEL) return null;
  return MASTERY_THRESHOLDS[level] - points;
}

const EMPTY_STATS: MasteryStats = Object.freeze({
  matches: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
  cs: 0,
  damage: 0,
  playMs: 0,
  bestStreak: 0,
  bestMulti: 0,
  points: 0,
  lastPlayedAt: 0,
});

export function foldMastery(base: MasteryStats | undefined, record: MatchRecord): MasteryStats {
  const b = base ?? EMPTY_STATS;
  return {
    matches: b.matches + 1,
    kills: b.kills + record.kills,
    deaths: b.deaths + record.deaths,
    assists: b.assists + record.assists,
    cs: b.cs + record.cs,
    damage: b.damage + record.damage,
    playMs: b.playMs + record.durationMs,
    bestStreak: Math.max(b.bestStreak, record.bestStreak),
    bestMulti: Math.max(b.bestMulti, record.bestMulti),
    points: b.points + masteryPoints(record),
    lastPlayedAt: Math.max(b.lastPlayedAt, record.endedAt),
  };
}

/** Every champion's total: the archive, then the ring folded on top. */
export function masteryTable(history: MatchHistory): Map<string, MasteryStats> {
  const table = new Map<string, MasteryStats>();
  for (const [id, stats] of Object.entries(history.archive)) table.set(id, stats);
  for (const record of history.records) {
    if (!record.championId) continue;
    table.set(record.championId, foldMastery(table.get(record.championId), record));
  }
  return table;
}

export function masteryOf(history: MatchHistory, championId: string): MasteryStats | null {
  return masteryTable(history).get(championId) ?? null;
}

/** Kills plus assists over deaths, deaths floored at one — the scoreboard's usual. */
export const kdaOf = (s: { kills: number; deaths: number; assists: number }): number =>
  (s.kills + s.assists) / Math.max(1, s.deaths);

// -------------------------------------------------------------------- writing

export const qualifies = (record: MatchRecord): boolean =>
  record.durationMs >= MIN_RECORDED_MS || record.kills + record.deaths + record.assists > 0;

/**
 * The ring with `record` written into it — replacing the entry with the same
 * id if there is one, newest first, evicting past the cap into the archive.
 * Pure; `recordMatch` is the storage-touching wrapper.
 */
export function upsertMatchRecord(history: MatchHistory, record: MatchRecord): MatchHistory {
  const kept = history.records.filter(r => r.id !== record.id);
  kept.unshift(record);
  kept.sort((a, b) => b.endedAt - a.endedAt);
  const archive = { ...history.archive };
  for (const evicted of kept.splice(HISTORY_CAP)) {
    if (!evicted.championId) continue;
    archive[evicted.championId] = foldMastery(archive[evicted.championId], evicted);
  }
  return { records: kept, archive };
}

/** Save one match. Returns false — and writes nothing — for a match that does not qualify. */
export function recordMatch(record: MatchRecord): boolean {
  if (!qualifies(record)) return false;
  writeMatchHistory(upsertMatchRecord(readMatchHistory(), record));
  return true;
}

// ----------------------------------------------------------------- formatting

/** `12:05` for twelve minutes, `1:02:05` past an hour. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const two = (n: number): string => String(n).padStart(2, '0');

/** "Hôm nay 17:20", "Hôm qua 21:03", else "02/09 17:20". */
export function formatWhen(endedAt: number, now: number = Date.now()): string {
  const at = new Date(endedAt);
  const today = new Date(now);
  const clock = `${two(at.getHours())}:${two(at.getMinutes())}`;
  if (sameDay(at, today)) return `Hôm nay ${clock}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(at, yesterday)) return `Hôm qua ${clock}`;
  return `${two(at.getDate())}/${two(at.getMonth() + 1)} ${clock}`;
}
