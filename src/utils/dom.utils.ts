const DomUtils = {
  preventRightClick(element: HTMLElement) {
    element.addEventListener('contextmenu', event => event.preventDefault());
  },
  preventZoom() {
    document.addEventListener(
      'wheel',
      event => {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
        }
      },
      { passive: false }
    );
  },
  /**
   * Whether this browser can put the page fullscreen at all.
   *
   * iPhone Safari cannot: the Fullscreen API is exposed on `HTMLVideoElement`
   * and nowhere else there, so the whole feature is missing rather than merely
   * refused. Worth asking before drawing a button, because a control that can
   * never work is worse than no control — see `OrientationHint.vue` for what
   * those devices get instead.
   */
  fullscreenSupported(): boolean {
    if (typeof document === 'undefined') return false;
    const element = document.documentElement as any;
    return Boolean(
      element?.requestFullscreen ||
      element?.webkitRequestFullscreen ||
      element?.mozRequestFullScreen ||
      element?.msRequestFullscreen
    );
  },

  /**
   * Whether a key event belongs to a text field rather than to the game.
   *
   * p5 binds `keydown` on `window`, not on the canvas, so every letter typed
   * into a HUD input arrives at `GameScene.keyPressed` as well: searching the
   * shop for an item toggled the shop shut on the `p`, and the loadout
   * editor's champion search fired half a kit. `LoadoutEditorModal` guards its
   * *name* input with `@keydown.stop` for the same reason — a fix that has to
   * be remembered once per input, and was not remembered by either search box
   * added after it, which is why the guard now also sits at the one place
   * every key passes through.
   *
   * The event's own target answers it whenever there is one; `activeElement`
   * covers a call with no event, the same fallback `GameScene.keyPressed`
   * already makes for p5's global `keyCode`.
   *
   * `SELECT` and the non-text `INPUT`s (a checkbox, a slider) are in
   * deliberately: a focused control consuming its own keystrokes is right
   * whatever the control is, and every one of those in the HUD lives behind
   * the config panel, which pauses the match anyway.
   */
  isTypingKeyEvent(event?: { target?: EventTarget | null } | null): boolean {
    const target =
      event?.target ?? (typeof document === 'undefined' ? null : document.activeElement);
    const element = target as HTMLElement | null;
    if (!element) return false;
    return (
      element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.tagName === 'SELECT' ||
      element.isContentEditable === true
    );
  },

  isFullscreen(): boolean {
    if (typeof document === 'undefined') return false;
    return Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
  },

  /**
   * Pin the device to landscape, if it will have it.
   *
   * Chrome on Android only honours this **while the document is fullscreen**,
   * which is why it is called from `goFullscreen` rather than offered as its
   * own button: an orientation lock on its own would silently do nothing. iOS
   * has no `screen.orientation.lock` at all.
   *
   * So a rejection is the normal case on half the devices that will run this
   * and is swallowed on purpose. Nothing downstream branches on the result —
   * the portrait hint watches the *actual* orientation instead, which is true
   * whether the lock worked, failed, or was never available.
   */
  lockLandscape(): void {
    const orientation = typeof screen === 'undefined' ? null : (screen as any)?.orientation;
    if (typeof orientation?.lock !== 'function') return;
    try {
      Promise.resolve(orientation.lock('landscape')).catch(() => {});
    } catch {
      /* Safari throws synchronously rather than rejecting. Same non-answer. */
    }
  },

  unlockOrientation(): void {
    const orientation = typeof screen === 'undefined' ? null : (screen as any)?.orientation;
    if (typeof orientation?.unlock !== 'function') return;
    try {
      orientation.unlock();
    } catch {
      /* as above */
    }
  },

  goFullscreen() {
    const element = document.documentElement as any;
    const request: undefined | (() => unknown) =
      element.requestFullscreen ??
      element.mozRequestFullScreen ??
      element.webkitRequestFullscreen ??
      element.msRequestFullscreen;
    if (!request) return;

    // The lock is chained onto the request rather than fired beside it: until
    // the document is actually fullscreen, Android refuses it. The prefixed
    // methods return nothing, so those fall through to the immediate call —
    // which is the older, looser behaviour those browsers had anyway.
    const pending = request.call(element);
    if (pending instanceof Promise) pending.then(() => this.lockLandscape()).catch(() => {});
    else this.lockLandscape();
  },
  exitFullscreen() {
    this.unlockOrientation();
    if (document.exitFullscreen) document.exitFullscreen();
    else if ((document as any).mozCancelFullScreen) (document as any).mozCancelFullScreen();
    else if ((document as any).webkitExitFullscreen) (document as any).webkitExitFullscreen();
    else if ((document as any).msExitFullscreen) (document as any).msExitFullscreen();
  },
  toggleFullscreen(): boolean {
    if (this.isFullscreen()) {
      this.exitFullscreen();
      return false;
    }
    this.goFullscreen();
    return true;
  },
};
export default DomUtils;
