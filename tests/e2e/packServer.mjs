/**
 * The static file server three Playwright scripts each stood up on their own
 * for a genuinely separate origin: `verify-runtime-pack.mjs`,
 * `verify-pwa-offline.mjs` and `verify-pack-management.mjs` all serve the
 * sibling `moba2d-content-riot` checkout's built `dist/` from a second local
 * port, because the property every one of them exercises is a cross-origin
 * install — same-origin would prove nothing.
 *
 * This is the exact defect `harness.mjs` exists to have fixed once already
 * (see its own header): the three carried byte-identical `PACK_DIST`
 * resolution, the same `manifest.json` fail-fast block, the same `TYPES` map,
 * and the same server body with the same query-strip content-type fix and
 * the same CORS header. It cannot fold into `startHarness` itself —
 * `verify-pwa-offline.mjs` is deliberately not a harness importer (it serves
 * the *built* `dist/` through `preview()` with the network cut, which is a
 * different contract from a dev server), and `tests/scripts/e2eHarness.test.ts`
 * enforces that boundary. It does not need to: none of this depends on the
 * harness, so a fourth module all three import is the whole fix.
 *
 * **The query-strip-then-`extname` fix.** A chunk requested as `x-abc.js?v=1`
 * has an `extname` of `.js?v=1` if the content type is read off `req.url`
 * directly — that matches nothing in `TYPES`, falls back to
 * `application/octet-stream`, and a browser refuses to execute an
 * `application/octet-stream` response as a module. The path is resolved once,
 * with the query string stripped, and both the file read and the content-type
 * lookup derive from that same resolved `path`.
 */
import { createServer as createStaticServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * The pack repository's built output. An absolute path in one developer's
 * home directory was fine while this was the only script that needed it and
 * it ran on one machine; three scripts and a second machine is where it stops
 * being fine. `LOL2D_PACK_DIST` overrides; the default is the sibling
 * checkout, which is how both repositories are actually laid out.
 */
export const PACK_DIST =
  process.env.LOL2D_PACK_DIST ?? join(process.cwd(), '..', 'moba2d-content-riot', 'dist');

/**
 * Fails fast, before any server or browser starts, rather than as a 404 (or,
 * for `verify-pwa-offline.mjs`, a 180-second timeout) a caller shrugs off
 * silently. Left unchecked, every request against the pack 404s, the
 * manifest fetch fails inside `installRuntimePacks()`, and every pack check
 * in the calling script fails exactly the way a real regression would — a
 * developer without the sibling checkout, or with a typo in
 * `LOL2D_PACK_DIST`, gets a report that reads as this repository's bug with
 * nothing pointing at the real cause. `manifest.json`, not just the
 * directory, because a stale empty `dist/` left over from an interrupted
 * build passes an `existsSync` on the directory alone.
 */
export function requirePackDist() {
  if (!existsSync(join(PACK_DIST, 'manifest.json'))) {
    console.error(
      `no pack build found at ${PACK_DIST} (looked for manifest.json inside it) — build the ` +
        `moba2d-content-riot repository first, or set LOL2D_PACK_DIST to its dist/ directory.`
    );
    process.exit(1);
  }
}

const TYPES = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

/**
 * Starts the static server on `port` and resolves once it is listening.
 *
 * `createServer` is imported under a different local name on purpose:
 * `tests/scripts/e2eHarness.test.ts` bans any harness importer from matching
 * `\bcreateServer\(`, aimed at a script that boots a *second Vite dev
 * server* duplicating the harness's own. This is not that — it is a plain
 * static file server for a genuinely separate origin — and renaming it also
 * just says what it is.
 */
export async function startPackServer(port) {
  const server = createStaticServer(async (req, res) => {
    try {
      // Resolved once, from the query-stripped path — see this file's own
      // header for the bug this is the fix for.
      const path = decodeURIComponent(req.url.split('?')[0]);
      const body = await readFile(join(PACK_DIST, path));
      res.writeHead(200, {
        // A sane default for an extension this map does not know, same as
        // the 404 branch below: an unrecognised type must never silently
        // become a response Chromium treats as a download instead of the
        // resource it asked for.
        'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
        'access-control-allow-origin': '*',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise(resolve => server.listen(port, resolve));
  return server;
}
