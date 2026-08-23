import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchPackManifest, satisfiesCoreRange, PackLoadError } from '@/content/packSource';

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
});
