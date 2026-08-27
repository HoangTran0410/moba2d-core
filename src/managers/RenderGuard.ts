/**
 * Keeps one bad frame from being the last one.
 *
 * p5's frame loop is `_draw`, and the shape of it is the whole reason this
 * module exists: it calls `redraw()` — which is where the game's `draw()` runs
 * — and only *afterwards*, at the very bottom, reaches
 *
 *     if (this._loop) this._requestAnimId = window.requestAnimationFrame(this._draw);
 *
 * (`p5.js:66431` and `:66449`). So an exception anywhere inside a draw does not
 * cost a frame, it costs **every frame from then on**: the chain is never
 * re-armed and nothing short of a reload brings the game back. What a player
 * sees is a black canvas with the Vue HUD still sitting on top of it, because
 * the DOM has a lifecycle of its own — reported from a real match on an
 * installed PWA after the app had been in the background a while.
 *
 * Two things follow, and both are the point:
 *
 *  - **The loop survives whatever threw.** That holds regardless of what it
 *    was, which matters because the cause is a browser reclaiming memory and
 *    is not reproducible on a desk.
 *  - **The player finds out.** They are on a phone and cannot open a console.
 *    A silent black screen is indistinguishable from a hang; a message and a
 *    reload button is a bug report.
 *
 * The error is also re-thrown out of band. `tests/e2e/harness.mjs` fails a run
 * on `pageerror`, so swallowing here would make every Playwright driver blind
 * to a crash in draw — the guard would have bought a live loop by hiding the
 * thing that killed it. Throwing from a `setTimeout` reaches `window.onerror`
 * without ever returning to p5's frame chain, so both properties hold at once.
 *
 * ## The simulation loop has the same shape, and had none of this
 *
 * `GameScene.updateLoop` arms its next tick with
 *
 *     this._animationFrameId = window.setTimeout(() => this.updateLoop(), interval / 2);
 *
 * at the *bottom*, after `this.game.update()`. That is p5's mistake again in
 * our own code: a throw inside `update()` means the line never runs and the
 * tick chain is never re-armed. What it looks like is worse than a dead draw,
 * because the draw loop is a separate chain and keeps painting: the game
 * freezes mid-match with a canvas that is still redrawing the last good frame
 * and a HUD that still answers. Pressing Escape opens the settings modal
 * normally, and closing it calls `resumeRuntime()`, which re-arms the chain —
 * so the match twitches forward a few ticks and stops again. It reads as a
 * hang. It is a crash.
 *
 * Found exactly that way: `VengefulSpirit_E` in the dota pack queried allies
 * filtered on `teamId` alone, `SpellObject` copies its owner's `teamId`, and
 * the aura paid *itself* — `addBuff` on a `SpellObject`. `guardUpdate` is what
 * turns that class of bug back into a bad tick with a message on screen.
 *
 * ## And everything that is in neither loop
 *
 * `installGlobalErrorReporter` puts the same overlay behind `window.onerror`
 * and `unhandledrejection`, so a throw from an event handler, a timer or a
 * rejected pack load is not a silent nothing either. It deliberately skips
 * errors the guards above already surfaced, since those reach `window.onerror`
 * by design.
 */

export interface RenderGuardOptions {
  /**
   * Where a crash is surfaced. Defaults to the on-screen overlay below; a test
   * passes its own, because the suite runs on `environment: 'node'` and has no
   * DOM to put an overlay in.
   */
  report?: (error: Error, count: number) => void;
  /**
   * How the first error is re-raised for anything watching `window.onerror`.
   * Injectable for the same reason.
   */
  rethrow?: (error: Error) => void;
}

/** The shape both `error` and `unhandledrejection` arrive in, narrowed to what is read. */
type ErrorEventish = { error?: unknown; message?: string; reason?: unknown };
type ErrorListener = (event: ErrorEventish) => void;

/**
 * Just enough of `window` to listen on.
 *
 * Injectable for the same reason `report` and `rethrow` are: this suite runs on
 * `environment: 'node'`, where there is no `window` to dispatch against.
 */
export interface ErrorEventSource {
  addEventListener(type: string, listener: ErrorListener): void;
  removeEventListener(type: string, listener: ErrorListener): void;
}

export interface GlobalErrorReporterOptions extends RenderGuardOptions {
  /** Defaults to `window`. A test passes its own. */
  source?: ErrorEventSource;
}

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

const rethrowAsync = (error: Error): void => {
  setTimeout(() => {
    throw error;
  }, 0);
};

const DRAW_LABEL = 'Lỗi khi vẽ khung hình';
const UPDATE_LABEL = 'Lỗi khi cập nhật trận đấu';
const GLOBAL_LABEL = 'Lỗi trong game';

/**
 * Errors a guard has already put on screen and re-raised.
 *
 * `rethrowAsync` throws the very same object, so it arrives at
 * `window.onerror` a moment later — and without this the global reporter would
 * count one bad frame twice and claim it as a second, unrelated crash.
 */
const alreadyReported = new WeakSet<Error>();

/**
 * Wraps a draw function so it can never break p5's frame chain.
 *
 * The counter is per wrapped function, so "how many frames have thrown" is a
 * fact about this loop rather than a module-wide tally.
 */
export function guardDraw(draw: () => void, options: RenderGuardOptions = {}): () => void {
  return guardLoop(draw, DRAW_LABEL, options);
}

