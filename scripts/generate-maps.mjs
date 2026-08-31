/**
 * Turns an export from core's map editor into the two halves a content pack
 * ships, so that the editor's file is the source of truth for a map rather
 * than merely the place it was drawn.
 *
 * `src/mapEditor/` is core's, and so is the shape it writes. This is the
 * other end of that: the rules about which of an export's fields may reach a
 * player are facts about *core's format*, and they belong beside the format
 * rather than in whichever pack discovered them. `@moba2d/content-riot`
 * discovered them, and the two paragraphs below are what that cost.
 *
 * ## The bug this exists for
 *
 * `maps/twistedTreeline.ts` carried `size: 6300` while the editor's export
 * beside it said `6400`, and the terrain in it reaches x=6385. Two hand-kept
 * copies of one fact, and they had already drifted apart by the width of a
 * wall.
 *
 * The divergence was *invisible* because core resolved it by accident: an
 * active map used to be built as `{ ...summary, ...geometry }`, so the
 * geometry's own keys won and the game ran at the export's 6400 while every
 * picker said 6300. Core now takes only `terrain`, `slots` and `lanes` from
 * geometry (`src/content/activeMap.ts`), which is right — and which means the
 * summary's number is the one that ships. A wrong summary stopped being
 * harmless the moment core stopped covering for it.
 *
 * The same spread carried `"id": "map-nhap-vao"` — the name that map was
 * drawn under in the editor — into `Game.activeMapId`, where it became the
 * `mapId` in a LAN hello. The joining client looked for `map-nhap-vao` in a
 * catalogue holding `lol:twisted-treeline`, missed, and blamed the packs. **A
 * host on that map could not be joined at all.** Nothing here has to *strip*
 * that any more, because nothing here copies it: the id belongs to the pack
 * and stays hand-written in the pack's `maps/<name>.ts`, which is the one
 * field a re-export must never be able to change.
 *
 * ## What it writes, and why two files rather than one
 *
 * Per editor-format map, under `outputDir`:
 *
 *   - `<name>.geometry.json` — `terrain`, `slots`, `lanes`, minified. This is
 *     what ships.
 *   - one entry in `mapMeta.ts` — `name`, `size`, `factions`. A few hundred
 *     bytes, and no polygons.
 *
 * Split because a pack's map definitions are split: `maps/<name>.ts` is the
 * cheap half a picker lists (a name and a size, never polygons) and the
 * geometry sits behind a dynamic import. A single generated module holding
 * both would put every wall in the menu's chunk the moment anything read a
 * name — undoing the split the hand-written files exist to make.
 *
 * ## What stays in the repository, and what reaches a player
 *
 * The editor's export keeps **everything**, `authoring` included, because
 * that block is what lets the editor re-open a shipped map and merge its cut
 * polygons back into the shapes they were drawn as. Losing it means a map
 * that can never be edited again.
 *
 * A player needs none of it. The generated geometry drops `authoring` (9.4KB
 * of 71KB for Twisted Treeline) along with `id`, `name`, `size` and
 * `factions` — which live in the meta or in code — and is written minified,
 * where the editor writes indented. Full source in the repository, only the
 * fields the runtime reads on the wire.
 *
 * ## Shape detection, not a list of names
 *
 * A pack names these files itself. The editor's own download is
 * `moba2d-map-export.json`; `_map.json` is the convention
 * `@moba2d/content-riot` settled on and the default `mapsDir` glob below, and
 * neither is a promise about what is *inside* a file that matches it. A pack
 * may keep hand-shaped map source next to editor exports — Summoner's Rift
 * spent its first life as a file whose root was `wall`, `bush`, `water`,
 * `turret1`, `turret2`, with slots and lanes *computed* from it in TypeScript
 * rather than read.
 *
 * So this reads every candidate and takes the ones shaped like an editor
 * export (`terrain` + `slots`), leaving anything else alone. A hard-coded
 * list would have to be edited by whoever adds the next map, which is exactly
 * the kind of second place to remember that this exists to remove.
 *
 * ## Not wired into the scaffold, on purpose
 *
 * `moba2d-pack-new` writes a hand-written TypeScript map — `maps/map.ts` plus
 * `maps/geometry.ts` — which is the right day-one shape: it typechecks, it
 * needs no editor, and its own split is what teaches the dynamic import. Such
 * a pack has no export for this to read, and `mapsDir` holding nothing is an
 * error here rather than a pass, so wiring `maps:generate` into every
 * scaffold would turn a new pack's first `npm run verify` red.
 *
 * A pack adopts it when it starts drawing maps, by adding to its own scripts:
 *
 *     "maps:generate": "moba2d-generate-maps",
 *     "maps:check": "moba2d-generate-maps --check"
 *
 * Wiring it is the declaration that this pack has editor maps — which is what
 * makes "found none" worth failing over.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * A content pack's layout. Exported so the `moba2d-generate-maps` bin has a
 * default to override field by field, in the same shape as
 * `PACK_ASSET_TREE` beside it.
 */
