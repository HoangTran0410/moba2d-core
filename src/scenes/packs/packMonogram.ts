/**
 * A pack's stand-in mark: two letters and a colour, derived from the pack
 * itself, drawn by core.
 *
 * The packs screen lists things a player has to tell apart at a glance, and
 * the honest source of a pack's logo is the pack — core ships no content and
 * has no business carrying another project's artwork (see `README.md`'s
 * trademark section, and the commit that took the last of it out of the
 * menu). So a real icon comes from the manifest, and it is shown **only for a
 * pack already installed**: that pack's code is already running with the
 * page's full authority, so an image from it costs nothing, while a pack the
 * player has not agreed to is a stranger whose chosen artwork must not
 * decorate a screen that is asking for permission (`resolvePackIcon`'s own
 * comment has the argument).
 *
 * Which leaves everything before that install with nothing to look at, and a
 * column of identical grey cards is exactly the "hard to tell apart" this
 * exists to fix. Hence a monogram: no network, no third-party art, no request
 * to a host the player has not agreed to talk to, and it works for a pack
 * added by URL five minutes from now.
 *
 * Imports nothing — this module is on the packs screen's chunk, which
 * `tests/scenes/packsBootPath.test.ts` keeps clear of `src/game/` and of
 * `@/content/runtimePacks`.
 */
export interface PackMonogram {
  /** One or two letters. Upper case, diacritics kept — this is Vietnamese copy. */
  text: string;
  /** A background colour, stable for a given id. */
  background: string;
  /** A foreground that stays legible on it. */
  foreground: string;
}

/**
 * The initials of the first two words, falling back to the id.
 *
 * A name is what the player reads, so it is what the letters come from; the
 * id is the fallback because a manifest may name a pack in a script whose
 * "first letter" is not a letter at all, and `id` is constrained to something
 * URL-safe.
 */
function initials(name: string, id: string): string {
  // `\p{L}`/`\p{N}` with `u`, not `[A-Za-z0-9]`: "Tướng" and "Đấu" both start
  // with a letter this project's copy uses and ASCII does not have.
  const isLetter = (character: string | undefined): boolean =>
    character !== undefined && /\p{L}|\p{N}/u.test(character);

  for (const source of [name, id]) {
    const words = source.trim().split(/\s+/);
    let text = '';
    for (const word of words) {
      const first = [...word][0];
      if (isLetter(first)) text += first!.toUpperCase();
      if (text.length === 2) return text;
    }
    // One word only ("riot", "Reference"): take its second letter rather than
    // leaving a single character rattling around in a square tile.
    if (text.length === 1) {
      const second = [...words.join('')][1];
      return isLetter(second) ? text + second!.toUpperCase() : text;
    }
  }
  return '?';
}

/**
 * A hue from the id, so the same pack is the same colour on every device and
 * across reloads — and two packs installed side by side are two colours
 * without anyone choosing them.
 *
 * A plain FNV-1a-shaped rolling hash, `>>> 0` on every step because a bare
 * `<<` in JavaScript works on a signed 32-bit int and a long id would
 * otherwise wrap to a negative hue.
 */
function hueOf(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = ((hash ^ id.charCodeAt(index)) >>> 0) * 16777619;
    hash >>>= 0;
  }
  return hash % 360;
}

export function packMonogram(name: string, id: string): PackMonogram {
  const hue = hueOf(id);
  return {
    text: initials(name, id),
    // Dark and desaturated enough to sit in this palette rather than shout
    // over it; the foreground is the same hue at reading brightness.
    background: `hsl(${hue}, 34%, 24%)`,
    foreground: `hsl(${hue}, 62%, 74%)`,
  };
}
