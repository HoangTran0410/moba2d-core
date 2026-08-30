/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Everything the HUD needs to *know*, with no opinion on how it is drawn.
 *
 * This is the shared layer both view layers (`DesktopHudView`, `MobileHudView`)
 * read from. It exists so the desktop and mobile HUDs can be extended
 * independently without ever forking the arithmetic that turns a `Game` into
 * "66/100 health" or "this spell is greyed out" — that logic is written once,
 * here, and both views only choose how to lay the result out.
 */
import type Game from '@/game/Game';
import { HotKeys, ItemHotKeys, SpellHotKeys } from '@/game/constants';
import { INVENTORY_SIZE } from '@/game/items/Item';
import { atOwnFountain } from '@/game/economy/ItemShop';
import AssetManager, { type AssetHandle } from '@/managers/AssetManager';
import { statLinesFor, type StatLine } from '@/game/hud/itemStatLines';

function ensureVisibleAsset(asset: Pick<AssetHandle, 'key' | 'status'> | undefined): void {
  if (asset?.key && asset.status === 'idle') {
    void AssetManager.ensure(asset.key).catch(error => console.warn(error));
  }
}

/**
 * How often the HUD reads the game, in milliseconds.
 *
 * It used to run on every animation frame, which meant rebuilding the spell and
 * buff arrays sixty times a second and handing Vue a fresh identity for every
 * one of them — style recalculation and patching on a phone that is already
 * several times slower than the desktop this was written on. Nothing here
 * changes fast enough to need it: the health bar carries a 0.1s CSS transition
 * that smooths the gaps, the cooldown numbers are whole seconds, and the wedge
 * is a percentage nobody can read to the frame. 50ms is twenty reads a second,
 * which is still four times finer than the fastest thing on screen.
 */
export const HUD_UPDATE_INTERVAL_MS = 50;

export interface SpellDisplay {
  instance: any;
  image: string;
  disabled: boolean;
  coolDown: number;
  currentCooldown: number;
  state: string;
  name: string;
  description: string;
  coolDownText: number;
  coolDownPercent: number;
  showCoolDown: boolean;
  /** True only for a real wait. A swing rhythm gets the wedge and nothing else. */
  lockedOut: boolean;
  small: boolean;
  canCast: boolean;
  hotKey: string;
  /** Undefined for spells that do not accumulate anything. */
  stackCount?: number;
  manaCost: number;
  /** False once the pool has dropped below manaCost, which greys the icon. */
  affordable: boolean;
  /**
   * The ability is running right now — a toggle that is on, an active window
   * open, a channel under way. See `Spell.isSustaining`.
   *
   * Deliberately not the same question as `showCoolDown`: a spell whose
   * cooldown starts at `'start'` is running and counting down at once, and
   * before this existed a toggle drew exactly the same icon on and off.
   */
  sustaining: boolean;
  /** Pressing the key again turns it off. Drives an on/off badge, not a clock. */
  toggle: boolean;
  /** 0..100 of the sustain left. **0 when it has no declared end**, not 100. */
  sustainPercent: number;
  /** Whole seconds left; 0 when it has no declared end. */
  sustainSecondsLeft: number;
}

export interface BuffDisplay {
  image: string;
  duration: number;
  timeElapsed: number;
  timeLeftText: number;
  stacks: number;
  /**
   * What the buff calls itself — `Buff.name`, which core's own buffs set to a
   * Vietnamese word ('Choáng', 'Khiên', 'Chậm') and everything else inherits
   * from its class name.
   *
   * Here because the row is hoverable now. Six unlabelled icons under the
   * portrait is a row a player can only learn by having been hit by each of
   * them once and remembering the picture; the name and the remaining time
   * were both already known and simply never shown.
   */
  name: string;
  /** `Buff.description`, '' for the many that declare none. */
  description: string;
  /** The one line under the name in the hover panel: how long is left. */
  note: string;
}

/** One source line inside a death-recap attacker row. */
export interface DeathRecapSourceRow {
  /** The ability's own name when the damage named one, else the type's label. */
  label: string;
  /** The ability's icon URL, '' when no live spell matched the label. */
  image: string;
  amount: number;
  hits: number;
  /** 'PHYSICAL' | 'MAGIC' | 'TRUE' — the panel colours the number with it. */
  type: string;
}

/** One attacker in the death recap, heaviest first. */
export interface DeathRecapRow {
  attacker: string;
  total: number;
  sources: DeathRecapSourceRow[];
}