export const PACK_MAP_TREE = {
  mapsDir: 'maps',
  outputDir: 'generated/maps',
  /** Files under `mapsDir` that are candidates at all. */
  suffix: '_map.json',
  regenerateCommand: 'npm run maps:generate',
};

/** `twistedTreeline_map.json` → `twistedTreeline`. */
const baseNameOf = (file, suffix) => file.slice(0, -suffix.length);

/**
 * An editor export, as opposed to hand-shaped map source that happens to sit
 * beside one. Tested by shape rather than by name — see the header.
 */
const isEditorExport = data =>
  data !== null &&
  typeof data === 'object' &&
  typeof data.terrain === 'object' &&
  data.terrain !== null &&
  typeof data.slots === 'object' &&
  data.slots !== null;

/**
 * Exactly the three fields `MapGeometry` declares, in a fixed order.
 *
 * Named rather than "everything except the keys we know about": a future
 * editor that starts writing a fourth block would silently ship it under a
 * deny-list, and silently shipping whatever the editor invents is the whole
 * class of bug this has already been paid for once.
 *
 * `lanes` is omitted when absent rather than written as `null`: core's
 * `MapGeometry.lanes` is optional and "no lanes" is a real map (no waves, and
 * the bots' PUSH posture falls through), which is not the same shape as a
 * lanes key holding nothing.
 */
const geometryOf = data => ({
  terrain: data.terrain,
  slots: data.slots,
  ...(data.lanes === undefined ? {} : { lanes: data.lanes }),
});

/**
 * The half a picker reads. No polygons, by construction.
 *
 * `tuning` belongs here and not in `geometryOf` above, and that is not a
 * filing preference: core declares it on `MapSummary`, so it has to arrive
 * with the name and the size or `ActiveMap` never sees it. Putting it in the
 * geometry file would also hide a map's own rules behind the lazy loader,
 * where a picker cannot read them and editing one number re-hashes a chunk
 * measured in hundreds of kilobytes.
 *
 * Omitted when absent, so a map that tunes nothing generates byte-identically
 * to before this existed and the staleness check stays quiet for every pack
 * that has not opted in.
 */
const metaOf = data => ({
  name: data.name,
  size: data.size,
  factions: data.factions,
  ...(data.tuning === undefined ? {} : { tuning: data.tuning }),
});

const metaModule = metas => {
  const entries = metas
    .map(({ base, meta }) => `  ${base}: ${JSON.stringify(meta)} as MapMeta,`)
    .join('\n');
  return `// Generated by moba2d-generate-maps — do not edit.
//
// The name, size, factions and own tuning of every editor-drawn map, read
// from the editor's own export so that no hand-kept copy can drift from it. \`id\` is
// deliberately absent: it is the pack's, not the editor's, and lives in
// \`maps/<name>.ts\` — see core's \`scripts/generate-maps.mjs\` for what a stray
// id once cost.
import type { MapDefinition } from '@moba2d/core/content/ContentPack';

export type MapMeta = Pick<MapDefinition, 'name' | 'size' | 'factions' | 'tuning'>;

export const mapMeta = {
${entries}
};
`;
};

