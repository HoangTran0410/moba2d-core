import TeamId from '@/game/enums/TeamId';
import Minion, {
  type MinionKind,
  type MinionPresetData,
} from '@/game/gameObject/attackableUnits/Minion';
import type { MapTuning, WaveStage } from '@/content/ContentPack';
import { resolveEconomy, resolveMinionTypes, type ResolvedEconomy } from '@/game/config/mapTuning';
import type { GameObjectRuntimeContext } from '@/game/gameObject/GameObject';
import type Fountain from '@/game/gameObject/structures/Fountain';
import type { MinionMusterPoint } from '@/game/preset';
import { LANES, getLaneWaypoints, nextWaypointIndexFrom } from '@/game/lanes';
import { isNetClient } from '@/game/net/netRole';

/** ms between waves, per base. */
export const WAVE_INTERVAL_MS = 30_000;
export const MIDGAME_WAVE_INTERVAL_MS = 25_000;
export const LATEGAME_WAVE_INTERVAL_MS = 20_000;
const MIDGAME_WAVES_AT_MS = 14 * 60_000;
const CANNON_EVERY_TWO_AT_MS = 15 * 60_000;
const CANNON_EVERY_WAVE_AT_MS = 25 * 60_000;
const LATEGAME_WAVES_AT_MS = 30 * 60_000;
/**
 * Accelerated opening for this shorter 2D match. Live Summoner's Rift uses
 * 30s; waiting that long here leaves a new player staring at empty lanes.
 */
export const FIRST_WAVE_DELAY_MS = 1_000;
/** ms between the minions of one wave leaving the base, so they walk in a line. */
export const MINION_RELEASE_INTERVAL_MS = 650;

/**
 * Hard ceiling on live minions across both teams.
 *
 * A lane is ~10,600px and a minion covers 2.6px/frame ≈ 156px/s, so one takes
 * ~68s to walk a lane end to end. The largest scheduled overlap is the 30-minute
 * cadence transition: the final 25-second wave (6 minions per lane-side) is only
 * 65 seconds into that walk when three 20-second waves (5 each) have left. Across
 * 3 lanes and 2 teams that is 6 * (6 + 3 * 5) = 126 live minions, and the 650ms
 * within-wave release spacing stretches the real overlap a little past even that.
 * The cap therefore sits above the modelled peak with headroom, so an ordinary
 * late wave — especially its last-released cannon — is never what the ceiling
 * deletes. In practice waves meet near mid and kill each other, so the count
 * usually sits well under this; the cap only catches a genuinely stalled board.
 */
export const MINION_LIVE_CAP = 160;

/**
 * The standard League lane formation: three melee bodies followed by three
 * casters. Every third wave adds a cannon, beginning with wave three.
 */
export const WAVE_COMPOSITION: readonly MinionKind[] = [
  'melee',
  'melee',
  'melee',
  'ranged',
  'ranged',
  'ranged',
];

/** Current Summoner's Rift cadence: 30s, then 25s at 14:00 and 20s at 30:00. */
export const waveIntervalAt = (elapsedMs: number): number => {
  if (elapsedMs >= LATEGAME_WAVES_AT_MS) return LATEGAME_WAVE_INTERVAL_MS;
  if (elapsedMs >= MIDGAME_WAVES_AT_MS) return MIDGAME_WAVE_INTERVAL_MS;
  return WAVE_INTERVAL_MS;
};

/**
 * Current normal-rift formation. Cannon cadence steps from every third wave to
 * every second after 15:00, then every wave after 25:00. Riot's 2026 pacing
 * trims one melee from mid-game cannon waves and one caster from all 30:00+
 * waves, so the extra spawn rate does not inflate the board indefinitely.
 */
export const waveComposition = (waveNumber: number, elapsedMs = 0): readonly MinionKind[] => {
  const cannonCadence =
    elapsedMs >= CANNON_EVERY_WAVE_AT_MS ? 1 : elapsedMs >= CANNON_EVERY_TWO_AT_MS ? 2 : 3;
  const hasCannon = waveNumber > 0 && waveNumber % cannonCadence === 0;
  const meleeCount = hasCannon && elapsedMs >= MIDGAME_WAVES_AT_MS ? 2 : 3;
  const rangedCount = elapsedMs >= LATEGAME_WAVES_AT_MS ? 2 : 3;
  const composition: MinionKind[] = [];
  for (let i = 0; i < meleeCount; i++) composition.push('melee');
  for (let i = 0; i < rangedCount; i++) composition.push('ranged');
  if (hasCannon) composition.push('cannon');
  return composition;
};

