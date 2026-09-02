import EventType from '@/game/enums/EventType';
import type EventManager from '@/managers/EventManager';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import type { UnitDeathEvent } from '@/game/gameObject/attackableUnits/AttackableUnit';

/**
 * The match's memory of who killed whom, told back as a kill feed and the
 * occasional banner.
 *
 * `MatchTally` keeps the *totals* and deliberately resets nothing on death;
 * this keeps the *rhythm* — the run of kills since a champion last died, the
 * kills that came fast enough to be one moment, the first kill of the match
 * — because those are what a fight feels like, and none of them is a total.
 * The five seconds after a kill used to be silent: the number on the health
 * bar went up by one and nothing else happened. Now they say something.
 *
 * One announcement per champion death, whoever or whatever did it, with the
 * tags a viewer would want beside it. Minion, monster and turret deaths do
 * not make the feed: nobody reads "Lính hạ Lính" forty times a minute.
 *
 * Host-authoritative. On a LAN client `die()` comes from the snapshot's dead
 * flag with no killer attached, so the client never runs `onDeath` — it
 * receives the host's announcements over the wire (`receive`), re-stamped to
 * its own clock. Both ends then read the same `recent()`/`banner()`.
 *
 * The callout names are the ones every MOBA player already hears in their
 * head — Double Kill, Penta Kill, First Blood, Killing Spree — because a
 * translation of them lands softer than the original (the user's call, on
 * hearing "Tam sát"). The sentences around them stay Vietnamese. None of
 * these words is a trademark; they predate this genre.
 */

/** Kills closer together than this are one multi-kill. */
export const MULTI_KILL_WINDOW_MS = 10_000;
/**
 * How long a feed row stays readable. Short on purpose: the feed sits over
 * the top of the fight, and a teamfight's worth of rows lingering there is a
 * screen nobody can play on. Six seconds is long enough to read a row twice.
 */
export const FEED_TTL_MS = 6_000;
/**
 * Rows the feed shows at once; older ones simply age out. Three on a
 * monitor; the touch layout hides the third (`hud.css`), so a phone gives up
 * at most two rows of its top edge.
 */
export const FEED_ROWS = 3;
/** How long a banner holds the centre of the screen. */
export const BANNER_TTL_MS = 2_200;
/** A kill run reaching one of these lengths is worth a banner even when it is not yours — each is a new tier name. */
export const STREAK_MILESTONES: readonly number[] = [3, 4, 5, 6, 7, 8];
/** Ending a run at least this long is a shutdown. */
export const SHUTDOWN_STREAK = 3;

/** One side of a kill as the feed shows it. Names and art only — never a unit reference on the wire. */
export interface AnnouncementSide {
  name: string;
  /** The avatar's asset path, as `HudState.avatar` is; '' when the unit has none. */
  avatar: string;
  team: string;
}

/** A champion's death, with everything the feed says about it. */
export interface Announcement {
  seq: number;
  /** `Game.matchTimeMs` when it happened — on a client, when it arrived. */
  atMs: number;
  /** Whatever landed the killing blow: a champion, a turret, a minion. `null` for a death nobody caused. */
  killer: AnnouncementSide | null;
  victim: AnnouncementSide;
  firstBlood: boolean;
  /** 1 for a lone kill, 2 for the second inside the window, and so on. 0 when the killer is not a champion. */
  multi: number;
  /** The killer's run of kills since it last died, this one included. 0 when the killer is not a champion. */
  streak: number;
  /** The run the victim was on, when it was at least `SHUTDOWN_STREAK`; else 0. */
  shutdown: number;
  /** Local references, for "is this mine". Never serialised — see `HostSession`. */
  killerUnit?: AttackableUnit;
  victimUnit?: AttackableUnit;
}

/** The wire shape: the same minus the unit references, plus their net ids. */
export type WireAnnouncement = Omit<Announcement, 'killerUnit' | 'victimUnit'> & {
  kid?: string;
  vid?: string;
};

interface KillRun {
  streak: number;
  multi: number;
  lastKillAtMs: number;
}

const MULTI_KILL_LABEL: readonly string[] = [
  '',
  '',
  'Double Kill',
  'Triple Kill',
  'Quadra Kill',
  'Penta Kill',
];

/** "Double Kill" for 2, up to "Penta Kill" for 5 or more; '' below 2. */
export const multiKillLabel = (multi: number): string =>
  MULTI_KILL_LABEL[Math.min(multi, MULTI_KILL_LABEL.length - 1)] ?? '';

const STREAK_LABEL: Record<number, string> = {
  3: 'Killing Spree',
  4: 'Rampage',
  5: 'Unstoppable',
  6: 'Dominating',
  7: 'Godlike',
};

