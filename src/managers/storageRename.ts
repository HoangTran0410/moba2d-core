/**
 * Carry a returning player's saved data across the project's rename.
 *
 * Every key this game stores used to be prefixed `lol2d:` and is now
 * `moba2d:` — the pregame config, the saved kits, the installed-pack list and
 * the seeded flag beside it, the death-recap toggle. **That prefix is not
 * cosmetic to a browser.** A rename with nothing else done is a deployed game
 * that, on its next load, hands every existing player an empty pack list, no
 * saved kits and default match settings, with their real data still sitting in
 * storage under a name nothing reads any more. The installed-pack list is the
 * expensive one: an emptied list also re-arms the first-boot seed, so the
 * player is offered the default pack again as though they had never played.
 *
 * So the prefix moves and the data moves with it, once, on the next load.
 *
 * **Prefix-walked rather than a list of keys**, deliberately: a hard-coded
 * list is a second place to remember, and the one key somebody forgets is the
 * one whose loss nobody notices until a player complains. Anything that was
 * ours is ours.
 *
 * **Copies rather than moves.** The old keys are left where they are, because
 * the cost of keeping them is a few hundred bytes per browser and the cost of
 * removing them is that a rolled-back deployment — an ordinary thing to do to
 * a Pages project on a bad afternoon — finds nothing to read. A later release
 * can delete them once the rename is not going anywhere.
 *
 * **Never overwrites.** A player who has already played a renamed build has
 * newer data under the new key; the old one is a fossil, and copying it over
 * the top would undo whatever they did since. First writer wins.
 *
 * This is the one file in the repository that still names the old prefix, and
 * it does so because that is its entire job.
 */
const OLD_PREFIX = 'lol2d:';
const NEW_PREFIX = 'moba2d:';

/**
 * Run before anything reads storage — `main.ts`, at module scope, above the
 * scene manager.
 *
 * Every step is inside the `try`: a browser with storage blocked (private
 * mode, cookies off) throws on the very first `localStorage` touch, and this
 * is a convenience for returning players, never a precondition for booting.
 * A player in that browser had nothing saved to carry anyway.
 */
export const carryRenamedStorage = (): void => {
  try {
    const carried: Array<[string, string]> = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key === null || !key.startsWith(OLD_PREFIX)) continue;
      const renamed = NEW_PREFIX + key.slice(OLD_PREFIX.length);
      if (localStorage.getItem(renamed) !== null) continue;
      const value = localStorage.getItem(key);
      if (value !== null) carried.push([renamed, value]);
    }
    // Written after the walk, not during it. Defensive rather than a fix for
    // anything measured: the Storage spec does not order `key(n)`, so mutating
    // the store you are indexing is unspecified — every browser in practice
    // appends, and no failing case could be constructed for it, which is why
    // there is no test below claiming otherwise. Collecting first costs one
    // array and removes the question.
    for (const [key, value] of carried) localStorage.setItem(key, value);
  } catch {
    /* storage blocked — nothing was saved to carry */
  }
};
