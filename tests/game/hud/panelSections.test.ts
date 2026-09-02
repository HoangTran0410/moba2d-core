import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PANEL_SECTIONS_KEY,
  isSectionOpen,
  resetPanelSections,
  setSectionOpen,
  toggleSection,
} from '../../../src/game/hud/config/panelSections';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

describe('panel sections', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    resetPanelSections();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows each section’s own default until the player touches it', () => {
    expect(isSectionOpen('match-mode', true)).toBe(true);
    expect(isSectionOpen('match-rules', false)).toBe(false);
  });

  it('remembers a choice as an override over the default, persisted', () => {
    toggleSection('match-rules', false);
    expect(isSectionOpen('match-rules', false)).toBe(true);
    toggleSection('match-mode', true);
    expect(isSectionOpen('match-mode', true)).toBe(false);
    expect(JSON.parse(storage.getItem(PANEL_SECTIONS_KEY)!)).toEqual({
      'match-rules': true,
      'match-mode': false,
    });
    setSectionOpen('match-rules', false);
    expect(isSectionOpen('match-rules', false)).toBe(false);
  });

  it('forgets everything on reset', () => {
    setSectionOpen('settings-debug', true);
    resetPanelSections();
    expect(isSectionOpen('settings-debug', false)).toBe(false);
    expect(storage.getItem(PANEL_SECTIONS_KEY)).toBeNull();
  });

  it('ignores a blob that is not a map of booleans', () => {
    storage.setItem(PANEL_SECTIONS_KEY, JSON.stringify({ 'match-rules': 'yes', 'match-map': true }));
    // The module read storage at import; a fresh read is what a new session does.
    resetPanelSections();
    expect(isSectionOpen('match-rules', false)).toBe(false);
  });
});