/** The tier a run of `streak` kills has reached; "Legendary" from 8 on; '' below 3. */
export const streakLabel = (streak: number): string =>
  streak >= 8 ? 'Legendary' : (STREAK_LABEL[streak] ?? '');

export const FIRST_BLOOD_LABEL = 'First Blood';
export const SHUTDOWN_LABEL = 'Shutdown';

/**
 * What made a kill more than a kill. Each kind wears its own colour in the
 * HUD so a run reads differently from a burst at a glance: first blood
 * crimson, a multi-kill gold, a run fire, a shutdown violet.
 */
export type AnnouncementKind = 'first' | 'multi' | 'streak' | 'shutdown';

export interface AnnouncementTag {
  kind: AnnouncementKind;
  label: string;
}

/** The badges beside a feed row, in the order they are worth reading. */
export function announcementTags(a: Announcement): AnnouncementTag[] {
  const tags: AnnouncementTag[] = [];
  if (a.firstBlood) tags.push({ kind: 'first', label: FIRST_BLOOD_LABEL });
  if (a.multi >= 2) tags.push({ kind: 'multi', label: multiKillLabel(a.multi) });
  if (a.shutdown > 0) tags.push({ kind: 'shutdown', label: SHUTDOWN_LABEL });
  if (a.streak >= SHUTDOWN_STREAK) tags.push({ kind: 'streak', label: streakLabel(a.streak) });
  return tags;
}

/** The banner's colour family: the four kinds above, a plain kill, or your own death. */
export type BannerKind = AnnouncementKind | 'kill' | 'death';

export interface BannerText {
  kind: BannerKind;
  title: string;
  subtitle: string;
}


/**
 * Whether this kill interrupts the centre of the screen. Yours always does;
 * anyone else's only when it is a moment — first blood, a triple or more, a
 * shutdown, a run hitting a milestone.
 */
export function deservesBanner(a: Announcement, player: AttackableUnit | null | undefined): boolean {
  if (player && (a.killerUnit === player || a.victimUnit === player)) return true;
  return a.firstBlood || a.multi >= 3 || a.shutdown > 0 || STREAK_MILESTONES.includes(a.streak);
}

/** What the banner says, from the player's side of it. */
export function bannerText(a: Announcement, player: AttackableUnit | null | undefined): BannerText {
  const killer = a.killer?.name ?? 'Không rõ';
  const pair = `${killer} hạ ${a.victim.name}`;
  const milestone = STREAK_MILESTONES.includes(a.streak);
  if (player && a.victimUnit === player) {
    return { kind: 'death', title: 'Bạn đã bị hạ', subtitle: a.killer ? `bởi ${killer}` : '' };
  }
  if (player && a.killerUnit === player) {
    // One headline, the loudest thing first: a burst over a run over a first
    // blood over a plain kill. Whatever did not make the headline rides the
    // subtitle, so nothing is lost — only ordered.
    const extras: string[] = [a.victim.name];
    let head: BannerText;
    if (a.multi >= 2) head = { kind: 'multi', title: multiKillLabel(a.multi), subtitle: '' };
    else if (milestone) head = { kind: 'streak', title: streakLabel(a.streak), subtitle: '' };
    else if (a.firstBlood) head = { kind: 'first', title: FIRST_BLOOD_LABEL, subtitle: '' };
    else head = { kind: 'kill', title: 'Hạ gục', subtitle: '' };
    if (a.firstBlood && head.kind !== 'first') extras.push(FIRST_BLOOD_LABEL);
    if (a.shutdown > 0) extras.push(SHUTDOWN_LABEL);
    if (milestone && head.kind !== 'streak') extras.push(streakLabel(a.streak));
    return { ...head, subtitle: extras.join(' · ') };
  }
  if (a.firstBlood) return { kind: 'first', title: FIRST_BLOOD_LABEL, subtitle: pair };
  if (a.multi >= 3) return { kind: 'multi', title: multiKillLabel(a.multi), subtitle: killer };
  if (a.shutdown > 0) return { kind: 'shutdown', title: SHUTDOWN_LABEL, subtitle: pair };
  if (milestone) return { kind: 'streak', title: streakLabel(a.streak), subtitle: killer };
  return { kind: 'kill', title: 'Hạ gục', subtitle: pair };
}

const sideOf = (unit: AttackableUnit): AnnouncementSide => ({
  name: (unit as { name?: string }).name ?? 'Không rõ',
  avatar: unit.avatar?.path ?? '',
  team: unit.teamId,
});