/**
 * Writes a pack's generated map data, or — with `check` — reports what is
 * stale without touching anything. Throws rather than exiting, so the caller
 * owns the process; the bin turns that into an exit code.
 */
export function generate(root, check = false, tree = PACK_MAP_TREE) {
  const { mapsDir, outputDir, suffix, regenerateCommand } = { ...PACK_MAP_TREE, ...tree };
  const mapsPath = resolve(root, mapsDir);
  const outPath = resolve(root, outputDir);
  const metaFile = join(outPath, 'mapMeta.ts');

  // A missing directory and an empty one are the same answer to the caller,
  // and neither should arrive as an ENOENT stack trace from `readdirSync`.
  const files = existsSync(mapsPath)
    ? readdirSync(mapsPath).filter(name => name.endsWith(suffix))
    : [];

  // "Scanned N, found no editor exports" and "found no candidate files at
  // all" are different answers and must not print the same line: an empty run
  // reads as a pass otherwise. Wiring this script is the declaration that
  // this pack has editor maps — see the header.
  if (files.length === 0) {
    throw new Error(
      `no *${suffix} under ${mapsDir}/ — nothing was checked.\n\n` +
        `  ${regenerateCommand} is wired in this pack, which says it has maps drawn in\n` +
        `  core's editor. Export one into ${mapsDir}/, or drop the script if it has none.\n`
    );
  }

  const metas = [];
  const written = [];
  const stale = [];

  for (const file of files.sort()) {
    const sourceText = readFileSync(join(mapsPath, file), 'utf8');
    const source = JSON.parse(sourceText);
    if (!isEditorExport(source)) continue;

    const base = baseNameOf(file, suffix);
    metas.push({ base, meta: metaOf(source) });

    const target = join(outPath, `${base}.geometry.json`);
    // Minified on purpose: the editor writes indented for a human, and this
    // copy has no human reader — it is downloaded by every player who opens
    // the map.
    const next = JSON.stringify(geometryOf(source));
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (current !== next) {
      stale.push(join(outputDir, `${base}.geometry.json`));
      if (!check) {
        mkdirSync(outPath, { recursive: true });
        writeFileSync(target, next);
      }
    }
    // Compared against the file on disk, not against a minified copy of it:
    // the file on disk is what a `?raw` import puts in the bundle today, so
    // that is the number this replaces.
    written.push({ base, bytes: next.length, from: sourceText.length });
  }

  const nextMeta = metaModule(metas);
  const currentMeta = existsSync(metaFile) ? readFileSync(metaFile, 'utf8') : null;
  if (currentMeta !== nextMeta) {
    stale.push(join(outputDir, 'mapMeta.ts'));
    if (!check) {
      mkdirSync(outPath, { recursive: true });
      writeFileSync(metaFile, nextMeta);
    }
  }

  if (check && stale.length) {
    throw new Error(
      `map data is stale — run \`${regenerateCommand}\`:\n` +
        stale.map(name => `  ${name}`).join('\n')
    );
  }

  return { written, check };
}

/** What the bin prints. Separated so `generate` stays quiet enough to test. */
export function report({ written, check }) {
  for (const { base, bytes, from } of written) {
    const saved = Math.round((1 - bytes / from) * 100);
    console.log(
      `maps: ${base} ${(bytes / 1024).toFixed(1)}KB shipped, ` +
        `down from ${(from / 1024).toFixed(1)}KB of editable source (${saved}% smaller)`
    );
  }
  console.log(check ? 'maps: up to date' : `maps: wrote ${written.length} geometry file(s) + meta`);
}
