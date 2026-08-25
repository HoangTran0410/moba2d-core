import { describe, expect, it } from 'vitest';
import { monsterBodyPreset } from '@/game/preset';
import type { MonsterBody } from '@/content/ContentPack';
import type { QualifiedMonster } from '@/content/PackRegistry';

/**
 * A camp's layout has to be able to face the right way.
 *
 * Reported from a real match: the red-side raptor pit stood in a wall while
 * the blue-side one was fine. The cause is a map's own symmetry meeting a
 * shared `MonsterDef` — Summoner's Rift's two halves are 180° *rotations* of
 * each other, not copies, and one `members` array with one `offset` list is
 * reused at both of a camp's slots. Measured in a real match through
 * `NavGrid.isWalkable`: on the red side two of two wolves and three of three
 * raptors stood on unwalkable ground, and every one of them was walkable once
 * its offset was negated.
 *
 * Core cannot know that — "my two halves are rotations of each other" is a
 * fact about a map, so the map says it. `rotationDeg` is the one number that
 * expresses it, and it is a rotation rather than a boolean `mirrored` because
 * a mirror is the wrong transform: reflecting a layout swaps its handedness,
 * and a pit laid out clockwise would come back anticlockwise.
 */
const monster = {
  id: 'lol:raptors',
  packId: 'lol',
  name: 'Raptors',
  fills: ['raptors'],
  members: [],
} as unknown as QualifiedMonster;

const body = (offset: { x: number; y: number }): MonsterBody =>
  ({
    name: 'Raptor',
    avatar: 'monster_raptor',
    speed: 2,
    size: 40,
    attackRange: 50,
    reviveTime: 100,
    health: 50,
    offset,
  }) as MonsterBody;

const slot = (over: Record<string, unknown> = {}) =>
  ({ role: 'raptors', x: 1_000, y: 1_000, r: 300, ...over }) as never;

describe('a neutral slot can turn its camp', () => {
  it('places a body at slot + offset when it says nothing', () => {
    const preset = monsterBodyPreset(monster, body({ x: 195, y: -15 }), slot());
    expect(preset.home).toEqual({ x: 1_195, y: 985 });
  });

  it('turns the layout by 180° when the slot asks', () => {
    const preset = monsterBodyPreset(monster, body({ x: 195, y: -15 }), slot({ rotationDeg: 180 }));
    expect(preset.home!.x).toBeCloseTo(805, 6);
    expect(preset.home!.y).toBeCloseTo(1_015, 6);
  });

  it('leaves the anchor body on the slot whatever the rotation', () => {
    // A camp of one, and the anchor of every camp of many, must not move —
    // otherwise a rotation would walk a boss off its own platform.
    for (const rotationDeg of [0, 90, 180, 270]) {
      const preset = monsterBodyPreset(monster, body({ x: 0, y: 0 }), slot({ rotationDeg }));
      expect(preset.home!.x).toBeCloseTo(1_000, 6);
      expect(preset.home!.y).toBeCloseTo(1_000, 6);
    }
  });

  it('turns by a quarter as readily as a half', () => {
    // Written out by hand rather than by calling the rotation: (100, 0) turned
    // 90° clockwise in screen space (y down) is (0, 100).
    const preset = monsterBodyPreset(monster, body({ x: 100, y: 0 }), slot({ rotationDeg: 90 }));
    expect(preset.home!.x).toBeCloseTo(1_000, 6);
    expect(preset.home!.y).toBeCloseTo(1_100, 6);
  });

  it('keeps every body the same distance from the slot it started at', () => {
    // The property that makes this a rotation and not a mirror or a scale: a
    // pit's shape is preserved, only its bearing changes.
    const offset = { x: 91, y: -84 };
    const spun = monsterBodyPreset(monster, body(offset), slot({ rotationDeg: 137 }));
    const before = Math.hypot(offset.x, offset.y);
    const after = Math.hypot(spun.home!.x - 1_000, spun.home!.y - 1_000);
    expect(after).toBeCloseTo(before, 6);
  });

  it('ignores a rotation that is not a number rather than placing a body at NaN', () => {
    // A NaN home is a monster at NaN, which is a body nothing can ever path to
    // and a health bar drawn nowhere.
    const preset = monsterBodyPreset(
      monster,
      body({ x: 50, y: 50 }),
      slot({ rotationDeg: 'half' })
    );
    expect(preset.home).toEqual({ x: 1_050, y: 1_050 });
  });
});
