import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Restarts the dev server when `package.json`'s **version** changes.
 *
 * ## The trap
 *
 * `__CORE_VERSION__` is a `define`, and `vite.config.ts` fills it by reading
 * `package.json` *once, when the config loads* — which is when the dev server
 * starts. Vite watches its own config file and restarts on a change to it. It
 * does not watch `package.json`. So `npm run contract:bump` raises the number
 * on disk while the running server keeps serving the old one, for as long as
 * that server lives.
 *
 * What it looks like from outside is the expensive part: the next pack install
 * fails with *"pack lol needs core >=1.4.0, this is 1.3.0"* — a message that
 * accuses the code of being un-bumped, on a machine where `git log` and
 * `package.json` both say 1.4.0. The first guess is a cache. It is not a
 * cache; it is a dev server that has been up since Monday, with 1.3.0
 * compiled into every module it serves and no service worker anywhere near it.
 * `ps aux | grep vite` is the diagnosis, and nobody reaches for that first.
 *
 * It recurs on every contract bump, which is the shape of thing that should
 * stop being remembered and start being enforced.
 *
 * ## Why the version and not the file
 *
 * Restarting on any `package.json` write would be simpler and would also be
 * right, but it throws away the module graph and the HMR state every time
 * somebody renames a script. Only the version is baked into a `define`, so
 * only the version is worth a restart.
 *
 * The read is guarded: an editor's save can be observed mid-write, and a JSON
 * parse error thrown out of a watcher handler is an unhandled rejection inside
 * the dev server rather than a message anyone sees. A half-written file is
 * simply not a version change yet; the completed write is the next event.
 */
export const restartOnVersionChange = ({ packageJsonPath }) => {
  const target = resolve(packageJsonPath);

  const versionOnDisk = () => {
    try {
      return JSON.parse(readFileSync(target, 'utf8')).version;
    } catch {
      return undefined;
    }
  };

  return {
    name: 'moba2d:restart-on-version-change',
    apply: 'serve',

    configureServer(server) {
      // The version this server's `define` was built from — captured here and
      // not re-read, because that is precisely the value the browser is stuck
      // with until a restart.
      let served = versionOnDisk();
      server.watcher.add(target);

      server.watcher.on('change', file => {
        if (resolve(file) !== target) return;

        const current = versionOnDisk();
        if (current === undefined || current === served) return;

        // Written before the restart, not after: a duplicate `change` event —
        // which one save produces on some platforms — would otherwise fight
        // the in-flight restart over the same port.
        served = current;
        server.config.logger.info(
          `\n  core version changed to ${current}; restarting so __CORE_VERSION__ ` +
            `stops serving the old one.\n`
        );
        server.restart();
      });
    },
  };
};
