import type { ContentPackData, ContentPackFactory } from './ContentPack';
import type { PackAssetManifest } from '@/managers/AssetManager';
import { validatePackData } from './validate';

/**
 * The one file that talks to the network, and the one that runs a stranger's
 * code. Both facts are why it is separate from `install.ts`: everything
 * downstream of here handles a pack that is already in memory and already
 * checked, exactly as the build-time path does.
 *
 * The order of operations is the design's only security boundary. The
 * manifest is plain JSON and is fetched, parsed and checked *before* the
 * entry is imported, so a caller can show the player what they are about to
 * run and who is serving it. Once `import()` is reached, the pack has the
 * same authority as the page — see the spec's §2.1, which records that as a
 * chosen trade, not an oversight.
 *
 * **Never `import(blobUrl)`.** A module loaded from a blob resolves its
 * relative specifiers against a URL with no path, so the pack's 237 lazy
 * spell imports would all fail and a pack would be forced into one flat
 * bundle. The entry is imported from its own https URL.
 */

/** Which step failed, so a caller can say something useful rather than "error". */
export type PackLoadStage = 'fetch' | 'manifest' | 'compat' | 'import' | 'shape';

export class PackLoadError extends Error {
  readonly stage: PackLoadStage;
  constructor(stage: PackLoadStage, message: string) {
    super(message);
    this.name = 'PackLoadError';
    this.stage = stage;
  }
}

/** A pack's manifest, as served beside its entry. */
export interface RuntimePackManifest {
  id: string;
  version: string;
  coreRange: string;
  name: string;
  entry: string;
  assets: string;
  champions?: number;
  /**
   * The pack's own mark, relative to this manifest. Optional; core draws a
   * monogram when it is absent, and never shows this on the install
   * confirmation — see `resolvePackIcon`.
   */
  icon?: string;
  /**
   * Which build this manifest describes — spec §4.1 of the pinning design.
   *
   * Derived by the pack's own manifest generator from the sorted `files`
   * list, so it changes exactly when a content hash does and no human has to
   * remember to bump anything. `version` is the semver a person reads and is
   * deliberately not this: riot's stayed `1.0.0` across dozens of publishes,
   * which is what made a stale install undetectable.
   *
   * Optional. A manifest without one is loaded exactly as before.
   */
  buildId?: string;
  /**
   * Every file the pack published, relative to this manifest — spec §3.1.
   * Optional: a pack without it installs and plays, and simply has nothing
   * prefetched for offline.
   */
  files?: string[];
}

/** Everything one install produced, ready for the registry. */
export interface LoadedPack {
  manifest: RuntimePackManifest;
  data: ContentPackData;
  code: ContentPackFactory;
  assetManifest: PackAssetManifest;
  /** The manifest's own URL — what `entry` and `assets` resolve against. */
  baseUrl: string;
}

/**
 * Core's own version, for a pack manifest's `coreRange` to be checked
 * against. `vite.config.ts` injects it; `typeof` rather than a bare read
 * because `vitest.config.ts` is a separate config that does not carry
 * `vite.config.ts`'s `define`, so under the test runner the identifier is
 * simply not declared — and a bare read would throw a ReferenceError at
 * module scope, taking down every importer.
 */
export const CORE_VERSION: string =
  typeof __CORE_VERSION__ === 'string' ? __CORE_VERSION__ : '0.0.0';

/**
 * How long a pack has to answer, on either of the two calls that leave the
 * page — the manifest `fetch` and the entry `import()`.
 *
 * A dead host was already handled: the connection is refused and `fetch`
 * rejects. A *slow* one was not, and it is the worse failure — a host that
 * accepts the connection and then says nothing holds `LoadingScene.boot()`
 * open for as long as it likes, and the menu handover sits behind that
 * `await`. That is exactly the dead screen the design forbids, reached
 * without anything ever going wrong enough to throw.
 *
 * Exported so a test can advance a clock by it rather than hard-coding a
 * second copy of the number, and so a caller can say how long it is willing
 * to wait in words a player understands. Fifteen seconds is a whole pack's
 * entry chunk on a bad phone connection, and still short enough that nobody
 * decides the game has hung.
 */
