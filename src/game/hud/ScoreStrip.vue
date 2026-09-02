<script setup lang="ts">
/**
 * The score strip: the player's side's kills, the match clock, the other
 * side's kills — one slim pill at the top centre, always up, and the tap
 * target that opens the scoreboard on a phone (a keyboard holds Tab).
 *
 * Slim on purpose: it sits over the fight for the whole match, so it has to
 * cost less screen than a kill-feed row. Pure display, fed by `hudState`.
 */
import { vTap } from './tapGuard';
import type { ScoreboardTeam } from './hudState';

defineProps<{ teams: ScoreboardTeam[]; clock: string; active: boolean }>();
const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <button
    type="button"
    class="score-strip"
    :class="{ active }"
    title="Bảng điểm (Tab)"
    @click="emit('toggle')"
    v-tap="() => emit('toggle')"
  >
    <span
      v-for="(team, i) of teams.slice(0, 2)"
      :key="team.teamId"
      class="score-strip-side"
      :class="['score-strip-side--' + team.modifier, { first: i === 0 }]"
    >
      <i class="fa-solid fa-skull" aria-hidden="true"></i>{{ team.kills }}
    </span>
    <span class="score-strip-clock">{{ clock }}</span>
  </button>
</template>
