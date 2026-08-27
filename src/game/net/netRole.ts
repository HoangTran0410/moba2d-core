/**
 * Which side of a LAN match this process is — or `'off'`, which is every
 * match that existed before this module did.
 *
 * A dependency-free module on purpose: the four sim gates (spec §4 —
 * `AttackableUnit.takeDamage`, `Spell.effectiveMana`,
 * `MinionSpawner.update`, the `Game` constructor's bot loop) live in files
 * that must not grow a dependency on sockets or sessions to ask one boolean
 * question. Nothing here touches p5, the DOM beyond `location.search`, or
 * any game type.
 *
 * The role is process-wide, not per-Game, because the gates fire from deep
 * inside object methods that have no session in hand — the same reasoning
 * `lanes.ts` documents for its own module-level state, with the same
 * consequence: tests that set a role must reset it
 * (`resetNetRoleForTests`).
 */

export type NetRole = 'off' | 'host' | 'client';

let role: NetRole = 'off';

/** Boot parameters a net client carries into the `Game` constructor. */
export interface NetClientBootInfo {
  playerTeam: string;
}

let clientBoot: NetClientBootInfo | null = null;

export const netRole = (): NetRole => role;
export const isNetClient = (): boolean => role === 'client';

export const setNetRole = (next: NetRole, boot: NetClientBootInfo | null = null): void => {
  role = next;
  clientBoot = next === 'client' ? boot : null;
};

export const netClientBoot = (): NetClientBootInfo | null => clientBoot;

export const resetNetRoleForTests = (): void => {
  role = 'off';
  clientBoot = null;
};

/** The URL-armed request, read once per call: `?net=host|join&server=ws://…&room=…`. */
export interface NetUrlRequest {
  mode: 'host' | 'join';
  server: string;
  room: string;
}

export const netRequestFromUrl = (
  search: string = window.location.search
): NetUrlRequest | null => {
  const params = new URLSearchParams(search);
  const mode = params.get('net');
  if (mode !== 'host' && mode !== 'join') return null;
  return {
    mode,
    server: params.get('server') ?? 'ws://localhost:8790',
    room: params.get('room') ?? 'r1',
  };
};
