import { loadPregameConfig } from '@/game/config/PregameConfig';

/**
 * What to call this player in the LAN lobby's list.
 *
 * The game has no nickname of its own — a champion's `name` is the only human
 * label anywhere in it — and in the lobby not even that exists yet: the match
 * has not been planned, and a loadout left on "random" has no champion until
 * it is rolled. So the honest answer is the *choice*: whichever champion this
 * device has configured, or "Ngẫu nhiên" when it is still rolling.
 *
 * Read fresh on every call rather than cached. The player can walk from the
 * lobby to Cấu hình, pick a different champion and come back, and a name the
 * room is still showing from before that would be wrong in the one place
 * people are looking to identify each other.
 *
 * Lives in `src/game/net/` rather than in the lobby screen because
 * `PregameConfig` is a `src/game/` module and `LanScene.vue` may not import
 * one (`tests/scenes/lanBootPath.test.ts`) — both lobby halves reach it from
 * this side of that line.
 */
export const lobbyDisplayName = (): string => {
  try {
    const chosen = loadPregameConfig().player.championName;
    if (!chosen || chosen === 'random') return 'Ngẫu nhiên';
    return chosen;
  } catch {
    // A corrupt or absent config is not a reason to refuse a room.
    return 'Người chơi';
  }
};
