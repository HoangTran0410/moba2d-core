/**
 * The "Trận mẫu" library: a whole practice setup, saved by name and reusable
 * in one press — the roster (each unit's champion, side, behaviour switches),
 * the match rules, the world, the map choice, *and* every participant's bag.
 *
 * `PregameConfig` already is a match written down; a template is one of those
 * plus the bags, under a name. The owner's problem this exists for: every
 * session began with re-adding the bots, re-flipping tự đánh / tự di chuyển /
 * tự mua đồ, and re-buying a target bot's build by hand.
 *
 * Deliberately its own storage key rather than a field inside
 * `moba2d:pregameConfig:v1`, for `savedKits.ts`'s two reasons: a library
 * grows without bound while the match config is one fixed shape, and a
 * corrupt library must not be able to take the match configuration down with
 * it. Failing closed here costs the saved templates, nothing more.
 *
 * ## Bags are stored ids, not a rule change
 *
 * `TemplateItems` holds qualified item ids (`<packId>:<localId>` — bare ids
 * collide the moment two packs are installed). They are granted free at the
 * boot that follows an apply, exactly like the practice panel's own give-item
 * cheat, and they are **not** part of `PregameConfig`: persisting bags there
 * would re-grant them on every ordinary boot and quietly delete the shop from
 * the game. A template grant is a one-shot act the player asked for by name.
 *
 * ## An id that resolves to nothing is skipped, never fatal
 *
 * A template outlives the packs it was saved from. The config half already
 * has that policy everywhere (`sanitizePregameConfig`, `preset.ts`'s
 * per-slot fallbacks, `GameScene`'s map fallback); the bag half gets it in
 * `ItemShop.grantTemplateBag`, which drops unresolvable ids on the floor.
 * `hud/config/templateGaps.ts` is the visible half of the same policy — the
 * list row says what will be skipped before the press.
 *
 * Pure data plus storage, like `PregameConfig.ts` and `savedKits.ts`: no p5,
 * no Vue, no reach into the game object graph, so the menu chunk and the
 * match can both import it and it unit-tests in plain node.
 */
import { uuidv4 } from '@/utils';
import { AI_COUNT_MAX, sanitizePregameConfig } from './PregameConfig';
import type { PregameConfig } from './PregameConfig';

export const MATCH_TEMPLATES_STORAGE_KEY = 'moba2d:matchTemplates:v1';

/** Same width as a saved kit's name, for the same shelf-heading reason. */
export const MATCH_TEMPLATE_NAME_MAX = 40;

/**
 * More slots than a bag actually holds, on purpose: the bag's true width is
 * the game chunk's fact (`items/Item.ts`), and this module cannot import it
 * without dragging the match in front of the menu. Granting already stops at
 * the first full bag, so an over-long stored list costs nothing — this cap
 * only keeps a hand-edited blob from smuggling in a novel.
 */
export const TEMPLATE_BAG_CAP = 12;

/**
 * Every participant's bag, as qualified item ids in slot order. `bots` is
 * index-aligned with the config's bot slots (`ai.bots`), and only the first
 * `ai.count` entries ever matter — the same convention every per-slot array
 * in `PregameConfig` follows.
 */
export interface TemplateItems {
  player: readonly string[];
  bots: readonly (readonly string[])[];
}

/** The whole of what a template restores: the bootable config, plus the bags. */
export interface MatchTemplateSetup {
  config: PregameConfig;
  items: TemplateItems;
}

export interface MatchTemplate {
  id: string;
  name: string;
  /** Epoch ms. The library is listed newest first. */
  savedAt: number;
  setup: MatchTemplateSetup;
}

const sanitizeBag = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const bag: string[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.length > 0 && bag.length < TEMPLATE_BAG_CAP)
      bag.push(entry);
  }
  return bag;
};

/**
 * Repairs a stored bag section the way `sanitizePregameConfig` repairs the
 * config: every piece independently, garbage dropped rather than thrown on.
 * Bot bags are truncated to the slot count the config itself is capped at.
 */
export const sanitizeTemplateItems = (raw: unknown): TemplateItems => {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<TemplateItems>;
  const rawBots = Array.isArray(source.bots) ? source.bots : [];
  const bots: string[][] = [];
  for (let i = 0; i < rawBots.length && i < AI_COUNT_MAX; i++) bots.push(sanitizeBag(rawBots[i]));
  return { player: sanitizeBag(source.player), bots };
};

