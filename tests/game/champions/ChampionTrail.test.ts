import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import type { Spine } from '@/game/render/creature/spine';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * A champion's cosmetic tail.
 *
 * Purely a picture: it has no hitbox, deals nothing, blocks nothing and is
 * never sent anywhere. What is worth holding is that it is *only* that — a
 * declaration that reached the wrong half of `resolveRig` could replace a
 * champion's portrait with a purple ball, and a champion swap that did not
 * rebuild it would leave the last champion's tail on the next one.
 */

let game: TestGame;

const TRAIL = { widths: [0.6, 0.7, 0.55, 0.35, 0.18], spacing: 0.5 };

const trailOf = (champion: Champion): Spine | undefined =>
  (champion as unknown as { trail?: Spine }).trail;

// No local drawingContext override: `stubGameGlobals` ships the full context
// stub, and a hand-rolled subset here is exactly what broke in CI when the
// champion frame moved onto the native context — the minimal stub lacked
// `fillRect`, and this file is pack-dependent so a local `verify` never ran it.

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
});
afterEach(() => vi.unstubAllGlobals());

describe('a champion that declared a trail', () => {
  it('builds one, with a vertebra per declared width', () => {
    const champion = new Champion({ game, teamId: 'blue' });
    champion.applyPreset({ trail: TRAIL });

    expect(trailOf(champion)?.joints).toHaveLength(TRAIL.widths.length);
  });

  it('streams it behind where it walked', () => {
    const champion = new Champion({ game, teamId: 'blue' });
    champion.applyPreset({ trail: TRAIL });

    for (let i = 0; i < 60; i++) {
      champion.position.set(1_000 + i * 4, 1_000);
      champion.draw();
    }

    const spine = trailOf(champion)!;
    const tail = spine.joints[spine.joints.length - 1];
    // Behind, meaning back down the path it came along — not ahead of it and
    // not sitting on the champion.
    expect(tail.x).toBeLessThan(champion.position.x);
    expect(Math.abs(tail.y - champion.position.y)).toBeLessThan(40);
  });

  it('states a box wide enough to hold it, so it is not culled at the edge', () => {
    const bare = new Champion({ game, teamId: 'blue' });
    const tailed = new Champion({ game, teamId: 'blue' });
    tailed.applyPreset({ trail: { widths: [1, 1, 1, 1, 1, 1], spacing: 1.4 } });

    expect(tailed.getDisplayBoundingBox().w).toBeGreaterThan(bare.getDisplayBoundingBox().w);
  });

  /**
   * The loadout editor commits the whole loadout on every edit, so `applyPreset`
   * runs on a live champion. A trail built once in the constructor would be the
   * first champion's tail worn by every one picked after it.
   */
  it('drops it when the next champion has none', () => {
    const champion = new Champion({ game, teamId: 'blue' });
    champion.applyPreset({ trail: TRAIL });
    expect(trailOf(champion)).toBeTruthy();

    champion.applyPreset({});
    expect(trailOf(champion)).toBeUndefined();
  });
});

describe('a champion that declared none', () => {
  it('is drawn exactly as it always was', () => {
    const champion = new Champion({ game, teamId: 'blue' });
    expect(trailOf(champion)).toBeUndefined();
    expect(() => champion.draw()).not.toThrow();
  });

  /**
   * `resolveRig` clamps a spine too short to trace a flank around back to an
   * `orb`, which is right for a camp that has no art and wrong here: a champion
   * has a portrait, and a ball pasted behind it is not what "my tail was one
   * vertebra long" should turn into.
   */
  it('and so does one whose trail was too short to be a tail', () => {
    const champion = new Champion({ game, teamId: 'blue' });
    champion.applyPreset({ trail: { widths: [1] } });

    expect(trailOf(champion)).toBeUndefined();
  });
});
