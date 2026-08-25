<script setup lang="ts">
/**
 * The mouse-and-keyboard HUD: the bar along the bottom of the screen, spell
 * cooldowns drawn on its own icons, hover for the description.
 *
 * Reads `HudState` (via the `state` prop, recomputed at `HUD_UPDATE_INTERVAL_MS`
 * by `InGameHUD`) and `HudInteractions` (via `inject('hud')`, shared with
 * `MobileHudView` and the practice panel) — it owns neither. Its whole job is
 * this layout; the desktop-specific behaviour in it is `mouseover`/`mouseout`
 * for the tooltip, everything else is the shared interaction layer.
 */
import { inject } from 'vue';
import FormatUtils from '@/utils/format.utils';
import type { HudInteractions } from './hudInteractions';
import type { HudState } from './hudState';

defineProps<{ state: HudState }>();

const hud = inject<HudInteractions>('hud')!;
</script>

<template>
  <div
    v-if="hud.spellHover"
    class="spell-info"
    :style="
      'top:' +
      hud.spellInfo.top +
      ';bottom:' +
      hud.spellInfo.bottom +
      ';left:' +
      hud.spellInfo.left +
      ';width:' +
      hud.spellInfo.width
    "
  >
    <div class="header">
      <div>
        <img crossorigin="anonymous" :src="hud.spellHover.image" alt="spell" />
        <h4>{{ hud.spellHover.name }}</h4>
      </div>
      <!-- An item with no active has neither number, and "0s / 0 mana" under
           its name is noise rather than information. -->
      <div v-if="hud.spellHover.coolDown > 0 || hud.spellHover.manaCost > 0" class="costs">
        <span v-if="hud.spellHover.coolDown > 0"
          >{{ FormatUtils.spellSeconds(hud.spellHover.coolDown) }}s</span
        >
        <span v-if="hud.spellHover.manaCost > 0" class="mana"
          >{{ hud.spellHover.manaCost }} mana</span
        >
      </div>
    </div>
    <p class="body" v-html="hud.spellHover.description"></p>
  </div>

  <div v-if="state.avatar" class="bottom-HUD">
    <div class="champion-avatar">
      <img
        crossorigin="anonymous"
        :src="state.avatar"
        alt="champion-avatar"
        :style="state.isDead ? 'filter: grayscale(100%)' : ''"
      />
      <span v-if="state.isDead" class="revive-counter">{{ state.reviveAfter }}</span>

      <!--
        The passive, on the portrait rather than in the ability row. It is a
        spell the champion *has*, not one it casts — no key, no cooldown, no
        cost — and putting it in a row of pressable icons would say the
        opposite. Both games this engine's players know place it here for the
        same reason.
      -->
      <div
        v-if="state.passive"
        class="passive-badge"
        @mouseover="hud.mouseover(state.passive, $event)"
        @mouseout="hud.mouseout(state.passive)"
      >
        <img crossorigin="anonymous" :src="state.passive.image" alt="passive" />
      </div>
    </div>

    <div class="champion-details">
      <div class="spells">
        <div
          v-for="(spell, index) of state.spells"
          :key="index"
          :class="[spell.small ? 'spell small' : 'spell', { sustaining: spell.sustaining }]"
          @click="hud.openPlayerLoadout(index)"
          @touchend.prevent="hud.openPlayerLoadout(index)"
          @mouseover="hud.mouseover(spell, $event)"
          @mouseout="hud.mouseout(spell)"
        >
          <img
            crossorigin="anonymous"
            :src="spell.image"
            alt="spell"
            :style="
              spell.disabled || spell.lockedOut || !spell.canCast || !spell.affordable
                ? 'filter: grayscale(100%)'
                : ''
            "
          />

          <!--
            Whether the ability is *on*, which the bar never said. A toggle
            carries its badge in both states — "TẮT" is the half that tells a
            player the key is a switch at all, and an indicator that only
            appears when lit leaves "off" and "not a toggle" looking the same.
            A bounded window (a recast stage, a timed stance) counts its
            seconds down instead, and drains the strip along the top edge:
            top-right is the one corner the stack badge, the mana pill and the
            hotkey all leave free.
          -->
          <span
            v-if="spell.toggle"
            :class="spell.sustaining ? 'toggle-badge on' : 'toggle-badge off'"
            >{{ spell.sustaining ? 'BẬT' : 'TẮT' }}</span
          >
          <span
            v-else-if="spell.sustaining && spell.sustainSecondsLeft > 0"
            class="toggle-badge on"
            >{{ spell.sustainSecondsLeft }}</span
          >
          <div
            v-if="spell.sustaining && spell.sustainPercent > 0"
            class="sustain-bar"
            :style="'width:' + spell.sustainPercent + '%'"
          ></div>

          <span v-if="spell.hotKey" class="hotKey">{{ spell.hotKey }}</span>
          <span v-if="spell.stackCount !== undefined" class="stacks">{{ spell.stackCount }}</span>
          <span
            v-if="spell.manaCost > 0"
            :class="spell.affordable ? 'mana-cost' : 'mana-cost short'"
            >{{ spell.manaCost }}</span
          >
          <div v-if="spell.showCoolDown">
            <div
              :class="spell.lockedOut ? 'cooldown-overlay' : 'cooldown-overlay rhythm'"
              :style="'height:' + spell.coolDownPercent + '%'"
            ></div>
            <div v-if="spell.lockedOut" class="cooldown">
              <p>{{ spell.coolDownText }}</p>
            </div>
          </div>
        </div>
      </div>
      <div class="health-bar">
        <div class="bar">
          <div :style="'width:' + state.stats.healthPercent + '%; background-color:#0ca20c'"></div>
          <div
            v-if="state.stats.shield > 0"
            class="shield"
            :style="
              'position:absolute; top:0; bottom:0; left:' +
              state.stats.shieldLeftPercent +
              '%; width:' +
              state.stats.shieldPercent +
              '%; background-color:rgba(225,230,238,0.85)'
            "
          ></div>
          <p>
            {{ state.stats.health }} / {{ state.stats.maxHealth
            }}<span v-if="state.stats.shield > 0"> (+{{ state.stats.shield }})</span>
          </p>
        </div>
        <div class="bar" style="margin-top: 3px">
          <div :style="'width:' + state.stats.manaPercent + '%; background-color:#218bdd;'"></div>
          <p>{{ state.stats.mana }} / {{ state.stats.maxMana }}</p>
        </div>
      </div>
      <div class="buffs">
        <div v-for="(buff, index) of state.buffs" :key="index" class="buff">
          <img crossorigin="anonymous" :src="buff.image" alt="buff" />
          <span>{{ buff.timeLeftText }}</span>
          <span v-if="buff.stacks > 1" class="stacks">{{ buff.stacks }}</span>
        </div>
      </div>
    </div>

    <!--
      The inventory, to the right of the abilities and the bars — six slots,
      always, filled or not. A row that grew as items were bought would move
      every key under the player's hand; a fixed grid is a shape they learn the
      position of.

      Clicking a slot opens the shop, which is the only place an item can be
      sold, so the row is also how a player finds it. `@touchend.prevent`
      beside `@click` for the reason every control here needs it: `GameScene`
      cancels touches on the page, so a thumb never synthesises the click.
    -->
    <div class="inventory">
      <div class="items">
        <div
          v-for="(item, index) of state.items"
          :key="index"
          class="item-slot"
          :class="{ filled: item.filled, sustaining: item.sustaining }"
          @click="hud.openShop()"
          @touchend.prevent="hud.openShop()"
          @mouseover="item.filled && hud.mouseover(item, $event)"
          @mouseout="hud.mouseout(item)"
        >
          <img v-if="item.image" crossorigin="anonymous" :src="item.image" alt="item" />
          <span v-if="item.hotKey" class="hotKey">{{ item.hotKey }}</span>
          <div v-if="item.showCoolDown">
            <div class="cooldown-overlay" :style="'height:' + item.coolDownPercent + '%'"></div>
            <div class="cooldown">
              <p>{{ item.coolDownText }}</p>
            </div>
          </div>
        </div>
      </div>

      <!--
        Hồi Thành and the gold, on one line under the inventory.
        
        It used to sit at the end of the ability strip, where it stretched the
        whole bar by its own width plus a margin for a control that is pressed
        once a minute. Here it costs nothing: the inventory column is already
        three tiles wide and the gold pill was using a third of that line.
        
        The grouping is not just packing, either — going home, the gold and the
        bag are the three things about the fountain, and they now read as one
        cluster instead of one being marooned among the abilities.
      -->
      <div class="inventory-footer">
        <!--
          Hồi Thành. It lives on `Champion.recall`, not in `spells[]` (see
          `Recall.ts`), and it used to sit at the end of the ability strip to
          say so — where it also stretched the whole bar by its own width plus
          a margin, for a control pressed about once a minute. It says the same
          thing more cheaply from here: it is the only round control in the
          bar, and it is nowhere near a hotkey.

          `@touchend.prevent` beside `@click` is not belt-and-braces —
          `GameScene` cancels touches on the canvas, so a thumb never
          synthesises the click and a `@click`-only control is dead under one.
          Clicking again cancels: `Game.recall()` owns that, not this.
        -->
        <button
          v-if="state.recall"
          class="recall-btn"
          :class="{
            channeling: state.recall.channeling,
            unavailable: !state.recall.canCast,
          }"
          :title="`${state.recall.name} (${state.recall.hotKey})`"
          @click="hud.recall()"
          @touchend.prevent="hud.recall()"
        >
          <i class="fa-solid fa-house-chimney"></i>
          <!-- The key moved into the tooltip when this button shrank to 22px.
               A letter hanging off a circle that small is not legible and it
               collided with the gold pill beside it; every other hotkey in the
               bar sits on a 3em tile with room for one. -->
          <div
            v-if="state.recall.channeling"
            class="recall-fill"
            :style="'height:' + state.recall.progressPercent + '%'"
          ></div>
          <span v-if="state.recall.channeling" class="recall-count">{{
            state.recall.secondsLeft
          }}</span>
        </button>

        <button
          class="gold-pill"
          :class="{ 'at-shop': state.canShop }"
          :title="state.canShop ? 'Mở cửa hàng' : 'Về bệ đá để mua đồ'"
          @click="hud.openShop()"
          @touchend.prevent="hud.openShop()"
        >
          <i class="fa-solid fa-coins"></i>
          <span>{{ state.gold }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