/**
 * The config half rides `sanitizePregameConfig` — it *is* a stored match
 * config, and gets the same repair-in-place policy the real one has had since
 * v1. What is dropped whole is an entry with no usable identity (id, name,
 * date) or no setup object at all: there is nothing there worth resurrecting
 * under a name the player typed.
 */
const sanitizeTemplate = (value: unknown): MatchTemplate | null => {
  if (!value || typeof value !== 'object') return null;
  const template = value as Partial<MatchTemplate>;
  if (typeof template.id !== 'string' || template.id.length === 0) return null;
  if (typeof template.name !== 'string' || template.name.length === 0) return null;
  if (typeof template.savedAt !== 'number' || !Number.isFinite(template.savedAt)) return null;
  const setup = template.setup;
  if (!setup || typeof setup !== 'object' || !('config' in setup)) return null;
  return {
    id: template.id,
    name: template.name.slice(0, MATCH_TEMPLATE_NAME_MAX),
    savedAt: template.savedAt,
    setup: {
      config: sanitizePregameConfig((setup as Partial<MatchTemplateSetup>).config),
      items: sanitizeTemplateItems((setup as Partial<MatchTemplateSetup>).items),
    },
  };
};

const read = (): MatchTemplate[] => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(MATCH_TEMPLATES_STORAGE_KEY);
  } catch {
    // `localStorage` disabled entirely, or absent (node). Not an error here.
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  // A plain loop rather than `.filter` with a narrowing predicate — the
  // repo's own `global.d.ts` overload makes that come back un-narrowed.
  const templates: MatchTemplate[] = [];
  for (const entry of parsed) {
    const template = sanitizeTemplate(entry);
    if (template) templates.push(template);
  }
  return templates;
};

const write = (templates: MatchTemplate[]): void => {
  try {
    localStorage.setItem(MATCH_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
  } catch {
    // A full or blocked storage costs the player this save, nothing more.
    // Never let it take down the panel that called us.
  }
};

/** Newest first. Never throws; a corrupt library reads as an empty one. */
export const loadMatchTemplates = (): MatchTemplate[] => read();

/** @throws if `name` is blank once trimmed — an unnamed template is unfindable. */
export const saveMatchTemplate = (name: string, setup: MatchTemplateSetup): MatchTemplate => {
  const trimmed = name.trim().slice(0, MATCH_TEMPLATE_NAME_MAX);
  if (!trimmed) throw new Error('A match template needs a name.');

  const template: MatchTemplate = {
    id: uuidv4(),
    name: trimmed,
    savedAt: Date.now(),
    // Sanitized on the way in rather than trusted: the caller's setup usually
    // came from a live source that keeps being edited after the save, and
    // `sanitizePregameConfig` is also this module's deep copy.
    setup: {
      config: sanitizePregameConfig(setup.config),
      items: sanitizeTemplateItems(setup.items),
    },
  };
  write([template, ...read()]);
  return template;
};

/** Silently ignores an unknown id, and a name that is blank once trimmed. */
export const renameMatchTemplate = (id: string, name: string): void => {
  const trimmed = name.trim().slice(0, MATCH_TEMPLATE_NAME_MAX);
  if (!trimmed) return;
  write(read().map(template => (template.id === id ? { ...template, name: trimmed } : template)));
};

/** Silently ignores an unknown id. */
export const deleteMatchTemplate = (id: string): void => {
  write(read().filter(template => template.id !== id));
};

/**
 * The bags of a template applied on the menu, parked here for the boot that
 * follows — `PregameConfig` deliberately has no field for them (see the file
 * header), and the menu cannot reach the units because they do not exist yet.
 *
 * Module state rather than storage, on purpose. One-shot: `Game`'s
 * constructor takes it once, so a plain restart from inside the booted match
 * re-rolls an ordinary match instead of re-granting a stale template — the
 * same line `MatchDirector` draws around refill and clear-cooldowns, actions
 * with nothing to store. In a *running* match the panel grants bags directly
 * and this stash is never involved.
 */
let pendingItems: TemplateItems | null = null;

export const stashTemplateItems = (items: TemplateItems): void => {
  pendingItems = sanitizeTemplateItems(items);
};

/** Hands the parked bags over and forgets them. `null` when nothing is parked. */
export const takeTemplateItems = (): TemplateItems | null => {
  const items = pendingItems;
  pendingItems = null;
  return items;
};
