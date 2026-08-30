<script setup lang="ts">
/**
 * Choosing a map, with enough on screen to choose *between* them.
 *
 * ## What it replaces
 *
 * A row of cards on the Trận đấu tab carrying a name, `6400×6400` and a
 * faction count. Everything that actually distinguishes one map from another
 * was invisible: its shape, and its rules. A map may retune seven whole
 * systems — respawn, the economy, turrets, the fountain, minions, the jungle,
 * terrain speed — and the only way to find out that one pays triple gold or
 * that its water halves your speed was to open the map editor. The rules were
 * shipped, enforced, and unreadable.
 *
 * So the picker became a modal, which is the only shape with room for the two
 * things a chooser wants: a picture, and a list of what is unusual.
 *
 * ## Highlighting is not choosing
 *
 * The same rule the shop's grid and detail pane keep. Tapping a name in the
 * list *previews* it; the button at the bottom is what writes the choice. A
 * player browsing four maps to compare their jungles must not silently change
 * the map they are about to play — and on a locked tab (a LAN client) they can
 * browse all of them and commit none, which is exactly right.
 *
 * ## The preview loads, the rules do not
 *
 * `MapSummary.tuning` rides on the summary the list already has, so every
 * rule below is available the instant this opens. The polygons are the map's
 * heavy half and sit behind a loader on purpose (`ContentPack.ts`'s split), so
 * they are fetched per highlighted map and the panel says so while it waits.
 * A failed load draws no picture and blocks nothing.
 */
import { computed, ref, watch } from 'vue';
import { vTap } from '../tapGuard';
import { buildMapPreview, TURRET_MARKER_FRACTION, type MapPreview } from './mapPreview';
import { mapRuleCount, mapRuleGroups } from './mapRuleLines';
import type { QualifiedMapSummary } from '@/content/PackRegistry';

const props = defineProps<{
  maps: QualifiedMapSummary[];
  /** The id currently in force — ticked in the list, and where browsing starts. */
  selectedId: string;
  /** False on a LAN client: browse everything, commit nothing. */
  canEdit: boolean;
  /** Load a map's polygons. `MatchConfigSource.loadMapGeometry`. */
  load: (id: string) => Promise<import('@/content/ContentPack').MapGeometry | null>;
}>();

const emit = defineEmits<{ close: []; pick: [id: string] }>();

/** What is being *looked at*, which is not what is chosen. See the header. */
const viewingId = ref(props.selectedId);
const viewing = computed(
  () => props.maps.find(map => map.id === viewingId.value) ?? props.maps[0] ?? null
);

const groups = computed(() => mapRuleGroups(viewing.value?.tuning));
const ruleCount = (map: QualifiedMapSummary): number => mapRuleCount(map.tuning);

const preview = ref<MapPreview | null>(null);
const loading = ref(false);

/**
 * One in-flight load at a time, and only the newest one may write.
 *
 * A player flicking down a list of maps starts a load per row, and they finish
 * in whatever order the network and the bundler agree on — so without the
 * token the picture can settle on a map nobody is looking at any more.
 */
let loadToken = 0;

watch(
  () => viewing.value?.id,
  async id => {
    preview.value = null;
    if (!id) return;
    const token = ++loadToken;
    loading.value = true;
    try {
      const geometry = await props.load(id);
      if (token !== loadToken) return;
      const map = props.maps.find(entry => entry.id === id);
      preview.value = geometry && map ? buildMapPreview(geometry, map.size, map.factions) : null;
    } catch {
      // A preview that cannot load is not a reason to stop somebody picking
      // the map. The panel simply draws no picture.
      if (token === loadToken) preview.value = null;
    } finally {
      if (token === loadToken) loading.value = false;
    }
  },
  { immediate: true }
);

/** Blue, red, or neither — `preset.ts` seats the first two factions and no more. */
const teamOf = (label: string): string => {
  const seated = preview.value?.seated ?? [];
  if (seated[0] === label) return 'blue';
  if (seated[1] === label) return 'red';
  return 'none';
};

const markerSize = computed(() => (preview.value?.size ?? 0) * TURRET_MARKER_FRACTION);

const commit = (): void => {
  if (!canCommit.value) return;
  emit('pick', viewingId.value);
  emit('close');
};

const canCommit = computed(
  () => props.canEdit && !!viewing.value && viewing.value.id !== props.selectedId
);
</script>

