/**
 * Moved to `src/testing/world.ts`, so a pack that is its own repository can
 * reach it by package name. This shim exists so core's own 12 dependent test
 * files keep their import path; delete it when they are repointed, not before.
 */
export * from '../../src/testing/world';
