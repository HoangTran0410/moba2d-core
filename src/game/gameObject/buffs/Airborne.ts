import AssetManager from '@/managers/AssetManager';
import BuffAddType from '@/game/enums/BuffAddType';
import StatusFlags from '@/game/enums/StatusFlags';
import Buff from '@/game/gameObject/Buff';
import { StatsModifier } from '@/game/gameObject/Stats';

// Hất tung
export default class Airborne extends Buff {
  image: Buff['image'] = AssetManager.get('buff_airborne');
  name = 'Hất Tung';
  // `Suppressed` derives "không thể di chuyển, đánh thường hay dùng chiêu",
  // which is true and says nothing about why. The reason is the whole read:
  // it ends when the body lands, not when a number runs out.
  description = 'Bị hất lên không trung — không thể làm gì cho tới khi tiếp đất.';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;
  height = 20;

  statsModifier: StatsModifier = new StatsModifier();

  statusFlagsToEnable = StatusFlags.Suppressed;

  onCreate(): void {
    this.statsModifier = new StatsModifier();
    this.statsModifier.height.baseBonus = this.height;
  }

  onActivate(): void {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate(): void {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}
