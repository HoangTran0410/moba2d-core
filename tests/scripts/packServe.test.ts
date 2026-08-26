import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error — a build script, deliberately plain .mjs with no types.
import { createPackServer, requireBuiltPack } from '../../scripts/pack-serve.mjs';

/**
 * The server a pack author points the hosted game at.
 *
 * Everything asserted here is a header, and every one of them is load-bearing
 * for the same single reason: the page doing the fetching is on somebody
 * else's origin, over https, and is asking a plain-http server on the
 * author's own machine for code it is about to `import()`. Miss one and the
 * failure the author sees is a CORS line in a console, with nothing naming
 * the pack.
 */
describe('moba2d-pack-serve', () => {
  const made: string[] = [];
  const servers: { close(cb: () => void): void }[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(server => new Promise<void>(done => server.close(() => done())))
    );
    await Promise.all(made.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  /** A built pack, as `npm run build` leaves one. */
  async function builtPack(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'pack-serve-'));
    made.push(root);
    const dist = join(root, 'dist');
    await mkdir(join(dist, 'assets'), { recursive: true });
    await writeFile(join(dist, 'manifest.json'), JSON.stringify({ id: 'my-pack' }));
    await writeFile(join(dist, 'pack.js'), 'export const packId = "my-pack";\n');
    await writeFile(join(dist, 'assets', 'hero.webp'), 'not really webp');
    // The file the traversal case must never be able to reach.
    await writeFile(join(root, 'secret.txt'), 'private');
    return root;
  }

  async function serving(dist: string): Promise<string> {
    const server = await createPackServer({ dir: dist });
    servers.push(server);
    await new Promise<void>(done => server.listen(0, '127.0.0.1', () => done()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('serves the manifest with the two headers a cross-origin install needs', async () => {
    const root = await builtPack();
    const origin = await serving(join(root, 'dist'));

    const response = await fetch(`${origin}/manifest.json`);

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('content-type')).toContain('application/json');
    // The whole point of a dev server: the author rebuilt, and the browser
    // must not answer the next read out of its own cache.
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ id: 'my-pack' });
  });

  it('answers the private-network preflight Chrome sends from a public page', async () => {
    // A page on https://<host> asking a plain-http server on the local
    // network is a private network request. Without this header the preflight
    // fails and the author sees a CORS error that names nothing useful.
    const root = await builtPack();
    const origin = await serving(join(root, 'dist'));

    const response = await fetch(`${origin}/manifest.json`, {
      method: 'OPTIONS',
      headers: { 'access-control-request-private-network': 'true' },
    });

    expect(response.status).toBeLessThan(300);
    expect(response.headers.get('access-control-allow-private-network')).toBe('true');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('gives the entry a JavaScript type, or the import() is refused', async () => {
    const root = await builtPack();
    const origin = await serving(join(root, 'dist'));

    const response = await fetch(`${origin}/pack.js`);

    expect(response.headers.get('content-type')).toContain('javascript');
    expect(await response.text()).toContain('packId');
  });

  it('serves nothing above the directory it was given', async () => {
    const root = await builtPack();
    const origin = await serving(join(root, 'dist'));

    const response = await fetch(`${origin}/../secret.txt`);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('private');
  });

  it('404s a file the build did not emit', async () => {
    const root = await builtPack();
    const origin = await serving(join(root, 'dist'));

    expect((await fetch(`${origin}/nope.js`)).status).toBe(404);
  });

  it('refuses to serve a pack that was never built, and says what to run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pack-serve-'));
    made.push(root);

    expect(() => requireBuiltPack(join(root, 'dist'))).toThrow(/npm run build/);
  });
});
