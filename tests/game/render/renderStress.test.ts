import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ObjectManager, {
  MOBILE_PARTICLE_DRAW_BUDGET,
} from '../../../src/game/managers/ObjectManager';
import ParticleSystem from '../../../src/game/gameObject/helpers/ParticleSystem';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { Rectangle } from '../../../src/libs/quadtree';
import {
  STRESS_ENTER_SHARE,
  STRESS_ENTER_SUSTAIN_MS,
  STRESS_LEAVE_SHARE,
  STRESS_LEAVE_SUSTAIN_MS,
  STRESS_DEEP_ENTER_SHARE,
  STRESS_DEEP_LEAVE_SHARE,
  freshRenderStress,
  nextStressState,
  stressTier,
  type RenderStress,
} from '../../../src/game/render/renderStress';
import { createGame, stubGameGlobals } from '../fixtures';

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

/**
 * The half of the report that was a *design* mistake rather than a threshold
 * one: stress used to compact the units too.
 *
 * The compact body drops the score, the tick marks and — until this — the buff
 * icons, and halves the bar. That is the right trade for a phone zoomed out to
 * where a champion is twelve screen pixels. It is the wrong trade for a desktop
 * that dropped frames for a second and a half, because what it costs is the
 * information the player is deciding from, and they cannot tell you why the
 * screen changed.
 */
describe('what stress is allowed to take away', () => {
  /**
   * A world with a player in it. `AttackableUnit.isAllied` — reached from
   * `getDisplayBoundingBox` — asks the game who the player is, and the fixture
   * throws rather than answering `undefined`.
   */
  const world = () => {
    const game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'blue' } as never));
    return game;
  };

  /** Whether the draw pass asked for compact bodies this frame. */
  const compactAsked = (game: { renderQuality?: string; renderStressed?: boolean }): boolean => {
    let compact = false;
    const manager = new ObjectManager({ mapSize: 1_000, camera, ...game } as never);
    // A real world for the unit: `getDisplayBoundingBox` reads its `game`.
    // The manager gets its own context above — the two are separate objects on
    // purpose, since what is under test is the manager's quality branch.
    const probe = new (class extends AttackableUnit {
      draw(options: { compactUnits?: boolean } = {}) {
        compact = options.compactUnits === true;
      }
    })({ game: world(), visionRadius: 20 } as never);
    probe.position.set(50, 50);
    probe.visibleToPlayerTeam = true;
    manager.objects = [probe];
    manager._objectsTree.insert(probe.getDisplayBoundingBox());
    manager.draw();
    return compact;
  };

  it('does not compact a body just because the frame was late', () => {
    expect(compactAsked({ renderQuality: 'auto', renderStressed: true })).toBe(false);
  });

  it('does not compact a body on the deep rung either, which is the same promise', () => {
    // The rung below it is allowed to take a great deal more away — thinner
    // crowd art, shorter-lived numbers — and none of that is permission to take
    // the health numbers and buff icons off a champion. See
    // `AttackableUnitRenderOptions.thinCrowd`, which exists precisely so this
    // stayed true when the second rung was added.
    expect(
      compactAsked({ renderQuality: 'auto', renderStressed: true, deeplyStressed: true })
    ).toBe(false);
  });

  it('still compacts under an explicit Thấp, which is the player asking for it', () => {
    expect(compactAsked({ renderQuality: 'low', renderStressed: false })).toBe(true);
  });
});

