#!/usr/bin/env node
/**
 * `moba2d-write-manifest` — writes a pack's `dist/manifest.json`, the file
 * core fetches *before* it runs any of that pack's code, and the URL a player
 * pastes into "Tìm pack".
 *
 * Runs after `vite build` (a pack's `build` script) and reads the built
 * `dist/pack.js` rather than `../pack.ts`: this is plain Node with no
 * TypeScript loader, and by the time it runs that file already exists as
 * plain ESM. Only the *data* half is read — inert data, no `ContentApi`
 * constructed — so nothing of the engine is needed here.
 *
 * ## Why this is a bin, and what moving it fixed
 *
 * It was a file the scaffold copied, and the two packs that have one had
 * already drifted: one hardcoded `icon: 'icon.png'` where the template tests
 * for the file, so removing `public/icon.png` would have pointed the manifest
 * at a 404 instead of letting core fall back to its monogram; one had lost
 * half the sentence explaining why an unparseable `coreRange` is not a loose
 * declaration but a pack nobody can install.
 *
 * **`coreRange` is no longer declared here at all.** It used to be a literal
 * in this file *and* in the pack's own `data.ts`, and both copies carried a
 * paragraph saying they must move together — `data.ts`'s is the copy
 * `PackRegistry` holds after the pack's code has already run, this one is the
 * copy a *runtime* install checks before a line of it runs. Only the second
 * can refuse an install, so the two drifting means the bundled build and the
 * published build disagree about which cores they support, and the published
 * one wins. That had been missed once already, and a pack test existed purely
 * to regex this file's source and compare the two strings. Reading it off the
 * built pack's own `data.manifest` deletes the second copy instead of
 * policing it.
 *
 * `version` is the one value still stated twice — npm owns `package.json`'s
 * and `npm version` moves it, `data.ts` states its own — so the two are
 * *compared* here rather than picked between. `name` has no home in
 * `PackManifest` at all and arrives as `--name=`; a pack that grows
 * `data.manifest.name` is preferred over the flag automatically.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packRootFrom } from './lib/packRoot.mjs';

/** `--name=value`, or the fallback. */
function flag(name, fallback) {
  const prefix = `--${name}=`;
  for (const argument of process.argv.slice(2)) {
    if (argument.startsWith(prefix)) return argument.slice(prefix.length);
  }
  return fallback;
}

