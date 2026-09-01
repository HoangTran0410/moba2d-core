import { beforeEach, describe, expect, it } from 'vitest';
import { contentRegistry, resetContentRegistryForTests } from '../../src/content/registry';
import { neutralSlotFill } from '../../src/game/preset';
import type { ContentPack, NeutralSlot } from '../../src/content/ContentPack';

/**
 * **A neutral slot is a named point on the ground, not necessarily a camp.**
 *
 * `slots.neutral` meant one thing for as long as it existed — a jungle camp —
 * and `NeutralSlot.role`'s own doc comment has always said the opposite about
 * the name on it: *"a free string a monster's `fills` matches. Core never
 * interprets it."* So a map could name a point and a pack could not put
 * anything on it that was not a body to fight: a relic somebody walks over, an
 * altar, a shrine, a capture point, a decoration. There was no field for it.
 *
 * `ContentPackCode.slotObjects` is that field, and this is the whole of what
 * core decides about it — what stands on a slot. The object itself is entirely
 * the pack's, which is the point: core learns no relic.
 */

const slot = (role: string): NeutralSlot => ({ role, x: 1_000, y: 1_000, r: 120 });

const pack = (id: string, extra: Partial<ContentPack>): ContentPack =>
  ({
    manifest: { id, version: '1.0.0', coreRange: '^1' },
    ...extra,
  }) as ContentPack;

/** A stand-in for whatever the pack builds — core never looks inside it. */
const marker = { id: 'built-by-the-pack' };

/** The smallest camp that installs, so the *other* half is what is under test. */
const camp = (role: string) => ({
  id: role,
  name: role,
  fills: [role],
  members: [
    {
      name: role,
      avatar: 'monster_test',
      speed: 0,
      size: 60,
      attackRange: 50,
      health: 100,
      reviveTime: 30_000,
      offset: { x: 0, y: 0 },
    },
  ],
});

describe('what fills a neutral slot', () => {
  beforeEach(resetContentRegistryForTests);

  it('is nothing at all for a role nobody answers', () => {
    expect(neutralSlotFill(slot('nobody-ships-this'))).toBeNull();
  });

  it('is the pack’s own object for a role it claims', () => {
    contentRegistry().install(
      pack('relics', { slotObjects: { relic: () => marker as never } })
    );

    const fill = neutralSlotFill(slot('relic'));
    expect(fill?.kind).toBe('object');
    // Built lazily, by the caller: `Game.spawnJungle` hands it the slot and
    // the running game, so the object can stand exactly where the map put it.
    expect(fill?.kind === 'object' && fill.build(slot('relic'), {} as never)).toBe(marker);
  });

  /**
   * The factory may look at the slot and decline — that is how a pack
   * conditions on a slot's own `stats` without core learning what any of them
   * mean. `Game.spawnJungle` adds nothing for a `null`, and does not fall
   * through to a camp either: the role was claimed.
   */
  it('lets the pack decline a slot it looked at', () => {
    contentRegistry().install(pack('relics', { slotObjects: { relic: () => null } }));

    const fill = neutralSlotFill(slot('relic'));
    expect(fill?.kind).toBe('object');
    expect(fill?.kind === 'object' && fill.build(slot('relic'), {} as never)).toBeNull();
  });

  it('is still the camp for every role no object claims', () => {
    contentRegistry().install(
      pack('jungle', {
        slotObjects: { relic: () => marker as never },
        monsters: { wolves: camp('wolves') } as never,
      })
    );

    const fill = neutralSlotFill(slot('wolves'));
    expect(fill?.kind).toBe('camp');
    expect(fill?.kind === 'camp' && fill.monster.id).toBe('jungle:wolves');
  });

  /**
   * A role is filled once. A pack that declares both for one role has said
   * something contradictory, and the object is the ruling — stated here rather
   * than left to whichever lookup `Game` happened to run first.
   */
  it('gives the object the slot when a camp claims the same role', () => {
    contentRegistry().install(
      pack('both', {
        slotObjects: { shrine: () => marker as never },
        monsters: { shrine: camp('shrine') } as never,
      })
    );

    expect(neutralSlotFill(slot('shrine'))?.kind).toBe('object');
  });
});
