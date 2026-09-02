# @moba2d/content-reference

Core's own content pack: one champion (Vera) and the ARAM map, shipped from
inside this repository to prove core ships real content of its own rather than
existing only to host somebody else's.

The map is drawn in `src/mapEditor/` and kept here as that editor's own export
(`maps/aram.json`, `authoring` block included, so it can be re-opened and
edited). `aramGeometry.ts` beside it is the copy that ships, and
`tests/content/referenceMap.test.ts` pins the two together — re-draw the map,
replace the JSON, and that test tells you the shipped copy is stale.

`@moba2d/core` is listed under `devDependencies`, not `dependencies` — same
reason, same three type-only modules, same enforcing test
(the `pack-core-boundary` seam) as `@moba2d/content-riot`. See
`packs/riot/README.md` for the full explanation rather than a second copy of
it here; `package.json` cannot hold a comment, which is why either pack's
reasoning lives in a README instead of beside its own `devDependencies`
block.
