import type { ActiveMap } from './ContentPack';
import type { PackRegistry } from './PackRegistry';

/**
 * What core publishes so the map editor can offer the maps the game has.
 *
 * ## One list, and the editor owns the screen
 *
 * This was a one-shot handoff first: the *menu* held a map picker, wrote the
 * single map the player chose, and the editor ate the key on boot. It worked,
 * and it was wrong in a way only using it showed — the menu then had a map
 * list holding pack maps while the editor had its own holding drafts, neither
 * could see the other, and a map deleted in one still sat in the other. Two
 * lists of two different things is not two features, it is one feature broken
 * in half.
 *
 * So the editor's "Map của bạn" is the only place maps are chosen, and this is
 * how it learns what the game has. The menu's Tạo map went back to being a
 * plain link — which also gave a landscape phone its screen back, since the
 * picker it used to unfold could not fit on one.
 *
 * ## A catalog, not a message
 *
 * Read as often as the editor likes, never consumed. It describes what is
 * installed rather than asking for anything, so a stale copy is merely old
 * news — the failure mode of the one-shot version, where a key left behind
 * re-imported over the author's work on every reload, cannot happen here.
 *
 * ## Why the geometry rides along
 *
 * The editor is a separate document with no bundler and no way to reach
 * `PackRegistry`, so a map it cannot read is a map it cannot offer. The whole
 * catalog is a few hundred KB against a multi-megabyte quota, and it is
 * rewritten on the way into the editor, so what the editor reads is what the
 * game had a moment ago.
 *
 * `tests/content/editorCatalog.test.ts` runs the real editor over what this
 * writes, because nothing else can hold the two halves together.
 */
export const PACK_MAPS_KEY = 'moba2d-pack-maps-v1';

/**
 * What the editor is told to call a copy.
 *
 * Opening a pack map makes a *new* local map rather than replacing the pack's
 * — a pack is read-only — so without this the picker lists two maps with one
 * name and no way to tell which is which.
 */
export const EDIT_SUFFIX = ' (bản sửa)';

/**
 * Write every installed map, geometry and all, for the editor to read.
 *
 * **Resolves each geometry.** `MapDefinition.geometry` is a
 * `MapGeometrySource` and a pack's is usually a `() => import(...)`: the whole
 * point of the summary/geometry split is that listing a map does not download
 * its polygons. Nothing downstream of here can await, so this is where it
 * happens.
 *
 * A map whose geometry will not load is left out rather than published half
 * formed. It is one row missing from a list, against an editor that opens an
 * empty canvas and says nothing.
 */
export async function publishPackMaps(registry: PackRegistry): Promise<void> {
  const published: ActiveMap[] = [];
  for (const summary of registry.maps()) {
    try {
      const geometry = await registry.loadMapGeometry(summary.id);
      if (!geometry) continue;
      published.push({
        id: summary.id,
        name: summary.name,
        size: summary.size,
        factions: summary.factions,
        ...geometry,
      });
    } catch (thrown) {
      console.warn(`[editor catalog] skipped "${summary.id}"`, thrown);
    }
  }

  try {
    localStorage.setItem(PACK_MAPS_KEY, JSON.stringify(published));
  } catch {
    // Storage disabled, or the quota is full. The editor still opens, on the
    // author's own maps — losing the pack list is worse than not opening at
    // all only if you would rather see an error than a working editor.
    console.warn('[editor catalog] could not publish the map list');
  }
}