/**
 * Everything about waves that used to be a module constant here.
 *
 * Resolved once per match from the active map, and read by `MinionSpawner`
 * instead of the constants directly, so the numbers below become *the
 * default plan* rather than the only one. A map that declares nothing gets a
 * plan whose `composition` and `intervalMs` are the very functions this file
 * already exported — not a copy of their behaviour, the functions — so the
 * Summoner's Rift cadence cannot drift away from itself.
 */
export interface WavePlan {
  types: Record<string, MinionPresetData>;
  firstDelayMs: number;
  releaseIntervalMs: number;
  liveCap: number;
  composition(waveNumber: number, elapsedMs: number): readonly string[];
  intervalMs(elapsedMs: number): number;
}

/**
 * The map's wave plan, or core's.
 *
 * A declared `stages` list is walked newest-applicable-first and each stage
 * overrides only the fields it names, so a map can change formation at 15:00
 * without restating the interval it set at 00:00.
 *
 * A composition naming a type the roster does not hold is dropped rather than
 * spawned as something else — `validate.ts` refuses such a map at install, so
 * reaching this is a locally-built map or a hand-edited one, and a silently
 * substituted body would be worse than a smaller wave.
 */
export function resolveWavePlan(tuning?: MapTuning): WavePlan {
  const types = resolveMinionTypes(tuning);
  const waves = tuning?.minions?.waves;
  const stages = [...(waves?.stages ?? [])].sort((a, b) => a.atMs - b.atMs);

  const stageValue = <K extends 'composition' | 'intervalMs'>(
    key: K,
    elapsedMs: number
  ): WaveStage[K] | undefined => {
    let found: WaveStage[K] | undefined;
    for (const stage of stages) {
      if (stage.atMs > elapsedMs) break;
      if (stage[key] !== undefined) found = stage[key];
    }
    return found;
  };

  const declaresFormation = waves?.composition !== undefined || stages.length > 0;

  return {
    types,
    firstDelayMs: waves?.firstDelayMs ?? FIRST_WAVE_DELAY_MS,
    releaseIntervalMs: waves?.releaseIntervalMs ?? MINION_RELEASE_INTERVAL_MS,
    liveCap: waves?.liveCap ?? MINION_LIVE_CAP,
    composition(waveNumber, elapsedMs) {
      if (!declaresFormation) return waveComposition(waveNumber, elapsedMs);
      const declared = stageValue('composition', elapsedMs) ?? waves?.composition ?? [];
      return declared.filter(id => id in types);
    },
    intervalMs(elapsedMs) {
      return stageValue('intervalMs', elapsedMs) ?? waves?.intervalMs ?? waveIntervalAt(elapsedMs);
    },
  };
}

export interface MinionSpawnerContext extends GameObjectRuntimeContext {
  fountains: Fountain[];
  /**
   * Where each team's wave forms up, per lane — the active map's own
   * `slots.minion`, teamId-bridged by `preset.ts`'s `minionMusterSlotsFrom`.
   * `validate.ts` refuses to install a map missing one for a lane it
   * declares, so `musterPoint` can trust this list rather than falling back
   * to the fountain the way `musterPointFor` (deleted) used to for a team
   * caught with fewer than two turrets.
   */
  minionMuster: readonly MinionMusterPoint[];
}

interface QueuedMinion {
  teamId: string;
  lane: string;
  kind: MinionKind;
  /** ms until this one leaves the fountain. */
  releaseIn: number;
}

/**
 * Wave clock. Not a GameObject: it owns no position and nothing should be able
 * to target or draw it, so Game drives it directly from fixedUpdate().
 *
 * It also owns the live-minion list. ObjectManager already retires `toRemove`
 * objects, so this list is a mirror kept only so the cap can be checked in O(1)
 * instead of scanning every object in the game every frame.
 */
export default class MinionSpawner {
  game: MinionSpawnerContext;
  minions: Minion[] = [];
  /** Waves released so far, across both bases. */
  waveCount = 0;
  /**
   * What this match's waves are made of and how fast they come — the active
   * map's own, or core's. Resolved once: a map cannot change mid-match, and
   * re-resolving per wave would rebuild the type table sixty times a minute.
   */
  readonly plan: WavePlan;
  /** The map's economy, resolved once beside the wave plan. */
  readonly economy: ResolvedEconomy;

