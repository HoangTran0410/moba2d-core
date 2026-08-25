/**
 * The screen a player gets when a match cannot start.
 *
 * Before this, `GameScene.enter` ran `void this.startGame()` and nothing
 * caught what that threw. A pack chunk that would not load — one dropped
 * request on mobile data is enough — became an unhandled rejection, and the
 * scene went on painting `drawKitLoading()` for ever, because `this.game` was
 * still null and `_exited` was still false. Reported exactly that way: press
 * Chơi on a phone, watch "Đang vào trận…" until the app is killed, with
 * nothing on screen saying anything is wrong. On a desktop the same failure
 * left one red line in a console, which is the only reason it was ever
 * diagnosed.
 *
 * Plain DOM and no imports, the same discipline `RenderGuard.ts` follows and
 * for the same reason: this runs *because* something in the game failed, so it
 * must not depend on the game. Both a click and a `touchend` handler on every
 * button, because `GameScene` calls `preventDefault()` on every touch on the
 * page and the browser therefore synthesises no trailing click — a rule this
 * repository has now paid for on a checkbox, a range drag and a plain
 * `@click`, and this screen is reached almost exclusively from a phone.
 */
const OVERLAY_ID = 'match-start-failed';

export interface MatchStartFailureActions {
  /** Try the whole match start again, from the top. */
  onRetry: () => void;
  /** Give up and go back to the menu, where the packs screen is reachable. */
  onMenu: () => void;
}

/**
 * What to tell the player, from what the failure actually was.
 *
 * The raw message is shown too, small, because it is the only diagnostic a
 * phone can produce — but it is never the headline. `Failed to fetch
 * dynamically imported module` is precise and means nothing to the person
 * reading it.
 */
function explain(error: Error): string {
  const text = `${error.message}`;
  if (/dynamically imported module|Failed to fetch|NetworkError|load failed/i.test(text)) {
    return 'Không tải được dữ liệu của gói nội dung. Kiểm tra mạng rồi thử lại.';
  }
  if (/no map installed|has no geometry/i.test(text)) {
    return 'Không tìm thấy bản đồ nào để chơi. Hãy mở màn Gói nội dung và cài lại gói.';
  }
  return 'Không vào được trận.';
}

const button = (label: string, primary: boolean, run: () => void): HTMLButtonElement => {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.style.cssText = [
    'appearance:none',
    'cursor:pointer',
    'padding:10px 18px',
    'border-radius:6px',
    'font:600 14px/1 inherit',
    'touch-action:manipulation',
    primary ? 'background:#c8aa6e' : 'background:transparent',
    primary ? 'color:#12151b' : 'color:#c8aa6e',
    primary ? 'border:1px solid #c8aa6e' : 'border:1px solid rgba(200,170,110,0.5)',
  ].join(';');

  // Both, and neither alone. See this file's header.
  element.addEventListener('click', run);
  element.addEventListener('touchend', event => {
    event.preventDefault();
    run();
  });
  return element;
};

/** Removes the screen, if it is up. Safe to call when it is not. */
export function hideMatchStartFailure(): void {
  // `typeof …getElementById !== 'function'`, not just `typeof document`.
  // Unit environments here run against a partial `document` stub, and this is
  // called from `stopGame` — a path those tests do exercise. Being defensive
  // costs nothing on a module whose whole job is to run after something else
  // has already failed.
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  document.getElementById(OVERLAY_ID)?.remove();
}

export function showMatchStartFailure(error: Error, actions: MatchStartFailureActions): void {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
  hideMatchStartFailure();

  const box = document.createElement('div');
  box.id = OVERLAY_ID;
  box.setAttribute('role', 'alert');
  box.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483646',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:14px',
    'padding:24px',
    'text-align:center',
    'background:rgba(10,20,40,0.97)',
    'color:#e6e8ee',
    "font:14px/1.5 'Segoe UI',system-ui,sans-serif",
    // The canvas swallows touches for the game's own controls; this screen is
    // not part of that argument.
    'touch-action:auto',
  ].join(';');

  const title = document.createElement('strong');
  title.textContent = 'Không vào được trận';
  title.style.cssText = 'font-size:20px;color:#f0a860';

  const summary = document.createElement('div');
  summary.textContent = explain(error);
  summary.style.cssText = 'max-width:32em';

  const detail = document.createElement('code');
  detail.textContent = `${error.message}`;
  detail.setAttribute('data-failure-detail', '');
  detail.style.cssText = [
    'max-width:40em',
    'word-break:break-word',
    'opacity:0.55',
    'font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
  ].join(';');

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center';
  row.append(button('Thử lại', true, actions.onRetry), button('Về menu', false, actions.onMenu));

  box.append(title, summary, detail, row);
  document.body.appendChild(box);
}
