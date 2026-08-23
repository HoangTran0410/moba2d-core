import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchPackManifest,
  loadPackFromManifest,
  satisfiesCoreRange,
  PackLoadError,
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
