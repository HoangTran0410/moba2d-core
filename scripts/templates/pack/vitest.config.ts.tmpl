import { defineConfig } from 'vitest/config';
// @ts-expect-error — plain .mjs, deliberately: a pack's config loader hands
// a bare specifier under `node_modules` straight to Node, which refuses to
// strip types there, so there is no `.d.ts` for a `bundler`-resolution
// program to find. See `@moba2d/core/testing/vitest`'s own header for the
// full reasoning.
import { moba2dPackTestConfig } from '@moba2d/core/testing/vitest';

/**
 * This pack's own test runner. Spreads the shared preset
 * (`@moba2d/core/testing/vitest`) rather than a hand-written copy, so this
 * config and core's own cannot quietly drift the way two hand-written
 * `resolve.alias`/`test.environment` blocks would.
 */
const preset = moba2dPackTestConfig({ setupFiles: ['./vitest.setup.ts'] });

export default defineConfig({
  resolve: preset.resolve,
  test: { ...preset.test, include: ['tests/**/*.test.ts'] },
});
