import {
  STRUCTURE_KINDS,
  type ContentPack,
  type ContentPackCode,
  type ContentPackData,
  type StructureKind,
} from './ContentPack';

/**
 * The boundary check, hand-written and dependency-free.
 *
 * Every rule here exists because the engine's own failure for it is silent.
 * `TerrainMap` drops a terrain layer it does not recognise without a word;
 * a lane naming a faction nobody declared walks minions to `undefined`; a
 * lane with no declared muster point for one of its factions is a wave with
 * nowhere to form up — `MinionSpawner.musterPointFor` used to answer that
 * with `null` and drop the whole wave into the fountain, silently, until it
 * walked back out (Task 6 deleted that fallback; now it is this file that
 * refuses the map). Each of those surfaces as a broken match some minutes
 * in. Named at load, they are a sentence.
 */
import { ITEM_STAT_KEYS } from '@/game/items/itemStats';

/** `ITEM_STAT_KEYS` as a set — see `checkItems`. */
const GRANTABLE_STATS = new Set<string>(ITEM_STAT_KEYS);

export type ValidationResult = { ok: true; pack: ContentPack } | { ok: false; errors: string[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isStringArray = (value: unknown): value is string[] => {
  if (!Array.isArray(value)) return false;
  for (const item of value) {
    if (typeof item !== 'string') return false;
  }
  return true;
};

/** Bare identifier: the pack id becomes a prefix, so a colon is ambiguous. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function checkManifest(value: unknown, errors: string[]): void {
  if (!isObject(value)) {
    errors.push('manifest: missing');
    return;
  }
  if (typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) {
    errors.push(`manifest.id: must be a bare identifier, got ${JSON.stringify(value.id)}`);
  }
  if (typeof value.version !== 'string') errors.push('manifest.version: must be a string');
  if (typeof value.coreRange !== 'string') errors.push('manifest.coreRange: must be a string');
  if (value.assets !== undefined && typeof value.assets !== 'string') {
    errors.push('manifest.assets: must be a string when present');
  }
}

function checkSpells(pack: Record<string, unknown>, errors: string[]): void {
  if (pack.spells === undefined) return;
  if (!isObject(pack.spells)) {
    errors.push('spells: must be an object');
    return;
  }
  for (const [id, value] of Object.entries(pack.spells)) {
    // A spell class is a constructor; a spell loader is a thunk returning a
    // promise of one. The success path casts this object to
    // Record<string, SpellSource>, and both arms of that union are
    // functions — a class is itself a function — so this one check already
    // accepts either without needing to tell them apart. Only PackRegistry
    // cares which arm it got, at resolution time.
    if (typeof value !== 'function') {
      errors.push(`spells.${id}: must be a class (constructor function)`);
    }
  }
}

/**
 * `ContentPackCode.monsterAbilities` — the code half `MonsterBody`'s own doc
 * comment points to. Structural, not deep: `cast` is a real closure over a
 * pack's `ContentApi`, so the only thing checkable here without invoking it
 * is that it is a function at all — the same shallow-but-real discipline
 * `checkSpells` applies to a spell class/loader.
 */
function checkMonsterAbilities(pack: Record<string, unknown>, errors: string[]): void {
  if (pack.monsterAbilities === undefined) return;
  if (!isObject(pack.monsterAbilities)) {
    errors.push('monsterAbilities: must be an object');
    return;
  }
  for (const [id, value] of Object.entries(pack.monsterAbilities)) {
    if (!Array.isArray(value) || value.length === 0) {
      errors.push(`monsterAbilities.${id}: must be a non-empty array`);
      continue;
    }
    value.forEach((ability, index) => {
      const path = `monsterAbilities.${id}[${index}]`;
      if (!isObject(ability)) {
        errors.push(`${path}: must be an object`);
        return;
      }
      if (typeof ability.name !== 'string') errors.push(`${path}.name: must be a string`);
      if (!isFiniteNumber(ability.cooldownMs)) {
        errors.push(`${path}.cooldownMs: must be a finite number`);
      }
      if (typeof ability.cast !== 'function') {
        errors.push(`${path}.cast: must be a function`);
      }
    });
  }
}

function checkChampions(pack: Record<string, unknown>, errors: string[]): void {
  if (pack.champions === undefined) return;
  if (!Array.isArray(pack.champions)) {
    errors.push('champions: must be an array');
    return;
  }
  // `pack.spells` is absent, not empty, when only the data half is being
  // validated (`validatePackData` — a `ContentPackData` has no `spells` key
  // at all) — the code half has not arrived yet, so there is nothing to
  // cross-check a champion's ability ids against, and skipping the check
  // here is not a hole: `install()` still validates the merged pack, spells
  // included, before either half is written. A *present* `spells: {}` (a
  // pack that truly declares none) still fails every reference below, same
  // as before the split.
  const spellsProvided = pack.spells !== undefined;
  const spells = isObject(pack.spells) ? pack.spells : {};
  for (const entry of pack.champions) {
    if (!isObject(entry) || typeof entry.id !== 'string') {
      errors.push('champions[]: each entry needs a string id');
      continue;
    }
    if (typeof entry.name !== 'string') {
      errors.push(`champions.${entry.id}.name: must be a string`);
    }
    if (entry.image !== null && typeof entry.image !== 'string') {
      errors.push(`champions.${entry.id}.image: must be a string or null`);
    }
    if (typeof entry.playable !== 'boolean') {
      errors.push(`champions.${entry.id}.playable: must be a boolean`);
    } else if (entry.playable) {
      // What `listSelectableChampions` and `PLAYABLE_CHAMPION_KITS` have
      // always meant by "pickable": a portrait and all four of Q/W/E/R.
      if (typeof entry.image !== 'string' || entry.image.length === 0) {
        errors.push(`champions.${entry.id}: playable champion needs a portrait (image)`);
      }
      if (!Array.isArray(entry.spells) || entry.spells.length !== 4) {
        errors.push(`champions.${entry.id}: playable champion needs exactly four abilities`);
      }
    }
    if (entry.attack !== undefined) {
      if (!isObject(entry.attack)) {
        errors.push(`champions.${entry.id}.attack: must be an object`);
      } else {
        for (const field of ['damage', 'attacksPerSecond', 'range'] as const) {
          if (!isFiniteNumber(entry.attack[field])) {
            errors.push(`champions.${entry.id}.attack.${field}: must be a finite number`);
          }
        }
      }
    }
    if (!Array.isArray(entry.spells)) {
      errors.push(`champions.${entry.id}.spells: must be an array`);
      continue;
    }
    for (const id of entry.spells) {
      if (typeof id !== 'string') {
        errors.push(`champions.${entry.id}.spells: ids must be strings`);
      } else if (spellsProvided && !(id in spells)) {
        errors.push(`champions.${entry.id}: spell ${id} is not in this pack`);
      }
    }
    if (entry.passive !== undefined) {
      if (typeof entry.passive !== 'string') {
        errors.push(`champions.${entry.id}.passive: must be a string`);
      } else if (spellsProvided && !(entry.passive in spells)) {
        errors.push(`champions.${entry.id}: passive ${entry.passive} is not in this pack`);
      } else if (entry.spells?.includes?.(entry.passive)) {
        // Both a passive *and* a kit slot is two instances of one spell on one
        // champion, one of them armed by core and one bound to a key. The
        // player then sees the same icon twice and only one of them does
        // anything the tooltip describes.
        errors.push(
          `champions.${entry.id}: passive ${entry.passive} is also in the kit; it must be one or the other`
        );
      }
    }
    if (entry.recall !== undefined) {
      if (typeof entry.recall !== 'string') {
        errors.push(`champions.${entry.id}.recall: must be a string`);
      } else if (spellsProvided && !(entry.recall in spells)) {
        errors.push(`champions.${entry.id}: recall ${entry.recall} is not in this pack`);
      }
    }
  }
}

const SPELL_DISPLAY_FIELDS: Record<string, 'string' | 'number' | 'string-or-null'> = {
  name: 'string',
  description: 'string',
  iconKey: 'string-or-null',
  coolDownMs: 'number',
  manaCost: 'number',
  specCoolDownMs: 'number',
};

function checkSpellDisplay(pack: Record<string, unknown>, errors: string[]): void {
  if (pack.spellDisplay === undefined) return;
  if (!isObject(pack.spellDisplay)) {
    errors.push('spellDisplay: must be an object');
    return;
  }
  // See `checkChampions`'s identical guard: an absent `spells` key means only
  // the data half is being validated, and there is nothing yet to check a
  // display entry's id against.
  const spellsProvided = pack.spells !== undefined;
  const spells = isObject(pack.spells) ? pack.spells : {};
  for (const [id, value] of Object.entries(pack.spellDisplay)) {
    if (spellsProvided && !(id in spells)) {
      errors.push(`spellDisplay.${id}: no spell named ${id} in this pack`);
    }
    if (!isObject(value)) {
      errors.push(`spellDisplay.${id}: must be an object`);
      continue;
    }
    for (const [field, kind] of Object.entries(SPELL_DISPLAY_FIELDS)) {
      const fieldValue = value[field];
      const ok =
        kind === 'string'
          ? typeof fieldValue === 'string'
          : kind === 'number'
            ? isFiniteNumber(fieldValue)
            : fieldValue === null || typeof fieldValue === 'string';
      if (!ok) {
        errors.push(`spellDisplay.${id}.${field}: must be a ${kind}`);
      }
    }
  }
}

/**
 * An item, as a pack declares it.
 *
 * Two of these checks close a silent failure rather than a loud one, which is
 * the whole argument for this file existing:
 *
 *   - a `stats` key that is not on `ITEM_STAT_KEYS` grants nothing, for ever,
 *     with nothing anywhere to look at. `modifierFor` skips it deliberately —
 *     reaching that branch at runtime means core and this validator disagree.
 *   - a `passive`/`active` naming a spell the pack does not ship builds an
 *     item whose whole point never happens, and the player is simply out the
 *     gold.
 *
 * The `health`/`mana`/`size` exclusion is not pedantry: those are current
 * pools and the body, so an item granting one would top a champion up on
 * equip and **take it back on sale**, which is a shop that can kill you. See
 * `ITEM_STAT_KEYS`.
 */
function checkItems(pack: Record<string, unknown>, errors: string[]): void {
  if (pack.items === undefined) return;
  if (!isObject(pack.items)) {
    errors.push('items: must be an object');
    return;
  }
  // See `checkChampions`'s identical guard: an absent `spells` key means only
  // the data half is on the table, so there is nothing yet to resolve an
  // item's spell ids against. `install()` still validates the merged pack.
  const spellsProvided = pack.spells !== undefined;
  const spells = isObject(pack.spells) ? pack.spells : {};

  /**
   * Gathered as the loop runs and checked after it, because every question
   * worth asking about a recipe needs the *other* items to answer: does this
   * id name anything, does the graph cycle, do the parts add up. Only entries
   * that passed their own checks go in — an item with a broken `cost` would
   * otherwise earn a second, more confusing error about arithmetic.
   */
  const costs = new Map<string, number>();
  const recipes = new Map<string, string[]>();

  for (const [key, value] of Object.entries(pack.items)) {
    const path = `items.${key}`;
    if (!isObject(value)) {
      errors.push(`${path}: must be an object`);
      continue;
    }
    // The map key is what everything else looks this item up by, so an `id`
    // saying something else is two names for one thing.
    if (value.id !== key) {
      errors.push(`${path}.id: must equal its key, got ${JSON.stringify(value.id)}`);
    }
    if (typeof value.name !== 'string') errors.push(`${path}.name: must be a string`);
    if (typeof value.icon !== 'string') {
      errors.push(`${path}.icon: must be a string — an item with no icon is unbuyable`);
    }
    if (!isFiniteNumber(value.cost) || (value.cost as number) < 0) {
      errors.push(`${path}.cost: must be a number of 0 or more`);
    } else {
      costs.set(key, value.cost as number);
    }

    if (value.buildsFrom !== undefined) {
      if (!Array.isArray(value.buildsFrom)) {
        errors.push(`${path}.buildsFrom: must be an array of item ids`);
      } else if (value.buildsFrom.some(entry => typeof entry !== 'string')) {
        errors.push(`${path}.buildsFrom: every entry must be an item id`);
      } else {
        recipes.set(key, value.buildsFrom as string[]);
      }
    }
    if (value.description !== undefined && typeof value.description !== 'string') {
      errors.push(`${path}.description: must be a string when present`);
    }

    if (value.stats !== undefined) {
      if (!isObject(value.stats)) {
        errors.push(`${path}.stats: must be an object`);
      } else {
        for (const [statKey, amount] of Object.entries(value.stats)) {
          if (!GRANTABLE_STATS.has(statKey)) {
            errors.push(`${path}.stats.${statKey}: not a stat an item may grant`);
          }
          if (!isFiniteNumber(amount)) {
            errors.push(`${path}.stats.${statKey}: must be a finite number`);
          }
        }
      }
    }

    for (const slot of ['passive', 'active'] as const) {
      const spellId = value[slot];
      if (spellId === undefined) continue;
      if (typeof spellId !== 'string') {
        errors.push(`${path}.${slot}: must be a string`);
        continue;
      }
      if (spellsProvided && !(spellId in spells)) {
        errors.push(`${path}: ${slot} ${spellId} is not in this pack`);
      }
    }
  }
  checkRecipes(costs, recipes, errors);
}

/**
 * The three questions a recipe can only be asked once every item is on the
 * table, all of which fail *silently* at runtime if they go unasked.
 *
 * **An id naming nothing** is a component `ItemShop.componentSlotsFor` can
 * never match, so the item quietly costs full price for ever and the build
 * path the author drew does not exist.
 *
 * **A cycle** is an item that is its own ancestor. Nothing hangs — the shop
 * only ever looks one level down — but no sequence of purchases can complete
 * it, which is a build path that is unreachable rather than merely wrong.
 *
 * **A total under the sum of its parts** wants a negative price out of
 * `priceFor`, which is `Wallet.spend` handing gold *out*. Core floors it at
 * zero rather than trusting this check, but a floored price is still a number
 * the author did not mean to write, and this is the only place that can say so.
 */
function checkRecipes(
  costs: Map<string, number>,
  recipes: Map<string, string[]>,
  errors: string[]
): void {
  for (const [id, parts] of recipes) {
    let sum = 0;
    let priceable = true;
    for (const part of parts) {
      if (!costs.has(part)) {
        errors.push(`items.${id}.buildsFrom: ${part} is not an item in this pack`);
        priceable = false;
        continue;
      }
      sum += costs.get(part) as number;
    }
    // Skipped when a part is missing: its price is unknown, so the sum is not
    // a real number and reporting it would be a second error about the first.
    if (priceable && (costs.get(id) ?? 0) < sum) {
      errors.push(
        `items.${id}.cost: ${costs.get(id)} is under the ${sum} its parts cost — ` +
          '`cost` is the total, so combining would pay the player'
      );
    }
  }

  // Iterative walk with an explicit stack, not recursion: a deep build path is
  // a legal pack and a pack is a stranger's JSON, so the depth is not ours to
  // bound.
  //
  // The `'open'` test below is not only how a cycle is *reported* — it is the
  // loop's termination condition. Weakening it does not produce a missed
  // error, it produces a hang: measured, by mutating it to `'done'` and
  // watching this file's own cycle case run the worker out of heap.
  const state = new Map<string, 'open' | 'done'>();
  const walk = (start: string): void => {
    const stack: { id: string; next: number }[] = [{ id: start, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const parts = recipes.get(frame.id) ?? [];
      if (frame.next === 0) {
        if (state.get(frame.id) === 'done') {
          stack.pop();
          continue;
        }
        state.set(frame.id, 'open');
      }
      if (frame.next >= parts.length) {
        state.set(frame.id, 'done');
        stack.pop();
        continue;
      }
      const part = parts[frame.next++];
      if (state.get(part) === 'open') {
        errors.push(`items.${part}.buildsFrom: builds out of itself, through ${frame.id}`);
        state.set(part, 'done');
        continue;
      }
      if (state.get(part) !== 'done' && recipes.has(part)) stack.push({ id: part, next: 0 });
    }
  };
  for (const id of recipes.keys()) {
    if (!state.has(id)) walk(id);
  }
}

/** One `MonsterBody` entry of a `monsters.<id>.members` array. */
function checkMonsterBody(path: string, value: unknown, errors: string[]): void {
  if (!isObject(value)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  if (typeof value.name !== 'string') errors.push(`${path}.name: must be a string`);
  // A body's own asset key, never validated against core's generated union —
  // same shape as `checkChampions`'s `image` check, but not nullable: unlike
  // a champion shelf entry, a jungle body with no art is not a real shape.
  if (typeof value.avatar !== 'string') errors.push(`${path}.avatar: must be a string`);
  if (!isFiniteNumber(value.speed)) errors.push(`${path}.speed: must be a finite number`);
  if (!isFiniteNumber(value.size)) errors.push(`${path}.size: must be a finite number`);
  if (!isFiniteNumber(value.attackRange)) {
    errors.push(`${path}.attackRange: must be a finite number`);
  }
  if (!isFiniteNumber(value.reviveTime)) {
    errors.push(`${path}.reviveTime: must be a finite number`);
  }
  if (!isFiniteNumber(value.health)) errors.push(`${path}.health: must be a finite number`);
  if (
    !isObject(value.offset) ||
    !isFiniteNumber(value.offset.x) ||
    !isFiniteNumber(value.offset.y)
  ) {
    errors.push(`${path}.offset: must be {x, y} finite numbers`);
  }
}

function checkMonsters(pack: Record<string, unknown>, errors: string[]): void {
  if (pack.monsters === undefined) return;
  if (!isObject(pack.monsters)) {
    errors.push('monsters: must be an object');
    return;
  }
  for (const [id, value] of Object.entries(pack.monsters)) {
    if (!isObject(value)) {
      errors.push(`monsters.${id}: must be an object`);
      continue;
    }
    if (typeof value.id !== 'string') errors.push(`monsters.${id}.id: must be a string`);
    if (typeof value.name !== 'string') errors.push(`monsters.${id}.name: must be a string`);
    // PackRegistry.install() and monstersFilling(role) both call
    // monster.fills.includes(role); a non-array fills is a runtime
    // TypeError one layer downstream instead of a named error here.
    if (!isStringArray(value.fills)) {
      errors.push(`monsters.${id}: fills must be an array of strings`);
    }
    // `Game.spawnJungle()` loops `members` unconditionally; an empty array
    // is a camp that fills its slot with nothing, the same silent-failure
    // shape this file exists to catch named rather than left to surface as
    // an empty jungle later.
    if (!Array.isArray(value.members) || value.members.length === 0) {
      errors.push(`monsters.${id}.members: must be a non-empty array`);
      continue;
    }
    value.members.forEach((member, index) => {
      checkMonsterBody(`monsters.${id}.members[${index}]`, member, errors);
    });
  }
}

/**
 * The heavy half — terrain, slots, lanes. `checkMap` below calls this only
 * when `geometry` arrived as a plain object, because a loader's body cannot
 * be inspected synchronously (see `checkSpells`'s identical treatment of a
 * `SpellSource` loader) — a lazy map's geometry goes unchecked at
 * `checkMap` time. It is **not** unchecked forever: exported so
 * `PackRegistry.loadMapGeometry` can call it again, against the resolved
 * object, the moment a loader settles — both shipped maps
 * (`summonersRift`, `referenceMap`) use loaders, so without that second
 * call this function's whole terrain/slot/lane half never ran on either of
 * them in production.
 */
export function checkMapGeometry(
  geometry: Record<string, unknown>,
  name: string,
  factions: Set<string>,
  errors: string[]
): void {
  if (!isObject(geometry.terrain)) {
    errors.push(`${name}.terrain: missing`);
  } else {
    for (const layer of Object.keys(geometry.terrain)) {
      // TerrainMap only knows wall/bush/water and drops anything else in
      // silence. A pack that declares `lava` must be told, not ignored.
      if (layer !== 'wall' && layer !== 'bush' && layer !== 'water') {
        errors.push(`${name}.terrain: unknown layer ${layer}`);
      }
    }
  }

  // Slots that declare a muster point, kept so the lane loop below can ask
  // "does this faction have somewhere to form up on this lane" — see the
  // `minionSlots` use after the lanes are walked.
  let minionSlots: Record<string, unknown>[] = [];

  if (!isObject(geometry.slots)) {
    errors.push(`${name}.slots: missing`);
  } else {
    const slots = geometry.slots;
    for (const group of ['spawn', 'minion', 'structure', 'neutral']) {
      if (!Array.isArray(slots[group])) errors.push(`${name}.slots.${group}: must be an array`);
    }

    const structures = Array.isArray(slots.structure) ? slots.structure : [];
    for (const slot of structures) {
      if (!isObject(slot)) continue;
      if (!STRUCTURE_KINDS.includes(slot.kind as StructureKind)) {
        errors.push(
          `${name}.slots.structure: unknown kind ${JSON.stringify(slot.kind)}; ` +
            `core provides ${STRUCTURE_KINDS.join(', ')}`
        );
      }
      if (typeof slot.faction === 'string' && !factions.has(slot.faction)) {
        errors.push(`${name}.slots.structure: faction ${slot.faction} was never declared`);
      }
    }

    for (const group of ['spawn', 'minion'] as const) {
      const groupSlots = Array.isArray(slots[group]) ? slots[group] : [];
      for (const slot of groupSlots) {
        if (isObject(slot) && typeof slot.faction === 'string' && !factions.has(slot.faction)) {
          errors.push(`${name}.slots.${group}: faction ${slot.faction} was never declared`);
        }
      }
    }

    if (Array.isArray(slots.minion)) {
      minionSlots = slots.minion.filter(isObject);
    }
  }

  // Absent lanes are a shape, not an omission: no waves, and BotBrain's PUSH
  // posture — the only rule that reads a lane — falls through to ROAM.
  if (geometry.lanes === undefined) return;
  if (!Array.isArray(geometry.lanes)) {
    errors.push(`${name}.lanes: must be an array when present`);
    return;
  }
  for (const lane of geometry.lanes) {
    if (!isObject(lane) || typeof lane.id !== 'string') {
      errors.push(`${name}.lanes[]: each lane needs a string id`);
      continue;
    }
    for (const end of ['from', 'to'] as const) {
      const faction = lane[end];
      if (typeof faction !== 'string' || !factions.has(faction)) {
        errors.push(
          `${name}.lanes.${lane.id}.${end}: faction ${String(faction)} was never declared`
        );
        continue;
      }
      // A faction that walks this lane and has no muster point on it is the
      // exact silent failure this file's header names: `MinionSpawner` used
      // to answer with `null` and drop the whole wave into the fountain, and
      // nobody found out until the first wave walked out of it. Refused here
      // instead, at install.
      const musters = minionSlots.some(slot => slot.faction === faction && slot.lane === lane.id);
      if (!musters) {
        errors.push(
          `${name}.slots.minion: no muster point for faction ${faction} on lane ${lane.id}`
        );
      }
    }
  }
}

function checkMap(map: unknown, index: number, errors: string[]): void {
  const where = `maps[${index}]`;
  // The one legitimate early return: if `map` is not an object there is
  // nothing left in it to inspect. Every other precondition below is
  // guarded on its own so one malformed section does not hide its siblings.
  if (!isObject(map)) {
    errors.push(`${where}: must be an object`);
    return;
  }
  if (typeof map.id !== 'string') {
    errors.push(`${where}: needs a string id`);
  }
  const name = typeof map.id === 'string' ? `maps.${map.id}` : where;
  if (typeof map.name !== 'string') {
    errors.push(`${name}.name: must be a string`);
  }
  if (!isFiniteNumber(map.size) || map.size <= 0) {
    errors.push(`${name}.size: must be a positive number`);
  }

  const factions = new Set<string>();
  if (!Array.isArray(map.factions) || map.factions.length === 0) {
    errors.push(`${name}.factions: must list at least one faction`);
  } else {
    for (const faction of map.factions) {
      if (isObject(faction) && typeof faction.id === 'string') factions.add(faction.id);
      else errors.push(`${name}.factions[]: each faction needs a string id`);
    }
  }

  // `geometry` is a `MapGeometrySource`: a plain object, checked in full
  // below, or a loader — see `checkMapGeometry`'s own header for why a loader
  // gets only the structural check `checkSpells` already gives a spell loader.
  if (map.geometry === undefined) {
    errors.push(`${name}.geometry: missing`);
    return;
  }
  if (typeof map.geometry === 'function') return;
  if (!isObject(map.geometry)) {
    errors.push(`${name}.geometry: must be an object or a loader function`);
    return;
  }
  checkMapGeometry(map.geometry, name, factions, errors);
}

function checkMaps(pack: Record<string, unknown>, errors: string[]): void {
  if (pack.maps === undefined) return;
  if (!Array.isArray(pack.maps)) {
    errors.push('maps: must be an array');
    return;
  }
  pack.maps.forEach((map: unknown, index: number) => checkMap(map, index, errors));
}

export function validatePack(candidate: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(candidate)) {
    return { ok: false, errors: ['pack: must be an object'] };
  }

  checkManifest(candidate.manifest, errors);
  checkSpells(candidate, errors);
  checkMonsterAbilities(candidate, errors);
  checkSpellDisplay(candidate, errors);
  checkChampions(candidate, errors);
  checkItems(candidate, errors);
  checkMonsters(candidate, errors);
  checkMaps(candidate, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, pack: candidate as unknown as ContentPack };
}

export type DataValidationResult =
  { ok: true; data: ContentPackData } | { ok: false; errors: string[] };

/**
 * The data half alone: manifest, champions, spell display, monsters, maps —
 * everything `PackRegistry.installData` writes. Reuses the same section
 * checks `validatePack` does; a `ContentPackData` candidate has no `spells`
 * key at all (not an empty one), so `checkChampions`/`checkSpellDisplay`'s
 * "does this id exist in `spells`" cross-check quietly skips itself (see
 * their own `spellsProvided` guard) rather than flagging every reference as
 * missing. `installCode` is what completes the pack; nothing here is a
 * weaker check, only an earlier one.
 */
export function validatePackData(candidate: unknown): DataValidationResult {
  const errors: string[] = [];
  if (!isObject(candidate)) {
    return { ok: false, errors: ['pack: must be an object'] };
  }

  checkManifest(candidate.manifest, errors);
  checkSpellDisplay(candidate, errors);
  checkChampions(candidate, errors);
  checkItems(candidate, errors);
  checkMonsters(candidate, errors);
  checkMaps(candidate, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: candidate as unknown as ContentPackData };
}

export type CodeValidationResult =
  { ok: true; code: ContentPackCode } | { ok: false; errors: string[] };

/**
 * The code half alone: every entry in `spells` is a class or a loader, and
 * every entry in `monsterAbilities` is a well-shaped `MonsterAbility[]`.
 */
export function validatePackCode(candidate: unknown): CodeValidationResult {
  const errors: string[] = [];
  if (!isObject(candidate)) {
    return { ok: false, errors: ['pack: must be an object'] };
  }

  checkSpells(candidate, errors);
  checkMonsterAbilities(candidate, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, code: candidate as unknown as ContentPackCode };
}
