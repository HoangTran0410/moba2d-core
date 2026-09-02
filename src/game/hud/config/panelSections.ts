import { ref } from 'vue';

/**
 * Which sections of the config panel are unfolded — `PanelSection.vue`'s
 * state, shared by every instance and remembered across opens.
 *
 * ## Why it persists
 *
 * The fold in the champion picker is session state, because it is a
 * navigation aid over a list. This one is different: the panel's tabs are a
 * settings screen, and a player who always comes here for the CDR slider
 * should find "Luật" open the second time without being asked. So the
 * player's choices are kept, as **overrides** over each section's own
 * default — a default-open section the player closed stays closed, a
 * default-closed one they opened stays open, and a section they never
 * touched follows whatever its author decided.
 *
 * `localStorage` only; a blob that fails to parse means no overrides.
 */

export const PANEL_SECTIONS_KEY = 'moba2d:panelSections:v1';

type Overrides = Record<string, boolean>;

const read = (): Overrides => {
  try {
    const raw = localStorage.getItem(PANEL_SECTIONS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Overrides = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean' && id) out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
};

const write = (overrides: Overrides): void => {
  try {
    localStorage.setItem(PANEL_SECTIONS_KEY, JSON.stringify(overrides));
  } catch {
    // Private mode or a full quota: the fold lives for this session only.
  }
};

/** Module-level and reactive: every `PanelSection` reads the same set. */
const overrides = ref<Overrides>(read());

export function isSectionOpen(id: string, fallback: boolean): boolean {
  return overrides.value[id] ?? fallback;
}

export function setSectionOpen(id: string, open: boolean): void {
  overrides.value = { ...overrides.value, [id]: open };
  write(overrides.value);
}

export function toggleSection(id: string, fallback: boolean): void {
  setSectionOpen(id, !isSectionOpen(id, fallback));
}

/** Forget every choice — for tests, and for a future "reset" that wants it. */
export function resetPanelSections(): void {
  overrides.value = {};
  try {
    localStorage.removeItem(PANEL_SECTIONS_KEY);
  } catch {
    // Nothing stored, or nowhere to store it.
  }
}