/**
 * The death recap: who killed the player and what the last seconds of damage
 * were made of, the way the source game retells a death. Built off
 * `AttackableUnit.deathRecap`, which `die()` snapshots from the rolling
 * damage ledger. `seq` bumps per death so the HUD can re-show a dismissed
 * panel on the next one.
 */
export interface DeathRecapDisplay {
  seq: number;
  killer: string;
  total: number;
  rows: DeathRecapRow[];
}

export interface StatsDisplay {
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  healthPercent: number;
  manaPercent: number;
  shieldPercent: number;
  shieldLeftPercent: number;
  shield: number;
}

/**
 * Hồi Thành, which is not a `SpellDisplay` because it is not in `spells[]` —
 * it lives on `Champion.recall` (see that class's comment for why) and the bar
 * is built by index off the kit. Its own row here keeps that separation
 * visible instead of smuggling an eighth slot into a seven-slot array.
 */
export interface RecallDisplay {
  name: string;
  description: string;
  /** `B`. The key is one way in, not the definition of the action. */
  hotKey: string;
  /** The trip home is running, so the button now cancels it. */
  channeling: boolean;
  /** 0..100 through the channel, clamped: the button fills by this. */
  progressPercent: number;
  /** Whole seconds of channel left. 0 while it is not running. */
  secondsLeft: number;
  /** False for a corpse, a silenced champion, or a disabled recall. */
  canCast: boolean;
}

/**
 * One inventory slot. **Always six of them**, filled or not: the row is a
 * fixed shape a player learns the position of, and a list that grew as items
 * were bought would move every key under their thumb.
 */
export interface ItemSlotDisplay {
  filled: boolean;
  /** '' for an empty slot, and for an item whose pack named art nothing registered. */
  image: string;
  name: string;
  /**
   * What this item grants, one stat to a line — the same lines the shop card
   * shows, from the same function, so the two never disagree about what an
   * item is worth or what order to read it in.
   *
   * The tooltip had none of this and the packs worked around that by opening
   * every description with its own stat block in prose. That put the numbers
   * on screen twice inside the shop and in one flat colour outside it. With
   * the list here, a description can go back to being the passive, the active
   * and the notes.
   */
  stats: StatLine[];
  /** The passive, the active, the notes. **Not** the stat block above. */
  description: string;
  /**
   * '1'..'6', or **''** for an item with no active.
   *
   * A key printed on something that does nothing when pressed is a promise the
   * bar does not keep — and most items are exactly that: stats and a passive.
   */
  hotKey: string;
  hasActive: boolean;
  coolDownPercent: number;
  coolDownText: number;
  showCoolDown: boolean;
  canCast: boolean;
  /** The active is running — same question, same answer, as `SpellDisplay.sustaining`. */
  sustaining: boolean;
}

/**
 * The champion's own passive: a spell it *has* rather than one it casts, so it
 * carries no key, no cooldown and no cost. Null for the champions that have
 * none, which is most of them, and null for one whose spell has no icon —
 * there is nothing to draw, and an empty square in the bar reads as a bug.
 */
export interface PassiveDisplay {
  image: string;
  name: string;
  description: string;
}

export interface HudState {
  avatar: string;
  isDead: boolean;
  reviveAfter: number;
  stats: StatsDisplay;
  spells: SpellDisplay[];
  buffs: BuffDisplay[];
  /** Null for a unit with no recall at all — a headless test, mostly. */
  recall: RecallDisplay | null;
  /** Null while alive (or before the first death). See `DeathRecapDisplay`. */
  deathRecap: DeathRecapDisplay | null;
  /** Whole coins. 0 for a unit with no wallet — a minion, a pet, a test double. */
  gold: number;
  /** Always `INVENTORY_SIZE` entries. See `ItemSlotDisplay`. */
  items: ItemSlotDisplay[];
  passive: PassiveDisplay | null;
  /**
   * The shop is reachable from where this champion is standing.
   *
   * Read through `ItemShop.atOwnFountain` rather than restated here: the bar
   * lighting up somewhere the shop would then refuse is worse than no light at
   * all, and one rule with two implementations is how that happens. It is what
   * teaches the rule — a pill that brightens at the fountain says "here" in
   * one match, where a button that silently refuses says nothing.
   */
  canShop: boolean;
}

