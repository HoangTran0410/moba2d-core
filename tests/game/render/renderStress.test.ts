import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ObjectManager, {
  MOBILE_PARTICLE_DRAW_BUDGET,
} from '../../../src/game/managers/ObjectManager';
import ParticleSystem from '../../../src/game/gameObject/helpers/ParticleSystem';
import { Rectangle } from '../../../src/libs/quadtree';
import {
  STRESS_ENTER_SHARE,
  STRESS_LEAVE_SHARE,
  nextStressState,
} from '../../../src/game/render/renderStress';
import { stubGameGlobals } from '../fixtures';

/**
 * **`auto` used to mean "are you on a phone".**
 *
 * The particle budget and the compact unit art — the two things the renderer
 * can give up to hold a frame — were reachable only by `game.touchUi` or by the
 * player finding the quality dropdown themselves. A laptop missing half its
 * frames drew every particle, every frame, forever.
 *
 * The first case below is the one that was wrong, and it is written as an
 * assertion about a *desktop* deliberately: it stays green if somebody later
 * decides stress should only apply to touch, and that would be the regression.
 */

const camera = {
  getBoundingBox: () => new Rectangle({ x: 0, y: 0, w: 100, h: 100 }),
  constantSize: (pixels: number) => pixels,
  currentScale: 1,
};

const PARTICLES_PER_SYSTEM = 1_000;
const SYSTEMS = 2;

/** Particles actually handed to a draw call, for one frame on one machine. */
const particlesDrawn = (game: {
  touchUi?: boolean;
  renderQuality?: string;
  renderStressed?: boolean;
}): number => {
  let drawn = 0;
  const manager = new ObjectManager({ mapSize: 1_000, camera, ...game } as never);
  manager.objects = Array.from({ length: SYSTEMS }, () => {
    const system = new ParticleSystem({
      isDeadFn: () => false,
      drawFn: () => drawn++,
      getParticlePosFn: particle => particle,
      getParticleSizeFn: () => 4,
    });
    system.particles = Array.from({ length: PARTICLES_PER_SYSTEM }, () => ({ x: 50, y: 50 }));
    return system;
  });
  for (const object of manager.objects) manager._objectsTree.insert(object.getDisplayBoundingBox());
  manager.draw();
  return drawn;
};

const ALL = PARTICLES_PER_SYSTEM * SYSTEMS;

beforeEach(() => stubGameGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('what automatic quality does on a machine that is not a phone', () => {
  it('draws everything while the machine is keeping up', () => {
    expect(particlesDrawn({ touchUi: false, renderQuality: 'auto' })).toBe(ALL);
  });

  it('rations the frame once the machine stops keeping up', () => {
    const drawn = particlesDrawn({
      touchUi: false,
      renderQuality: 'auto',
      renderStressed: true,
    });
    expect(drawn).toBeLessThan(ALL);
    expect(drawn).toBeLessThanOrEqual(MOBILE_PARTICLE_DRAW_BUDGET);
  });

  /**
   * Choosing Cao is the player overriding the measurement. A measurement that
   * overrode them back would make the setting a lie — and this is the arm that
   * a machine used for recording or screenshots relies on.
   */
  it('leaves an explicit Cao alone however badly the machine is coping', () => {
    expect(
      particlesDrawn({ touchUi: false, renderQuality: 'high', renderStressed: true })
    ).toBe(ALL);
  });

  it('still rations under an explicit Thấp on a machine that is coping fine', () => {
    expect(
      particlesDrawn({ touchUi: false, renderQuality: 'low', renderStressed: false })
    ).toBeLessThan(ALL);
  });
});

describe('deciding that a machine is struggling', () => {
  it('is measured against the cap the player chose, not against 60', () => {
    // A rock-solid 30 under a 30 cap is not a machine in trouble.
    expect(nextStressState(false, 30, 30)).toBe(false);
    // The same 30 under a 60 cap is missing every other frame.
    expect(nextStressState(false, 30, 60)).toBe(true);
  });

  it('takes two different thresholds to turn on and off', () => {
    const target = 60;
    const between = target * ((STRESS_ENTER_SHARE + STRESS_LEAVE_SHARE) / 2);

    // Between the two: whichever state it is in, it stays there. A single
    // threshold here would flutter — cutting raises the rate, which restores
    // the quality, which drops the rate again.
    expect(nextStressState(false, between, target)).toBe(false);
    expect(nextStressState(true, between, target)).toBe(true);

    expect(nextStressState(false, target * (STRESS_ENTER_SHARE - 0.01), target)).toBe(true);
    expect(nextStressState(true, target * (STRESS_LEAVE_SHARE + 0.01), target)).toBe(false);
  });

  it('changes nothing on a reading it cannot trust', () => {
    expect(nextStressState(false, Number.NaN, 60)).toBe(false);
    expect(nextStressState(true, Number.NaN, 60)).toBe(true);
    expect(nextStressState(false, 60, 0)).toBe(false);
    expect(nextStressState(true, 0, 60)).toBe(true);
  });
});

describe('where the frame rate is measured', () => {
  const strip = (path: string) =>
    readFileSync(resolve(__dirname, path), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  /**
   * The sample used to live inside the overlay, behind its debug flag — so on
   * every real player's machine the meter was never fed and the decision above
   * had nothing to read. It is the sort of coupling that is invisible from
   * either file alone.
   */
  it('is fed every frame by the game, not by the debug readout', () => {
    expect(strip('../../../src/game/Game.ts')).toContain('fpsMeter.sample(');
    expect(strip('../../../src/game/debug/FpsOverlay.ts')).not.toContain('meter.sample(');
  });
});
