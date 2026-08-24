/**
 * `trackDownloadingUpdate` is the one piece of `src/pwa/updates.ts` with real
 * branching — everything else in that file is either a plain ref or the
 * `virtual:pwa-register` wiring, which does not exist outside a real build
 * (see the module's own header comment). A fake "installing worker" object
 * is enough to drive every transition without a browser.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  UPDATE_CHECK_MIN_GAP_MS,
  UPDATE_DOWNLOAD_STALL_MS,
  createUpdateChecker,
  requestUpdate,
  trackDownloadingUpdate,
  updateDownloadedCount,
  updateDownloading,
  updateQueued,
  updateReady,
} from '@/pwa/updates';

function fakeInstallingWorker() {
  let state = 'installing';
  const listeners: Array<() => void> = [];
  return {
    get state() {
      return state;
    },
    addEventListener(type: 'statechange', listener: () => void) {
      if (type === 'statechange') listeners.push(listener);
    },
    setState(next: string) {
      state = next;
      for (const listener of listeners) listener();
    },
  };
}

/** A controllable stand-in for `setTimeout`/`clearTimeout`, fired by hand. */
function fakeTimers() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  return {
    setTimeoutFn: ((fn: () => void) => {
      const id = nextId++;
      pending.set(id, fn);
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeoutFn: ((id: unknown) => {
      pending.delete(id as number);
    }) as typeof clearTimeout,
    fire(id: number) {
      pending.get(id)?.();
    },
    has(id: number) {
      return pending.has(id);
    },
  };
}

describe('trackDownloadingUpdate', () => {
  beforeEach(() => {
    updateDownloading.value = false;
  });

  it('lights updateDownloading as soon as an install starts', () => {
    trackDownloadingUpdate(fakeInstallingWorker());
    expect(updateDownloading.value).toBe(true);
  });

  it('clears updateDownloading once the worker finishes installing', () => {
    const worker = fakeInstallingWorker();
    trackDownloadingUpdate(worker);
    worker.setState('installed');
    expect(updateDownloading.value).toBe(false);
  });

  it('clears updateDownloading if the worker is dropped as redundant', () => {
    const worker = fakeInstallingWorker();
    trackDownloadingUpdate(worker);
    worker.setState('redundant');
    expect(updateDownloading.value).toBe(false);
  });

  it('does not clear updateDownloading on a non-terminal statechange', () => {
    const worker = fakeInstallingWorker();
    trackDownloadingUpdate(worker);
    worker.setState('installing');
    expect(updateDownloading.value).toBe(true);
  });

  it('gives up after the stall timeout if the install never resolves', () => {
    const worker = fakeInstallingWorker();
    const timers = fakeTimers();
    trackDownloadingUpdate(worker, timers.setTimeoutFn, timers.clearTimeoutFn);
    expect(updateDownloading.value).toBe(true);
    timers.fire(1);
    expect(updateDownloading.value).toBe(false);
  });

  it('cancels the stall timeout once the worker finishes first', () => {
    const worker = fakeInstallingWorker();
    const timers = fakeTimers();
    trackDownloadingUpdate(worker, timers.setTimeoutFn, timers.clearTimeoutFn);
    worker.setState('installed');
    expect(timers.has(1)).toBe(false);
  });
});

describe('UPDATE_DOWNLOAD_STALL_MS', () => {
  it('is a positive tuning value', () => {
    expect(UPDATE_DOWNLOAD_STALL_MS).toBeGreaterThan(0);
  });
});

/**
 * The press that arrives before the build does.
 *
 * `updateReady` cannot come early — it means "a worker is waiting to be
 * skip-waited to", and until the serial precache download finishes there is no
 * such worker. Measured at 825ms to `updatefound` against 4622ms to ready on a
 * small synthetic diff, and ~1s against ~19s on a real one
 * (`npm run e2e:pwa-update`). The menu used to offer nothing for that whole
 * gap, which a player spends pressing Play — and then a reload mid-match is
 * the one thing `registerType: 'prompt'` exists to prevent.
 *
 * So the button is offered on the fast signal and the press waits for the
 * build instead.
 */
describe('requestUpdate', () => {
  beforeEach(() => {
    updateReady.value = false;
    updateQueued.value = false;
    updateDownloading.value = false;
  });

  it('remembers a press that arrives while the build is still downloading', async () => {
    updateDownloading.value = true;
    await requestUpdate();
    expect(updateQueued.value).toBe(true);
    // Nothing has been handed over: there is nothing to hand over to.
    expect(updateReady.value).toBe(false);
  });

  it('applies straight away when a build is already waiting', async () => {
    updateReady.value = true;
    await requestUpdate();
    expect(updateReady.value).toBe(false);
    expect(updateQueued.value).toBe(false);
  });

  it('drops a queued press when the download it was waiting on dies', () => {
    const worker = fakeInstallingWorker();
    trackDownloadingUpdate(worker);
    updateQueued.value = true;

    worker.setState('redundant');

    // Otherwise "sẽ cập nhật khi tải xong…" stays on screen for ever, waiting
    // on a build that is never coming.
    expect(updateQueued.value).toBe(false);
  });

  it('drops a queued press when the download stalls out', () => {
    const worker = fakeInstallingWorker();
    const timers = fakeTimers();
    trackDownloadingUpdate(worker, timers.setTimeoutFn, timers.clearTimeoutFn);
    updateQueued.value = true;

    timers.fire(1);

    expect(updateQueued.value).toBe(false);
  });

  it('counts a fresh download from zero', () => {
    updateDownloadedCount.value = 41;

    trackDownloadingUpdate(fakeInstallingWorker());

    // A retry after a `redundant` attempt otherwise resumes from a number
    // that belonged to a download which no longer exists.
    expect(updateDownloadedCount.value).toBe(0);
  });

  it('keeps a queued press while the install is still going', () => {
    const worker = fakeInstallingWorker();
    trackDownloadingUpdate(worker);
    updateQueued.value = true;

    worker.setState('installing');

    expect(updateQueued.value).toBe(true);
  });
});

/**
 * When to ask the server at all.
 *
 * A timer is the wrong primary mechanism: a backgrounded tab's timers are
 * throttled to minutes or stopped outright, so the interval cannot catch the
 * case that matters — the player coming back. `visibilitychange` and `online`
 * can, and both go through this throttle so a burst of tab switches is one
 * request rather than one each.
 */
describe('createUpdateChecker', () => {
  const registrationSpy = () => {
    let calls = 0;
    return {
      update: () => {
        calls += 1;
        return Promise.resolve();
      },
      get calls() {
        return calls;
      },
    };
  };

  it('checks immediately the first time, however low the clock starts', () => {
    const registration = registrationSpy();
    createUpdateChecker(registration, () => 0)();
    expect(registration.calls).toBe(1);
  });

  it('swallows a rejection, which offline is', async () => {
    let settled = false;
    const check = createUpdateChecker({
      update: () => {
        settled = true;
        return Promise.reject(new Error('offline'));
      },
    });
    expect(() => check()).not.toThrow();
    await Promise.resolve();
    expect(settled).toBe(true);
  });

  it('collapses a burst of checks inside the minimum gap into one', () => {
    const registration = registrationSpy();
    let clock = 1_000_000;
    const check = createUpdateChecker(registration, () => clock);

    check();
    clock += 1_000;
    check();
    // Still one millisecond short of the gap — the boundary itself is a real
    // check, and `checks again once the gap has passed` below is where that
    // is asserted.
    clock += UPDATE_CHECK_MIN_GAP_MS - 1_001;
    check();

    expect(registration.calls).toBe(1);
  });

  it('checks again once the gap has passed', () => {
    const registration = registrationSpy();
    let clock = 1_000_000;
    const check = createUpdateChecker(registration, () => clock);

    check();
    clock += UPDATE_CHECK_MIN_GAP_MS;
    check();

    expect(registration.calls).toBe(2);
  });
});
