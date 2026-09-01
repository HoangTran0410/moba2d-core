import AssetManager from '@/managers/AssetManager';
import BuffAddType from '@/game/enums/BuffAddType';
import Buff from '@/game/gameObject/Buff';
import { percent, term } from '@/game/gameObject/buffs/describeBuff';

/**
 * A grievous wound: while it is on, everything that would put health back on
 * this unit puts back less. `combat/Healing.ts` owns what that reaches — every
 * heal, the vamp payout and health regeneration, but never a shield — and this
 * class is only the thing a spell or an item applies.
 *
 * **The mechanic is core's, the items are a pack's.** Sustain is bought here
 * (`Stats.lifesteal`, `spellVamp`, `omnivamp`, `healthRegen`), so the counter
 * to it has to be buyable in the same shop, and neither half may live where
 * only one pack can reach it.
 *
 * `RENEW_EXISTING`, and it matters more than usual: `healCutFraction` takes
 * the *strongest* live cut rather than the sum, so two appliers must not put
 * two instances on one victim and read as one wound while showing two icons.
 * One instance, refreshed — which also makes "how long have I got left" a
 * question with one answer.
 *
 * A wound is not crowd control: no `statusFlags`, nothing `cleanse` will take
 * off, and no `CROWD_CONTROL_FLAGS` bit. Quicksilver does not answer this.
 */
export const HEAL_CUT_FRACTION = 0.4;

/** Long enough to cover the healing a fight actually produces, and no longer. */
export const HEAL_CUT_DURATION_MS = 3_000;

export default class HealCut extends Buff {
  image: Buff['image'] = AssetManager.get('buff_healcut');
  name = 'Vết Thương Sâu';
  buffAddType = BuffAddType.RENEW_EXISTING;

  /**
   * The share of every heal this takes. Written by whoever applies it — the
   * default is what League charges for the same effect, and a pack is free to
   * sell a weaker one.
   */
  healCut = HEAL_CUT_FRACTION;

  onCreate(): void {
    this.description ??=
      `Giảm ${term(percent(this.healCut))} mọi hiệu ứng hồi máu và hồi phục nhận được. ` +
      'Không ảnh hưởng lá chắn.';
  }
}
