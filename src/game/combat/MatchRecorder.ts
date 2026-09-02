import type { Announcement } from './Announcer';
import { recordMatch, type MatchRecord } from '@/game/config/matchHistory';

/**
 * The match's own historian: turns the player's live numbers into a
 * `MatchRecord` and writes it — every `AUTOSAVE_MS` of match time, and once
 * more on the way out.
 *
 * ## Why it saves while the match is still running
 *
 * A phone kills a backgrounded PWA without a word, and a browser tab closes
 * without `destroy()`. A recorder that only wrote at the end would lose
 * exactly the evenings that ended abruptly, which on a phone is most of
 * them. So it writes the same record by id every thirty seconds; the store
 * replaces rather than appends (`upsertMatchRecord`), so a match saved ten
 * times is one match.
 *
 * ## What it reads
 *
 * The player's `MatchTally` and wallet, the announcer's stream for the best
 * multi-kill and streak of the player's own (kept here, because the announcer
 * remembers a run only while it is alive), and the match's id, map, mode and
 * clock. All through a small context so a test can drive it with plain
 * objects — the shape `MatchAnnouncer` and `DeathCamera` take, for the same
 * reason.
 *
 * Off on a LAN client: its tally is not on the wire, so a client would record
 * zeros for a match the host has the numbers for.
 */

export const AUTOSAVE_MS = 30_000;

export interface RecorderPlayer {
  championId?: string;
  name?: string;
  tally: { kills: number; deaths: number; assists: number; minionsKilled: number; damageDealt: number };
  wallet?: { earnedTotal: number };
}

export interface RecorderContext {
  matchId: string;
  mapId: string;
  mode: string;
  /** False on a LAN client: nothing is written. */
  enabled: boolean;
  /** Unpaused match time — `Game.matchTimeMs`. */
  nowMs(): number;
  /** Wall clock, for `endedAt`. */
  clock(): number;
  player(): RecorderPlayer | null;
  botCount(): number;
  onAnnounce(listener: (announcement: Announcement) => void): () => void;
}

export class MatchRecorder {
  bestStreak = 0;
  bestMulti = 0;
  private lastSaveMs = 0;
  private off: (() => void) | null;

  constructor(private readonly context: RecorderContext) {
    this.off = context.onAnnounce(announcement => {
      const player = context.player();
      if (!player || announcement.killerUnit !== (player as unknown)) return;
      this.bestMulti = Math.max(this.bestMulti, announcement.multi);
      this.bestStreak = Math.max(this.bestStreak, announcement.streak);
    });
  }

  /** The match as it stands, or null with no player to read. */
  snapshot(): MatchRecord | null {
    const player = this.context.player();
    if (!player) return null;
    return {
      id: this.context.matchId,
      endedAt: this.context.clock(),
      durationMs: this.context.nowMs(),
      mapId: this.context.mapId,
      mode: this.context.mode,
      championId: player.championId ?? null,
      championName: player.name ?? '?',
      kills: player.tally.kills,
      deaths: player.tally.deaths,
      assists: player.tally.assists,
      cs: player.tally.minionsKilled,
      damage: Math.round(player.tally.damageDealt),
      gold: player.wallet?.earnedTotal ?? 0,
      bestStreak: this.bestStreak,
      bestMulti: this.bestMulti,
      bots: this.context.botCount(),
    };
  }

  /** Write the match now. False when disabled, playerless, or not yet worth recording. */
  save(): boolean {
    if (!this.context.enabled) return false;
    const record = this.snapshot();
    if (!record) return false;
    this.lastSaveMs = this.context.nowMs();
    return recordMatch(record);
  }

  /** Once per simulation tick: an autosave every `AUTOSAVE_MS` of match time. */
  tick(): void {
    if (!this.context.enabled) return;
    if (this.context.nowMs() - this.lastSaveMs < AUTOSAVE_MS) return;
    this.save();
  }

  detach(): void {
    this.off?.();
    this.off = null;
  }
}