export const PACK_LOAD_TIMEOUT_MS = 15_000;

/**
 * `work`, or a rejection once `PACK_LOAD_TIMEOUT_MS` has passed.
 *
 * `AbortSignal` covers the `fetch`; nothing aborts an `import()` in flight,
 * so the entry gets a race instead. The loser is not cancelled — the browser
 * finishes fetching the module and the result is dropped — which is the
 * honest limit of what can be done here, and is still the difference between
 * a menu that opens and one that does not.
 */
function withTimeout<T>(work: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alarm = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), PACK_LOAD_TIMEOUT_MS);
  });
  return Promise.race([work, alarm]).finally(() => clearTimeout(timer));
}

/**
 * Deliberately narrow: `>=x.y.z` and `*`, nothing else.
 *
 * A full semver range parser is a dependency and a surface; what a pack
 * actually needs to say is "core must be at least this new". Anything this
 * does not understand is refused rather than guessed at, so a pack can never
 * be admitted by a range nobody implemented.
 */
export function satisfiesCoreRange(range: string, version: string): boolean {
  if (range === '*') return true;
  const floor = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(range);
  const have = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!floor || !have) return false;
  for (let i = 1; i <= 3; i++) {
    const want = Number(floor[i]);
    const got = Number(have[i]);
    if (got > want) return true;
    if (got < want) return false;
  }
  return true;
}

const REQUIRED: (keyof RuntimePackManifest)[] = [
  'id',
  'version',
  'coreRange',
  'name',
  'entry',
  'assets',
];

/**
 * `entry` and `assets` resolve against the manifest's URL, and must land on
 * the manifest's own origin.
 *
 * Not a restriction on *which* hosts a player may install from — any URL is
 * allowed, by design. It is a restriction on a manifest redirecting
 * execution somewhere other than where it was fetched from: the player is
 * shown the origin they are about to trust, and this is what makes that
 * screen tell the truth. A pack author serving its own files is unaffected.
 *
 * The try/catch is not decoration. A relative `manifestUrl` is a valid
 * `fetch()` argument and an invalid `new URL()` base, so an unguarded
 * resolve throws a bare `TypeError` with no stage attached.
 */
function resolveWithin(path: string, base: string, field: string): string {
  let resolved: URL;
  let origin: string;
  try {
    origin = new URL(base).origin;
    resolved = new URL(path, base);
  } catch {
    throw new PackLoadError(
      'manifest',
      `${base} is not an absolute URL, so ${field} cannot resolve`
    );
  }
  if (resolved.origin !== origin) {
    throw new PackLoadError(
      'manifest',
      `${field} "${path}" leaves the manifest's origin (${origin})`
    );
  }
  return resolved.href;
}

/**
 * The pack's mark as an absolute URL, or `undefined` if it declared none.
 *
 * **Only ever shown for a pack that is already installed.** A pack that has
 * been installed already runs with the page's full authority, so an image
 * from it is no additional risk; a pack that has *not* is a stranger, and
 * artwork it chose sitting beside the origin in `PackInstallConfirm.vue`
 * would be attacker-controlled decoration inside a permission prompt — a
 * padlock, a shield, or another pack's logo, drawn to buy trust the origin
 * line exists to withhold. The shelf and the confirmation both draw a
 * monogram core derives itself instead.
 *
 * Never throws: `fetchPackManifest` already ran `resolveWithin` over this
 * field, so a manifest that reaches here has an icon that resolves or none
 * at all. The `try` is for the caller that hands over a hand-built manifest.
 */
export function resolvePackIcon(
  manifest: RuntimePackManifest,
  manifestUrl: string
): string | undefined {
  if (!manifest.icon) return undefined;
  try {
    return resolveWithin(manifest.icon, manifestUrl, 'icon');
  } catch {
    return undefined;
  }
}