function buildStats(player: any): StatsDisplay {
  const { health, maxHealth, mana, maxMana } = player.stats || {};
  const healthPercent = Math.min((health?.value as number) / maxHealth?.value, 1) * 100;
  const shield = player.shieldAmount ?? 0;
  const shieldPercent = Math.min(shield / (maxHealth?.value || 1), 1) * 100;
  return {
    health: ~~health?.value,
    maxHealth: ~~maxHealth?.value,
    mana: ~~mana?.value,
    maxMana: ~~maxMana?.value,
    healthPercent,
    manaPercent: Math.min((mana?.value as number) / maxMana?.value, 1) * 100,
    shield: ~~shield,
    shieldPercent,
    shieldLeftPercent: Math.min(healthPercent, 100 - shieldPercent),
  };
}

function buildSpells(player: any): SpellDisplay[] {
  const mana = player.stats?.mana;
  return (player.spells || [])
    .filter((i: any) => i?.image?.path)
    .map((spell: any, index: number) => {
      ensureVisibleAsset(spell.image);
      const isInternalSpell = index === 0;
      const isSummonerSpell = index > 4;
      const hotKey = SpellHotKeys[index]
        ? String.fromCharCode(SpellHotKeys[index]).toUpperCase()
        : '';

      const { disabled, image, state, currentCooldown, name, description, stackCount } =
        spell || {};

      // The *effective* numbers, not the spell's own tuning fields: under a
      // cooldown-reduction or URF match those differ, and the icon has to agree
      // with what the cast path actually charges and waits. `currentCooldown`
      // already counts down from the reduced duration, so using the raw
      // `coolDown` as the denominator would also under-fill the sweep.
      // These are equipped spells, so an owner and its match rules always
      // exist — ownerless instances built by `pregameCatalog` cannot see match
      // rules and stay on raw numbers.
      const coolDown = spell?.effectiveCoolDownMs ?? spell?.coolDown ?? 0;
      const manaCost = spell?.effectiveManaCost ?? spell?.manaCost ?? 0;
      // And the description, for exactly the same reason: its damage is
      // authored text with the first-frame number baked in, while `takeDamage`
      // multiplies by this owner's ability power. The bar promised 15 for the
      // whole match however much power the player bought.
      const effectiveDescription = spell?.effectiveDescription ?? description;

      // `=== true` rather than a truthy read: an ownerless catalogue instance
      // and a spell from a pack built against an older core both answer
      // `undefined` here, and neither may make the bar throw or glow.
      const sustaining = spell?.isSustaining === true;
      const sustainDurationMs = sustaining ? (spell?.sustainDurationMs ?? 0) : 0;

      return {
        instance: spell,
        image: image?.path,
        disabled,
        coolDown,
        currentCooldown,
        state,
        name,
        description: effectiveDescription,
        coolDownText: Math.ceil(currentCooldown / 1000),
        coolDownPercent: coolDown > 0 ? Math.min((currentCooldown / coolDown) * 100, 100) : 0,
        showCoolDown: currentCooldown > 0,
        // `!== false` so a spell that never heard of the flag still reads as a
        // lockout, which is what every cooldown but the swing timer is.
        lockedOut: currentCooldown > 0 && spell?.cooldownLocksOut !== false,
        small: isInternalSpell || isSummonerSpell,
        // Per spell, not per champion: a spell that declines the crowd-control
        // rule (`Spell.castableWhileControlled` — a cleanse) is pressable while
        // its owner is stunned, and greying it out then would be the bar lying
        // about the one moment it matters.
        canCast: (player.canCast || spell?.castableWhileControlled === true) && !player.isDead,
        hotKey,
        stackCount,
        manaCost,
        affordable: (mana?.value ?? 0) >= manaCost,
        sustaining,
        toggle: spell?.isToggle === true,
        // A duration of 0 means "no declared end" (`SpellRuntime.sustainDurationMs`),
        // so the percentage is 0 rather than a bar filling toward nothing.
        sustainPercent:
          sustainDurationMs > 0
            ? Math.min(
                100,
                Math.max(0, ((spell?.sustainRemainingMs ?? 0) / sustainDurationMs) * 100)
              )
            : 0,
        sustainSecondsLeft:
          sustainDurationMs > 0 ? Math.ceil((spell?.sustainRemainingMs ?? 0) / 1000) : 0,
      };
    });
}

