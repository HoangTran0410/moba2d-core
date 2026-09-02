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
 */
import type { FeedDisplay } from './hudState';
import type { AnnouncementKind } from '@/game/combat/Announcer';

defineProps<{ feed: FeedDisplay }>();

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
    <transition-group v-if="feed.rows.length" tag="ul" name="kill-feed" class="kill-feed" aria-live="polite">
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
        <span class="kill-feed-name" :class="row.victim.side">{{ row.victim.name }}</span>
        <span class="kill-feed-face" :class="row.victim.side">
          {{ initial(row.victim.name) }}
          <img v-if="row.victim.avatar" crossorigin="anonymous" :src="row.victim.avatar" alt="" />
        </span>
        <span v-for="tag of row.tags" :key="tag.kind" class="kill-feed-badge" :class="'badge-' + tag.kind">
          <i :class="TAG_ICON[tag.kind]" aria-hidden="true"></i>{{ tag.label }}
        </span>
      </li>
    </transition-group>

    <transition name="kill-banner">
      <div v-if="feed.banner" :key="feed.banner.seq" class="kill-banner" :class="'banner-' + feed.banner.kind">
        <div class="kill-banner-title">{{ feed.banner.title }}</div>
        <div v-if="feed.banner.subtitle" class="kill-banner-sub">{{ feed.banner.subtitle }}</div>
      </div>
    </transition>
  </div>
</template>