/**
 * Fetches and checks a manifest. Nothing the pack wrote as *code* has run
 * when this resolves — that is the whole point of it being its own step.
 *
 * The abort signal covers the body read as well as the connection, which is
 * why it is cleared in a `finally` around the whole function rather than
 * beside the `fetch`: a host that sends headers and then stops sending bytes
 * stalls inside `response.json()`, not inside `fetch`.
 */
export async function fetchPackManifest(
  manifestUrl: string,
  coreVersion: string = CORE_VERSION
): Promise<RuntimePackManifest> {
  const abort = new AbortController();
  const alarm = setTimeout(() => abort.abort(), PACK_LOAD_TIMEOUT_MS);
  const tooSlow = (): PackLoadError =>
    new PackLoadError('fetch', `${manifestUrl} did not answer within ${PACK_LOAD_TIMEOUT_MS}ms`);
  try {
    let response: Response;
    try {
      response = await fetch(manifestUrl, { credentials: 'omit', signal: abort.signal });
    } catch (cause) {
      if (abort.signal.aborted) throw tooSlow();
      throw new PackLoadError(
        'fetch',
        `could not reach ${manifestUrl}: ${(cause as Error).message}`
      );
    }
    if (!response.ok) {
      throw new PackLoadError('fetch', `${manifestUrl} answered ${response.status}`);
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      if (abort.signal.aborted) throw tooSlow();
      throw new PackLoadError('manifest', `${manifestUrl} is not JSON`);
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new PackLoadError('manifest', `${manifestUrl} is not an object`);
    }

    const candidate = parsed as Record<string, unknown>;
    const missing: string[] = [];
    for (const field of REQUIRED) {
      if (typeof candidate[field] !== 'string') missing.push(field);
    }
    if (missing.length > 0) {
      throw new PackLoadError('manifest', `manifest is missing: ${missing.join(', ')}`);
    }
    if (candidate.champions !== undefined && typeof candidate.champions !== 'number') {
      throw new PackLoadError('manifest', 'manifest.champions must be a number when present');
    }
    if (candidate.files !== undefined && !Array.isArray(candidate.files)) {
      throw new PackLoadError('manifest', 'manifest.files must be an array when present');
    }
    if (candidate.icon !== undefined && typeof candidate.icon !== 'string') {
      throw new PackLoadError('manifest', 'manifest.icon must be a string when present');
    }
    if (candidate.buildId !== undefined && typeof candidate.buildId !== 'string') {
      throw new PackLoadError('manifest', 'manifest.buildId must be a string when present');
    }

    const manifest = candidate as unknown as RuntimePackManifest;
    if (!satisfiesCoreRange(manifest.coreRange, coreVersion)) {
      throw new PackLoadError(
        'compat',
        `pack ${manifest.id} needs core ${manifest.coreRange}, this is ${coreVersion}`
      );
    }
    // Refused here, before any code has even been fetched, rather than left
    // for `loadPackFromManifest` to discover — see `resolveWithin`'s own
    // comment for why this is the design's whole point.
    resolveWithin(manifest.assets, manifestUrl, 'assets');
    // Same rule as `assets` and `entry`: a pack may not point core's `<img>`
    // at some other host. Refused here rather than at render time, so a
    // manifest that tries it never reaches the confirmation at all.
    if (manifest.icon) resolveWithin(manifest.icon, manifestUrl, 'icon');
    if (Array.isArray(manifest.files)) {
      // A plain loop, not `.filter`: `Array.prototype.filter` is polyfilled in
      // this project and cannot narrow a type (CLAUDE.md).
      const paths: string[] = [];
      for (const entry of manifest.files) {
        if (typeof entry === 'string' && entry.length > 0) paths.push(entry);
      }
      manifest.files = paths;
    }
    return manifest;
  } finally {
    clearTimeout(alarm);
  }
}

