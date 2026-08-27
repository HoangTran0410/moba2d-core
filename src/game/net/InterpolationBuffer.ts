import type { UnitSnap } from './protocol';

/**
 * The client's view of the host's recent past.
 *
 * Playback runs between the two newest snapshots, advanced by *local wall
 * time since the newest arrived* over the span the two snapshots claim in
 * match time — per unit of time, never per frame (the `Camera.smoothingFor`
 * lesson applied to the network: a 30fps and a 144fps client must show the
 * same world). That renders roughly one snapshot interval (~66ms at 15Hz)
 * behind the host, which is the interpolation delay v1 accepts instead of
 * predicting.
 *
 * Only position interpolates. Health, mana, death, action state and
 * cooldowns come from the newest snapshot verbatim — lerping a health bar
 * between two authoritative values invents numbers the host never reported.
 *
 * A unit that moved more than `snapThresholdUnits` inside one snapshot span
 * snaps to its new position instead of gliding: a Flash drawn as a glide
 * reads as a bug (`tests/game/net/interpolation.test.ts` pins all of this
 * by hand).
 */

interface BufferedSnapshot {
  tm: number;
  receivedAt: number;
  units: Map<string, UnitSnap>;
}

const KEEP = 4;
const DEFAULT_SNAP_THRESHOLD = 400;

export class InterpolationBuffer {
  private snapshots: BufferedSnapshot[] = [];

  push(snapshot: { tm: number; units: UnitSnap[] }, receivedAtMs: number): void {
    // A late or duplicate snapshot (older match time than the newest held)
    // would make playback walk backwards; drop it.
    const newest = this.snapshots[this.snapshots.length - 1];
    if (newest && snapshot.tm <= newest.tm) return;
    this.snapshots.push({
      tm: snapshot.tm,
      receivedAt: receivedAtMs,
      units: new Map(snapshot.units.map(unit => [unit.id, unit])),
    });
    if (this.snapshots.length > KEEP) this.snapshots.splice(0, this.snapshots.length - KEEP);
  }

  get size(): number {
    return this.snapshots.length;
  }

  /**
   * The newest raw snapshot, un-interpolated — what reconciliation of a
   * locally-predicted unit compares itself against (a predicted champion
   * never rides the playback delay, so it wants the freshest truth, not the
   * smoothed past).
   */
  latest(): { tm: number; units: Map<string, UnitSnap> } | null {
    const newest = this.snapshots[this.snapshots.length - 1];
    return newest ? { tm: newest.tm, units: newest.units } : null;
  }

  /**
   * Every unit the newest snapshot knows, at its interpolated position for
   * local time `nowMs` — or `null` before two snapshots exist. Units the
   * older snapshot does not know appear at their newest position outright;
   * units missing from the newest snapshot are simply absent, which is the
   * caller's signal that the host stopped tracking them.
   */
  sample(
    nowMs: number,
    snapThresholdUnits: number = DEFAULT_SNAP_THRESHOLD
  ): Map<string, UnitSnap> | null {
    if (this.snapshots.length < 2) return null;
    const newest = this.snapshots[this.snapshots.length - 1];
    const previous = this.snapshots[this.snapshots.length - 2];
    const span = newest.tm - previous.tm;
    const progress = span > 0 ? Math.min(1, Math.max(0, (nowMs - newest.receivedAt) / span)) : 1;

    const out = new Map<string, UnitSnap>();
    for (const [id, target] of newest.units) {
      const from = previous.units.get(id);
      if (!from) {
        out.set(id, target);
        continue;
      }
      const dx = target.x - from.x;
      const dy = target.y - from.y;
      const teleported = Math.hypot(dx, dy) > snapThresholdUnits;
      out.set(id, {
        ...target,
        x: teleported ? target.x : from.x + dx * progress,
        y: teleported ? target.y : from.y + dy * progress,
      });
    }
    return out;
  }
}
