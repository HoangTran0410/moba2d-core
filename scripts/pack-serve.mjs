#!/usr/bin/env node
/**
 * `moba2d-pack-serve [--port 5174] [--dir dist]`
 *
 * Serves a built pack's `dist/` so its author can install it into the *hosted*
 * game — moba2d.pages.dev, a Pages deploy, any copy of core that is already
 * running somewhere — by pasting the URL this prints into the Packs screen.
 *
 * ## Why core ships this rather than each pack writing its own
 *
 * Because almost nobody making a pack has a checkout of core to run. They
 * scaffold a repository with `moba2d-pack-new`, and from that moment their
 * whole loop is their pack plus somebody else's copy of the game. The thing
 * standing between those two is a static file server with exactly the right
 * four headers, and getting one of the four wrong produces a CORS line in a
 * console that names nothing and suggests nothing. So it is a bin, alongside
 * `moba2d-pack-new` and `moba2d-pack-add`, and every pack has it the moment it
 * declares `@moba2d/core`.
 *
 * ## The headers, and why each one is here
 *
 *   - `access-control-allow-origin: *` — the hosted page fetches the manifest
 *     and `import()`s the entry cross-origin. `docs/PACK_AUTHORING.md` already
 *     names this as one of the two things any host must provide.
 *   - `access-control-allow-private-network: true`, plus a real answer to
 *     `OPTIONS` — a page on a public https origin asking a plain-http server
 *     on the local network is a *private network request*, and Chrome
 *     preflights it. This is the header that preflight is asking for. Sent
 *     unconditionally rather than only when the request header is present:
 *     it costs nothing, and the alternative is a rule that has to be right
 *     about which Chrome versions ask.
 *   - `content-type` — the second thing the authoring doc names. A `.js`
 *     served as `text/plain` is not a module, and the `import()` is refused
 *     before any of the pack's code runs.
 *   - `cache-control: no-store` — the entire point of a dev server. Core
 *     already refuses to pin or cache a pack served from loopback (see
 *     `src/content/devPack.ts`); this is the same promise one layer down, so
 *     the browser's own HTTP cache cannot answer a read the author made
 *     precisely because they rebuilt.
 *
 * ## What it deliberately does not do
 *
 * It does not watch, and it does not rebuild. The author runs `npm run build`,
 * which is one command that already writes both `dist/` and the manifest that
 * describes it — and `src/content/devPackWatch.ts` is what notices the new
 * build and tells them to reload. A watcher here would be a second, racier
 * copy of a job the pack's own build script already does correctly.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, realpathSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packRootFrom } from './lib/packRoot.mjs';

const scriptPath = fileURLToPath(import.meta.url);

const DEFAULT_PORT = 5174;
const DEFAULT_DIR = 'dist';

/**
 * Only the types a published pack actually contains. An unknown extension gets
 * `application/octet-stream` rather than a guess: a wrong `content-type` on a
 * module is a refused import, which is a worse failure than a download.
 */
const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

/**
 * Refuses a directory that is not a built pack, naming the command that
 * would make it one.
 *
 * The failure this prevents is the quiet one: serving an empty directory
 * answers every request with a 404, and what the author sees in the game is a
 * manifest fetch that failed — indistinguishable from a port typo, a firewall,
 * or a CORS problem.
 */
export function requireBuiltPack(dir) {
  const manifest = join(dir, 'manifest.json');
  if (!existsSync(manifest)) {
    throw new Error(
      `${dir} has no manifest.json — the pack has not been built.\n` +
        `  Run \`npm run build\` in the pack first, then serve it again.`
    );
  }
  return dir;
}

/** Everything every response carries, whatever it is answering. */
const commonHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-private-network': 'true',
  'cache-control': 'no-store',
};

/**
 * The server, separate from the CLI so a test can drive it on an ephemeral
 * port without spawning a process or picking a port that might be taken.
 */
export async function createPackServer({ dir }) {
  // The real path, resolved once: the containment check below compares
  // resolved paths, and a `dist` reached through a symlink would otherwise
  // fail its own prefix test for every file in it.
  const root = realpathSync(resolve(dir));

  return createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        ...commonHeaders,
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'access-control-allow-headers': '*',
        'access-control-max-age': '86400',
      });
      response.end();
      return;
    }

    const send = (status, body) => {
      response.writeHead(status, { ...commonHeaders, 'content-type': 'text/plain; charset=utf-8' });
      response.end(body);
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(405, 'method not allowed');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      send(400, 'bad request');
      return;
    }

    // Containment, checked on the resolved path rather than by rejecting `..`
    // in the URL: the encodings that spell `..` are not a list anybody should
    // be maintaining, and `resolve` has already collapsed all of them.
    const target = resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(root + sep)) {
      send(404, 'not found');
      return;
    }

    let stats;
    try {
      stats = statSync(target);
    } catch {
      send(404, 'not found');
      return;
    }
    if (stats.isDirectory()) {
      send(404, 'not found');
      return;
    }

    response.writeHead(200, {
      ...commonHeaders,
      'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(stats.size),
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(target).pipe(response);
  });
}

// `realpathSync`, not a bare `resolve()`: reached through the
// `node_modules/.bin/` symlink, `process.argv[1]` stays the symlink path while
// `scriptPath` is already resolved — see `scripts/check-seams.mjs`'s own
// header, where this cost a silent no-op.
function invokedDirectly() {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(resolve(invoked)) === scriptPath;
  } catch {
    return resolve(invoked) === scriptPath;
  }
}

if (invokedDirectly()) {
  const argv = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [key, inline] = token.slice(2).split('=');
    const next = argv[i + 1];
    flags[key] = inline ?? (next === undefined || next.startsWith('--') ? 'true' : argv[++i]);
  }

  const port = Number(flags.port ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    console.error(`\n  --port must be a port number, got ${flags.port}\n`);
    process.exit(2);
  }

  // Anchored on the pack, not on the shell's cwd, so this works from a nested
  // directory inside the pack exactly as `moba2d-pack-add` does.
  let packRoot;
  try {
    packRoot = packRootFrom(process.cwd());
  } catch (error) {
    console.error(`\n  ${error.message}\n`);
    process.exit(1);
  }

  const dir = resolve(packRoot, flags.dir ?? DEFAULT_DIR);
  try {
    requireBuiltPack(dir);
  } catch (error) {
    console.error(`\n  ${error.message}\n`);
    process.exit(1);
  }

  const server = await createPackServer({ dir });
  server.listen(port, () => {
    const url = `http://localhost:${port}/manifest.json`;
    console.log(`\n  Serving ${dir}\n`);
    console.log(`  Paste this into the game's Packs screen (Thêm bằng URL):\n`);
    console.log(`    ${url}\n`);
    console.log(`  Rebuild with \`npm run build\`; the game offers a reload on its own.`);
    console.log(`  Safari blocks http://localhost from an https page — use Chrome or Firefox,`);
    console.log(`  or put a tunnel in front of this port for an https URL.\n`);
  });
  server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n  Port ${port} is already in use — try \`--port ${port + 1}\`.\n`);
      process.exit(1);
    }
    throw error;
  });
}