describe('deciding that a machine is struggling', () => {
  const TARGET = 60;
  const frame = 1000 / 60;

  /** Runs `ms` of frames at a steady rate, and hands back the state. */
  const hold = (state: RenderStress, fps: number, ms: number): RenderStress => {
    let next = state;
    for (let elapsed = 0; elapsed < ms; elapsed += frame) {
      next = nextStressState(next, fps, TARGET, frame);
    }
    return next;
  };

  it('is measured against the cap the player chose, not against 60', () => {
    // A rock-solid 30 under a 30 cap is not a machine in trouble, however long
    // it holds there.
    let steady = freshRenderStress();
    for (let elapsed = 0; elapsed < 10_000; elapsed += frame) {
      steady = nextStressState(steady, 30, 30, frame);
    }
    expect(steady.stressed).toBe(false);
  });

  /**
   * The reported bug, as arithmetic.
   *
   * Traced on an M4 Pro: idle sits at 58.5-60.6 and **one** 900ms hitch drops
   * the smoothed average to 54.2. The first version of this rule degraded below
   * 50 and only restored above 57 — so a machine that never struggles could be
   * parked in the degraded state by a single hiccup, and 54.2 was not enough to
   * climb back out.
   */
  it('is unmoved by one hitch on a machine that is otherwise fine', () => {
    let state = hold(freshRenderStress(), 59, 3_000);
    expect(state.stressed).toBe(false);

    // The hitch itself: a handful of frames at the measured post-hitch average.
    state = hold(state, 54.2, 200);
    expect(state.stressed).toBe(false);

    state = hold(state, 59, 1_000);
    expect(state.stressed).toBe(false);
  });

  it('does not degrade a machine holding a playable rate below target', () => {
    // 48 of 60 is inside the band on purpose: playable, and not worth taking
    // anybody's information away for.
    expect(hold(freshRenderStress(), 48, 10_000).stressed).toBe(false);
  });

  it('degrades a machine that stays under the floor', () => {
    const struggling = hold(freshRenderStress(), 30, STRESS_ENTER_SUSTAIN_MS + 200);
    expect(struggling.stressed).toBe(true);
  });

  it('needs the stretch to be continuous, not merely frequent', () => {
    let state = freshRenderStress();
    // Half the entry window under the floor, then one healthy frame, over and
    // over: never a sustained stretch, so never degraded.
    for (let round = 0; round < 8; round++) {
      state = hold(state, 30, STRESS_ENTER_SUSTAIN_MS * 0.6);
      state = nextStressState(state, 59, TARGET, frame);
    }
    expect(state.stressed).toBe(false);
  });

  /** And the half the report was actually about: it has to come back. */
  it('restores quality once the machine is clearly out of trouble', () => {
    const struggling = hold(freshRenderStress(), 25, STRESS_ENTER_SUSTAIN_MS + 200);
    expect(struggling.stressed).toBe(true);

    const recovered = hold(struggling, 59, STRESS_LEAVE_SUSTAIN_MS + 200);
    expect(recovered.stressed).toBe(false);
  });

  it('restores faster than it degrades, because the two mistakes are not equal', () => {
    expect(STRESS_LEAVE_SUSTAIN_MS).toBeLessThan(STRESS_ENTER_SUSTAIN_MS);
    expect(STRESS_ENTER_SHARE).toBeLessThan(STRESS_LEAVE_SHARE);
  });

  it('changes nothing on a reading it cannot trust', () => {
    const stressed: RenderStress = {
      stressed: true,
      deeplyStressed: false,
      belowMs: 0,
      aboveMs: 0,
      deepBelowMs: 0,
      deepAboveMs: 0,
    };
    expect(nextStressState(stressed, Number.NaN, TARGET, frame)).toBe(stressed);
    expect(nextStressState(stressed, 60, 0, frame)).toBe(stressed);
    expect(nextStressState(stressed, 60, TARGET, Number.NaN)).toBe(stressed);
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

/**
 * The ladder, as a decision table.
 *
 * `stressTier` exists because the rule — "Thấp, or auto and the flag" — was
 * about to be written out in four places (the draw pass, the fog, the minimap,
 * the combat text) and four copies is how they stop agreeing about what Cao
 * means. So the copies are gone and this is the one place it is decided.
 */
describe('how much the renderer is allowed to give up', () => {
  it('gives up nothing on a machine that is keeping up', () => {
    expect(stressTier('auto', false, false)).toBe(0);
  });

  it('gives up decoration on a machine that is late', () => {
    expect(stressTier('auto', true, false)).toBe(1);
  });

  it('gives up the fight’s own detail on a machine that is drowning', () => {
    expect(stressTier('auto', true, true)).toBe(2);
  });

  it('never overrides Cao, however badly the machine is doing', () => {
    // Choosing Cao is the player overriding the measurement on purpose, and a
    // measurement must not override them back.
    expect(stressTier('high', true, true)).toBe(0);
  });

  it('takes Thấp straight to the bottom rung, not to the middle of it', () => {
    // Asking for low quality is asking for all of it.
    expect(stressTier('low', false, false)).toBe(2);
  });
});

describe('deciding that a machine is drowning, not merely late', () => {
  const TARGET = 60;
  const frame = 1000 / 60;
  const hold = (state: RenderStress, fps: number, ms: number): RenderStress => {
    let next = state;
    for (let elapsed = 0; elapsed < ms; elapsed += frame) {
      next = nextStressState(next, fps, TARGET, frame);
    }
    return next;
  };

  it('leaves the deep rung alone on the machine the first rung was written for', () => {
    // 34.5fps of 60 is the measured 6x-throttle machine: late, and the first
    // rung is the right answer for it. Taking the fight's own detail away from
    // a machine holding thirty-five frames a second would be an overreaction.
    const late = hold(freshRenderStress(), 34.5, 10_000);
    expect(late.stressed).toBe(true);
    expect(late.deeplyStressed).toBe(false);
  });

  it('reaches the deep rung on the machine that measured fifteen frames a second', () => {
    const drowning = hold(freshRenderStress(), 15.5, 10_000);
    expect(drowning.deeplyStressed).toBe(true);
  });

  it('never sets the deep rung without the shallow one', () => {
    // Every reader of `deeplyStressed` is entitled to assume the rung below it.
    let state = freshRenderStress();
    for (let elapsed = 0; elapsed < 20_000; elapsed += frame) {
      state = nextStressState(state, 10 + Math.sin(elapsed / 300) * 40, TARGET, frame);
      if (state.deeplyStressed) expect(state.stressed).toBe(true);
    }
  });

  it('holds the deep rung through the recovery its own cuts bought', () => {
    // The consequence of the hysteresis, and it is deliberate: a machine the
    // deep cuts lifted from 15fps to 30fps reads 0.5 — above the entry, below
    // the exit — so it stays simplified. The cuts are *why* it is at 30.
    const drowning = hold(freshRenderStress(), 15.5, 10_000);
    expect(drowning.deeplyStressed).toBe(true);
    expect(hold(drowning, 30, 10_000).deeplyStressed).toBe(true);
    // And it does hand it back once the machine is genuinely clear.
    expect(hold(drowning, 55, 10_000).deeplyStressed).toBe(false);
  });

  it('needs a deeper hole than the first rung, and climbs out of it later', () => {
    expect(STRESS_DEEP_ENTER_SHARE).toBeLessThan(STRESS_ENTER_SHARE);
    expect(STRESS_DEEP_ENTER_SHARE).toBeLessThan(STRESS_DEEP_LEAVE_SHARE);
    expect(STRESS_DEEP_LEAVE_SHARE).toBeLessThan(STRESS_LEAVE_SHARE);
  });
});