const EMPTY_SLOT: Omit<ItemSlotDisplay, 'hotKey'> = {
  filled: false,
  image: '',
  name: '',
  stats: [],
  description: '',
  hasActive: false,
  coolDownPercent: 0,
  coolDownText: 0,
  showCoolDown: false,
  canCast: false,
  sustaining: false,
};

/**
 * Six slots, always. See `ItemSlotDisplay` for why the empty ones are here.
 *
 * The icon comes off `HeldItem.icon`, an already-resolved handle, rather than
 * being looked up from the def's key: `AssetManager.get` throws on an unknown
 * key and this function runs twenty times a second, so a pack with one bad
 * icon key would take the whole bar down mid match. `ItemShop` does that
 * lookup once, at purchase, and guards it.
 */
function buildItems(player: any): ItemSlotDisplay[] {
  const held = player.items ?? [];
  const slots: ItemSlotDisplay[] = [];

  for (let slot = 0; slot < INVENTORY_SIZE; slot++) {
    const item = held[slot];
    const key = ItemHotKeys[slot] ? String.fromCharCode(ItemHotKeys[slot]).toUpperCase() : '';

    if (!item) {
      slots.push({ ...EMPTY_SLOT, hotKey: '' });
      continue;
    }

    ensureVisibleAsset(item.icon);
    const active = item.active ?? null;
    // `effectiveCoolDownMs`, not the spell's own tuning field, for the same
    // reason `buildSpells` uses it: under a cooldown-reduction match the two
    // differ and the icon has to agree with what the cast path actually waits.
    const coolDown = active?.effectiveCoolDownMs ?? active?.coolDown ?? 0;
    const currentCooldown = active?.currentCooldown ?? 0;

    slots.push({
      filled: true,
      image: item.icon?.path ?? '',
      name: item.def?.name ?? '',
      stats: statLinesFor(item.def),
      // **Not** rescaled, unlike a spell's. An item's abilities are the one
      // population `economy/ItemShop` opts out of ability power by hand
      // (`damageScalesWithAbilityPower = false`, because they already read
      // `attackDamage` and must not be paid for out of two stats), so an
      // item's printed damage is the damage it deals at every point in the
      // match. This line ran through `amplifiedDamageText` for one commit and
      // promised a flat 30 as `30 (+60)` — the exact failure the rescaling
      // exists to prevent, pointed the other way.
      description: item.def?.description ?? '',
      hotKey: active ? key : '',
      hasActive: !!active,
      coolDownPercent: coolDown > 0 ? Math.min((currentCooldown / coolDown) * 100, 100) : 0,
      coolDownText: Math.ceil(currentCooldown / 1000),
      showCoolDown: currentCooldown > 0,
      canCast:
        !!active &&
        (!!player.canCast || active?.castableWhileControlled === true) &&
        !player.isDead,
      sustaining: active?.isSustaining === true,
    });
  }

  return slots;
}

/**
 * The passive, or null. Null for a champion with none *and* for one whose
 * passive spell carries no icon — the bar has nothing to draw, and an empty
 * square in a row of artwork reads as a broken image rather than as a feature.
 */
function buildPassive(player: any): PassiveDisplay | null {
  const passive = player.passive;
  if (!passive?.image?.path) return null;
  ensureVisibleAsset(passive.image);
  return {
    image: passive.image.path,
    name: passive.name ?? '',
    description: passive.description ?? '',
  };
}

/**
 * One `BuffDisplay` object per kind of buff, reused between reads.
 *
 * `buildBuffs` used to mint a fresh object every 50ms, which this file's own
 * `HUD_UPDATE_INTERVAL_MS` comment already calls out as the thing to avoid —
 * and it became a correctness problem, not just a cost one, the moment the row
 * grew a hover panel. `HudInteractions.showSpellInfo` keeps the *object* it was
 * handed, so a countdown read off a snapshot taken at hover time freezes at
 * whatever it said then and sits there being wrong for as long as the pointer
 * rests on the icon.
 *
 * Keyed by `stackId ?? constructor`, the same identity the aggregation below
 * groups on: both are stable for the life of the process, and the map is
 * bounded by how many kinds of buff the installed content declares — not by
 * how many are applied, and not by how long the match runs.
 */
const buffDisplays = new Map<unknown, BuffDisplay>();

