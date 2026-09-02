import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HISTORY_CAP,
  MASTERY_MAX_LEVEL,
  MASTERY_THRESHOLDS,
  MATCH_HISTORY_KEY,
  MIN_RECORDED_MS,
  clearMatchHistory,
  foldMastery,
  formatDuration,
  formatWhen,
  kdaOf,
  masteryLevel,
  masteryOf,
  masteryPoints,
  masteryTable,
  masteryToNext,
  qualifies,
  readMatchHistory,
  recordMatch,
  sanitizeMatchHistory,
  upsertMatchRecord,
  type MatchRecord,
} from '../../../src/game/config/matchHistory';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const record = (overrides: Partial<MatchRecord> = {}): MatchRecord => ({
  id: 'm1',
  endedAt: 1_000,
  durationMs: 600_000,
  mapId: 'lol:summoners-rift',
  mode: 'classic',
  championId: 'lol:Yasuo',
  championName: 'Yasuo',
  kills: 5,
  deaths: 2,
  assists: 3,
  cs: 80,
  damage: 12_345,
  gold: 6_000,
  bestStreak: 3,
  bestMulti: 2,
  bots: 3,
  ...overrides,
});

describe('qualifies', () => {
  it('needs thirty seconds of match time, or anything to have happened', () => {
    expect(qualifies(record({ durationMs: MIN_RECORDED_MS, kills: 0, deaths: 0, assists: 0 }))).toBe(true);
    expect(qualifies(record({ durationMs: 10_000, kills: 0, deaths: 0, assists: 0 }))).toBe(false);
    expect(qualifies(record({ durationMs: 10_000, kills: 0, deaths: 1, assists: 0 }))).toBe(true);
    expect(qualifies(record({ durationMs: 10_000, kills: 0, deaths: 0, assists: 1 }))).toBe(true);
  });
});

describe('upsertMatchRecord', () => {
  const empty = { records: [], archive: {} };

  it('adds newest first and replaces a record with the same id', () => {
    const one = upsertMatchRecord(empty, record({ id: 'a', endedAt: 100 }));
    const two = upsertMatchRecord(one, record({ id: 'b', endedAt: 200 }));
    expect(two.records.map(r => r.id)).toEqual(['b', 'a']);
    const again = upsertMatchRecord(two, record({ id: 'a', endedAt: 300, kills: 9 }));
    expect(again.records.map(r => r.id)).toEqual(['a', 'b']);
    expect(again.records[0].kills).toBe(9);
    expect(again.records).toHaveLength(2);
  });

  it('evicts past the cap into the archive, folded per champion, and never loses their points', () => {
    let history = empty as ReturnType<typeof upsertMatchRecord>;
    for (let i = 0; i < HISTORY_CAP + 3; i++) {
      history = upsertMatchRecord(history, record({ id: `m${i}`, endedAt: i, championId: i % 2 ? 'lol:Zed' : 'lol:Yasuo' }));
    }
    expect(history.records).toHaveLength(HISTORY_CAP);
    expect(history.records[0].id).toBe(`m${HISTORY_CAP + 2}`);
    // m0, m1, m2 fell off: two Yasuo (0, 2) and one Zed (1).
    expect(history.archive['lol:Yasuo'].matches).toBe(2);
    expect(history.archive['lol:Zed'].matches).toBe(1);
    expect(history.archive['lol:Yasuo'].points).toBe(2 * masteryPoints(record()));
    // The total still counts every match ever written.
    const table = masteryTable(history);
    expect(table.get('lol:Yasuo')!.matches + table.get('lol:Zed')!.matches).toBe(HISTORY_CAP + 3);
  });

  it('does not archive a hand-built kit — there is no champion to credit', () => {
    let history = empty as ReturnType<typeof upsertMatchRecord>;
    for (let i = 0; i <= HISTORY_CAP; i++) {
      history = upsertMatchRecord(history, record({ id: `m${i}`, endedAt: i, championId: null }));
    }
    expect(history.archive).toEqual({});
  });

  it('leaves its input alone', () => {
    const before = { records: [record({ id: 'a' })], archive: {} };
    upsertMatchRecord(before, record({ id: 'b' }));
    expect(before.records.map(r => r.id)).toEqual(['a']);
  });
});

