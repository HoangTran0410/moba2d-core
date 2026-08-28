<script setup lang="ts">
/**
 * The HUD app's root component: the corner control, plus a switch between
 * `DesktopHudView` and `MobileHudView` on `hud.touchUi` — the same flag
 * `Game.applyTouchUiClass` uses, not a viewport breakpoint (see
 * `styles/hud.css`'s "Touch layout" section for why).
 *
 * There used to be a second, always-visible button here — an in-game
 * mouse/touch mode toggle. It moved to the pregame setup screen's Settings
 * tab: a global preference a player sets roughly once does not earn
 * permanent on-screen real estate, doubly so right after the bottom-HUD
 * strip came out specifically to reclaim screen space. See
 * `TouchControls.ts`'s `touchModePreference`/`setTouchModePreference` for
 * the tri-state ('auto' | 'touch' | 'pointer') that setting now reads and
 * writes, and `?touch=1` for how this HUD's own touch-mode e2e coverage
 * keeps working without that button — the query parameter resolves ahead of
 * the stored preference, independent of any UI control.
 *
 * The one control left is the way into the practice panel, and it renders in
 * both modes. It started touch-only, because `MobileHudView` has no
 * bottom-HUD strip (each equipped icon is its own tap target into the panel)
 * while `DesktopHudView` still does. But the strip's icons open the panel
 * *pre-aimed at one slot* — they are a shortcut into it, not an announcement
 * that it exists, and a mouse player who never thought to click their own
 * spell bar had no way to find the panel at all. So: same button, same entry
 * point, both modes. It still hides behind the panel itself, which occupies
 * the same corner.
 *
 * `hud` (the shared `HudInteractions`, created once per game) arrives as a
 * prop from `InGameHUD.ts` rather than being constructed here, because it
 * needs the `Game` instance the lifecycle wrapper owns. It is `provide()`d
 * from here so `DesktopHudView`, `MobileHudView` and the practice panel can
 * all `inject('hud')` the same reactive object instead of three independent
 * copies that could drift.
 *
 * `state` (the read-only `HudState` snapshot) is *not* a prop: it changes on
 * every tick of `InGameHUD.ts`'s 20Hz loop, well after this component has
 * mounted, so it lives in local state and is pushed in through `setState`,
 * exposed below for the lifecycle wrapper to call.
 */
import { markRaw, onUnmounted, provide, ref, shallowRef } from 'vue';
import type { HudInteractions } from './hudInteractions';
import type { HudState } from './hudState';
import { vTap } from './tapGuard';
import DeathRecapPanel from './DeathRecapPanel.vue';
import DesktopHudView from './DesktopHudView.vue';
import MobileHudView from './MobileHudView.vue';
import OrientationHint from './OrientationHint.vue';
import NetLinkOverlay from './NetLinkOverlay.vue';
import MatchConfigPanel from './config/MatchConfigPanel.vue';
import ShopPanel from './shop/ShopPanel.vue';
import MatchDirectorSource from './config/MatchDirectorSource';

const props = defineProps<{ hud: HudInteractions }>();

provide('hud', props.hud);

const state = ref<HudState | null>(null);

/**
 * ## The config panel is mounted here, not in the two layout views
 *
 * It is a modal over everything, not part of either layout, and it used to be
 * `v-if`'d in both `DesktopHudView` and `MobileHudView` — two mount points for
 * one dialog, which now also means two places to build its data source. One
 * here, above the layout switch, is the honest shape.
 *
 * `markRaw` on the source for the same reason `hudInteractions.ts` uses it on
 * the director it wraps: a `reactive()` source would hand back proxied units
 * and proxied p5 vectors — the whole game graph — on every roster read. The
 * panel drives its own re-renders through `ConfigPanelState.invalidate`.
 *
 * `shallowRef` and built lazily rather than at module scope: `Game` constructs
 * its `InGameHUD` part-way through its own constructor, before `game.director`
 * exists, and `MatchDirectorSource` reads the director eagerly in its
 * constructor.
 */
const source = shallowRef<MatchDirectorSource | null>(null);

const openPanel = (): MatchDirectorSource => {
  if (!source.value) source.value = markRaw(new MatchDirectorSource(props.hud));
  return source.value;
};

