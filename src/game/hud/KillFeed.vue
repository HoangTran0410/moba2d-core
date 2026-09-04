<script setup lang="ts">
/**
 * The kill callouts and the banner, one component for both HUD layouts.
 *
 * Top centre, like the game this one is inspired by: the newest callout
 * lands under the top edge and pushes the older ones down; a banner for the
 * moments worth shouting sits beneath the stack. Pure display — everything
 * it shows is decided in `hudState`'s `buildFeed` (who is ally, which badges,
 * which colour family, how faded, whose kill), so this file has no game
 * import and no opinion. Mounted from `InGameHUD.vue` beside the death
 * recap, hidden with the corner cluster when a panel takes the corner.
 *
 * **A row is a run, not a kill** (`hud/killFeedGroups.ts`): one killer, then
 * every face they took down. Two `transition-group`s, nested, are what makes
 * that read as an update rather than a new callout — the outer one is keyed
 * on the row's opening kill, so a growing run is the same node and never
 * re-enters, and the inner one animates only the face just added.
 *
 * The names go once there is more than one victim. Five of them never fit a
 * phone's top edge, and the row that tried was the row that had to be capped
 * at three and then two — the faces are what a player reads at a glance
 * anyway, and the badge already says how many.
 *
 * Past five faces the row counts instead of drawing (`MAX_FEED_VICTIMS`): a
 * ten-kill run was 755px wide on a 692px window and lost both its ends to the
 * clip, the killer's own face among them. Newest face first, so the run's
 * older kills are the ones that fall into the count.
 *
 * A badge's word is wrapped rather than left bare so a narrow window can drop
 * it (`hud.css`) and keep the icon: the colour and the glyph already say which
 * kind of moment it was, and the row losing its left end costs far more.
 *
 * An objective row — a turret, an epic camp — has no portrait to put on the
 * right, so the glyph for its kind stands in for one and the name is kept.
 */
import type { FeedDisplay } from './hudState';
import type { AnnouncementKind, ObjectiveKind } from '@/game/combat/Announcer';

defineProps<{ feed: FeedDisplay }>();

/** The glyph an objective wears where a champion would have a face. */
const OBJECTIVE_ICON: Record<ObjectiveKind, string> = {
  turret: 'fa-solid fa-chess-rook',
  epic: 'fa-solid fa-dragon',
};

const TAG_ICON: Record<AnnouncementKind, string> = {
  first: 'fa-solid fa-droplet',
  multi: 'fa-solid fa-bolt',
  streak: 'fa-solid fa-fire',
  shutdown: 'fa-solid fa-fire-extinguisher',
};

/** The letter under a portrait while its image is still on its way from a pack's host. */
const initial = (name: string): string => name.trim().charAt(0).toUpperCase();
</script>

<template>
  <!-- One column, so the banner always sits under however many rows there are. -->
  <div v-if="feed.rows.length || feed.banner" class="kill-callouts">
    <transition-group
      v-if="feed.rows.length"
      tag="ul"
      name="kill-feed"
      class="kill-feed"
      aria-live="polite"
    >
      <li
        v-for="row of feed.rows"
        :key="row.seq"
        class="kill-feed-row"
        :class="[row.accent && 'accent-' + row.accent, { mine: row.mine }]"
        :style="{ opacity: row.fade }"
      >
        <template v-if="row.killer">
          <span class="kill-feed-face" :class="row.killer.side">
            {{ initial(row.killer.name) }}
            <img v-if="row.killer.avatar" crossorigin="anonymous" :src="row.killer.avatar" alt="" />
          </span>
          <span class="kill-feed-name" :class="row.killer.side">{{ row.killer.name }}</span>
        </template>
        <i class="fa-solid fa-skull-crossbones kill-feed-mark" aria-hidden="true"></i>
        <span
          v-if="row.victims.length === 1"
          class="kill-feed-name"
          :class="row.objective ? 'objective' : row.victims[0].side"
        >
          {{ row.victims[0].name }}
        </span>
        <transition-group tag="span" name="kill-feed-victim" class="kill-feed-victims">
          <span
            v-for="victim of row.victims"
            :key="victim.seq"
            class="kill-feed-face"
            :class="row.objective ? 'objective' : victim.side"
            :title="victim.name"
          >
            <i v-if="row.objective" :class="OBJECTIVE_ICON[row.objective]" aria-hidden="true"></i>
            <template v-else>
              {{ initial(victim.name) }}
              <img v-if="victim.avatar" crossorigin="anonymous" :src="victim.avatar" alt="" />
            </template>
          </span>
          <span v-if="row.overflow" key="overflow" class="kill-feed-more">+{{ row.overflow }}</span>
        </transition-group>
        <span
          v-for="tag of row.tags"
          :key="tag.kind"
          class="kill-feed-badge"
          :class="'badge-' + tag.kind"
          :title="tag.label"
        >
          <i :class="TAG_ICON[tag.kind]" aria-hidden="true"></i>
          <span class="kill-feed-badge-label">{{ tag.label }}</span>
        </span>
      </li>
    </transition-group>

    <transition name="kill-banner">
      <div
        v-if="feed.banner"
        :key="feed.banner.seq"
        class="kill-banner"
        :class="[
          'banner-' + feed.banner.kind,
          feed.banner.tier ? 'tier-' + feed.banner.tier : null,
        ]"
      >
        <div class="kill-banner-title">{{ feed.banner.title }}</div>
        <div v-if="feed.banner.subtitle" class="kill-banner-sub">{{ feed.banner.subtitle }}</div>
      </div>
    </transition>
  </div>
</template>
