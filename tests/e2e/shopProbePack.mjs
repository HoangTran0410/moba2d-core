/**
 * A shelf to drive the shop panel against.
 *
 * Core alone sells nothing — `packs/reference/` ships one champion and four
 * abilities and no items at all, by design (CLAUDE.md, "Content packs"). What
 * a given checkout *does* sell is whatever pack its browser has installed, and
 * that is neither empty nor knowable from here: a machine that has fetched the
 * default pack shows fourteen items, none of which declares a `buildsFrom`
 * today. A driver that wants to see a build tree therefore has to put one on
 * the shelf itself, and this is that stock.
 *
 * It is **added to** whatever is already there, never substituted for it,
 * which is why every name carries a "Thử": two of those fourteen items are
 * already called `Kiếm Dài`, and a driver selecting a tile by its name would
 * match two elements and throw. For the same reason a driver must assert
 * "at least these five" rather than a total.
 *
 * It goes in through `PackRegistry.installData` — the *same* door a runtime
 * pack install uses, not a mock and not a `vi.mock` seam. `shopItems()` reads
 * the registry live and is deliberately un-memoised, so an install after the
 * match has booted is visible on the next 20Hz repaint, exactly as a player
 * pasting a pack URL would be.
 *
 * The five items are chosen to exercise everything the panel draws, and each
 * one is load-bearing:
 *
 *   - three components and two combines, so `shopSections` has both sections
 *     to emit and neither is empty;
 *   - `crown` builds out of `blade`, which builds out of `sword` and `cloak` —
 *     two levels, which is the only way to see whether `recipeTree` nests;
 *   - `wand` is a part of `crown` and of nothing else, so `buildsInto` on a
 *     cheap tile has exactly one answer to print;
 *   - every `cost` is over the sum of its parts, because `validate.ts` refuses
 *     a pack whose total is under it and would reject this whole install.
 *
 * Icons are core's own asset keys. A pack with no `manifest.assets` has its
 * icon keys left bare and resolved against core's flat namespace, so these
 * draw real art rather than the initial-letter fallback — which matters,
 * because the fallback is a different code path and a tile that silently drew
 * letters would look like a pass.
 *
 * Nothing here declares a `passive` or an `active`: those name spells, a data
 * half installs no code, and `ItemShop.refusalFor` would answer `NOT_LOADED`
 * for every one of them — an entire shelf nobody can buy.
 */

/** What the probe shelf holds, mirrored here so a driver can assert against it. */
export const PROBE_ITEMS = {
  wand: { id: 'probe:wand', name: 'Đũa Thử', cost: 250 },
  sword: { id: 'probe:sword', name: 'Kiếm Thử', cost: 300 },
  cloak: { id: 'probe:cloak', name: 'Áo Thử', cost: 400 },
  blade: { id: 'probe:blade', name: 'Đại Kiếm Thử', cost: 900 },
  crown: { id: 'probe:crown', name: 'Vương Miện Thử', cost: 1800 },
};

/** Cheapest first — the order `shopRows` sorts into, and what a browse reads as. */
export const PROBE_COSTS = [250, 300, 400, 900, 1800];

/**
 * Installs the shelf and tops the player's wallet up.
 *
 * The gold is not decoration: the panel's whole greying story runs off
 * `refusalFor`, and a champion who cannot afford anything would show every
 * tile blocked with `TOO_EXPENSIVE` — which looks identical to the away-from-
 * the-fountain state this script later checks on purpose.
 */
export const seedShopProbePack = async (page, { gold = 6_000 } = {}) => {
  await page.evaluate(async wallet => {
    const { contentCatalog } = await import('/src/content/catalog.ts');
    contentCatalog().installData({
      manifest: { id: 'probe', version: '0.0.0', coreRange: '*' },
      items: {
        wand: {
          id: 'wand',
          name: 'Đũa Thử',
          icon: 'buff_haste',
          cost: 250,
          description: 'Một cây đũa nhỏ, đủ để cầm cự.',
          stats: { maxMana: 80 },
        },
        sword: {
          id: 'sword',
          name: 'Kiếm Thử',
          icon: 'spell_basic_attack',
          cost: 300,
          description: 'Thanh kiếm cơ bản nhất.',
          stats: { attackDamage: 12 },
        },
        cloak: {
          id: 'cloak',
          name: 'Áo Thử',
          icon: 'buff_slow',
          cost: 400,
          description: 'Vải dày, chắn được vài nhát.',
          stats: { armor: 25 },
        },
        blade: {
          id: 'blade',
          name: 'Đại Kiếm Thử',
          icon: 'buff_stun',
          cost: 900,
          description: 'Kiếm dài rèn cùng áo choàng.',
          stats: { attackDamage: 30, armor: 25 },
          buildsFrom: ['sword', 'cloak'],
        },
        crown: {
          id: 'crown',
          name: 'Vương Miện Thử',
          icon: 'buff_truesight',
          cost: 1800,
          description: 'Món cuối của một ván đấu dài.',
          stats: { attackDamage: 30, armor: 25, maxMana: 80, critChance: 0.15 },
          buildsFrom: ['blade', 'wand'],
        },
      },
    });

    window.__moba2d.scene.oScene.game.player.wallet.earn(wallet);
  }, gold);
};
