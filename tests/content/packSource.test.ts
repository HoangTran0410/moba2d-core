import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchPackManifest,
  loadPackFromManifest,
  satisfiesCoreRange,
  PackLoadError,
  PACK_LOAD_TIMEOUT_MS,
  resolvePackIcon,
  type RuntimePackManifest,
} from '@/content/packSource';

const MANIFEST = {
  id: 'riot',
  version: '1.0.0',
  coreRange: '>=1.0.0',
  name: 'Riot champions',
  entry: 'pack.js',
  assets: 'assets/',
  champions: 58,
};

const respondWith = (body: unknown, ok = true, status = 200) =>
  vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  } as unknown as Response);

describe('satisfiesCoreRange', () => {
  it('accepts a floor the version meets', () => {
    expect(satisfiesCoreRange('>=1.0.0', '1.0.0')).toBe(true);
    expect(satisfiesCoreRange('>=1.0.0', '1.4.2')).toBe(true);
    expect(satisfiesCoreRange('>=1.2.0', '2.0.0')).toBe(true);
  });

  it('refuses a floor the version does not meet', () => {
    expect(satisfiesCoreRange('>=2.0.0', '1.9.9')).toBe(false);
    expect(satisfiesCoreRange('>=1.2.0', '1.1.9')).toBe(false);
  });

  it('accepts the wildcard', () => {
    expect(satisfiesCoreRange('*', '0.0.1')).toBe(true);
  });

  it('refuses a range shape it does not understand, rather than guessing', () => {
    // Deliberately narrow: only `>=x.y.z` and `*` are supported, and
    // anything else is treated as incompatible so a pack cannot be admitted
    // by a range nobody implemented.
    expect(satisfiesCoreRange('^1.0.0', '1.5.0')).toBe(false);
    expect(satisfiesCoreRange('1.x', '1.5.0')).toBe(false);
    expect(satisfiesCoreRange('', '1.5.0')).toBe(false);
  });
});

describe('fetchPackManifest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the manifest when it is well formed and compatible', async () => {
    vi.stubGlobal('fetch', respondWith(MANIFEST));
    await expect(fetchPackManifest('https://h/p/manifest.json', '1.0.0')).resolves.toEqual(
      MANIFEST
    );
  });

  it('reports the fetch stage when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const error = await fetchPackManifest('https://h/p/manifest.json', '1.0.0').catch(e => e);
    expect(error).toBeInstanceOf(PackLoadError);
    expect(error.stage).toBe('fetch');
  });

  it('reports the fetch stage on a non-200', async () => {
    vi.stubGlobal('fetch', respondWith(null, false, 404));
    const error = await fetchPackManifest('https://h/p/manifest.json', '1.0.0').catch(e => e);
    expect(error.stage).toBe('fetch');
    expect(error.message).toContain('404');
  });

  it('reports the manifest stage when a required field is missing', async () => {
    const { entry, ...withoutEntry } = MANIFEST;
    vi.stubGlobal('fetch', respondWith(withoutEntry));
    const error = await fetchPackManifest('https://h/p/manifest.json', '1.0.0').catch(e => e);
    expect(error.stage).toBe('manifest');
    expect(error.message).toContain('entry');
  });

  it('reports the compat stage when the pack wants a newer core', async () => {
    vi.stubGlobal('fetch', respondWith({ ...MANIFEST, coreRange: '>=9.0.0' }));
    const error = await fetchPackManifest('https://h/p/manifest.json', '1.0.0').catch(e => e);
    expect(error.stage).toBe('compat');
    expect(error.message).toContain('9.0.0');
  });

  it('reports the manifest stage when champions is present but not a number', async () => {
    vi.stubGlobal('fetch', respondWith({ ...MANIFEST, champions: '58' }));
    const error = await fetchPackManifest('https://h/p/manifest.json', '1.0.0').catch(e => e);
    expect(error.stage).toBe('manifest');
    expect(error.message).toContain('champions');
  });

  it('reports the manifest stage when assets leaves the manifest origin', async () => {
    vi.stubGlobal('fetch', respondWith({ ...MANIFEST, assets: 'https://evil.example/assets/' }));
    const error = await fetchPackManifest('https://h/p/manifest.json', '1.0.0').catch(e => e);
    expect(error.stage).toBe('manifest');
    expect(error.message).toContain('assets');
  });

  it('reports the manifest stage when files is present but not an array', async () => {
    vi.stubGlobal('fetch', respondWith({ ...MANIFEST, files: 'nope' }));
    const error = await fetchPackManifest('https://h/p/manifest.json', '1.0.0').catch(e => e);
    expect(error.stage).toBe('manifest');
    expect(error.message).toContain('files');
  });

  it('keeps only the string entries of files, dropping the rest', async () => {
    vi.stubGlobal('fetch', respondWith({ ...MANIFEST, files: ['a.js', 42] }));
    const manifest = await fetchPackManifest('https://h/p/manifest.json', '1.0.0');
    expect(manifest.files).toEqual(['a.js']);
  });

  it('reports the manifest stage when icon is present but not a string', async () => {
    vi.stubGlobal('fetch', respondWith({ ...MANIFEST, icon: 42 }));
    const error = await fetchPackManifest('https://h/p/manifest.json', '1.0.0').catch(e => e);
    expect(error.stage).toBe('manifest');
    expect(error.message).toContain('icon');
  });

  /**
   * The same rule `entry` and `assets` obey, and it matters more here than it
   * looks: an icon is an `<img src>` core renders on its own page, so a pack
   * pointing it at some other host would make the packs screen fetch from
   * there. Refused at manifest time, before the confirmation is ever shown.
   */
  it('reports the manifest stage when icon leaves the manifest origin', async () => {
    vi.stubGlobal('fetch', respondWith({ ...MANIFEST, icon: 'https://evil.example/logo.png' }));
    const error = await fetchPackManifest('https://h/p/manifest.json', '1.0.0').catch(e => e);
    expect(error.stage).toBe('manifest');
    expect(error.message).toContain('icon');
  });

  it('accepts a manifest with no icon at all', async () => {
    vi.stubGlobal('fetch', respondWith(MANIFEST));
    const manifest = await fetchPackManifest('https://h/p/manifest.json', '1.0.0');
    expect(manifest.icon).toBeUndefined();
  });
});

