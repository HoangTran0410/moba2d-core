import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { vi } from 'vitest';

/**
 * The two libraries the editor page hands its modules as plain globals.
 *
 * `poly-decomp` and `polygon-clipping` are vendored under
 * `public/map-editor/lib/` and loaded by `map-editor/index.html` as classic
 * `<script>` tags, so `geom.ts` reaches for them by bare name (see
 * `src/mapEditor/vendor.d.ts` for why they stayed that way). A test that
 * imports `geom.ts` has to put them where it expects to find them.
 *
 * Every suite here used to build a `vm` sandbox of its own and run the whole
 * editor into it, because the editor was nine classic scripts that could not
 * be imported at all. Now only the two vendored bundles need that treatment —
 * they are UMD builds, and running them in a sandbox with `window` pointing at
 * itself is how they publish their globals without a DOM. The editor's own
 * modules are just imported.
 *
 * Call it at the top of a test module, before anything *calls* into `Geom`.
 * Import order does not matter: nothing in `geom.ts` touches either library at
 * module scope, only inside `decompose` and `union`.
 */
export function installEditorVendorGlobals(): void {
  const dir = resolve(__dirname, '../../public/map-editor/lib');
  const sandbox: Record<string, unknown> = { console, JSON, Math };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const lib of ['decomp.min.js', 'polygon-clipping.min.js']) {
    vm.runInContext(readFileSync(resolve(dir, lib), 'utf8'), context);
  }
  const globals = globalThis as Record<string, unknown>;
  globals.decomp = sandbox.decomp;
  globals.polygonClipping = sandbox.polygonClipping;
  if (!globals.decomp || !globals.polygonClipping) {
    throw new Error('the vendored geometry libraries did not publish their globals');
  }
}

/**
 * The scraps of DOM the editor's *data* half touches.
 *
 * `storage.ts` builds an `<a download>` to save a file and asks for
 * `#modal-root` before reporting; neither is what these suites are about, but
 * both run on the import path and a missing one fails as a `TypeError` inside
 * the code under test rather than as a message about the fixture. This is the
 * same stub the `vm` sandboxes carried, lifted out of them.
 */
export function installHeadlessDom(): void {
  vi.stubGlobal('document', {
    createElement: () => ({ style: {}, appendChild() {}, click() {}, remove() {} }),
    body: { appendChild() {} },
    getElementById: () => null,
    querySelector: () => null,
  });
}
