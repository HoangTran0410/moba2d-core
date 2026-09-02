import { describe, expect, it } from 'vitest';
import { PackRegistry } from '@/content/PackRegistry';
import type { ContentPack } from '@/content/ContentPack';

/**
 * A pack's per-champion bot opinions (`ContentPackCode.championAI`) are
 * installed like its monster abilities: qualified by the pack id, and refused
 * when the key names a champion the pack does not ship — a typo that
 * installed would be an opinion nobody ever hears.
 */
const manifest = { id: 'ref', version: '1.0.0', coreRange: '^1' };
const hero = { id: 'Hero', name: 'Hero', image: null, spells: [], playable: false };

describe('championAI in the registry', () => {
  it('is looked up by qualified champion id', () => {
    const registry = new PackRegistry();
    const opinion = { posture: () => undefined };
    registry.install({ manifest, champions: [hero], championAI: { Hero: opinion } } as unknown as ContentPack);
    expect(registry.championAIFor('ref:Hero')).toBe(opinion);
    expect(registry.championAIFor('Hero')).toBeUndefined();
    expect(registry.championAIFor('other:Hero')).toBeUndefined();
  });

  it('refuses an opinion about a champion the pack does not ship', () => {
    const registry = new PackRegistry();
    expect(() =>
      registry.install({
        manifest,
        champions: [hero],
        championAI: { Ghost: { posture: () => undefined } },
      } as unknown as ContentPack)
    ).toThrow(/championAI\.Ghost/);
  });

  it('forgets every opinion on reset', () => {
    const registry = new PackRegistry();
    registry.install({ manifest, champions: [hero], championAI: { Hero: {} } } as unknown as ContentPack);
    registry.reset();
    expect(registry.championAIFor('ref:Hero')).toBeUndefined();
  });
});
