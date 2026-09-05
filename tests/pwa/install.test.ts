/**
 * The install offer is a tiny state machine around a parked one-shot event:
 * caught → ready; prompted → spent either way; `appinstalled` → cleared.
 * A fake prompt event drives every transition without a browser.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearInstallPrompt,
  installReady,
  iosManualInstall,
  promptInstall,
  watchInstallPrompt,
} from '@/pwa/install';

class FakePromptEvent extends Event {
  prompted = 0;
  outcome: 'accepted' | 'dismissed' = 'accepted';
  prompt = async (): Promise<void> => {
    this.prompted += 1;
  };
  get userChoice(): Promise<{ outcome: 'accepted' | 'dismissed' }> {
    return Promise.resolve({ outcome: this.outcome });
  }
}

describe('install offer', () => {
  beforeEach(() => {
    clearInstallPrompt();
  });

  it('parks a caught prompt and cancels the browser default', () => {
    const target = new EventTarget();
    watchInstallPrompt(target);
    const event = new FakePromptEvent('beforeinstallprompt', { cancelable: true });
    target.dispatchEvent(event);
    expect(installReady.value).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('an accepted prompt is spent', async () => {
    const target = new EventTarget();
    watchInstallPrompt(target);
    const event = new FakePromptEvent('beforeinstallprompt', { cancelable: true });
    target.dispatchEvent(event);
    await expect(promptInstall()).resolves.toBe('accepted');
    expect(event.prompted).toBe(1);
    expect(installReady.value).toBe(false);
  });

  it('a dismissed prompt is spent too — Chromium refuses a second prompt()', async () => {
    const target = new EventTarget();
    watchInstallPrompt(target);
    const event = new FakePromptEvent('beforeinstallprompt', { cancelable: true });
    event.outcome = 'dismissed';
    target.dispatchEvent(event);
    await expect(promptInstall()).resolves.toBe('dismissed');
    expect(installReady.value).toBe(false);
    await expect(promptInstall()).resolves.toBe('unavailable');
  });

  it('reports unavailable with nothing parked', async () => {
    await expect(promptInstall()).resolves.toBe('unavailable');
  });

  it('appinstalled clears a parked prompt', () => {
    const target = new EventTarget();
    watchInstallPrompt(target);
    target.dispatchEvent(new FakePromptEvent('beforeinstallprompt', { cancelable: true }));
    expect(installReady.value).toBe(true);
    target.dispatchEvent(new Event('appinstalled'));
    expect(installReady.value).toBe(false);
  });

  it('knows the browsers where installing is a manual gesture', () => {
    const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5 };
    const ipadOS = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 };
    const mac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 };
    expect(iosManualInstall(iphone as Navigator)).toBe(true);
    expect(iosManualInstall(ipadOS as Navigator)).toBe(true);
    expect(iosManualInstall(mac as Navigator)).toBe(false);
  });
});