/** How long is left, in the words the hover panel puts under the name. */
function buffNote(duration: number, timeLeft: number, stacks: number): string {
  const parts: string[] = [];
  // duration 0 is `Buff`'s "never expires" — a countdown there would be a
  // number counting down to nothing.
  parts.push(duration > 0 ? `còn ${Math.max(0, Math.ceil(timeLeft / 1000))}s` : 'vĩnh viễn');
  if (stacks > 1) parts.push(`${stacks} lớp`);
  return parts.join(' · ');
}

/**
 * One row per kind of buff, not per stack: one stacking spell alone can hold hundreds of
 * StatAmp instances, which used to render hundreds of icons. The longest
 * remaining instance drives the countdown.
 */
function buildBuffs(player: any): BuffDisplay[] {
  const buffRows = new Map<any, BuffDisplay>();
  for (const buff of player.buffs || []) {
    if (!buff?.image?.path) continue;
    // Display-only opt-out — a permanent item passive's armed state. See
    // `Buff.hudVisible`; `=== false` so a plain test double stays visible.
    if (buff.hudVisible === false) continue;
    ensureVisibleAsset(buff.image);

    const key = buff.stackId ?? buff.constructor;
    const timeLeft = (buff.duration || 0) - (buff.timeElapsed || 0);
    const existing = buffRows.get(key);
    // A `countedStacks` buff (`src/game/gameObject/Buff.ts` — a permanent,
    // uniform stat stack) is one instance carrying its whole
    // count on `.stacks`; every other buff has never heard of that field, so
    // this falls back to 1 and behaves exactly as a plain per-instance count.
    const stacks = buff.stacks ?? 1;

    if (existing) {
      existing.stacks += stacks;
      if (buff.duration && timeLeft > existing.duration - existing.timeElapsed) {
        existing.duration = buff.duration;
        existing.timeElapsed = buff.timeElapsed;
        existing.timeLeftText = Math.ceil(timeLeft / 1000);
      }
      existing.note = buffNote(
        existing.duration,
        existing.duration - existing.timeElapsed,
        existing.stacks
      );
      continue;
    }

    // The same object as last read when this kind was up then — see
    // `buffDisplays`. Every field is written here, so an entry coming back
    // after a gap carries nothing over from the last time it was on.
    const display = buffDisplays.get(key) ?? ({} as BuffDisplay);
    buffDisplays.set(key, display);
    display.image = buff.image.path;
    display.duration = buff.duration;
    display.timeElapsed = buff.timeElapsed;
    // duration 0 is `Buff`'s "never expires": no countdown, rather than the
    // negative seconds a permanent buff used to count into.
    display.timeLeftText = buff.duration ? Math.ceil(timeLeft / 1000) : 0;
    display.stacks = stacks;
    display.name = buff.name ?? '';
    display.description = buff.description ?? '';
    display.note = buffNote(buff.duration, timeLeft, stacks);
    buffRows.set(key, display);
  }
  return [...buffRows.values()];
}

/**
 * The channel's length comes off the spell's own `castSpec.channel`, never off
 * a copy of `RECALL_CHANNEL_MS` — retuning the constant must not mean editing
 * the HUD, and importing the spell here would drag it into this shared layer.
 */
function buildRecall(player: any): RecallDisplay | null {
  const recall = player.recall;
  if (!recall) return null;

  const durationMs = recall.castSpec?.channel?.durationMs ?? 0;
  const progress = Math.min(1, Math.max(0, recall.channelProgress ?? 0));

  return {
    name: recall.name ?? '',
    description: recall.description ?? '',
    hotKey: String.fromCharCode(HotKeys.B),
    channeling: recall.state === 'CHANNELING',
    progressPercent: progress * 100,
    secondsLeft: Math.ceil(((1 - progress) * durationMs) / 1000),
    canCast: !!player.canCast && !player.isDead && !recall.disabled,
  };
}

/** The type labels the recap falls back to when no ability named itself. */
const DAMAGE_TYPE_LABEL: Record<string, string> = {
  PHYSICAL: 'Sát thương vật lý',
  MAGIC: 'Sát thương phép',
  TRUE: 'Sát thương chuẩn',
};

/** A source label, as the icon map keys it: codename trimmed, case folded. */
const sourceKeyOf = (name: string): string =>
  name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();

/**
 * label -> iconUrl, read off the spells actually living in this match.
 *
 * The ledger stores display labels, not ids — and resolving a bare id
 * through the catalog is the qualified-id swamp (`summonerIdOr`'s trap).
 * Every live `Spell` already carries its own `name` and `image`, so one walk
 * over the world's champions — kits, passives, item spells — answers the
 * lookup for any installed pack, with no registry and no chunk crossing.
 * Cached per death: icons do not change while the corpse reads them.
 */
