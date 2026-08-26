#!/usr/bin/env node
/**
 * Detects the one node_modules state nobody remembers to check for: this pack
 * *was* linked to a sibling `@moba2d/core` checkout (`npm run pack:link` from
 * core) and an `npm install` / `bun install` here has since replaced the
 * symlink with the registry/git copy — so typecheck and tests now run against
 * the wrong core, and the first symptom is a page of baffling type errors.
 *
 * The stomp is detectable because an install replaces only the package
 * directory itself and leaves the rest of the scope directory alone: the
 * parked npm copy (`.core-npm`) and the `.core-link-target` marker
 * `pack:link` writes both outlive the symlink. Either of those existing
 * while `core` is not a symlink can only mean a dropped link.
 *
 * Wired in twice:
 *   - `postinstall` (`--warn-only`): the warning appears in the very install
 *     that did the damage, while the author still remembers running it.
 *   - first step of `verify`: blocking, so a red verify leads with the real
 *     cause and its one-line repair instead of the type errors.
 *
 * A pack that has never been linked — the normal state for a standalone
 * author building against the published core — passes silently.
 */
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scopeDir = join(packRoot, 'node_modules', '@moba2d');
const coreDir = join(scopeDir, 'core');
const parkedNpmCopy = join(scopeDir, '.core-npm');
const linkTargetMarker = join(scopeDir, '.core-link-target');

const warnOnly = process.argv.includes('--warn-only');

let coreIsLink = false;
try {
  coreIsLink = lstatSync(coreDir).isSymbolicLink();
} catch {
  // no @moba2d/core at all — npm install has not run; later steps say so
}
if (coreIsLink) process.exit(0);

const wasLinked = existsSync(linkTargetMarker) || existsSync(parkedNpmCopy);
if (!wasLinked) process.exit(0);

const target = existsSync(linkTargetMarker)
  ? readFileSync(linkTargetMarker, 'utf8').trim()
  : resolve(packRoot, '..', 'moba2d-core');

console.error(`
  @moba2d/core was linked to a sibling checkout and the link is GONE —
  an npm/bun install in this pack replaces that symlink with the
  registry/git copy, so typecheck and tests now run against the wrong core.

  Repair, from the core checkout:

    cd ${target} && npm run pack:link -- ${packRoot}
`);
process.exit(warnOnly ? 0 : 1);
