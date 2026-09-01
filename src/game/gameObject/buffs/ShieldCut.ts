import AssetManager from '@/managers/AssetManager';
import BuffAddType from '@/game/enums/BuffAddType';
import Buff from '@/game/gameObject/Buff';
import { percent, term } from '@/game/gameObject/buffs/describeBuff';

/**
 * A cracked guard: while it is on, every shield granted to this unit is worth
 * less. `combat/Shielding.ts` owns what that reaches — new shields only, never
 * one already standing — and this class is only the thing an item applies.
 *
 * The sibling of `HealCut`, down to the stacking rule: `RENEW_EXISTING` so two
 * appliers are one crack, because the fraction is read as the *strongest* live
 * cut rather than the sum and two instances would show two icons for one
 * effect.
 *
 * Not crowd control — no `statusFlags`, nothing `cleanse` takes off.
 */
export const SHIELD_CUT_FRACTION = 0.5;

/** Long enough to cover the shield a team throws at a focused ally. */
export const SHIELD_CUT_DURATION_MS = 3_000;

export default class ShieldCut extends Buff {
  image: Buff['image'] = AssetManager.get('buff_shieldcut');
  name = 'Rạn Khiên';
  buffAddType = BuffAddType.RENEW_EXISTING;

  /** The share every *new* shield loses while this is on. */
  shieldCut = SHIELD_CUT_FRACTION;

  onCreate(): void {
    this.description ??=
      `Lá chắn nhận được từ giờ chỉ còn ${term(percent(1 - this.shieldCut))} giá trị. ` +
      'Không ảnh hưởng lá chắn đang có sẵn.';
  }
}
