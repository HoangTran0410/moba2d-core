import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { installEngineGlobalsForTests } from '../../src/testing';
import { moba2dPackTestConfig } from '../../src/testing/vitest.mjs';

describe('installEngineGlobalsForTests', () => {
  it('is idempotent', () => {
    installEngineGlobalsForTests();
    const first = globalThis.lerp;
    installEngineGlobalsForTests();
    expect(globalThis.lerp).toBe(first);
  });
});

describe('moba2dPackTestConfig', () => {
  it("points @ at core's own src, which is where ContentApi.ts lives", () => {
    const alias = moba2dPackTestConfig().resolve.alias['@'];
    expect(existsSync(join(alias, 'content', 'ContentApi.ts'))).toBe(true);
  });
});
