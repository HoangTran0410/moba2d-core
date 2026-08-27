import type { Vec2 } from '@/game/spell/runtime/types';

/**
 * What a `Game` knows about an attached net session — the whole coupling,
 * kept to an interface so `Game.ts` never imports a socket. A host session
 * only uses `update`; a client session additionally intercepts the three
 * places local orders are born (LAN design spec §4): the right-click block
 * in `fixedUpdate`, the kit controller's `createContext`, and `recall()`.
 * An intercept returning `true` means "this order went to the wire — do not
 * execute it locally".
 */
export interface NetGameHooks {
  /** Called at the end of every `Game.fixedUpdate`. */
  update(): void;
  /** A right-click / pointer order at `point`. */
  interceptPointer(point: Vec2): boolean;
  /** A kit-slot press aimed at `aim`. */
  interceptCast(slot: number, aim: Vec2): boolean;
  /** The B key / recall button. */
  interceptRecall(): boolean;
  /** Tear down: close the socket, clear `Game.net`, reset the net role. */
  close(): void;
}