<template>
  <div class="pregame-modal-backdrop" @click.self="emit('close')">
    <div class="pregame-modal map-picker-modal">
      <header class="pregame-modal-header">
        <h3>Chọn bản đồ</h3>
        <button type="button" class="pregame-icon-btn" title="Đóng" @click="emit('close')">
          <i class="fas fa-times"></i>
        </button>
      </header>

      <div class="pregame-modal-body map-picker-body">
        <!-- The list keeps `#practice-map` and `.map-option[data-map]`: those
             are the selectors the map-picker e2e drives, and moving the control
             into a modal is not a reason to rename them. -->
        <div id="practice-map" class="map-picker" role="radiogroup" aria-label="Bản đồ">
          <button
            v-for="map of maps"
            :key="map.id"
            type="button"
            class="map-option"
            :class="{ selected: map.id === selectedId, viewing: map.id === viewingId }"
            role="radio"
            :aria-checked="map.id === selectedId"
            :data-map="map.id"
            @click="viewingId = map.id"
            v-tap="() => (viewingId = map.id)"
          >
            <span class="map-option-name">
              {{ map.name }}
              <i v-if="map.id === selectedId" class="fas fa-check map-option-tick" aria-hidden="true"></i>
            </span>
            <span class="map-option-meta">
              {{ map.size }}×{{ map.size }} · {{ map.factions.length }} phe
              <!-- The badge is the whole point of the rules work: a map that
                   bends nothing says nothing, and one that bends nine things
                   says so before it is picked. -->
              <template v-if="ruleCount(map)"> · {{ ruleCount(map) }} luật riêng</template>
            </span>
            <span class="map-option-pack">{{ map.packId }}</span>
          </button>
        </div>

        <div v-if="viewing" class="map-detail">
          <div class="map-preview-frame">
            <svg
              v-if="preview"
              class="map-preview"
              :viewBox="`0 0 ${preview.size} ${preview.size}`"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              :aria-label="`Xem trước ${viewing.name}`"
            >
              <rect class="mp-ground" x="0" y="0" :width="preview.size" :height="preview.size" />
              <polygon v-for="(pts, i) of preview.water" :key="`w${i}`" class="mp-water" :points="pts" />
              <polygon v-for="(pts, i) of preview.bushes" :key="`b${i}`" class="mp-bush" :points="pts" />
              <!-- Lanes under the walls: a lane that crossed one would be
                   drawing a route nobody can walk, and the map rules refuse
                   that anyway — so the wall wins the pixel. -->
              <polyline
                v-for="(pts, i) of preview.lanes"
                :key="`l${i}`"
                class="mp-lane"
                :points="pts"
                :stroke-width="preview.laneWidth"
              />
              <polygon v-for="(pts, i) of preview.walls" :key="`p${i}`" class="mp-wall" :points="pts" />
              <circle
                v-for="(camp, i) of preview.camps"
                :key="`c${i}`"
                class="mp-camp"
                :cx="camp.x" :cy="camp.y" :r="camp.r"
              ><title>{{ camp.label }}</title></circle>
              <circle
                v-for="(spawn, i) of preview.spawns"
                :key="`s${i}`"
                class="mp-spawn"
                :class="`is-${teamOf(spawn.label)}`"
                :cx="spawn.x" :cy="spawn.y" :r="spawn.r"
              ><title>{{ spawn.label }}</title></circle>
              <rect
                v-for="(turret, i) of preview.turrets"
                :key="`t${i}`"
                class="mp-turret"
                :class="`is-${teamOf(turret.label)}`"
                :x="turret.x - markerSize / 2"
                :y="turret.y - markerSize / 2"
                :width="markerSize"
                :height="markerSize"
              ><title>{{ turret.label }}</title></rect>
            </svg>
            <p v-else class="map-preview-empty">
              {{ loading ? 'Đang tải hình bản đồ…' : 'Bản đồ này không có hình xem trước.' }}
            </p>
          </div>

          <div class="map-rules">
            <h4>Luật riêng của bản đồ</h4>
            <!-- Said in one sentence rather than drawn as an empty box: a map
                 that declares nothing plays exactly like every other, and that
                 is information too. -->
            <p v-if="!groups.length" class="map-rules-none">
              Chơi theo đúng luật mặc định của core — không đổi gì.
            </p>
            <section v-for="section of groups" :key="section.title" class="map-rule-group">
              <h5>{{ section.title }}</h5>
              <div v-for="line of section.lines" :key="line.label" class="map-rule-row">
                <span class="map-rule-label">{{ line.label }}</span>
                <span class="map-rule-value">{{ line.value }}</span>
                <!-- The standard beside it, because "40% hồi máu" means nothing
                     without knowing core pays 12%. -->
                <span class="map-rule-standard">thường {{ line.standard }}</span>
              </div>
            </section>
          </div>
        </div>
      </div>

      <footer class="map-picker-footer">
        <span v-if="!canEdit" class="map-picker-note">Máy khác đang giữ quyền đổi cấu hình.</span>
        <span v-else-if="viewing && viewing.id === selectedId" class="map-picker-note">
          Đang chọn <strong>{{ viewing.name }}</strong>.
        </span>
        <button
          type="button"
          class="btn primary map-picker-commit"
          :disabled="!canCommit"
          @click="commit()"
          v-tap="() => commit()"
        >
          Chọn bản đồ này
        </button>
      </footer>
    </div>
  </div>
</template>
