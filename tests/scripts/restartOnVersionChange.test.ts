import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restartOnVersionChange } from '../../scripts/vite/restart-on-version-change.mjs';

/**
 * The trap this plugin exists to close, measured rather than imagined.
 *
 * `__CORE_VERSION__` is a `define`, and `vite.config.ts` fills it by reading
 * `package.json` **once, when the config loads** — which is when the dev server
 * starts. Vite watches its own config file and restarts on a change to it; it
 * does not watch `package.json`. So `npm run contract:bump` raises the number
 * on disk and the running dev server keeps serving the old one, for as long as
 * that server lives.
 *
 * What that looks like from the outside is the worst part. The next pack
 * install fails with *"pack lol needs core >=1.4.0, this is 1.3.0"* — a message
 * that accuses the code of being un-bumped when it is not, on a machine where
 * `git log` and `package.json` both say 1.4.0. The first instinct is a cache,
 * and it is not a cache: a dev server started three days earlier had 1.3.0
 * compiled into every module it served, with no service worker anywhere near
 * it. That cost a debugging cycle in both directions before anyone thought to
 * check `ps`.
 *
 * It recurs on every contract bump, which is exactly the shape of thing that
 * should stop being remembered and start being enforced.
 */
const fakeServer = () => {
  const handlers: ((file: string) => void)[] = [];
  return {
    restart: vi.fn(),
    // Modelled rather than stubbed away: a real Vite server always carries
    // one, and a plugin that logged through an optional chain would silently
    // stop explaining itself the day the shape changed.
    config: { logger: { info: vi.fn() } },
    watcher: {
      added: [] as string[],
      add(path: string) {
        this.added.push(path);
      },
      on(event: string, handler: (file: string) => void) {
        if (event === 'change') handlers.push(handler);
      },
    },
    fire(file: string) {
      for (const handler of handlers) handler(file);
    },
  };
};

const withPackageJson = (contents: unknown): string => {
  const dir = mkdtempSync(join(tmpdir(), 'moba2d-version-'));
  const path = join(dir, 'package.json');
  writeFileSync(path, JSON.stringify(contents));
  return path;
};

describe('restartOnVersionChange', () => {
  it('watches the package.json it was given', () => {
    const path = withPackageJson({ version: '1.4.0' });
    const server = fakeServer();
    restartOnVersionChange({ packageJsonPath: path }).configureServer(server);
    expect(server.watcher.added).toContain(path);
  });

  it('restarts when the version on disk changes', () => {
    const path = withPackageJson({ version: '1.4.0' });
    const server = fakeServer();
    restartOnVersionChange({ packageJsonPath: path }).configureServer(server);

    writeFileSync(path, JSON.stringify({ version: '1.5.0' }));
    server.fire(path);

    expect(server.restart).toHaveBeenCalledTimes(1);
  });

  it('says why, naming the new version', () => {
    // The restart is the fix; the line is what stops the *next* person
    // wondering whether their dev server just died on its own.
    const path = withPackageJson({ version: '1.4.0' });
    const server = fakeServer();
    restartOnVersionChange({ packageJsonPath: path }).configureServer(server);

    writeFileSync(path, JSON.stringify({ version: '1.5.0' }));
    server.fire(path);

    const said = server.config.logger.info.mock.calls.flat().join(' ');
    expect(said).toContain('1.5.0');
    expect(said).toContain('__CORE_VERSION__');
  });

  it('leaves the server alone when some other field changes', () => {
    // Editing a script name should not throw away the dev server, the module
    // graph and the HMR state. Only the number that is baked in matters.
    const path = withPackageJson({ version: '1.4.0', scripts: { dev: 'vite' } });
    const server = fakeServer();
    restartOnVersionChange({ packageJsonPath: path }).configureServer(server);

    writeFileSync(path, JSON.stringify({ version: '1.4.0', scripts: { dev: 'vite --host' } }));
    server.fire(path);

    expect(server.restart).not.toHaveBeenCalled();
  });

  it('ignores a change to any other file', () => {
    const path = withPackageJson({ version: '1.4.0' });
    const server = fakeServer();
    restartOnVersionChange({ packageJsonPath: path }).configureServer(server);

    writeFileSync(path, JSON.stringify({ version: '9.9.9' }));
    server.fire(join(path, '..', 'something-else.ts'));

    expect(server.restart).not.toHaveBeenCalled();
  });

  it('restarts only once for one version change, however many events arrive', () => {
    // A single save can produce several `change` events on some platforms, and
    // `server.restart()` while a restart is already in flight is a fight over
    // the same port.
    const path = withPackageJson({ version: '1.4.0' });
    const server = fakeServer();
    restartOnVersionChange({ packageJsonPath: path }).configureServer(server);

    writeFileSync(path, JSON.stringify({ version: '1.5.0' }));
    server.fire(path);
    server.fire(path);
    server.fire(path);

    expect(server.restart).toHaveBeenCalledTimes(1);
  });

  it('survives a half-written file rather than taking the dev server down', () => {
    // An editor saving `package.json` can be observed mid-write, and a JSON
    // parse error thrown out of a watcher handler is an unhandled rejection in
    // the dev server rather than a message anybody sees.
    const path = withPackageJson({ version: '1.4.0' });
    const server = fakeServer();
    restartOnVersionChange({ packageJsonPath: path }).configureServer(server);

    writeFileSync(path, '{ "version": "1.5');
    expect(() => server.fire(path)).not.toThrow();
    expect(server.restart).not.toHaveBeenCalled();

    // And recovers once the write completes.
    writeFileSync(path, JSON.stringify({ version: '1.5.0' }));
    server.fire(path);
    expect(server.restart).toHaveBeenCalledTimes(1);
  });
});
