import {
  announcementTags,
  SHUTDOWN_STREAK,
  type Announcement,
  type AnnouncementKind,
  type AnnouncementSide,
  type AnnouncementTag,
} from '@/game/combat/Announcer';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';

/**
 * One row per multi-kill, not one row per kill.
 *
 * `MatchAnnouncer` makes an announcement per champion death, which is right
 * for a ledger and wrong for the screen: a penta arrived as five callouts,
 * the stack shows three (`hud.css`) and a phone shows two, so the three kills
 * that earned the word "Penta" were pushed off the top before it was said.
 * The fix is not a taller stack — the feed sits over the fight and the
 * occlusion budget is the point. It is to draw a run the way the genre draws
 * it: the killer once, then the faces of everyone they took down.
 *
 * **The chain is the announcer's `multi`, not a clock.** `multi` climbs by one
 * for every kill inside `MULTI_KILL_WINDOW_MS` and resets to 1 outside it, so
 * "still the same run" is exactly `multi === previous + 1`. Reading the window
 * again here would be a second copy of that rule, free to drift from the one
 * that decides whether the word is "Double" or nothing.
 *
 * **A row keeps the seq of the kill that opened it.** `KillFeed.vue` keys its
 * `transition-group` on that seq, so a growing run stays the same DOM node and
 * the row does not re-enter — the second kill slides a face in, it does not
 * drop a new callout on top of the old one.
 *
 * Pure: it reads no clock and no game. `hudState.buildFeed` applies the TTL to
 * `latestAtMs` and turns the members into display sides.
 */
/**
 * Faces a row draws before it starts counting instead.
 *
 * Five because that is where the genre's vocabulary stops — `multiKillLabel`
 * says "Penta Kill" for five and for nine alike — so a row that has run out of
 * words has also run out of portraits. Uncapped, a ten-kill run drew a 755px
 * row on a 692px window and was clipped at *both* ends: the killer's own face
 * and name went off the left edge, which is the one part a feed must never
 * lose.
 *
 * The faces kept are the *newest* ones, drawn newest-first: who just died is
 * what a feed is read for, and a run past five has already said what it is
 * with the word "Penta". The older faces are the ones that fall into the
 * count.
 */
export const MAX_FEED_VICTIMS = 5;

export interface KillFeedGroup {
  /** The seq of the kill that opened the row — its identity while it grows. */
  seq: number;
  killer: AnnouncementSide | null;
  killerUnit: AttackableUnit | undefined;
  /** Every kill on the row, oldest first. One entry for a lone kill. */
  victims: Announcement[];
  /** When the newest kill landed: what the row's age is measured from. */
  latestAtMs: number;
  /** The badges the whole run earned, in `announcementTags` order. */
  tags: AnnouncementTag[];
  /** The row's colour family, from the run as a whole. */
  accent: AnnouncementKind | null;
}

/**
 * What identifies a killer across the buffer. The unit reference when there is
 * one; a LAN client that could not resolve the unit still has the name, and
 * two champions cannot share one.
 */
const killerKeyOf = (a: Announcement): AttackableUnit | string | null =>
  a.killerUnit ?? (a.killer ? `name:${a.killer.name}` : null);

/**
 * A run is the one thing that must read differently from a kill at a glance,
 * so it wins over the rest; a plain kill has none.
 */
function accentOf(a: Announcement): AnnouncementKind | null {
  if (a.streak >= SHUTDOWN_STREAK) return 'streak';
  if (a.multi >= 2) return 'multi';
  if (a.shutdown > 0) return 'shutdown';
  if (a.firstBlood) return 'first';
  return null;
}

/** Folds announcements (oldest first) into rows (oldest first). */
export function groupKillFeed(announcements: readonly Announcement[]): KillFeedGroup[] {
  const groups: Announcement[][] = [];
  /** Per killer, the run still climbing — a later kill of theirs may join it. */
  const open = new Map<AttackableUnit | string, Announcement[]>();

  for (const row of announcements) {
    const key = killerKeyOf(row);
    // `multi` is 0 when the killer is not a champion — a turret, a minion,
    // nobody. Those never form a run, so they never join or open one.
    if (key === null || row.multi < 1) {
      groups.push([row]);
      continue;
    }
    const chain = row.multi >= 2 ? open.get(key) : undefined;
    if (chain && row.multi === chain[chain.length - 1].multi + 1) {
      chain.push(row);
      continue;
    }
    // Either a fresh run, or one whose earlier kills have already aged out of
    // the buffer — a mid-run row is still better than five separate ones.
    const fresh = [row];
    groups.push(fresh);
    open.set(key, fresh);
  }

  return groups.map(toGroup);
}

function toGroup(members: Announcement[]): KillFeedGroup {
  const head = members[0];
  const latest = members[members.length - 1];
  // The badges come off one synthetic announcement rather than a rule of their
  // own, so the folded row and a single kill are graded by the same function.
  // `multi` and `streak` are the run's, which is the newest; first blood and a
  // shutdown were earned by whichever kill earned them and would be lost if the
  // row only ever showed the last one.
  const merged: Announcement = {
    ...latest,
    firstBlood: members.some(m => m.firstBlood),
    shutdown: members.reduce((worst, m) => Math.max(worst, m.shutdown), 0),
  };
  return {
    seq: head.seq,
    killer: head.killer,
    killerUnit: head.killerUnit,
    victims: members,
    latestAtMs: latest.atMs,
    tags: announcementTags(merged),
    accent: accentOf(merged),
  };
}

export default groupKillFeed;