/**
 * The entry URL with the build id hung off it as `?b=<buildId>`.
 *
 * **`pack.js` is the only mutable name a pack publishes.** Everything below
 * it — `chunks/runtime-entry-<hash>.js` and the 238 spell chunks it names —
 * is content-hashed, and the deploy keeps exactly one build. So a cache that
 * holds `pack.js` across a republish holds a pointer graph into files the
 * server has deleted: the chunks already cached still resolve, and the first
 * one that was never fetched 404s. That is a race between three independently
 * expiring cache entries, not a steady state, which is why it presented as an
 * intermittent "the champion's Q became a basic attack".
 *
 * The query makes two builds two URLs, so no cache — HTTP or worker — can
 * serve one build's entry against another's manifest. It goes on the *entry
 * only*: relative dynamic imports inside it resolve against the pathname and
 * drop the query, so the chunk graph is untouched and the worker does not end
 * up caching the pack twice.
 *
 * Deliberately not a fix in the pack's build config. Making Rollup emit
 * `pack-<hash>.js` would pin the name but not help: the manifest naming it is
 * itself cacheable, and an old manifest would then name an entry the deploy
 * has already deleted — trading a 404 on a leaf for a 404 on the root.
 */
function pinEntryToBuild(entryUrl: string, buildId: string | undefined): string {
  if (!buildId) return entryUrl;
  try {
    const url = new URL(entryUrl);
    url.searchParams.set('b', buildId);
    return url.href;
  } catch {
    // `resolveWithin` already parsed this URL, so it cannot fail here. Guarded
    // anyway rather than letting a hypothetical throw take out a load that
    // would otherwise have worked: an unpinned entry is the old behaviour,
    // which is worse than pinned and much better than refused.
    return entryUrl;
  }
}

/**
 * Imports the entry and checks the halves it exported.
 *
 * Only the data half goes through `validatePackData` here. The code half
 * cannot be checked yet: `module.default` is an *uninvoked*
 * `ContentPackFactory`, and turning it into a `ContentPackCode` needs a real
 * `ContentApi` — the ~80-module engine surface (`Spell`, `SpellObject`,
 * every buff) this boundary deliberately does not import as a value. The
 * check is deferred, not skipped: `PackRegistry.installCode` runs
 * `validatePackCode` once the factory has actually been invoked and a
 * `ContentPackCode` exists to check.
 *
 * `importModule` defaults to a real dynamic `import()` and exists as a seam
 * for tests: a runtime `import(expr)` is not something `vi.mock` can
 * intercept, since the specifier is a string built at call time rather than
 * a static module path.
 */
export async function loadPackFromManifest(
  manifest: RuntimePackManifest,
  manifestUrl: string,
  importModule: (url: string) => Promise<Record<string, unknown>> = url =>
    import(/* @vite-ignore */ url) as Promise<Record<string, unknown>>
): Promise<LoadedPack> {
  const entryUrl = pinEntryToBuild(
    resolveWithin(manifest.entry, manifestUrl, 'entry'),
    manifest.buildId
  );

  let module: Record<string, unknown>;
  try {
    module = await withTimeout(
      importModule(entryUrl),
      `${entryUrl} did not load within ${PACK_LOAD_TIMEOUT_MS}ms`
    );
  } catch (cause) {
    throw new PackLoadError('import', `could not load ${entryUrl}: ${(cause as Error).message}`);
  }

  if (typeof module.default !== 'function') {
    throw new PackLoadError('shape', `${entryUrl} has no default export function`);
  }
  if (
    module.assetManifest !== undefined &&
    (typeof module.assetManifest !== 'object' || module.assetManifest === null)
  ) {
    throw new PackLoadError('shape', `${entryUrl} assetManifest must be an object when present`);
  }

  const checked = validatePackData(module.data);
  if (checked.ok === false) {
    throw new PackLoadError('shape', `${manifest.id} data half: ${checked.errors.join('; ')}`);
  }
  if (checked.data.manifest.id !== manifest.id) {
    throw new PackLoadError(
      'shape',
      `manifest says id "${manifest.id}" but the pack declares "${checked.data.manifest.id}"`
    );
  }

  return {
    manifest,
    data: checked.data,
    code: module.default as ContentPackFactory,
    assetManifest: (module.assetManifest ?? {}) as PackAssetManifest,
    baseUrl: manifestUrl,
  };
}
