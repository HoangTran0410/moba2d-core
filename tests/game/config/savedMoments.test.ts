import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SAVED_MOMENTS_STORAGE_KEY,
  SAVED_MOMENT_NAME_MAX,
  deleteSavedMoment,
  loadSavedMoments,
  renameSavedMoment,
  sanitizeMomentOverlay,
  saveSavedMoment,
  stashMomentBoot,
  takeMomentBoot,
  type MomentOverlay,
} from '../../../src/game/config/savedMoments';
import {
  DEFAULT_PREGAME_CONFIG,
  sanitizePregameConfig,
} from '../../../src/game/config/PregameConfig';
import { MatchTeam } from '../../../src/game/config/MatchTeams';

/**
 * Same in-memory `localStorage` as `matchTemplates.test.ts`, for the same
 * reason: this vitest environment is `node` and has no ambient storage.
 */
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

const SETUP = {
  config: sanitizePregameConfig({
    ...DEFAULT_PREGAME_CONFIG,
    playerTeam: MatchTeam.RED,
    ai: { ...DEFAULT_PREGAME_CONFIG.ai, count: 3 },
  }),
  items: { player: ['probe:boots'], bots: [['probe:ward'], []] },
};

/** An overlay that is nothing like the zero state, so a round-trip proves the move. */
const OVERLAY: MomentOverlay = {
  matchTimeMs: 123_456,
  player: {
    x: 640,
    y: 1280,
    health: 512,
    mana: 130,
    dead: false,
    reviveAfterMs: 0,
    gold: 1450,
    spells: [
      null,
      { cooldownMs: 2500, stacks: 88, fields: { chargeMs: 1200, armed: true, tag: 'q' } },
    ],
  },
  bots: [
    {
      x: 100,
      y: 200,
      health: 0,
      mana: 10,
      dead: true,
      reviveAfterMs: 4200,
      gold: 300,
      spells: [],
    },
  ],
  minionClock: { elapsedMs: 90_000, nextWaveIn: 12_000, waveCount: 4 },
  monsters: [{ x: 500, y: 500, health: 750, dead: false, reviveAfterMs: 0 }],
};

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  // The stash is module state and outlives a stubbed storage — drain whatever
  // an earlier test parked.
  takeMomentBoot();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('savedMoments', () => {
  it('round-trips a moment through serialize and parse, overlay included', () => {
    const saved = saveSavedMoment('Giữa giao tranh', 0xdead, SETUP, OVERLAY);
    expect(saved.id).toBeTruthy();
    expect(saved.matchSeed).toBe(0xdead);

    const loaded = loadSavedMoments();
    expect(loaded).toHaveLength(1);
    const moment = loaded[0];
    expect(moment.name).toBe('Giữa giao tranh');
    expect(moment.setup.config.playerTeam).toBe(MatchTeam.RED);
    expect(moment.setup.items.player).toEqual(['probe:boots']);
    expect(moment.overlay.matchTimeMs).toBe(123_456);
    expect(moment.overlay.player.gold).toBe(1450);
    expect(moment.overlay.player.spells[0]).toBeNull();
    expect(moment.overlay.player.spells[1]).toEqual({
      cooldownMs: 2500,
      stacks: 88,
      fields: { chargeMs: 1200, armed: true, tag: 'q' },
    });
    expect(moment.overlay.bots[0].dead).toBe(true);
    expect(moment.overlay.bots[0].reviveAfterMs).toBe(4200);
    expect(moment.overlay.minionClock).toEqual({
      elapsedMs: 90_000,
      nextWaveIn: 12_000,
      waveCount: 4,
    });
    expect(moment.overlay.monsters).toHaveLength(1);

    // What actually hit storage parses back to the same thing — the JSON is
    // the contract, not the in-memory object.
    const raw = localStorage.getItem(SAVED_MOMENTS_STORAGE_KEY)!;
    expect(JSON.parse(raw)[0].overlay.player.spells[1].stacks).toBe(88);
  });

  it('lists newest first, renames and deletes by id', () => {
    const first = saveSavedMoment('Một', 1, SETUP, OVERLAY);
    const second = saveSavedMoment('Hai', 2, SETUP, OVERLAY);

    expect(loadSavedMoments().map(moment => moment.id)).toEqual([second.id, first.id]);

    renameSavedMoment(first.id, '  Một mới  ');
    expect(loadSavedMoments().find(moment => moment.id === first.id)?.name).toBe('Một mới');

    renameSavedMoment(first.id, '   ');
    expect(loadSavedMoments().find(moment => moment.id === first.id)?.name).toBe('Một mới');

    deleteSavedMoment(second.id);
    expect(loadSavedMoments().map(moment => moment.id)).toEqual([first.id]);
    deleteSavedMoment('no-such-id');
    expect(loadSavedMoments()).toHaveLength(1);
  });

  it('refuses a blank name and caps a long one', () => {
    expect(() => saveSavedMoment('   ', 1, SETUP, OVERLAY)).toThrow();
    const saved = saveSavedMoment('M'.repeat(SAVED_MOMENT_NAME_MAX + 20), 1, SETUP, OVERLAY);
    expect(saved.name).toHaveLength(SAVED_MOMENT_NAME_MAX);
  });

  it('reads a corrupt library as empty, and drops only the rotten entries', () => {
    localStorage.setItem(SAVED_MOMENTS_STORAGE_KEY, '{not json');
    expect(loadSavedMoments()).toEqual([]);

    localStorage.setItem(SAVED_MOMENTS_STORAGE_KEY, JSON.stringify({ nope: true }));
    expect(loadSavedMoments()).toEqual([]);

    const good = saveSavedMoment('Còn tốt', 7, SETUP, OVERLAY);
    const raw = JSON.parse(localStorage.getItem(SAVED_MOMENTS_STORAGE_KEY)!);
    raw.push({ id: '', name: 'x', savedAt: 1, setup: {}, overlay: {} });
    raw.push(42);
    localStorage.setItem(SAVED_MOMENTS_STORAGE_KEY, JSON.stringify(raw));

    const loaded = loadSavedMoments();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(good.id);
  });

  it('sanitizes a hostile overlay: junk numbers zeroed, junk fields dropped', () => {
    const overlay = sanitizeMomentOverlay({
      matchTimeMs: Number.NaN,
      player: {
        x: 'left',
        health: -5,
        gold: Number.POSITIVE_INFINITY,
        dead: 'yes',
        spells: [{ cooldownMs: -100, stacks: 'many', fields: { ok: 1, bad: { nested: true } } }],
      },
      bots: 'none',
      minionClock: { elapsedMs: -1, nextWaveIn: 'soon', waveCount: 2.9 },
      monsters: [{}, null],
    });
    expect(overlay.matchTimeMs).toBe(0);
    expect(overlay.player.x).toBe(0);
    expect(overlay.player.health).toBe(0);
    expect(overlay.player.gold).toBe(0);
    expect(overlay.player.dead).toBe(false);
    expect(overlay.player.spells[0]).toEqual({ cooldownMs: 0, stacks: null, fields: { ok: 1 } });
    expect(overlay.bots).toEqual([]);
    expect(overlay.minionClock).toEqual({ elapsedMs: 0, nextWaveIn: 0, waveCount: 2 });
    expect(overlay.monsters).toHaveLength(2);
  });

  it('one-shots the boot stash', () => {
    stashMomentBoot({ matchSeed: 99, overlay: OVERLAY });
    const boot = takeMomentBoot();
    expect(boot?.matchSeed).toBe(99);
    expect(boot?.overlay.player.gold).toBe(1450);
    expect(takeMomentBoot()).toBeNull();
  });

  it('backfills a missing seed rather than dropping the moment', () => {
    saveSavedMoment('Không seed', Number.NaN, SETUP, OVERLAY);
    const loaded = loadSavedMoments();
    expect(loaded).toHaveLength(1);
    expect(Number.isFinite(loaded[0].matchSeed)).toBe(true);
  });
});
