import { describe, expect, it, vi } from 'vitest';
import { guardDraw, guardUpdate, installGlobalErrorReporter } from '../../src/managers/RenderGuard';

/**
 * One uncaught error in `draw()` used to end the game for good.
 *
 * p5's frame loop is `_draw`, and it calls `redraw()` — which is where our
 * `draw()` runs — *before* it reaches
 * `this._requestAnimId = window.requestAnimationFrame(this._draw)` at the very
 * bottom (`p5.js:66431` and `:66449`). So a throw anywhere inside the game's
 * draw does not skip a frame, it skips **every** frame from then on: the chain
 * is never re-armed and nothing short of a reload brings it back.
 *
 * Reported from a real match on an installed PWA — background the app long
 * enough and it comes back to a black canvas with the Vue HUD still on top of
 * it, which is exactly the shape of a dead canvas loop under a live DOM. The
 * player is on a phone and cannot open a console, so the error also has to
 * reach a screen.
 *
 * The guard is the structural half and stands on its own: whatever throws, and
 * whether or not we ever find out what it was, the loop has to survive it.
 */
describe('the render guard', () => {
  it('does not let a throwing draw escape, so p5 re-arms the frame', () => {
    const guarded = guardDraw(
      () => {
        throw new Error('boom');
      },
      { report: () => undefined, rethrow: () => undefined }
    );

    expect(() => guarded()).not.toThrow();
  });

  it('keeps calling draw on later frames', () => {
    // The property that actually matters: one bad frame is a bad frame, not the
    // end of the session.
    let frames = 0;
    const guarded = guardDraw(
      () => {
        frames++;
        if (frames === 1) throw new Error('boom');
      },
      { report: () => undefined, rethrow: () => undefined }
    );

    guarded();
    guarded();
    guarded();

    expect(frames).toBe(3);
  });

  it('reports the first error, with the count of every one after it', () => {
    const report = vi.fn();
    const guarded = guardDraw(
      () => {
        throw new Error('boom');
      },
      { report, rethrow: () => undefined }
    );

    guarded();
    guarded();
    guarded();

    expect(report).toHaveBeenCalledTimes(3);
    expect(report.mock.calls.map(call => call[1])).toEqual([1, 2, 3]);
    expect(report.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((report.mock.calls[0][0] as Error).message).toBe('boom');
  });

  it('says nothing at all while the frame is fine', () => {
    const report = vi.fn();
    const guarded = guardDraw(() => undefined, { report, rethrow: () => undefined });

    guarded();
    guarded();

    expect(report).not.toHaveBeenCalled();
  });

  it('wraps a thrown non-Error, so the reporter always has a message', () => {
    const report = vi.fn();
    const guarded = guardDraw(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'a string, which is legal and which p5 sketches do throw';
      },
      { report, rethrow: () => undefined }
    );

    guarded();

    expect(report.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((report.mock.calls[0][0] as Error).message).toContain('a string');
  });

  it('re-throws out of band, so the e2e harness still sees a draw error', () => {
    // `tests/e2e/harness.mjs` fails a run on `pageerror`, and swallowing here
    // would make every Playwright driver blind to a crash in draw — the guard
    // would have bought a live loop by hiding the thing that killed it. An
    // async re-throw reaches `window.onerror` without ever returning to p5's
    // frame chain, so both properties hold at once.
    const escaped: unknown[] = [];
    const guarded = guardDraw(
      () => {
        throw new Error('boom');
      },
      { report: () => undefined, rethrow: error => escaped.push(error) }
    );

    guarded();
    guarded();

    // Once. A draw that throws every frame would otherwise raise sixty errors a
    // second, and the first one is the one that says what happened.
    expect(escaped).toHaveLength(1);
    expect((escaped[0] as Error).message).toBe('boom');
  });
});

/**
 * The simulation loop had the same shape as p5's `_draw` and none of the
 * protection. `GameScene.updateLoop` arms its next tick with a `setTimeout` at
 * the bottom, *after* `game.update()` — so an uncaught throw does not cost a
 * tick, it costs every tick from then on.
 *
 * What that looks like is worse than a dead draw, because the draw chain is
 * separate and keeps painting: the match freezes with a canvas still redrawing
 * the last good frame and a HUD that still answers. Escape opens the settings
 * modal normally, and closing it calls `resumeRuntime()` — which re-arms the
 * chain, so the match twitches forward a few ticks and stops again. Reported
 * exactly that way, from `VengefulSpirit_E` in the dota pack paying `addBuff`
 * to its own aura object.
 */
describe('the update guard', () => {
  it('does not let a throwing tick escape, so the loop re-arms its timer', () => {
    const guarded = guardUpdate(
      () => {
        throw new Error('boom');
      },
      { report: () => undefined, rethrow: () => undefined }
    );

    expect(() => guarded()).not.toThrow();
  });

  it('keeps ticking the match after a bad tick', () => {
    let ticks = 0;
    const guarded = guardUpdate(
      () => {
        ticks++;
        if (ticks === 1) throw new Error('boom');
      },
      { report: () => undefined, rethrow: () => undefined }
    );

    guarded();
    guarded();
    guarded();

    expect(ticks, 'the tick chain stopped at the first throw').toBe(3);
  });

  it('re-throws out of band, once, like the draw guard', () => {
    const escaped: unknown[] = [];
    const guarded = guardUpdate(
      () => {
        throw new Error('boom');
      },
      { report: () => undefined, rethrow: error => escaped.push(error) }
    );

    guarded();
    guarded();

    expect(escaped).toHaveLength(1);
  });
});

/**
 * The outermost layer, and the weakest on purpose: it can only report. By the
 * time `error` or `unhandledrejection` fires the stack is already unwound, so
 * nothing here keeps a loop alive — the two guards above do that. This is for
 * the throws that are in neither loop: an event handler, a timer, a pack load
 * nobody awaited.
 */
describe('the global error reporter', () => {
  /** A stand-in for `window`, because this suite runs on `environment: 'node'`. */
  const makeSource = () => {
    const listeners = new Map<string, ((event: Record<string, unknown>) => void)[]>();
    return {
      addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      removeEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter(entry => entry !== listener)
        );
      },
      emit(type: string, event: Record<string, unknown>) {
        for (const listener of listeners.get(type) ?? []) listener(event);
      },
    };
  };

  it('surfaces a throw that is in neither loop', () => {
    const report = vi.fn();
    const source = makeSource();
    installGlobalErrorReporter({ report, source });

    source.emit('error', { error: new Error('from a timer') });

    expect(report).toHaveBeenCalledTimes(1);
    expect((report.mock.calls[0][0] as Error).message).toBe('from a timer');
  });

  it('surfaces a promise nobody awaited', () => {
    const report = vi.fn();
    const source = makeSource();
    installGlobalErrorReporter({ report, source });

    source.emit('unhandledrejection', { reason: new Error('a pack that never loaded') });

    expect(report).toHaveBeenCalledTimes(1);
    expect((report.mock.calls[0][0] as Error).message).toBe('a pack that never loaded');
  });

  it('does not double-count the error a loop guard already surfaced', () => {
    // `rethrowAsync` throws the very same object, so it arrives here a moment
    // later by design. Counting it again would tell the player two things broke.
    const report = vi.fn();
    const source = makeSource();
    installGlobalErrorReporter({ report, source });

    const error = new Error('boom');
    guardDraw(
      () => {
        throw error;
      },
      { report: () => undefined, rethrow: () => undefined }
    )();

    source.emit('error', { error });

    expect(report, 'the same throw was reported twice').not.toHaveBeenCalled();
  });

  it('stops listening once uninstalled', () => {
    const report = vi.fn();
    const source = makeSource();
    installGlobalErrorReporter({ report, source })();

    source.emit('error', { error: new Error('after') });

    expect(report).not.toHaveBeenCalled();
  });
});