describe('resolvePackIcon', () => {
  const base = { ...MANIFEST } as RuntimePackManifest;

  it('resolves a relative icon against the manifest', () => {
    expect(resolvePackIcon({ ...base, icon: 'icon.png' }, 'https://h/p/manifest.json')).toBe(
      'https://h/p/icon.png'
    );
  });

  it('answers undefined when the pack declared none', () => {
    expect(resolvePackIcon(base, 'https://h/p/manifest.json')).toBeUndefined();
  });

  /**
   * `fetchPackManifest` has already refused these, so this path is only
   * reachable through a hand-built manifest — but it is a `src/` function
   * whose result goes straight into an `<img src>`, so it answers `undefined`
   * rather than throwing or handing back a foreign origin.
   */
  it('answers undefined rather than a foreign origin', () => {
    expect(
      resolvePackIcon({ ...base, icon: 'https://evil.example/x.png' }, 'https://h/p/manifest.json')
    ).toBeUndefined();
    expect(
      resolvePackIcon({ ...base, icon: '//evil.example/x.png' }, 'https://h/p/manifest.json')
    ).toBeUndefined();
    expect(resolvePackIcon({ ...base, icon: 'icon.png' }, 'not-a-url')).toBeUndefined();
  });
});

describe('loadPackFromManifest', () => {
  const BASE_MANIFEST: RuntimePackManifest = {
    id: 'riot',
    version: '1.0.0',
    coreRange: '>=1.0.0',
    name: 'Riot champions',
    entry: 'pack.js',
    assets: 'assets/',
  };
  const MANIFEST_URL = 'https://h/p/manifest.json';

  const validModule = () => ({
    default: () => ({}),
    data: { manifest: { id: 'riot', version: '1.0.0', coreRange: '>=1.0.0' } },
  });

  it('reports the import stage when the entry fails to load', async () => {
    const importModule = vi.fn().mockRejectedValue(new Error('404'));
    const error = await loadPackFromManifest(BASE_MANIFEST, MANIFEST_URL, importModule).catch(
      e => e
    );
    expect(error).toBeInstanceOf(PackLoadError);
    expect(error.stage).toBe('import');
  });

  it('reports the shape stage when the entry has no default export function', async () => {
    const importModule = vi.fn().mockResolvedValue({ data: {} });
    const error = await loadPackFromManifest(BASE_MANIFEST, MANIFEST_URL, importModule).catch(
      e => e
    );
    expect(error.stage).toBe('shape');
  });

  it('reports the shape stage when the pack declares a different id than the manifest', async () => {
    const importModule = vi.fn().mockResolvedValue({
      default: () => ({}),
      data: { manifest: { id: 'not-riot', version: '1.0.0', coreRange: '>=1.0.0' } },
    });
    const error = await loadPackFromManifest(BASE_MANIFEST, MANIFEST_URL, importModule).catch(
      e => e
    );
    expect(error.stage).toBe('shape');
    expect(error.message).toContain('not-riot');
  });

  it('reports the shape stage when assetManifest is present but not an object', async () => {
    const importModule = vi.fn().mockResolvedValue({ ...validModule(), assetManifest: 'nope' });
    const error = await loadPackFromManifest(BASE_MANIFEST, MANIFEST_URL, importModule).catch(
      e => e
    );
    expect(error.stage).toBe('shape');
    expect(error.message).toContain('assetManifest');
  });

  it('imports the entry from its own https URL, never a blob', async () => {
    const importModule = vi.fn().mockResolvedValue(validModule());
    const loaded = await loadPackFromManifest(BASE_MANIFEST, MANIFEST_URL, importModule);
    expect(importModule).toHaveBeenCalledTimes(1);
    const [calledUrl] = importModule.mock.calls[0] as [string];
    expect(calledUrl).toMatch(/^https:\/\//);
    expect(calledUrl).not.toMatch(/^blob:/);
    expect(loaded.data.manifest.id).toBe('riot');
  });

  it('refuses an entry that resolves to a different origin', async () => {
    const manifest = { ...BASE_MANIFEST, entry: 'https://evil.example/x.js' };
    const importModule = vi.fn();
    const error = await loadPackFromManifest(manifest, MANIFEST_URL, importModule).catch(e => e);
    expect(error.stage).toBe('manifest');
    expect(importModule).not.toHaveBeenCalled();
  });

  it('refuses a protocol-relative entry', async () => {
    const manifest = { ...BASE_MANIFEST, entry: '//evil.example/x.js' };
    const importModule = vi.fn();
    const error = await loadPackFromManifest(manifest, MANIFEST_URL, importModule).catch(e => e);
    expect(error.stage).toBe('manifest');
    expect(importModule).not.toHaveBeenCalled();
  });

  it('refuses to resolve the entry against a relative manifestUrl', async () => {
    const importModule = vi.fn();
    const error = await loadPackFromManifest(BASE_MANIFEST, '/p/manifest.json', importModule).catch(
      e => e
    );
    expect(error.stage).toBe('manifest');
    expect(importModule).not.toHaveBeenCalled();
  });
});

/**
 * A dead host was always handled — the connection is refused and `fetch`
 * rejects. A *slow* one was not, and it is the worse failure: the menu
 * handover in `LoadingScene.boot()` sits behind this `await`, so a host that
 * accepts the connection and then says nothing produces the dead screen the
 * design forbids without anything ever throwing.
 *
 * Both fakes here honour the mechanism under test rather than merely never
 * settling: the `fetch` double rejects when its `AbortSignal` fires, which is
 * what a real `fetch` does, and the import double is a promise nothing can
 * cancel, which is what a real `import()` is.
 */
describe('a host that accepts the connection and then stalls', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('gives up on the manifest after PACK_LOAD_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new Error('The operation was aborted'))
            );
          })
      )
    );

    const pending = fetchPackManifest('https://h/p/manifest.json').catch(e => e);
    await vi.advanceTimersByTimeAsync(PACK_LOAD_TIMEOUT_MS);
    const error = await pending;

    expect(error).toBeInstanceOf(PackLoadError);
    expect(error.stage).toBe('fetch');
    expect(error.message).toContain(String(PACK_LOAD_TIMEOUT_MS));
  });

  it('gives up on the entry import after PACK_LOAD_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    const manifest: RuntimePackManifest = {
      id: 'riot',
      version: '1.0.0',
      coreRange: '>=1.0.0',
      name: 'Riot champions',
      entry: 'pack.js',
      assets: 'assets/',
    };
    const never = () => new Promise<Record<string, unknown>>(() => {});

    const pending = loadPackFromManifest(manifest, 'https://h/p/manifest.json', never).catch(
      e => e
    );
    await vi.advanceTimersByTimeAsync(PACK_LOAD_TIMEOUT_MS);
    const error = await pending;

    expect(error).toBeInstanceOf(PackLoadError);
    expect(error.stage).toBe('import');
    expect(error.message).toContain(String(PACK_LOAD_TIMEOUT_MS));
  });

  it('does not fire the alarm on a host that answers in time', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'riot',
          version: '1.0.0',
          coreRange: '>=1.0.0',
          name: 'Riot champions',
          entry: 'pack.js',
          assets: 'assets/',
        }),
      } as unknown as Response)
    );

    // Passed explicitly rather than leaning on `CORE_VERSION`, which is
    // `'0.0.0'` under the test runner (see its own doc comment).
    const manifest = await fetchPackManifest('https://h/p/manifest.json', '1.0.0');
    // Nothing left armed: a timer still pending here is one that would fire
    // into a settled promise, and in Node it also keeps the process alive.
    expect(vi.getTimerCount()).toBe(0);
    expect(manifest.id).toBe('riot');
  });
});
