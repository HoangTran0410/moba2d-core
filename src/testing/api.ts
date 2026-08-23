import { buildContentApi, type ContentApi } from '../content/ContentApi';

/**
 * Every property of `T`, optionally, at every depth a plain object goes —
 * `ContentApi` is namespaces of namespaces, not arrays or class instances,
 * so that is the only shape this needs to handle. Function-typed members
 * (`asset`, `renderableAsset`) are left as `T[K]` rather than recursed into:
 * a function is structurally an `object` too, and partialising its call
 * signature away is never what an override means.
 */
export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * `vi.mock()` on a core module path is not available to a separated pack —
 * the module a pack's test would be mocking does not live in that pack's own
 * repository. This is the replacement: a `ContentApi` with named members
 * swapped, for the one test that needs to intercept what a pack spell
 * constructs internally rather than takes as a parameter — a `CastTelegraph`
 * built inside the spell's own `press()`, say — and has no local core module
 * path left to `vi.mock()`.
 *
 * Built by layering a shallow merge over each overridden namespace of the
 * real `buildContentApi()`, into a fresh object — never by assigning into
 * the real one. Every namespace on that singleton is `Object.freeze`d
 * (`ContentApi.ts`'s `buildContentApi`), so a mutation would both throw
 * under strict mode and, worse if it silently no-opped, leak into every
 * other test in the same file; `clearMocks` does not undo either.
 */
export function buildTestApi(overrides: DeepPartial<ContentApi> = {}): ContentApi {
  const real = buildContentApi() as unknown as Record<string, unknown>;
  const patch = overrides as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...real };

  for (const key of Object.keys(patch)) {
    const base = real[key];
    const value = patch[key];
    merged[key] =
      base !== null && typeof base === 'object' && value !== null && typeof value === 'object'
        ? { ...(base as Record<string, unknown>), ...(value as Record<string, unknown>) }
        : value;
  }

  return merged as unknown as ContentApi;
}
