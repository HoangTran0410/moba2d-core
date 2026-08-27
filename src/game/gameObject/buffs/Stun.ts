// TODO https://leagueoflegends.fandom.com/wiki/Stun
// https://leagueoflegends.fandom.com/wiki/Root
import AssetManager from '@/managers/AssetManager';
import BuffAddType from '@/game/enums/BuffAddType';
import StatusFlags from '@/game/enums/StatusFlags';
import Buff from '@/game/gameObject/Buff';

/**
 * Làm choáng.
 *
 * ## Do not override `image` on an instance of this buff
 *
 * Almost every other buff's `image` is HUD-only, and a spell that overrides it
 * with its own icon is *improving* the buff bar: three simultaneous slows all
 * drawn as `buff_slow` say nothing about which one to play around. Over a
 * hundred sites in the content packs do exactly that, and they are right to.
 *
 * This buff is one of the two exceptions — `Fear` is the other, and they are
 * the only two whose `draw()` paints `this.image` **into the world**, spinning
 * on the victim at their body size. Here the icon is not a label in a list, it
 * is the readout the whole screen uses to answer "who is stunned right now",
 * and a champion-specific ability icon at that size is not legible as one.
 * `docs/VFX_STANDARD.md`'s rule applies directly: legibility outranks looking
 * good.
 *
 * Found as drift rather than as a decision — three of the dota pack's four
 * stuns had overridden it, against 24 of 25 in the lol pack that had not, with
 * nothing written down either way. This is the written-down version.
 */
export default class Stun extends Buff {
  /** Drawn on the victim by `draw()` below, not only in the HUD. See the header. */
  image: Buff['image'] = AssetManager.get('buff_stun');
  name = 'Choáng';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;
  statusFlagsToEnable = StatusFlags.Stunned | StatusFlags.Immovable;

  draw(): void {
    // draw buff on target unit
    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;

    push();
    translate(pos.x, pos.y);
    rotate(-frameCount / 15);
    image(AssetManager.renderable(this.image ?? undefined), 0, 0, size, size);
    pop();
  }
}
