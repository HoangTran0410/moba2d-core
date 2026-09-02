import { beforeEach, describe, expect, it } from 'vitest';
import { contentRegistry, resetContentRegistryForTests } from '../../src/content/registry';
import { neutralSlotFill } from '../../src/game/preset';
import { coreSlotObjectFor } from '../../src/game/gameObject/structures/slotObjects';
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
 * core decides about it — what stands on a slot.
 *
 * The object was, at first, *entirely* the pack's: core learned no relic. It
 * has learned exactly one since (`gameObject/structures/slotObjects.ts`), and
 * the reason is the map editor: a role is furniture when a map author drawing
 * the point in core's own editor would be surprised to find nothing on it, and
 * "nothing unless you also installed a particular pack" is that surprise. The
 * seam did not move — a pack registering the same role still wins, which the
 * cases below are what prove.
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

  /**
   * Core's own short list, with nothing installed at all. `relic` is on it;
   * the point of asserting it here rather than in the relic's own tests is the
   * *lookup*, not the object — a map may name the role and get an answer with
   * no pack in the world.
   */
  it('is core’s own object for a furniture role no pack claims', () => {
    const fill = neutralSlotFill(slot('relic'));

    expect(fill?.kind).toBe('object');
    expect(coreSlotObjectFor('relic'), 'the relic left core’s table').toBeTypeOf('function');
  });

  it('leaves a role off core’s short list to the packs', () => {
    expect(coreSlotObjectFor('shrine')).toBeUndefined();
    expect(coreSlotObjectFor('wolves')).toBeUndefined();
  });

  it('is the pack’s own object for a role it claims, over core’s', () => {
    contentRegistry().install(
      pack('relics', { slotObjects: { relic: () => marker as never } })
    );

    const fill = neutralSlotFill(slot('relic'));
    expect(fill?.kind).toBe('object');
    // Built lazily, by the caller: `Game.spawnJungle` hands it the slot and
    // the running game, so the object can stand exactly where the map put it.
    //
    // `relic` is also the one role core answers itself, so this is the
    // override in one assertion: the pack's marker, not core's relic.
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
   * **The map breaks the tie.** A role a camp and an object both answer is a
   * contradiction somebody has to settle, and the map that drew the point is
   * the one that knows what it drew — a point drawn for a relic says so, and a
   * point that says nothing means what every map drawn before `slotObjects`
   * meant.
   */
  describe('when a camp and an object both answer the role', () => {
    beforeEach(() => {
      contentRegistry().install(
        pack('both', {
          slotObjects: { shrine: () => marker as never },
          monsters: { shrine: camp('shrine') } as never,
        })
      );
    });

    it('is the camp for a point that says nothing', () => {
      expect(neutralSlotFill(slot('shrine'))?.kind).toBe('camp');
    });

    it('is the object for a point the map drew as one', () => {
      expect(neutralSlotFill({ ...slot('shrine'), kind: 'object' })?.kind).toBe('object');
    });
  });

  /**
   * And the fallback that keeps a forgotten `kind` from being a quiet failure.
   * A map author who drew a relic point and never touched the new field still
   * gets the relic, because no camp answered the role — `kind` chooses the
   * *order*, not whether the object exists.
   */
  it('still fills a point that says nothing when only an object answers', () => {
    contentRegistry().install(pack('relics', { slotObjects: { relic: () => marker as never } }));

    expect(neutralSlotFill(slot('relic'))?.kind).toBe('object');
  });

  /**
   * The other direction, and the reason `kind` is load-bearing rather than a
   * note for the editor: a point drawn as an object is never a camp, whatever
   * the packs installed happen to answer with.
   */
  it('leaves an object point empty rather than standing a camp on it', () => {
    contentRegistry().install(pack('jungle', { monsters: { wolves: camp('wolves') } as never }));

    expect(neutralSlotFill({ ...slot('wolves'), kind: 'object' })).toBeNull();
  });
});