describe('mastery', () => {
  it('scores a match from kills, assists, farm and time, with a floor', () => {
    expect(masteryPoints(record({ kills: 0, assists: 0, cs: 0, durationMs: 0, deaths: 20 }))).toBe(20);
    expect(masteryPoints(record({ kills: 5, assists: 3, cs: 80, durationMs: 600_000, deaths: 2 }))).toBe(
      20 + 50 + 15 + 40 + 30 - 8
    );
  });

  it('levels climb the thresholds and stop at the top', () => {
    expect(masteryLevel(0)).toBe(1);
    expect(masteryLevel(MASTERY_THRESHOLDS[1] - 1)).toBe(1);
    expect(masteryLevel(MASTERY_THRESHOLDS[1])).toBe(2);
    expect(masteryLevel(MASTERY_THRESHOLDS[MASTERY_MAX_LEVEL - 1])).toBe(MASTERY_MAX_LEVEL);
    expect(masteryLevel(1e9)).toBe(MASTERY_MAX_LEVEL);
    expect(masteryToNext(0)).toBe(MASTERY_THRESHOLDS[1]);
    expect(masteryToNext(1e9)).toBeNull();
    for (let i = 1; i < MASTERY_THRESHOLDS.length; i++) {
      expect(MASTERY_THRESHOLDS[i]).toBeGreaterThan(MASTERY_THRESHOLDS[i - 1]);
    }
  });

  it('folds a record into a total, keeping the best run and the latest date', () => {
    const one = foldMastery(undefined, record({ bestStreak: 3, endedAt: 10 }));
    const two = foldMastery(one, record({ id: 'm2', bestStreak: 1, bestMulti: 4, endedAt: 5, kills: 1 }));
    expect(two.matches).toBe(2);
    expect(two.kills).toBe(6);
    expect(two.bestStreak).toBe(3);
    expect(two.bestMulti).toBe(4);
    expect(two.lastPlayedAt).toBe(10);
    expect(two.playMs).toBe(1_200_000);
  });

  it('masteryOf is the archive plus the ring, and null for a champion never played', () => {
    const history = {
      records: [record({ id: 'a', championId: 'lol:Yasuo', kills: 2 })],
      archive: { 'lol:Yasuo': foldMastery(undefined, record({ id: 'old', kills: 10 })) },
    };
    const yasuo = masteryOf(history, 'lol:Yasuo')!;
    expect(yasuo.matches).toBe(2);
    expect(yasuo.kills).toBe(12);
    expect(masteryOf(history, 'lol:Zed')).toBeNull();
  });

  it('kda floors deaths at one', () => {
    expect(kdaOf({ kills: 4, deaths: 0, assists: 2 })).toBe(6);
    expect(kdaOf({ kills: 4, deaths: 2, assists: 2 })).toBe(3);
  });
});

describe('the store', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads nothing as an empty history, and garbage the same way', () => {
    expect(readMatchHistory()).toEqual({ records: [], archive: {} });
    storage.setItem(MATCH_HISTORY_KEY, '{oops');
    expect(readMatchHistory()).toEqual({ records: [], archive: {} });
  });

  it('drops broken records, dedupes by id, sorts newest first and caps', () => {
    const history = sanitizeMatchHistory({
      records: [
        { id: 'a', endedAt: 1, kills: '3' },
        { id: 'a', endedAt: 9 },
        { nope: true },
        { id: 'b', endedAt: 5, championId: '' },
        ...Array.from({ length: HISTORY_CAP }, (_, i) => ({ id: `x${i}`, endedAt: 100 + i })),
      ],
      archive: { 'lol:Zed': { matches: 2, points: 'many' }, '': { matches: 1 } },
    });
    expect(history.records).toHaveLength(HISTORY_CAP);
    expect(history.records[0].id).toBe(`x${HISTORY_CAP - 1}`);
    expect(history.records.some(r => r.id === 'a')).toBe(false);
    expect(history.archive['lol:Zed']).toMatchObject({ matches: 2, points: 0 });
    expect(Object.keys(history.archive)).toEqual(['lol:Zed']);
    const b = sanitizeMatchHistory({ records: [{ id: 'b', endedAt: 5, championId: '' }] }).records[0];
    expect(b.championId).toBeNull();
    expect(b.championName).toBe('?');
  });

  it('recordMatch writes a qualifying match and refuses one that is not', () => {
    expect(recordMatch(record({ durationMs: 5_000, kills: 0, deaths: 0, assists: 0 }))).toBe(false);
    expect(storage.getItem(MATCH_HISTORY_KEY)).toBeNull();
    expect(recordMatch(record())).toBe(true);
    expect(readMatchHistory().records.map(r => r.id)).toEqual(['m1']);
    recordMatch(record({ kills: 7 }));
    expect(readMatchHistory().records).toHaveLength(1);
    expect(readMatchHistory().records[0].kills).toBe(7);
    clearMatchHistory();
    expect(readMatchHistory().records).toEqual([]);
  });
});

describe('formatting', () => {
  it('formats a duration as m:ss, with hours once past one', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(725_000)).toBe('12:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });

  it('says today, yesterday, or the date', () => {
    const now = new Date(2026, 8, 2, 20, 0).getTime();
    expect(formatWhen(new Date(2026, 8, 2, 17, 20).getTime(), now)).toBe('Hôm nay 17:20');
    expect(formatWhen(new Date(2026, 8, 1, 21, 3).getTime(), now)).toBe('Hôm qua 21:03');
    expect(formatWhen(new Date(2026, 7, 28, 9, 5).getTime(), now)).toBe('28/08 09:05');
  });
});