const root = resolve(packRootFrom(process.cwd()), flag('root', '.'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const dist = join(root, flag('dist', 'dist'));

const entryFile = join(dist, 'pack.js');
if (!existsSync(entryFile)) {
  console.error(
    `no ${entryFile} — this runs after \`vite build\`, and reads the built pack rather than its source.`
  );
  process.exit(1);
}
const { data } = await import(pathToFileURL(entryFile).href);

const id = data.manifest?.id;
const coreRange = data.manifest?.coreRange;
if (!id || !coreRange) {
  console.error(
    `dist/pack.js exports no data.manifest.{id,coreRange} — this reads the pack's own\n` +
      `declaration rather than restating it. Check the pack's data half.`
  );
  process.exit(1);
}

/**
 * The name core shows wherever this pack appears — the install confirmation,
 * the installed row, and the section header over this pack's champions in the
 * picker. Core re-reads this manifest on every boot and rewrites its stored
 * record from it, so renaming reaches a browser that installed under the old
 * name without anyone reinstalling anything.
 *
 * `PackManifest` has no field for it, so it is the pack's `--name=` today.
 * `data.manifest.name` wins when a pack has one, so adding the field to the
 * contract later needs no change here and no flag day.
 */
const name = data.manifest.name ?? flag('name', undefined);
if (!name) {
  console.error(
    `no display name — pass --name="Your Pack" (the name core shows on the install\n` +
      `confirmation and over this pack's champions), or declare data.manifest.name.`
  );
  process.exit(1);
}

/**
 * Stated in two places nobody can merge: npm owns `package.json`'s and moves
 * it with `npm version`, the pack's data half states its own. Compared rather
 * than chosen, because picking one silently would make the other a lie the
 * next reader trusts.
 */
if (data.manifest.version && data.manifest.version !== pkg.version) {
  console.error(
    `version disagrees: package.json says ${pkg.version}, data.manifest says ` +
      `${data.manifest.version}. Move both.`
  );
  process.exit(1);
}

/**
 * A floor no core can satisfy is a pack nobody can install, and the build is
 * the last place to notice before it is a URL somebody has.
 *
 * Two failures, both silent otherwise: a range core's parser does not
 * understand (`^1`, `>=1.0`, `~1.2.3` — `satisfiesCoreRange` reads `*` and
 * `>=X.Y.Z` and nothing else), and a floor above the core this pack was
 * actually built against, which cannot be right because the members it
 * promises did not exist in what compiled it.
 */
const installedCore = JSON.parse(
  readFileSync(join(root, 'node_modules/@moba2d/core/package.json'), 'utf8')
).version;

const floor = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(coreRange);
if (coreRange !== '*' && !floor) {
  console.error(
    `coreRange "${coreRange}" is not a shape core can parse — use '*' or '>=X.Y.Z'. ` +
      `Anything else means this pack refuses to install, with a message that reads ` +
      `like a real version conflict.`
  );
  process.exit(1);
}
const have = /^(\d+)\.(\d+)\.(\d+)$/.exec(installedCore);
if (floor && have) {
  let ordering = 0;
  for (let i = 1; i <= 3 && ordering === 0; i++) ordering = Number(floor[i]) - Number(have[i]);
  if (ordering > 0) {
    console.error(
      `coreRange "${coreRange}" is above the core this pack was built against ` +
        `(${installedCore}). Nothing here can be using members that core does not have.`
    );
    process.exit(1);
  }
}

/**
 * This pack's own mark, if it has one.
 *
 * `public/` is copied verbatim into `dist/` by Vite, so the name is stable and
 * unhashed and core can resolve it against this manifest. Emitted only when
 * the file is actually there: core draws a monogram from the pack's name when
 * a manifest declares no icon, and a monogram beats a manifest pointing at a
 * 404 — which is exactly what a hardcoded `'icon.png'` produces the day
 * somebody deletes the file.
 *
 * Core shows it beside an **installed** pack only, never on the install
 * confirmation — artwork a stranger chose, sitting inside a permission
 * prompt, is decoration bought to earn trust the origin line exists to
 * withhold.
 */
const icon = existsSync(join(dist, 'icon.png')) ? 'icon.png' : undefined;

const championCount = data.champions.filter(champion => champion.playable).length;
const mapCount = (data.maps ?? []).length;
const itemCount = Object.keys(data.items ?? {}).length;

/**
 * Every file this build emitted, relative to the manifest and POSIX-separated
 * — the list core's background prefetch walks to fill its offline cache.
 *
 * A static host offers no directory listing, so a prefetch that is not handed
 * a list can only cache what a match happens to ask for, which is the
 * champion the player already picked and therefore already has. The ones they
 * have not played are exactly what the offline case is about.
 *
 * `manifest.json` excludes itself: core already has it — fetching it is what
 * produced this list.
 */
function emittedFiles(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...emittedFiles(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

const files = emittedFiles(dist)
  .filter(fileName => fileName !== 'manifest.json')
  .sort();

/**
 * Which build this is — core's `buildId`, and the only thing that can tell a
 * stale install from a current one.
 *
 * **Derived, never declared.** `version` is the obvious candidate and it does
 * not work: it is a number a human has to remember to bump, and the largest
 * pack there is stayed `1.0.0` across dozens of publishes. Core's
 * `InstalledPackRecord` carried a `version` field commented "so an update can
 * be noticed later" that nothing could ever act on, because the value never
 * moved.
 *
 * Hashed over the sorted file list rather than over `pack.js`'s bytes: the
 * entry is an 86-byte facade that re-exports from a hashed chunk, so two
 * genuinely different builds can emit an identical one. Every other name in
 * `dist` carries a content hash, which makes the list itself the complete
 * statement of what this build contains.
 */
const buildId = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);

writeFileSync(
  join(dist, 'manifest.json'),
  JSON.stringify(
    {
      id,
      version: pkg.version,
      coreRange,
      buildId,
      name,
      // Both resolve against this manifest's own URL, and both must land on
      // its own origin — core refuses a manifest that points execution
      // somewhere other than where the player was shown it came from.
      //
      // `'assets/'` is a *directory* under `dist`, and deliberately not
      // `data.manifest.assets`, which is the pack's asset *namespace*
      // (`'lol'`, `'dota'`) that `PackRegistry` qualifies keys with. Two
      // fields, one name, different questions.
      entry: 'pack.js',
      assets: 'assets/',
      champions: championCount,
      // Alongside `champions`, and for the same reason: the install
      // confirmation is the one screen that has to describe this pack before
      // any of its code has run, so the numbers have to travel in the
      // manifest. Both optional on core's side — a manifest published before
      // they existed installs exactly as it did.
      maps: mapCount,
      items: itemCount,
      // `undefined` here and `JSON.stringify` drops the key entirely, which is
      // what core's own defensive read of an absent icon expects.
      icon,
      files,
    },
    null,
    2
  ) + '\n'
);

console.log(
  `manifest written: ${id}@${pkg.version}, ${championCount} champion(s), ${files.length} file(s)`
);
