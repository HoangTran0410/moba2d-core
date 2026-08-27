import { describe, expect, it } from 'vitest';
import { InterpolationBuffer } from '../../../src/game/net/InterpolationBuffer';
import type { UnitSnap } from '../../../src/game/net/protocol';

/**
 * The buffer's arithmetic, hand-computed. The rule under test (its own doc
 * comment states it the same way): playback runs between the two newest
 * snapshots, advanced by local wall time since the newest arrived, over the
 * span the two snapshots claim — per unit of time, never per frame, which is
 * the `Camera.smoothingFor` lesson applied to the network.
 */

const snap = (id: string, x: number, y: number, over: Partial<UnitSnap> = {}): UnitSnap => ({
  id,
  x,
  y,
  hp: 100,
  maxHp: 100,
  mp: 50,
  dead: false,
  actionState: 0,
  ...over,
});

describe('InterpolationBuffer', () => {
  it('lerps between the two newest snapshots by local elapsed time', () => {
    const buffer = new InterpolationBuffer();
    buffer.push({ tm: 1000, units: [snap('a', 0, 0)] }, 5000);
    buffer.push({ tm: 1100, units: [snap('a', 100, 40)] }, 5100);

    // Snapshot span is 100ms of match time. 50ms after the newest arrived,
    // playback is halfway from the older to the newer: x = 50, y = 20 — by
    // hand, not by asking the buffer twice.
    const halfway = buffer.sample(5150);
    expect(halfway?.get('a')?.x).toBe(50);
    expect(halfway?.get('a')?.y).toBe(20);

    // At the moment the newest arrived, playback shows the older snapshot.
    const atArrival = buffer.sample(5100);
    expect(atArrival?.get('a')?.x).toBe(0);

    // Past the span, playback clamps to the newest — a late next snapshot
    // must freeze the unit, never extrapolate it through a wall.
    const late = buffer.sample(5400);
    expect(late?.get('a')?.x).toBe(100);
  });

  it('snaps instead of lerping when the unit moved a dash-sized distance', () => {
    const buffer = new InterpolationBuffer();
    buffer.push({ tm: 1000, units: [snap('a', 0, 0)] }, 5000);
    buffer.push({ tm: 1066, units: [snap('a', 700, 0)] }, 5066);

    // 700 units in one snapshot interval is a blink, not a walk: halfway
    // through the span the unit is already at the destination, because a
    // Flash drawn as a glide reads as a bug.
    const sample = buffer.sample(5099, 400);
    expect(sample?.get('a')?.x).toBe(700);
  });

  it('takes non-positional fields from the newest snapshot verbatim', () => {
    const buffer = new InterpolationBuffer();
    buffer.push({ tm: 1000, units: [snap('a', 0, 0, { hp: 100, actionState: 1 })] }, 5000);
    buffer.push(
      { tm: 1100, units: [snap('a', 10, 0, { hp: 40, actionState: 5, cds: [0, 900] })] },
      5100
    );

    const sample = buffer.sample(5150);
    const a = sample?.get('a');
    expect(a?.hp).toBe(40);
    expect(a?.actionState).toBe(5);
    expect(a?.cds).toEqual([0, 900]);
  });

  it('carries a unit that only the newest snapshot knows, at its own position', () => {
    const buffer = new InterpolationBuffer();
    buffer.push({ tm: 1000, units: [snap('a', 0, 0)] }, 5000);
    buffer.push({ tm: 1100, units: [snap('a', 10, 0), snap('b', 300, 300)] }, 5100);

    const sample = buffer.sample(5150);
    expect(sample?.get('b')?.x).toBe(300);
  });

  it('drops a unit missing from the newest snapshot', () => {
    const buffer = new InterpolationBuffer();
    buffer.push({ tm: 1000, units: [snap('a', 0, 0), snap('b', 5, 5)] }, 5000);
    buffer.push({ tm: 1100, units: [snap('a', 10, 0)] }, 5100);

    expect(buffer.sample(5150)?.has('b')).toBe(false);
  });

  it('answers null before two snapshots exist, and forgets old ones', () => {
    const buffer = new InterpolationBuffer();
    expect(buffer.sample(0)).toBeNull();
    buffer.push({ tm: 1000, units: [snap('a', 0, 0)] }, 5000);
    expect(buffer.sample(5001)).toBeNull();
    for (let i = 1; i <= 10; i++) {
      buffer.push({ tm: 1000 + i * 66, units: [snap('a', i, 0)] }, 5000 + i * 66);
    }
    expect(buffer.size).toBeLessThanOrEqual(4);
  });
});
