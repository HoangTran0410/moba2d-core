import type { Vec2 } from '@/game/spell/runtime/types';
import type { CastPhase } from '@/game/spell/input/SpellInputController';
import type Champion from '@/game/gameObject/attackableUnits/Champion';
import type { ChampionPresetData } from '@/game/gameObject/attackableUnits/Champion';

/**
 * What a `Game` knows about an attached net session — the whole coupling,
 * kept to an interface so `Game.ts` never imports a socket. A host session
 * only uses `update` and `onLoadoutApplied`; a client session additionally
 * intercepts the places local orders are born (LAN design spec §4): the
 * right-click block in `fixedUpdate`, the kit controller's `createContext`
 * and `onCancel`, and `recall()`. An intercept returning `true` means "this
 * order went to the wire — do not execute it locally".
 */
export interface NetGameHooks {
  /** Called at the end of every `Game.fixedUpdate`. */
  update(): void;
  /** A right-click / pointer order at `point`. */
  interceptPointer(point: Vec2): boolean;
  /**
   * The minimap's tap-teleport. Unlike the other intercepts a client answers
   * `true` — wire-only, no local prediction — because the reconciler snaps
   * any locally-jumped position straight back before the host's confirming
   * snapshot could arrive; the jump lands from the snapshot instead (~50ms).
   */
  interceptTeleport(point: Vec2): boolean;
  /**
   * A kit-slot gesture aimed at `aim`. `phase` is the input's own life — the
   * press that starts a cast (and starts a charge charging), the per-frame
   * hold that re-aims it, and the release that commits a charge. A charge
   * has to cross the wire as press *and* release, or the host can only ever
   * fire it at minimum charge — the v1 shortcut that made every charge spell
   * dash the instant the key went down.
   */
  interceptCast(slot: number, aim: Vec2, phase: CastPhase): boolean;
  /** The player called a running charge off — the pointer left the button, or the scene cancelled. */
  interceptCastCancel(slot: number): void;
  /** The B key / recall button. */
  interceptRecall(): boolean;
  /**
   * `MatchDirector` gave a live champion a new kit (đổi tướng, or an edited
   * slot). The applied preset still holds real classes; the sessions turn it
   * back into a serializable `KitPlan` (`kitWire.ts`) — the host to broadcast
   * it, a client to ask the host to make the change real.
   */
  onLoadoutApplied(unit: Champion, preset: ChampionPresetData & { avatar?: string }): void;
  /**
   * `MatchDirector.setTeam` moved a live champion to the other side. A host
   * re-broadcasts (the side rides in the champ event); a client asks the
   * host to make its own switch real — hostility is computed independently
   * at both ends, so an unsynced side is two sims disagreeing about who can
   * hurt whom.
   */
  onTeamChanged(unit: Champion): void;
  /**
   * The net-borne champions the local `MatchDirector` knows nothing about —
   * remote players on a host, everything remote on a client. The Đội tab
   * appends them as read-only rows (`MatchDirectorSource.roster`), which is
   * the only reason the seam exists: the director's own roster is local units
   * it can mutate, and these are precisely the units it must not.
   */
  netRosterUnits(): Champion[];
  /** Tear down: close the socket, clear `Game.net`, reset the net role. */
  close(): void;
}
