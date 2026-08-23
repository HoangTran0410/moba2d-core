import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Plain JavaScript, deliberately, not TypeScript — do not convert this back.
 * A pack's `vitest.config.ts` importing a `.ts` module out of `node_modules`
 * dies on `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`: Vite's config
 * loader externalises bare specifiers and hands them to Node, and Node
 * refuses to strip types under `node_modules`. The identical probe against
 * an `.mjs` target passes end to end. Measured 2026-08-23 against a real
 * tarball install.
 *
 * The Vitest configuration a separated pack needs, so a pack author does not
 * copy core's `vitest.config.ts` and then drift from it.
 *
 * The alias is the load-bearing part and it is not a preference. Core ships
 * unbundled `.ts`, and its own internals import through `@/*`; without this
 * mapping a pack's first test dies on
 * `Failed to load url @/managers/AssetManager … in
 * node_modules/@moba2d/core/src/content/ContentApi.ts`, which names a file
 * the pack author has never opened.
 *
 * It resolves from this file's own location rather than from
 * `require.resolve('@moba2d/core/package.json')`, which throws
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` unless the consumer is on a version of core
 * that exports it — and this must work on the version that does not.
 *
 * `server.deps.inline` is deliberately absent: measured unnecessary on
 * Vitest 1.6 with a tarball install. If a pack ever fails to load a core
 * module out of `node_modules`, add `server: { deps: { inline: [/@moba2d\/core/] } }`
 * and say so, rather than adding it here on suspicion.
 */
const coreSrc = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function moba2dPackTestConfig({ setupFiles = [] } = {}) {
  return {
    resolve: { alias: { '@': coreSrc } },
    test: { environment: 'node', clearMocks: true, setupFiles },
  };
}
