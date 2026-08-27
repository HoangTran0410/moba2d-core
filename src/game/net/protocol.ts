/**
 * The LAN wire format — plain JSON, versioned by shape rather than number
 * for v1. Everything here is pure data and pure functions so the format is
 * testable without a socket, a game, or a browser
 * (`tests/game/net/netProtocol.test.ts` pins it by hand).
 *
 * Snapshots ride as arrays per unit rather than keyed objects: at 15Hz with
 * ~40 live units the field names would be most of the bytes. Positions are
 * rounded to a tenth of a world unit — far below a pixel at any zoom — which
 * is what keeps the JSON affordable on a LAN without inventing a binary
 * format v1 does not need (spec §7).
 */

/** One tracked unit's state inside a snapshot. */
export interface UnitSnap {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  mp: number;
  dead: boolean;
  /** `Stats.actionState` verbatim — the movement/combat bitmask the HUD and draw paths read. */
  actionState: number;
  /** Champions only: `currentCooldown` per kit slot, ms. Absent for everything else. */
  cds?: number[];
}

/** A champion entering the world — enough for a client to construct the real thing. */
export interface ChampionSpawnEvent {
  k: 'champ';
  id: string;
  team: string;
  x: number;
  y: number;
  /** A `KitPlan` — already plain serializable data (`preset.ts`). Typed loose here so the protocol stays dependency-free. */
  plan: unknown;
}

export interface MinionSpawnEvent {
  k: 'minion';
  id: string;
  team: string;
  lane: string;
  kind: string;
  x: number;
  y: number;
}

/** The unit left the world entirely (corpse swept, not merely dead). */
export interface GoneEvent {
  k: 'gone';
  id: string;
}

/**
 * A damage number over `id`'s head — the post-mitigation figure the host's
 * own `CombatText` just floated. A client cannot compute any of these (its
 * `takeDamage` is gated shut), so without this stream a LAN client's match
 * has no floating numbers at all. Rides the ordinary per-tick event flush;
 * the client replays it through the same `CombatText.show`, whose per-victim
 * merge then behaves exactly as it does on the host.
 */
export interface DamageNumberNetEvent {
  k: 'dmg';
  id: string;
  /** The shown (post-mitigation, pre-pool-cap) number. */
  a: number;
  /** `DamageType` — picks the colour, and with it the merge key. */
  ty: string;
}

/** A committed cast — the client plays the spell's visual half from this. */
export interface CastEvent {
  k: 'cast';
  id: string;
  slot: number;
  x: number;
  y: number;
}

export type NetEvent =
  | ChampionSpawnEvent
  | MinionSpawnEvent
  | GoneEvent
  | CastEvent
  | DamageNumberNetEvent;

export type NetMessage =
  | { t: 'snap'; tm: number; units: UnitSnap[] }
  | { t: 'ev'; ev: NetEvent[] }
  | {
      t: 'hello';
      tm: number;
      mapId: string;
      rules: { cooldownMultiplier: number; manaFree: boolean };
      you: { id: string; team: string; plan: unknown };
      roster: NetEvent[];
    }
  | { t: 'move'; x: number; y: number }
  | { t: 'cast'; slot: number; x: number; y: number }
  /** Release the charge `cast` started, aimed where the drag ended. Without it, min-charge only. */
  | { t: 'rel'; slot: number; x: number; y: number }
  /** The player called a running charge off — mirror of the local cancel. */
  | { t: 'stop'; slot: number }
  /** The client changed its own kit (đổi tướng); `plan` is a `KitPlan` (`kitWire.ts` validates). */
  | { t: 'loadout'; plan: unknown }
  /** The minimap's tap-teleport — wire-only on a client, or reconciliation just snaps it back. */
  | { t: 'tp'; x: number; y: number }
  /**
   * Host → one client: your champion died, and this is its recap — killer
   * plus the last seconds' damage ledger, which only the host's sim ever
   * wrote (`AttackableUnit.deathRecap`; a client's `takeDamage` is gated).
   */
  | { t: 'died'; recap: unknown }
  | { t: 'recall' };

const round1 = (value: number): number => Math.round(value * 10) / 10;

type UnitRow = [string, number, number, number, number, number, number, number, ...number[]];

const packUnit = (unit: UnitSnap): UnitRow => {
  const row: UnitRow = [
    unit.id,
    round1(unit.x),
    round1(unit.y),
    Math.round(unit.hp),
    Math.round(unit.maxHp),
    Math.round(unit.mp),
    unit.dead ? 1 : 0,
    unit.actionState,
  ];
  if (unit.cds) row.push(...unit.cds.map(cd => Math.round(cd)));
  return row;
};

const unpackUnit = (row: unknown): UnitSnap | null => {
  if (!Array.isArray(row) || row.length < 8 || typeof row[0] !== 'string') return null;
  const numbers = row.slice(1);
  if (!numbers.every(value => typeof value === 'number')) return null;
  const unit: UnitSnap = {
    id: row[0],
    x: row[1],
    y: row[2],
    hp: row[3],
    maxHp: row[4],
    mp: row[5],
    dead: row[6] === 1,
    actionState: row[7],
  };
  if (row.length > 8) unit.cds = row.slice(8) as number[];
  return unit;
};

export const encodeMessage = (message: NetMessage): string => {
  if (message.t === 'snap') {
    return JSON.stringify({ t: 'snap', tm: message.tm, u: message.units.map(packUnit) });
  }
  return JSON.stringify(message);
};

/**
 * Tolerant by design: a frame from a mismatched build, a relay system
 * notice, or plain garbage answers `null` and the session skips it — a
 * malformed packet must never take the match down.
 */
export const decodeMessage = (raw: unknown): NetMessage | null => {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const message = parsed as Record<string, unknown>;
  switch (message.t) {
    case 'snap': {
      if (typeof message.tm !== 'number' || !Array.isArray(message.u)) return null;
      const units: UnitSnap[] = [];
      for (const row of message.u) {
        const unit = unpackUnit(row);
        if (unit) units.push(unit);
      }
      return { t: 'snap', tm: message.tm, units };
    }
    case 'ev':
      return Array.isArray(message.ev) ? (parsed as NetMessage) : null;
    case 'hello':
      return typeof message.mapId === 'string' && typeof message.you === 'object'
        ? (parsed as NetMessage)
        : null;
    case 'move':
    case 'tp':
      return typeof message.x === 'number' && typeof message.y === 'number'
        ? (parsed as NetMessage)
        : null;
    case 'died':
      return typeof message.recap === 'object' && message.recap !== null
        ? (parsed as NetMessage)
        : null;
    case 'cast':
    case 'rel':
      return typeof message.slot === 'number' ? (parsed as NetMessage) : null;
    case 'stop':
      return typeof message.slot === 'number' ? { t: 'stop', slot: message.slot } : null;
    case 'loadout':
      return typeof message.plan === 'object' && message.plan !== null
        ? (parsed as NetMessage)
        : null;
    case 'recall':
      return { t: 'recall' };
    default:
      return null;
  }
};
