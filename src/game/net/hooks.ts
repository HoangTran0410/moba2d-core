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
   * The virtual joystick's push, as the world point it is steering toward —
   * or `null` the frame the thumb lifts, which `TouchControls` fires exactly
   * once. A client forwards it and then lets the local seam run, the way
   * `interceptPointer` does, so the prediction still steers at full frame
   * rate while the wire carries a throttled sample.
   *
   * Separate from `interceptPointer` because the two orders mean different
   * things on the host — see the `steer` message in `protocol.ts`. Without
   * this seam a phone could join a LAN match, cast, recall and tap the
   * minimap, but every push of the stick moved only its own screen: the host
   * heard nothing, and reconciliation pulled the champion back to where the
   * host still had it.
   */
  interceptSteer(target: Vec2 | null): boolean;
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
  interceptCast(slot: number, aim: Vec2, phase: CastPhase, row?: 'item'): boolean;
  /** The player called a running charge off — the pointer left the button, or the scene cancelled. */
  interceptCastCancel(slot: number, row?: 'item'): void;
  /**
   * The shop, from the panel. Unlike a cast this answers **`true`** on a
   * client — wire-only, no local half. A cast is predicted because the player
   * must see their own spell leave instantly; a purchase has nothing to
   * predict and everything to get wrong, since the gold, the fountain rule and
   * the component maths are all the host's. Spending a client's own copy of a
   * wallet the host has never heard of buys an item that vanishes on the next
   * `bag` event.
   */
  interceptShop(
    order:
      | { kind: 'buy'; itemId: string }
      | { kind: 'sell'; slot: number }
      | { kind: 'swap'; a: number; b: number }
      | { kind: 'undo' }
      | { kind: 'redo' }
  ): boolean;
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
  /**
   * Whether the wire has gone quiet — a *client* session's own judgement, and
   * absent on a host, which has no single wire to lose.
   *
   * On the interface rather than reached through a cast because the HUD is the
   * only consumer and `Game.net` is the only handle it has. The implementation
   * makes it `reactive` — the HUD watches it through a `computed`, which over
   * a plain object would never re-evaluate.
   */
  readonly link?: { lost: boolean };
  /**
   * The champions clients are driving, and whether anyone is still on the
   * wire for each — host sessions only, hence optional.
   *
   * `attached: false` is the case that had no name before: a player whose
   * phone slept closes nothing, so the champion is neither present nor gone.
   * The Đội tab and `drive-lan-reconnect.mjs` both read it.
   */
  netClientRows?(): Array<{ id: string; name: string; attached: boolean }>;
  /** Throw a client out by unit id — host sessions only. Answers whether it matched. */
  kickUnit?(unitId: string): boolean;
  /** Tear down: close the socket, clear `Game.net`, reset the net role. */
  close(): void;
}
