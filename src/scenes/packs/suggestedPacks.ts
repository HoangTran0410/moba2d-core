/**
 * The packs this build offers by name — the shelf a player with nothing
 * installed and no URL to paste actually chooses from.
 *
 * It replaces one line of dead text. The packs screen used to end its empty
 * state with `Pack mặc định: https://…/manifest.json` rendered as a plain
 * `<span>`, which on this page could not be clicked, could not be installed,
 * and could not even be *copied* — `styles/main.css` sets `user-select: none`
 * on `*`, so the one thing the screen told a player to do with that string was
 * the one thing the screen prevented.
 *
 * **A shelf entry names the pack, and that is the point.** A player choosing
 * whether to install something has to know what it is, and "hơn 50 tướng" is
 * not that. This is the one place core is allowed to say what a pack's
 * content is, because the content is not core's: the pack lives in its own
 * repository, under its own licence, and this is a pointer to it. Core's own
 * screens — menu, loading, About — carry no such artwork or wording, and
 * `tests/content/vocabularyBoundary.test.ts` keeps the *engine* clear of the
 * bundled pack's champion, monster and spell vocabulary, which is a different
 * rule from this one.
 *
 * **Adding an entry is meant to be the whole change.** Append an object below
 * with an `id`, a `name`, a one-line `description`, its `manifestUrl` and the
 * `repoUrl` a player can read the pack's source at; `PacksScene.vue` renders
 * whatever is here. `tests/scenes/packsSuggested.test.ts` checks the shape and
 * that both URLs are `https://`.
 *
 * **A suggestion is not a permission.** Nothing here shortens the path an
 * install takes: the Cài button fills the URL field and runs the same
 * `checkUrl` a pasted URL runs, so the origin disclosure in
 * `PackInstallConfirm.vue` stands in front of a suggested pack exactly as it
 * stands in front of a stranger's. Being listed in this file buys a pack a
 * button, not trust — see that component's own header for why the disclosure
 * is the whole of the security model.
 *
 * Imports nothing: this module is loaded by the packs screen, which
 * `tests/scenes/packsBootPath.test.ts` keeps clear of `src/game/` and of
 * `@/content/runtimePacks`.
 */
export interface SuggestedPack {
  /** The pack's own id, as its manifest declares it — used to notice it is already installed under some other URL. */
  id: string;
  name: string;
  /** One line, player-facing: what a player gets by installing it. */
  description: string;
  manifestUrl: string;
  /** Where the pack's source can be read. Shown as a plain link, never fetched. */
  repoUrl: string;
}

export const SUGGESTED_PACKS: SuggestedPack[] = [
  {
    id: 'riot',
    name: 'Tướng Liên Minh Huyền Thoại',
    description:
      'Hơn 50 tướng LMHT đủ 4 chiêu, phép bổ trợ, quái rừng, bản đồ Summoner’s Rift. Bản fan-made, không liên kết với Riot Games.',
    manifestUrl: 'https://hoangtran99.is-a.dev/moba2d-content-riot/manifest.json',
    repoUrl: 'https://github.com/HoangTran0410/moba2d-content-riot',
  },
];

/**
 * The pack this build installs by itself on a first boot.
 *
 * The same string as `runtimePacks.ts`'s own `DEFAULT_PACK_URL`, and
 * deliberately a second copy of it rather than an import: that module is the
 * one `src/content/` file pinned to the `game` chunk, so reaching it — even
 * for a string literal — would fetch the whole match to draw this shelf.
 * `tests/scenes/packsBootPath.test.ts` imports the real constant (a test file
 * never goes through `manualChunks`) and fails when the two drift apart.
 */
export const DEFAULT_PACK_URL = SUGGESTED_PACKS[0].manifestUrl;