/**
 * Escape closes the innermost layer first — the loadout editor over a tab, not
 * the panel under it. The key never reaches the DOM (p5 binds `keydown` on
 * `window` and `GameScene` routes it), so `HudInteractions` is the only thing
 * the two ends share. Returning `false` when nothing is open lets Escape fall
 * through to the panel, which is what closes it.
 */
const panel = ref<InstanceType<typeof MatchConfigPanel> | null>(null);

props.hud.onEscapeInner = () => panel.value?.closeInnerLayer() ?? false;

onUnmounted(() => {
  props.hud.onEscapeInner = null;
});

/**
 * Exposed so `InGameHUD.ts` can drive the screen and so the e2e scripts
 * (`tests/e2e/drive-mobile-hud.mjs`, `drive-touch-controls.mjs`) can reach
 * `hud` off `game.inGameHUD.vueInstance.hud` the same way they always have —
 * that property is load-bearing for those scripts, not incidental.
 */
defineExpose({
  hud: props.hud,
  setState: (next: HudState | null) => {
    state.value = next;
  },
});
</script>

<template>
  <!--
    The corner cluster: everything that opens a panel, in one row, all the same
    size and shape.

    They used to be three unrelated things in one corner — a round canvas
    button for Hồi Thành, and two DOM squares stacked below the corner, one of
    which only exists on a phone. Three renderings of three shapes reading as
    an accident rather than a control group, which is what was reported.

    Now: one flex row, right-aligned, and `TouchLayout`'s `CORNER_BUTTON_BOX`
    reserves exactly its width so the canvas recall lands immediately to its
    left on the same line. Order is corner-outward — the panel in the very
    corner, then the shop — so the button a player reaches for most often is
    the one furthest from the screen edge and hardest to fat-finger.

    Both hide behind either modal: each of those occupies this same corner with
    its own close button, and a control underneath one is a control that cannot
    be pressed.
  -->
  <div v-if="!hud.showSpellsPicker && !hud.showShop" class="corner-cluster">
    <!--
      Touch only. On a phone the gold pill and the six inventory tiles do not
      render at all and `P` is not a key a thumb can press, so without this the
      shop is unreachable on the device this game is most played on. On a
      desktop the bar already carries two ways in.
    -->
    <button
      v-if="hud.touchUi"
      class="corner-btn shop-btn"
      :class="{ 'at-shop': state?.canShop }"
      @click="hud.openShop()"
      v-tap="() => hud.openShop()"
      title="Cửa hàng"
    >
      <i class="fa-solid fa-coins"></i>
    </button>

    <button
      class="corner-btn spell-picker-btn"
      @click="hud.openSpellPicker()"
      v-tap="() => hud.openSpellPicker()"
      title="Bảng luyện tập"
    >
      <i class="fa-solid fa-wand-magic-sparkles"></i>
    </button>
  </div>

  <!-- One recap for both views — see its own header. -->
  <DeathRecapPanel
    v-if="state && state.deathRecap"
    :recap="state.deathRecap"
    :is-dead="state.isDead"
  />
  <DesktopHudView v-if="state && !hud.touchUi" :state="state" />
  <MobileHudView v-if="state && hud.touchUi" />

  <!-- Over the match, not over a pause: see `ShopPanel.vue`. It needs `state`
       for the live gold and bag, which is why it is mounted here beside the
       config panel rather than inside either layout view. -->
  <ShopPanel v-if="state && hud.showShop" :state="state" @close="hud.closeShop()" />

  <MatchConfigPanel
    v-if="hud.showSpellsPicker"
    ref="panel"
    :source="openPanel()"
    @close="hud.closeSpellPicker()"
  />

  <!-- Unconditional on purpose: it decides for itself whether to show, and a
       `v-if` here would remount it — and reset its dismissal — on every turn
       of the phone. -->
  <OrientationHint />

  <!-- Above every other layer and outside every `v-if` on `state`: the case it
       exists for is precisely the one where the match data has stopped
       arriving, so gating it on that data would hide it exactly when it is
       needed. It decides for itself whether to show. -->
  <NetLinkOverlay />
</template>