/**
 * The same guarantee for the simulation tick — see this module's own header on
 * why `GameScene.updateLoop` needs it just as badly as p5's `_draw` did.
 *
 * Separate from `guardDraw` only so the overlay can say which half died. A
 * frozen match and a black canvas are different symptoms and the player is
 * reading the message to tell someone what they saw.
 */
export function guardUpdate(update: () => void, options: RenderGuardOptions = {}): () => void {
  return guardLoop(update, UPDATE_LABEL, options);
}

function guardLoop(work: () => void, label: string, options: RenderGuardOptions): () => void {
  const report = options.report ?? ((error, count) => showCrashOverlay(error, count, label));
  const rethrow = options.rethrow ?? rethrowAsync;
  let failures = 0;

  return () => {
    try {
      work();
    } catch (thrown) {
      const error = asError(thrown);
      failures += 1;
      // Once. A loop that throws every frame would otherwise raise sixty errors
      // a second, and the first one is the one that says what happened.
      if (failures === 1) {
        alreadyReported.add(error);
        rethrow(error);
      }
      report(error, failures);
    }
  };
}

/**
 * Puts the overlay behind the two events that catch everything else: a throw
 * from an event handler or a timer (`error`), and a promise nobody awaited
 * (`unhandledrejection`).
 *
 * Additive, not a replacement: the loop guards above are what keep the game
 * *running* through a bad frame, and nothing here can do that — by the time
 * these fire the stack is already unwound. This exists so that a crash outside
 * both loops is still something the player can read and report, rather than a
 * screen that quietly stops responding.
 *
 * Returns its own undo, so a test can install it without leaking a listener
 * into the next one.
 */
export function installGlobalErrorReporter(options: GlobalErrorReporterOptions = {}): () => void {
  const source =
    options.source ?? (typeof window === 'undefined' ? undefined : (window as ErrorEventSource));
  if (!source) return () => undefined;

  const report = options.report ?? ((error, count) => showCrashOverlay(error, count, GLOBAL_LABEL));
  let failures = 0;

  const surface = (thrown: unknown): void => {
    const error = asError(thrown);
    // Already on screen and already re-raised by a loop guard — this is that
    // same throw arriving by its scheduled route, not a new one.
    if (alreadyReported.has(error)) return;
    failures += 1;
    report(error, failures);
  };

  const onError: ErrorListener = event => surface(event.error ?? event.message);
  const onRejection: ErrorListener = event => surface(event.reason);

  source.addEventListener('error', onError);
  source.addEventListener('unhandledrejection', onRejection);
  return () => {
    source.removeEventListener('error', onError);
    source.removeEventListener('unhandledrejection', onRejection);
  };
}

/* ------------------------------------------------------------- the overlay */

const OVERLAY_ID = 'render-crash';

/**
 * Puts the error on the screen, because the player is on a phone.
 *
 * Plain DOM and no imports: this runs when the game has already failed, so it
 * must not depend on anything the game does. Built once and then only updated,
 * since the frame that threw is very likely to throw again immediately.
 */
function showCrashOverlay(error: Error, count: number, label: string): void {
  if (typeof document === 'undefined') return;

  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    const tally = existing.querySelector('[data-crash-count]');
    if (tally) tally.textContent = String(count);
    return;
  }

  const box = document.createElement('div');
  box.id = OVERLAY_ID;
  box.setAttribute('role', 'alert');
  box.style.cssText = [
    'position:fixed',
    'left:0',
    'right:0',
    'bottom:0',
    'z-index:2147483647',
    'padding:12px 14px',
    'background:rgba(12,16,22,0.96)',
    'color:#e6e8ee',
    'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
    'border-top:2px solid #c8763a',
    'max-height:45vh',
    'overflow:auto',
    // The canvas swallows touches; this must not be part of that argument.
    'touch-action:auto',
  ].join(';');

  const title = document.createElement('strong');
  title.textContent = label;
  title.style.cssText = 'display:block;color:#f0a860;margin-bottom:4px';

  const message = document.createElement('div');
  message.textContent = `${error.message}`;
  message.style.cssText = 'white-space:pre-wrap;word-break:break-word';

  const where = document.createElement('div');
  where.textContent = (error.stack ?? '').split('\n').slice(1, 4).join('\n');
  where.style.cssText = 'margin-top:4px;opacity:0.66;white-space:pre-wrap;word-break:break-word';

  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top:8px;display:flex;gap:8px;align-items:center';

  const tally = document.createElement('span');
  tally.setAttribute('data-crash-count', '');
  tally.textContent = String(count);
  const tallyLabel = document.createElement('span');
  tallyLabel.style.cssText = 'opacity:0.66';
  tallyLabel.append('số lần lỗi: ', tally);

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Tải lại';
  reload.style.cssText =
    'padding:6px 14px;background:#1b2430;color:#e6e8ee;border:1px solid #3a4658;font:inherit';
  // Both, per the house rule for every control in this game: the canvas layer
  // cancels gestures over itself and a click-only control is dead under a thumb.
  reload.addEventListener('click', () => location.reload());
  reload.addEventListener('touchend', event => {
    event.preventDefault();
    location.reload();
  });

  footer.append(reload, tallyLabel);
  box.append(title, message, where, footer);
  document.body.appendChild(box);
}
