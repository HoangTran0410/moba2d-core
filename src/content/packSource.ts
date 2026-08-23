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
 * Fetches and checks a manifest. Nothing the pack wrote as *code* has run
 * when this resolves — that is the whole point of it being its own step.
 */
export async function fetchPackManifest(
  manifestUrl: string,
  coreVersion: string = CORE_VERSION
): Promise<RuntimePackManifest> {
  let response: Response;
  try {
    response = await fetch(manifestUrl, { credentials: 'omit' });
  } catch (cause) {
    throw new PackLoadError('fetch', `could not reach ${manifestUrl}: ${(cause as Error).message}`);
  }
  if (!response.ok) {
    throw new PackLoadError('fetch', `${manifestUrl} answered ${response.status}`);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
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
  return manifest;
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
  const entryUrl = resolveWithin(manifest.entry, manifestUrl, 'entry');

  let module: Record<string, unknown>;
  try {
    module = await importModule(entryUrl);
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