  /**
   * The wave clock. Off stops queueing and releasing; it does not stop pruning,
   * so minions already dead still leave the list and a field cleared by another
   * system stays cleared rather than filling back up with corpses.
   *
   * Elapsed match time freezes rather than draining while off. `setEnabled`
   * abandons any partly released wave and restarts from the match-opening delay
   * when switched back on, so the old queue cannot leak out of a paused panel
   * toggle and the player *sees* the switch work — see `setEnabled`.
   */
  enabled = true;

  _nextWaveIn: number;
  _elapsedMs = 0;
  _queue: QueuedMinion[] = [];

  constructor(game: MinionSpawnerContext) {
    this.game = game;
    this.plan = resolveWavePlan(game.mapTuning);
    this.economy = resolveEconomy(game.mapTuning);
    this._nextWaveIn = this.plan.firstDelayMs;
  }

  /**
   * Changes the wave clock without rewinding the match-time thresholds.
   *
   * Off abandons the unreleased tail of the current wave. On keeps `_elapsedMs`
   * (and therefore the 14/30-minute cadence) but restarts the countdown at the
   * match-opening delay rather than a full interval. This used to wait out a
   * whole interval "so the switch is quiet", and it read as broken from the
   * panel: the toggle clears the field instantly on the way off, so silence on
   * the way back on looks like nothing ever spawning again — the more so
   * because every re-open of the panel pauses the countdown and every off/on
   * flip restarted it. One wave a second after the switch is the same promise
   * match start makes, and it is still one wave, never a backdated burst.
   * Repeating the current state is a no-op so an already-running clock is
   * never postponed by a duplicate UI event.
   */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) {
      this._queue.length = 0;
      return;
    }
    this._nextWaveIn = this.plan.firstDelayMs;
  }

  get liveCount(): number {
    return this.minions.length;
  }

  /** ms until the next wave leaves the fountains. */
  get nextWaveIn(): number {
    return this._nextWaveIn;
  }

  update() {
    // A LAN client's minions arrive as spawn events from the host
    // (`net/netRole.ts`, LAN design spec §4) — this spawner being the one
    // place a wave is born is what makes that a single gate. `prune` is
    // skipped too: the client's list is owned by its session.
    if (isNetClient()) return;
    this.prune();
    if (!this.enabled) return;

    this._elapsedMs += deltaTime;
    this._nextWaveIn -= deltaTime;
    if (this._nextWaveIn <= 0) {
      // reset rather than subtract: after a long tab-hidden gap deltaTime can be
      // several intervals wide, and queueing a burst of backdated waves is not
      // what anyone means by "a wave every 30 seconds"
      this._nextWaveIn = this.plan.intervalMs(this._elapsedMs);
      this.queueWave();
    }

    this.releaseQueued();
  }

  /**
   * Queues one wave per lane from every base. Exposed so tests and the
   * end-to-end driver can skip the countdown instead of waiting out a real
   * 30 seconds.
   *
   * `LANES` is `lanes.ts`'s active-match lane set, installed by `Game`'s
   * constructor from the running map's own `lanes[]`. A map that declares
   * none leaves it empty, so this loop queues nothing and no minion is ever
   * spawned — spec §7's laneless map, "no lanes[] means no waves".
   */
  queueWave() {
    this.waveCount += 1;
    const mapWide = this.plan.composition(this.waveCount, this._elapsedMs);

    for (const fountain of this.game.fountains) {
      const teamId = fountain.teamId;
      if (teamId !== TeamId.BLUE && teamId !== TeamId.RED) continue;

      for (const lane of LANES) {
        const composition = this.compositionAt(teamId, lane) ?? mapWide;
        for (let i = 0; i < composition.length; i++) {
          this._queue.push({
            teamId,
            lane,
            kind: composition[i],
            releaseIn: i * this.plan.releaseIntervalMs,
          });
        }
      }
    }
  }

  /**
   * What *this* muster point fields, or `undefined` to use the map's.
   *
   * The map-wide formation sends the same six bodies down every lane of every
   * team, which is the right default and was the only thing a map could say.
   * A point that declares its own is how "top pushes with siege, bot trickles
   * two melee" becomes a map — see `MinionSlot.stats.composition`.
   *
   * An **empty** declared array is honoured, not treated as absent: a lane the
   * bots walk that ships no minions is a legitimate map, and `[]` is how it
   * says so. `??` rather than `||` is what makes that true.
   *
   * Filtered against the roster the same way the map-wide formation is
   * (`resolveWavePlan`): a name the roster does not hold is dropped rather
   * than spawned as something else. `validate.ts` refuses such a map at
   * install, so reaching this is a locally-built or hand-edited one.
   */
  private compositionAt(teamId: string, lane: string): readonly string[] | undefined {
    for (const slot of this.game.minionMuster) {
      if (slot.teamId !== teamId || slot.lane !== lane) continue;
      if (!slot.composition) return undefined;
      return slot.composition.filter(id => id in this.plan.types);
    }
    return undefined;
  }

  releaseQueued() {
    if (this._queue.length === 0) return;

    let write = 0;
    for (let i = 0; i < this._queue.length; i++) {
      const entry = this._queue[i];
      entry.releaseIn -= deltaTime;
      if (entry.releaseIn > 0) {
        this._queue[write++] = entry;
      } else {
        // dropped rather than held back when the board is full: a queue that
        // waits for room would release a whole backdated wave the instant a
        // fight cleared, which is worse than losing it
        this.spawn(entry);
      }
    }
    this._queue.length = write;
  }

  spawn({ teamId, lane, kind }: Pick<QueuedMinion, 'teamId' | 'lane' | 'kind'>): Minion | null {
    if (this.minions.length >= this.plan.liveCap) return null;

    // A queued id whose type left the roster cannot be spawned as something
    // else: a wave one body short is a smaller wave, a substituted body is a
    // lie about what the map declared.
    const preset = this.plan.types[kind];
    if (!preset) return null;

    const muster = this.musterSlotFor(teamId, lane);
    const position = this.scatterAround(muster);
    // Waypoint 0 is the fountain, so a wave leaving *from* it always started at
    // 1. The muster point is already past waypoint 1 on two of the three lanes,
    // and a minion sent back to one it has walked past turns round to reach it.
    const startWaypointIndex = nextWaypointIndexFrom(lane, teamId, position.x, position.y);

    const minion = new Minion({
      game: this.game,
      position,
      teamId,
      lane,
      waypoints: getLaneWaypoints(lane, teamId),
      preset,
      startWaypointIndex,
    });

    // A type that named its own `goldBounty` keeps it: it said something more
    // specific than the map's blanket number, the same precedence every other
    // layer in `MapTuning` follows.
    if (preset.goldBounty === undefined) minion.goldBounty = this.economy.minionBounty;

    this.minions.push(minion);
    this.game.objectManager.addObject(minion);
    return minion;
  }

  /**
   * The full declared slot for `(teamId, lane)`, scatter radius included.
   * `musterPoint` is the public `{x, y}`-only form of this same lookup.
   *
   * Throws rather than falling back to the fountain the way the old
   * `musterPointFor` did for a team caught with fewer than two turrets: a
   * lane with no slot is now a `validate.ts` error at install, so reaching
   * this with nothing to find means the map that got installed should not
   * have — a bug to surface loudly, not paper over with a silent fountain
   * spawn nobody notices until the wave never shows up.
   */
  private musterSlotFor(teamId: string, lane: string): MinionMusterPoint {
    for (const slot of this.game.minionMuster) {
      if (slot.teamId === teamId && slot.lane === lane) return slot;
    }
    throw new Error(`MinionSpawner: no muster point declared for team ${teamId} on lane ${lane}`);
  }

  /**
   * Where this team's wave for `lane` forms up — the active map's own
   * declared slot (`map.slots.minion`, teamId-bridged). Used to be derived
   * at spawn time from the two live turrets nearest the fountain
   * (`musterPointFor`, deleted) and returned `null` for a team caught with
   * fewer than two; a map now declares the point once, so this never has to
   * answer "I don't know" — `validate.ts` refuses to install a map that
   * would leave it unable to.
   */
  musterPoint(teamId: string, lane: string): { x: number; y: number } {
    const { x, y } = this.musterSlotFor(teamId, lane);
    return { x, y };
  }

  /** A point near the muster, so six bodies do not start life inside each other. */
  private scatterAround(muster: { x: number; y: number; scatter: number }): p5.Vector {
    const angle = random(TWO_PI);
    const away = random(muster.scatter);
    return createVector(muster.x + cos(angle) * away, muster.y + sin(angle) * away);
  }

  fountainFor(teamId: string): Fountain | undefined {
    for (const fountain of this.game.fountains) {
      if (fountain.teamId === teamId) return fountain;
    }
    return undefined;
  }

  /** In-place compaction: this runs every frame and must not allocate. */
  prune() {
    let write = 0;
    for (let i = 0; i < this.minions.length; i++) {
      const minion = this.minions[i];
      if (!minion.toRemove) this.minions[write++] = minion;
    }
    this.minions.length = write;
  }
}
