import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_MS, MatchRecorder, type RecorderPlayer } from '../../../src/game/combat/MatchRecorder';
import { MATCH_HISTORY_KEY, readMatchHistory } from '../../../src/game/config/matchHistory';
import type { Announcement } from '../../../src/game/combat/Announcer';

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

const bench = (enabled = true) => {
  const player: RecorderPlayer = {
    championId: 'lol:Yasuo',
    name: 'Yasuo',
    tally: { kills: 0, deaths: 0, assists: 0, minionsKilled: 0, damageDealt: 0 },
    wallet: { earnedTotal: 500 },
  };
  const state = { nowMs: 0, clock: 1_700_000_000_000, bots: 3 };
  const listeners: ((a: Announcement) => void)[] = [];
  const recorder = new MatchRecorder({
    matchId: 'match-1',
    mapId: 'lol:summoners-rift',
    mode: 'urf',
    enabled,
    nowMs: () => state.nowMs,
    clock: () => state.clock,
    player: () => player,
    botCount: () => state.bots,
    onAnnounce: listener => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
  });
  const announce = (partial: Partial<Announcement>) => {
    for (const listener of listeners) listener({ multi: 1, streak: 0, ...partial } as Announcement);
  };
  return { player, state, recorder, announce, listeners };
};

describe('MatchRecorder', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('snapshots the player’s numbers under the match’s id, map and mode', () => {
    const { player, state, recorder } = bench();
    player.tally.kills = 4;
    player.tally.minionsKilled = 61;
    player.tally.damageDealt = 999.6;
    state.nowMs = 120_000;
    expect(recorder.snapshot()).toMatchObject({
      id: 'match-1',
      mapId: 'lol:summoners-rift',
      mode: 'urf',
      championId: 'lol:Yasuo',
      championName: 'Yasuo',
      kills: 4,
      cs: 61,
      damage: 1000,
      gold: 500,
      durationMs: 120_000,
      endedAt: 1_700_000_000_000,
      bots: 3,
    });
  });

  it('does not write a match nothing has happened in yet', () => {
    const { recorder, state } = bench();
    state.nowMs = 5_000;
    expect(recorder.save()).toBe(false);
    expect(storage.getItem(MATCH_HISTORY_KEY)).toBeNull();
  });

  it('writes once it qualifies, and re-writes the same entry rather than a second one', () => {
    const { recorder, state, player } = bench();
    player.tally.kills = 1;
    expect(recorder.save()).toBe(true);
    state.nowMs = 300_000;
    player.tally.kills = 6;
    expect(recorder.save()).toBe(true);
    const { records } = readMatchHistory();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: 'match-1', kills: 6, durationMs: 300_000 });
  });

  it('keeps the best multi-kill and streak of the player’s own kills only', () => {
    const { recorder, player, announce } = bench();
    announce({ killerUnit: player as never, multi: 2, streak: 1 });
    announce({ killerUnit: { name: 'someone else' } as never, multi: 5, streak: 9 });
    announce({ killerUnit: player as never, multi: 1, streak: 4 });
    expect(recorder.bestMulti).toBe(2);
    expect(recorder.bestStreak).toBe(4);
    expect(recorder.snapshot()).toMatchObject({ bestMulti: 2, bestStreak: 4 });
  });

  it('autosaves every AUTOSAVE_MS of match time, not every tick', () => {
    const { recorder, state, player } = bench();
    player.tally.deaths = 1;
    state.nowMs = AUTOSAVE_MS - 1;
    recorder.tick();
    expect(storage.getItem(MATCH_HISTORY_KEY)).toBeNull();
    state.nowMs = AUTOSAVE_MS;
    recorder.tick();
    expect(readMatchHistory().records).toHaveLength(1);
    state.nowMs = AUTOSAVE_MS + 1_000;
    player.tally.deaths = 2;
    recorder.tick();
    expect(readMatchHistory().records[0].deaths).toBe(1);
    state.nowMs = AUTOSAVE_MS * 2;
    recorder.tick();
    expect(readMatchHistory().records[0].deaths).toBe(2);
  });

  it('is inert on a LAN client and lets go of the announcer on detach', () => {
    const { recorder, player, state, listeners } = bench(false);
    player.tally.kills = 3;
    state.nowMs = AUTOSAVE_MS * 3;
    recorder.tick();
    expect(recorder.save()).toBe(false);
    expect(storage.getItem(MATCH_HISTORY_KEY)).toBeNull();
    expect(listeners).toHaveLength(1);
    recorder.detach();
    expect(listeners).toHaveLength(0);
  });
});
