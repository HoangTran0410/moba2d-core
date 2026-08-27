# Map Tracer

Turns a top-down map image into `MapGeometry` terrain polygons — the
alternative to hand-drawing every wall in `tools/shape-maker` (Summoner's
Rift took 329 of them by hand; a traced map takes minutes).

```bash
npx vite tools/map-tracer --open
```

(ES modules do not load over `file://`, so open it through a server. Any
static server works; vite is already in this repo's dev dependencies.)

## Workflow

1. **Drop a top-down image** of the map onto the page. The cleaner the
   source, the better the trace — a flat-shaded minimap or a layer render
   beats a screenshot with champions and fog on it.
2. **Sample colors.** Pick the `wall` tab and click the image on wall
   pixels; each click adds a swatch (click a swatch chip to remove it).
   Raise `tolerance` until the tint overlay covers the terrain and nothing
   else. Repeat on the `bush` / `water` tabs if the map has them.
3. **Tune the trace.**
   - `downsample` majority-votes k×k pixel blocks — the anti-aliasing pass.
     Ties fill, because for a wall the conservative error is the blocked
     one. Higher = smoother, blockier polygons.
   - `simplify px` is the Douglas-Peucker tolerance in image pixels.
   - `min area` (image px²) drops specks.
4. **Export.** Set `map size` (the image's larger dimension spans the whole
   map), then copy the `terrain` literal into the pack's
   `<name>Geometry.ts`.

## What it deliberately does not do

- **Holes are bridged, not kept as loops.** Core blocks a point inside
  *any* wall polygon, so a walkable courtyard inside a wall ring cannot be
  its own polygon — the tracer folds each hole into its outer boundary
  with a zero-width keyhole cut (the technique font glyphs use), which
  both the even-odd rule and canvas' nonzero fill read correctly. Holes
  under `min area` are filled instead: a pit too small to stand in is
  noise.
- **Slots and lanes stay yours.** Spawn points, turrets, camps, muster
  slots and lane waypoints are gameplay decisions, not pixels — place them
  by hand (see `packs/reference/provingGroundsGeometry.ts` for the shape,
  and mind `tests/content/laneTurretClearance.test.ts`'s clearance floors).
- **No nav guarantee.** A traced corridor can rasterise narrower than
  `NavGrid.requiredClearance` and read as a wall in game — after pasting,
  point `tests/content/referenceMap.test.ts`'s `wallGapWidths` idea (or a
  quick `NavigationSystem.runSearch` between the spawns) at the new
  geometry the way `referenceMap.test.ts` does.

The algorithm half is `trace.mjs`, tested in core's own suite
(`tests/tools/mapTracer.test.ts`) on hand-built masks; this page is only
the shell around it.