let recapIconCache: { recap: unknown; icons: Map<string, string> } | null = null;
function recapIconsFor(player: any, recap: unknown): Map<string, string> {
  // Keyed on the recap object itself, not its seq: seq restarts per unit, so
  // a fresh match's first death would otherwise wear the last match's icons.
  if (recapIconCache?.recap === recap) return recapIconCache.icons;
  const icons = new Map<string, string>();
  const claim = (spell: { name?: string; image?: { path?: string; key?: string; status?: string } } | null | undefined): void => {
    const name = spell?.name;
    const path = spell?.image?.path;
    if (!name || !path) return;
    const key = sourceKeyOf(name);
    if (!icons.has(key)) {
      ensureVisibleAsset(spell.image as AssetHandle);
      icons.set(key, path);
    }
  };
  const units: any[] = player.game?.objectManager?.objects ?? [];
  for (const unit of [player, ...units]) {
    if (!Array.isArray(unit?.spells)) continue;
    for (const spell of unit.spells) claim(spell);
    claim(unit.passive);
    claim(unit.recall);
    if (Array.isArray(unit.items)) {
      for (const held of unit.items) {
        claim(held?.passive);
        claim(held?.active);
      }
    }
  }
  recapIconCache = { recap, icons };
  return icons;
}

/**
 * Groups the death ledger for the panel: one row per attacker, heaviest
 * first; inside a row, one line per named source (or per damage type when
 * nothing named itself), heaviest first.
 */
function buildDeathRecap(player: any): DeathRecapDisplay | null {
  // Deliberately not gated on `isDead`: respawns are fast here, and a recap
  // that vanished with the corpse was gone before anyone finished reading
  // it. The panel decides its own dismissal (the close button, or a tap
  // outside once respawned) — the data just keeps answering.
  if (!player.deathRecap) return null;
  const recap = player.deathRecap;
  const icons = recapIconsFor(player, recap);

  const rows = new Map<string, DeathRecapRow & { lines: Map<string, DeathRecapSourceRow> }>();
  let total = 0;
  for (const entry of recap.entries as {
    amount: number;
    type: string;
    attackerName: string;
    attackerId: string;
    source?: string;
  }[]) {
    total += entry.amount;
    let row = rows.get(entry.attackerId);
    if (!row) {
      row = { attacker: entry.attackerName, total: 0, sources: [], lines: new Map() };
      rows.set(entry.attackerId, row);
    }
    row.total += entry.amount;
    // Spell names carry their code name as a trailing parenthetical, which is
    // documentation, not something to retell a death with — trimmed here.
    const label = (entry.source ?? DAMAGE_TYPE_LABEL[entry.type] ?? entry.type).replace(
      /\s*\([^)]*\)\s*$/,
      ''
    );
    const key = `${label}:${entry.type}`;
    const line = row.lines.get(key);
    if (line) {
      line.amount += entry.amount;
      line.hits += 1;
    } else {
      row.lines.set(key, {
        label,
        image: icons.get(sourceKeyOf(label)) ?? '',
        amount: entry.amount,
        hits: 1,
        type: entry.type,
      });
    }
  }

  return {
    seq: recap.seq,
    killer: recap.killerName,
    total,
    rows: [...rows.values()]
      .map(row => ({
        attacker: row.attacker,
        total: row.total,
        sources: [...row.lines.values()].sort((a, b) => b.amount - a.amount),
      }))
      .sort((a, b) => b.total - a.total),
  };
}

/** Reads `game.player` and returns everything the HUD displays. Null while there is no player yet. */
export function computeHudState(game: Game | undefined | null): HudState | null {
  const player = (game as any)?.player;
  if (!player) return null;

  ensureVisibleAsset(player.avatar);

  return {
    avatar: player.avatar?.path || '',
    isDead: player.isDead,
    reviveAfter: ~~((player.deathData?.reviveAfter ?? 0) / 1000),
    stats: buildStats(player),
    spells: buildSpells(player),
    buffs: buildBuffs(player),
    recall: buildRecall(player),
    deathRecap: buildDeathRecap(player),
    gold: player.wallet?.balance ?? 0,
    items: buildItems(player),
    passive: buildPassive(player),
    canShop: atOwnFountain(player, { fountains: (game as any)?.fountains ?? [] }),
  };
}
