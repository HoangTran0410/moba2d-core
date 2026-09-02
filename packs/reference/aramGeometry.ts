import type { MapGeometry } from '@moba2d/core/content/ContentPack';
import mapJsonRaw from './maps/aram.json?raw';

/**
 * ARAM's heavy half — terrain, slots and its one lane, read straight out of the
 * `src/mapEditor/` export beside it. **One copy of the map, not two.**
 *
 * `maps/aram.json` *is* the map: it carries the `authoring` block the editor
 * needs to re-open it and merge its cut polygons back into the shapes they were
 * drawn as, and a map without that is a map that can never be edited again.
 * Transcribing it into a TypeScript literal would be the same fact written
 * twice, which is exactly the drift that once shipped a map whose summary said
 * 6300 while its terrain reached 6385.
 *
 * ## `?raw` and a `JSON.parse`, not `import data from './x.json'`
 *
 * `vite.config.ts` declares `assetsInclude: ['**\/*.json']`, so a plain JSON
 * import in this project resolves to a *URL*, not to data. `?raw` is how every
 * map in every pack here reads its own export, and the top of that config file
 * carries the whole argument for why.
 *
 * Parsed once at module scope rather than inside the loader: a loader that
 * re-parses hands out a *different object* every call, and the lane arrays a
 * map declares then stop being the ones `setActiveLanes` installed.
 *
 * ## Why this module exists at all, when the JSON is right there
 *
 * The chunk split. `vite.config.ts` sends everything under `/packs/reference/`
 * to `pregame` by *path*, and a dynamic `import()` does not exempt it — that is
 * the exact regression the `map-<id>` carve-out above that rule exists for. It
 * matches this module by basename and, since this map, a pack's `maps/*.json`
 * too, so both halves land in `map-aram` and the menu never carries a polygon.
 * `npm run chunks:check` on a real `vite build` is what confirms that; the rule
 * matching in isolation proves nothing.
 *
 * The `authoring` block rides along in that chunk, which is the honest price of
 * having one copy: ~6KB of a lazily-fetched chunk, against a second transcript
 * of the map that a test would have to keep honest for ever.
 */
const source = JSON.parse(mapJsonRaw) as MapGeometry & { authoring?: unknown };

export const aramGeometry: MapGeometry = {
  terrain: source.terrain,
  slots: source.slots,
  lanes: source.lanes,
};
