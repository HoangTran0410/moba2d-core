import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import Game from '../../src/game/Game';
import {
  MAX_CATCHUP_STEPS,
  stepsToRun,
  withSimulationStep,
} from '../../src/game/simulationClock';

/**
 * **A tick is one step long, whatever the renderer is doing.**
 *
 * The bug this file exists for was not visible from any one file: the
 * simulation ran on its own 60Hz timer while reading p5's *render* delta for
 * how far to advance. At 60/60 the two agree and nothing looks wrong. Choosing
 * the 30 FPS setting — the one control offered to a weak machine — made the
 * whole game run at exactly double speed, measured end to end at 2.00x.
 *
 * So the load-bearing case here is not "the helper swaps a global": it is
 * "`Game.update` advances by its own step **while the render clock says
 * something else**". Anything that stops being true would restore the bug.
 */
describe('the simulation step', () => {
  it('substitutes the global the simulation reads, and puts it back', () => {
    vi.stubGlobal('deltaTime', 33);
    const seen: number[] = [];
    withSimulationStep(16, () => {
      seen.push((globalThis as { deltaTime?: number }).deltaTime!);
    });
    expect(seen).toEqual([16]);
    expect((globalThis as { deltaTime?: number }).deltaTime).toBe(33);
    vi.unstubAllGlobals();
  });

  it('puts it back through a throw, so one bad tick does not freeze every animation', () => {
    vi.stubGlobal('deltaTime', 33);
    expect(() =>
      withSimulationStep(16, () => {
        throw new Error('tick blew up');
      })
    ).toThrow('tick blew up');
    expect((globalThis as { deltaTime?: number }).deltaTime).toBe(33);
    vi.unstubAllGlobals();
  });

  /**
   * The regression itself. A fake `this` rather than a real `Game`: `update`
   * touches four fields, and building the whole match to assert on one addition
   * would be testing p5's ability to boot.
   */
  it('advances match time by its own step, not by the render frame’s', () => {
    const renderDelta = 1000 / 30; // the 30 FPS setting: double the tick interval
    vi.stubGlobal('deltaTime', renderDelta);
    const inTick: number[] = [];
    const host = {
      paused: false,
      fps: 60,
      matchTimeMs: 0,
      fixedUpdate() {
        inTick.push((globalThis as { deltaTime?: number }).deltaTime!);
      },
    };

    Game.prototype.update.call(host as unknown as Game);

    expect(host.matchTimeMs).toBeCloseTo(1000 / 60, 6);
    // And the tick body saw the step too — `matchTimeMs` alone would still be
    // right while every `-= deltaTime` timer in the simulation drained double.
    expect(inTick).toEqual([1000 / 60]);
    expect((globalThis as { deltaTime?: number }).deltaTime).toBe(renderDelta);
    vi.unstubAllGlobals();
  });

  it('does not advance a paused match', () => {
    const host = { paused: true, fps: 60, matchTimeMs: 0, fixedUpdate: vi.fn() };
    Game.prototype.update.call(host as unknown as Game);
    expect(host.matchTimeMs).toBe(0);
    expect(host.fixedUpdate).not.toHaveBeenCalled();
  });
});

describe('how many steps one poll may run', () => {
  const interval = 1000 / 60;

  it('runs nothing before a step is due', () => {
    expect(stepsToRun(interval * 0.4, interval)).toEqual({ run: 0, advanceMs: 0 });
  });

  it('runs one step per elapsed interval', () => {
    expect(stepsToRun(interval * 2.5, interval).run).toBe(2);
  });

  it('repays a hitch, but only up to the ceiling', () => {
    const long = stepsToRun(interval * 40, interval);
    expect(long.run).toBe(MAX_CATCHUP_STEPS);
    // The clock still moves the whole way: a scene that fell a second behind
    // must not spend the next second firing catch-up batches that each land
    // later than the last.
    expect(long.advanceMs).toBeCloseTo(interval * 40, 6);
  });

  it('refuses a nonsense interval rather than dividing by it', () => {
    expect(stepsToRun(100, 0)).toEqual({ run: 0, advanceMs: 0 });
    expect(stepsToRun(Number.NaN, interval)).toEqual({ run: 0, advanceMs: 0 });
  });
});

/**
 * The loop that drives the step. Its own arithmetic is `stepsToRun` above; what
 * a scan can see, and a unit test cannot, is that the scene still asks it —
 * running one tick per poll however far behind it is looks completely normal in
 * a diff and loses game time on exactly the machines this work is for.
 */
describe('the tick loop', () => {
  const source = readFileSync(resolve(__dirname, '../../src/scenes/GameScene.ts'), 'utf8')
    // Comments first, or this scan reads its own explanation as the code.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('asks how many steps are due rather than always running one', () => {
    expect(source).toContain('stepsToRun(');
  });

  it('never reintroduces the single-tick poll it replaced', () => {
    expect(source).not.toMatch(/elapsedTime\s*%\s*interval/);
  });
});