export default class MatchAnnouncer {
  private readonly runs = new WeakMap<AttackableUnit, KillRun>();
  private readonly rows: Announcement[] = [];
  private readonly listeners = new Set<(a: Announcement) => void>();
  private firstBloodTaken = false;
  private seq = 0;
  private stop: (() => void) | null = null;

  constructor(
    private readonly events: EventManager | undefined,
    private readonly clock: () => number
  ) {}

  /** Start listening for deaths. Idempotent; `detach` undoes it. */
  attach(): void {
    if (this.stop || !this.events) return;
    this.stop = this.events.on(EventType.ON_DIE, (event: UnitDeathEvent) => this.onDeath(event));
  }

  detach(): void {
    this.stop?.();
    this.stop = null;
  }

  /** Hear every announcement as it is made — the host forwards these. Returns the unsubscribe. */
  onAnnounce(listener: (a: Announcement) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** The host's announcement, arriving on a client. Stamped to *this* clock; the host's is not ours. */
  receive(wire: WireAnnouncement, units: { killerUnit?: AttackableUnit; victimUnit?: AttackableUnit }): void {
    const { kid: _kid, vid: _vid, ...rest } = wire;
    this.push({ ...rest, atMs: this.clock(), killerUnit: units.killerUnit, victimUnit: units.victimUnit });
  }

  /** The rows still worth showing, oldest first, at most `FEED_ROWS`. */
  recent(nowMs: number): Announcement[] {
    this.prune(nowMs);
    return this.rows.slice(-FEED_ROWS);
  }

  /** The newest announcement still young enough to hold the centre, if any deserves to. */
  banner(nowMs: number, player: AttackableUnit | null | undefined): Announcement | null {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const row = this.rows[i];
      if (nowMs - row.atMs > BANNER_TTL_MS) return null;
      if (deservesBanner(row, player)) return row;
    }
    return null;
  }

  /** The killer's run so far — what a shutdown would end. Exposed for the scoreboard and tests. */
  streakOf(unit: AttackableUnit): number {
    return this.runs.get(unit)?.streak ?? 0;
  }

  private onDeath(event: UnitDeathEvent): void {
    const { unit: victim, killer } = event;
    const now = this.clock();

    // The victim's run ends whatever killed it — a turret ends a spree too.
    const victimRun = this.runs.get(victim);
    const ended = victimRun?.streak ?? 0;
    if (victimRun) {
      victimRun.streak = 0;
      victimRun.multi = 0;
      victimRun.lastKillAtMs = Number.NEGATIVE_INFINITY;
    }

    if (event.credit !== 'champion') return;

    let multi = 0;
    let streak = 0;
    let firstBlood = false;
    const killerIsChampion = !!killer && killer !== victim && killer.killCredit === 'champion';
    if (killerIsChampion) {
      const run = this.runOf(killer);
      run.streak += 1;
      run.multi = now - run.lastKillAtMs <= MULTI_KILL_WINDOW_MS ? run.multi + 1 : 1;
      run.lastKillAtMs = now;
      multi = run.multi;
      streak = run.streak;
      // Champion on champion only: a tower's first kill is not anyone's blood.
      firstBlood = !this.firstBloodTaken;
      this.firstBloodTaken = true;
    }

    const announcement: Announcement = {
      seq: ++this.seq,
      atMs: now,
      killer: killer && killer !== victim ? sideOf(killer) : null,
      victim: sideOf(victim),
      firstBlood,
      multi,
      streak,
      shutdown: ended >= SHUTDOWN_STREAK ? ended : 0,
      killerUnit: killer && killer !== victim ? killer : undefined,
      victimUnit: victim,
    };
    this.push(announcement);
    for (const listener of this.listeners) listener(announcement);
  }

  private runOf(unit: AttackableUnit): KillRun {
    let run = this.runs.get(unit);
    if (!run) {
      run = { streak: 0, multi: 0, lastKillAtMs: Number.NEGATIVE_INFINITY };
      this.runs.set(unit, run);
    }
    return run;
  }

  private push(announcement: Announcement): void {
    this.rows.push(announcement);
    this.prune(announcement.atMs);
  }

  private prune(nowMs: number): void {
    // Rows older than the feed shows are gone for good; a banner never
    // outlives a row, so the same cut serves both.
    let drop = 0;
    while (drop < this.rows.length && nowMs - this.rows[drop].atMs > FEED_TTL_MS) drop++;
    if (drop > 0) this.rows.splice(0, drop);
    // And never more than a few beyond what is shown, whatever the clock says.
    if (this.rows.length > FEED_ROWS * 4) this.rows.splice(0, this.rows.length - FEED_ROWS * 4);
  }
}
