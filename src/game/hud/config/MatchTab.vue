<script setup lang="ts">
/**
 * The match itself: its rules, the world it runs in, and the two ways out of it.
 *
 * Everything that is *not* about a participant and *not* about this device.
 * CDR and URF apply on the spot in a running match — `Spell.ts` reads
 * `game.matchRules` at cast time rather than capturing it at construction, so
 * moving the slider changes the cooldown of spells that already exist, on their
 * next cast. The jungle and minion switches apply on the first unpaused tick,
 * which is what the note under them is for: without it the panel looks broken,
 * because the honest answer to "I turned the jungle off and nothing happened"
 * is "the match is not running".
 *
 * Outside a match all four are plain config writes and the note hides.
 *
 * The controls deliberately do not stage behind a confirm. There is nothing to
 * stage: each is one assignment, reversible by dragging or clicking back, and a
 * rule change is not a pick a player builds up over several taps. The two that
 * *do* confirm are at the bottom, and they are the two that are not recoverable.
 *
 * ## On a LAN client the whole tab is read-only
 *
 * Except the way out, which a client must always have. Everything above it
 * belongs to the match, and a LAN match belongs to its host — see
 * `MatchConfigSource.canEditMatchSettings`. The controls are *disabled and
 * still rendered*, showing the values that are actually running: the honest
 * thing for a client to see is the host's 40% CDR greyed out, not an empty tab
 * that says nothing about the match it is in.
 *
 * The handlers check it too, and that is not belt-and-braces for the
 * `:disabled` attributes. `v-tap` binds touch events straight to the element,
 * and touch events still fire on a disabled `<button>` — so `pickMap` under a
 * thumb would otherwise move `selectedMapId` (a local ref the source cannot
 * refuse) and tick a map the match will never boot.
 */
import { computed, inject, ref } from 'vue';
import { resolveMapId } from '@/content/defaultMap';
import { CONFIG_PANEL } from './panelState';
import { CDR_PERCENT_MAX, CDR_PERCENT_MIN } from '@/game/config/PregameConfig';
import {
  MATCH_MODES,
  describeMode,
  matchModeFor,
  modeDrift,
  type MatchModeId,
} from '@/game/config/matchModes';
import {
  clearMatchHistory,
  formatDuration,
  formatWhen,
  readMatchHistory,
  type MatchRecord,
} from '@/game/config/matchHistory';
import {
  MATCH_TEMPLATE_NAME_MAX,
  deleteMatchTemplate,
  loadMatchTemplates,
  renameMatchTemplate,
  saveMatchTemplate,
  type MatchTemplate,
} from '@/game/config/matchTemplates';
import { describeTemplateGaps, templateGaps } from './templateGaps';
import { vTap } from '../tapGuard';
import MapPickerModal from './MapPickerModal.vue';
import PanelSection from './PanelSection.vue';
import { mapRuleCount, mapRuleGroups } from './mapRuleLines';

/**
 * `canStart` is the shell's knowledge, not this tab's: whether pressing a
 * template can boot the match right here — true only where the Bắt Đầu footer
 * itself renders (the menu's start screen; not the LAN lobby, whose start is
 * Vào trận, and never in a match). The `start` emit is forwarded by
 * `MatchConfigPanel` to the same host handler that footer uses.
 */
const props = defineProps<{ canStart?: boolean }>();
const emit = defineEmits<{ close: []; start: [] }>();

const panel = inject(CONFIG_PANEL)!;
const source = panel.source;

const live = source.live;

/**
 * Read once, like `live` above: the net role is set when a session boots and
 * cleared when it closes, and neither can happen while this panel is mounted
 * over the match it belongs to.
 */
const canEdit = source.canEditMatchSettings;

/**
 * Seeded from the source, which is the match's own view of its rules — a match
 * booted from a config that set a rule seeded it at construction, so the tab
 * opens showing what is running rather than a fresh 0%.
 */
const rules = ref(source.getRules());
const world = ref(source.getWorld());

/**
 * ## The mode chips
 *
 * A mode is a macro over the controls under it (`config/matchModes.ts`), so
 * picking one re-reads `rules` and `world` the way `resetDefaults` does: the
 * slider and the switches move to where the mode put them, in front of the
 * player, which is also how they learn what "URF" meant. The chip stays lit
 * afterwards even when a knob is dragged away — the id is a stored fact — and
 * `modeDrift` is what keeps that honest by appending "đã chỉnh".
 *
 * Async because a mode with a bot count reshapes a running roster, and a bot
 * arriving fetches its kit. `switchingMode` disables the chips meanwhile so a
 * second tap cannot race the first through `MatchDirector.pendingAdd`.
 *
 * Re-picking the lit chip is allowed only when it has drifted: that is the
 * one press that means "put URF back", and refusing it would leave the player
 * choosing another mode and coming back, which is two presses to say one
 * thing.
 */
const modeId = ref<MatchModeId>(source.getMode());
const mode = computed(() => matchModeFor(modeId.value));
const switchingMode = ref(false);

const modeDrifted = computed(() =>
  modeDrift(mode.value, { rules: rules.value, world: world.value, botCount: source.botCount() })
);

const pickMode = async (id: MatchModeId): Promise<void> => {
  if (!canEdit || switchingMode.value) return;
  if (id === modeId.value && !modeDrifted.value) return;
  switchingMode.value = true;
  try {
    await source.setMode(id);
    modeId.value = source.getMode();
    rules.value = source.getRules();
    world.value = source.getWorld();
    panel.invalidate();
  } finally {
    switchingMode.value = false;
  }
};

/**
 * What the lit mode does, as short lines: its knobs from `describeMode`, then
 * its tuning through the same formatter the map picker uses for a map's own
 * rules — one vocabulary for "this number is not core's", whoever moved it.
 */
const modeLines = computed(() => [
  ...describeMode(mode.value),
  ...mapRuleGroups(mode.value.tuning).flatMap(group =>
    group.lines.map(line => `${line.label} ${line.value}`)
  ),
]);

/**
 * The half of a mode a running match cannot take: its numbers are merged at
 * boot and its random roster is rolled there. Named plainly, and only the
 * parts this mode actually has, so "Tay đôi" — which is one bot and nothing
 * pending — shows no note at all.
 */
const modePending = computed(() => {
  const parts: string[] = [];
  if (mode.value.allRandom) parts.push('tướng ngẫu nhiên');
  if (mode.value.tuning) parts.push('các con số (vàng, hồi sinh, tốc chạy)');
  return parts.join(' và ');
});

/**
 * "Chơi lại" beside the pending note — the press that makes the pending half
 * real. Two-step like the exit below, and for the same reason: it throws a
 * match away.
 */
const confirmingModeRestart = ref(false);
const restartForMode = (): void => {
  if (!confirmingModeRestart.value) {
    confirmingModeRestart.value = true;
    return;
  }
  confirmingModeRestart.value = false;
  live?.restart();
};

/**
 * ## Trận mẫu
 *
 * The saved-setup library (`config/matchTemplates.ts`): the whole match —
 * roster, per-bot switches, bags, rules, world, map choice — under a name,
 * so an evening's setup is one press next session instead of rebuilding
 * every bot by hand.
 *
 * Saving reads `source.templateSetup()` — in a match that is the live match,
 * bags included; on the menu it is the configured setup with empty bags.
 * Applying goes back through `source.applyTemplateSetup()`: on the start
 * screen it writes the config and boots (`emit('start')`, the footer's own
 * door), in a match it applies on the spot the way Đặt lại mặc định does —
 * and confirms the same way, because it replaces a match that exists.
 */
const templates = ref<MatchTemplate[]>(loadMatchTemplates());
const templatesSummary = computed(() =>
  templates.value.length ? `${templates.value.length} mẫu` : 'chưa có mẫu'
);

/**
 * What a template cannot deliver on *this* install — a champion, bag id or
 * map from a pack that is gone. Said on the row, before the press, because
 * downstream the policy is skip-quietly (`templateGaps.ts`'s file comment).
 */
const templateGapLines = computed(() => {
  const lines = new Map<string, string | null>();
  for (const template of templates.value)
    lines.set(template.id, describeTemplateGaps(templateGaps(template.setup)));
  return lines;
});

const templateMeta = (template: MatchTemplate): string => {
  const config = template.setup.config;
  return `${config.ai.count} bot · ${matchModeFor(config.mode).name} · ${mapNameOf(config.mapId)}`;
};

const templateName = ref('');
const saveTemplate = (): void => {
  const name = templateName.value.trim();
  if (!name) return;
  saveMatchTemplate(name, source.templateSetup());
  templateName.value = '';
  // Re-read rather than splice: storage sanitized the entry, and the list on
  // screen must be the list that was written.
  templates.value = loadMatchTemplates();
};

const renamingId = ref<string | null>(null);
const renameDraft = ref('');
const startRename = (template: MatchTemplate): void => {
  renamingId.value = template.id;
  renameDraft.value = template.name;
};
const cancelRename = (): void => {
  renamingId.value = null;
};
const commitRename = (): void => {
  if (renamingId.value && renameDraft.value.trim())
    renameMatchTemplate(renamingId.value, renameDraft.value);
  renamingId.value = null;
  templates.value = loadMatchTemplates();
};

/** Two-step per row, armed independently of every other confirm on the tab. */
const confirmingDeleteId = ref<string | null>(null);
const removeTemplate = (template: MatchTemplate): void => {
  if (confirmingDeleteId.value !== template.id) {
    confirmingDeleteId.value = template.id;
    return;
  }
  confirmingDeleteId.value = null;
  deleteMatchTemplate(template.id);
  templates.value = loadMatchTemplates();
};

const applyingTemplate = ref(false);
const confirmingApplyId = ref<string | null>(null);

/** The one-press start: write the setup, then leave through the footer's door. */
const startTemplate = async (template: MatchTemplate): Promise<void> => {
  if (!props.canStart || !canEdit || applyingTemplate.value) return;
  applyingTemplate.value = true;
  try {
    await source.applyTemplateSetup(template.setup);
    emit('start');
  } finally {
    applyingTemplate.value = false;
  }
};

/**
 * Apply without booting: the LAN lobby's shape (configure, then Vào trận) and
 * the in-match shape — where it confirms first, because unlike every other
 * control on this tab it replaces the roster standing on the map.
 */
const applyTemplate = async (template: MatchTemplate): Promise<void> => {
  if (!canEdit || applyingTemplate.value) return;
  if (live && confirmingApplyId.value !== template.id) {
    confirmingApplyId.value = template.id;
    return;
  }
  confirmingApplyId.value = null;
  applyingTemplate.value = true;
  try {
    await source.applyTemplateSetup(template.setup);
    // Every control on this tab is seeded from the source at mount, the same
    // situation resetDefaults is in — re-read what the template moved.
    rules.value = source.getRules();
    world.value = source.getWorld();
    modeId.value = source.getMode();
    // In a match `getMap()` reports the running map, unmoved (see the map
    // block below) — the *choice* the template just made is its own mapId,
    // resolved the way the mount resolves a stored one.
    selectedMapId.value = live
      ? (resolveMapId(maps, template.setup.config.mapId) ?? template.setup.config.mapId)
      : (resolveMapId(maps, source.getMap()) ?? source.getMap());
    panel.invalidate();
  } finally {
    applyingTemplate.value = false;
  }
};

/**
 * ## Trận gần đây
 *
 * The local match history (`config/matchHistory.ts`), read once per mount:
 * the running match is in it too, autosaved every thirty seconds, so the
 * list opened mid-match shows tonight's numbers so far. Shown a page at a
 * time — ten rows, then "Xem thêm" — because forty rows of K/D/A is a wall on
 * a phone. Cleared with the same two-step press the other irreversible
 * controls on this tab use.
 */
const HISTORY_PAGE = 10;
const history = ref<MatchRecord[]>(readMatchHistory().records);
const historyShown = ref(HISTORY_PAGE);
const historyNow = Date.now();
const shownHistory = computed(() => history.value.slice(0, historyShown.value));
const mapNameOf = (id: string): string => maps.find(map => map.id === id)?.name ?? id;
const confirmingClearHistory = ref(false);
const clearHistory = (): void => {
  if (!confirmingClearHistory.value) {
    confirmingClearHistory.value = true;
    return;
  }
  confirmingClearHistory.value = false;
  clearMatchHistory();
  history.value = [];
};

/**
 * ## The folded headers' one line each
 *
 * What a section's controls currently say, for `PanelSection`'s summary —
 * the tab reads as five lines until something is opened. Every one is a
 * computed over the same refs the controls edit, so a change inside a section
 * is on its header the moment it folds.
 */
const modeSummary = computed(() => `${mode.value.name}${modeDrifted.value ? ' · đã chỉnh' : ''}`);
const rulesSummary = computed(() => {
  const parts = [`CDR ${rules.value.cooldownReductionPercent}%`];
  if (rules.value.manaFree) parts.push('không mana');
  if (!rules.value.recall) parts.push('không hồi thành');
  return parts.join(' · ');
});
const worldSummary = computed(() =>
  [world.value.jungle ? 'rừng' : 'không rừng', world.value.minions ? 'lính' : 'không lính'].join(' · ')
);

const CDR_PERCENT_STEP = 10;

/**
 * Read back after writing rather than trusting the local edit: the source
 * rounds and clamps, so the label shows the percentage the match actually got
 * and not the one the control asked for.
 */
const setCdr = (percent: number, persist: boolean): void => {
  source.setRules({ ...rules.value, cooldownReductionPercent: percent }, persist);
  rules.value = source.getRules();
};

const cdrValue = (event: Event): number => Number((event.target as HTMLInputElement).value);
const onCdrInput = (event: Event): void => setCdr(cdrValue(event), false);
const onCdrChange = (event: Event): void => setCdr(cdrValue(event), true);

/**
 * The scroll-vs-slider tail `touch-action: pan-y` cannot cover — the same
 * shape as the zoom slider's guard in `SettingsTab.vue`: a vertical scroll
 * that begins on the track jumps the value on `pointerdown` before the pan is
 * recognised, and the recognition arrives as `pointercancel`. Snapshot on the
 * way down, put it back on the cancel.
 */
let cdrBeforeGesture: number | null = null;

const onCdrPointerDown = (): void => {
  cdrBeforeGesture = rules.value.cooldownReductionPercent;
};

const onCdrPointerUp = (): void => {
  cdrBeforeGesture = null;
};

const onCdrPointerCancel = (event: Event): void => {
  if (cdrBeforeGesture === null) return;
  setCdr(cdrBeforeGesture, true);
  (event.target as HTMLInputElement).value = String(rules.value.cooldownReductionPercent);
  cdrBeforeGesture = null;
};

const onUrfChange = (event: Event): void => {
  source.setRules({ ...rules.value, manaFree: (event.target as HTMLInputElement).checked }, true);
  rules.value = source.getRules();
};

/**
 * The brawl's rule as its own switch, so a knob a mode writes is also a knob
 * a player can see and move — a mode is a macro over the controls on this
 * tab, and a rule with no control would be one the tab could not admit
 * having changed.
 */
const onRecallChange = (event: Event): void => {
  source.setRules({ ...rules.value, recall: (event.target as HTMLInputElement).checked }, true);
  rules.value = source.getRules();
};

const setWorld = (patch: { jungle?: boolean; minions?: boolean }): void => {
  source.setWorld(patch);
  world.value = source.getWorld();
  panel.invalidate();
};

const onJungleChange = (event: Event): void =>
  setWorld({ jungle: (event.target as HTMLInputElement).checked });

const onMinionsChange = (event: Event): void =>
  setWorld({ minions: (event.target as HTMLInputElement).checked });

/**
 * The map picker (Task 10 of the content-pack extraction).
 *
 * Outside a match this is a plain setting — `setMap` writes it, `getMap()`
 * reads it straight back — so re-reading the source after every write would
 * work fine here, the same idiom `setCdr` above uses. It would not work in a
 * match: `MatchConfigSource.getMap`'s own doc comment is explicit that a
 * running match reports its own map, unmoved, no matter what is picked,
 * because nothing in this seam rebuilds a live terrain map or nav grid.
 * Re-reading `getMap()` there would make the picker visibly snap back to the
 * running map the instant a different one was chosen — indistinguishable from
 * the control being broken. `selectedMapId` tracks the *pick* instead, which
 * is honest in both places: outside a match the pick and the setting are the
 * same fact, and in one, the note below says what the picker cannot.
 *
 * It is a row of cards rather than a `<select>`, and that is about what a
 * player can see. A native select shows one map at a time and nothing about
 * it — choosing between two worlds meant choosing between two names, with no
 * way to tell how big either was, how many sides it fields, or which pack it
 * came from except by starting a match on it. Every one of those facts is
 * already on `QualifiedMapSummary`; none of it fitted in an `<option>`.
 */
const maps = source.availableMaps();
// Not `ref(source.getMap())` directly: on a core-alone install `getMap()` can
// still return a persisted id from before a pack departed, which names no
// `<option>` this control actually has — it rendered with nothing selected
// while the match itself played correctly, on the match's own fallback. That
// fallback is `content/defaultMap.ts` now, shared rather than written twice:
// the two copies disagreed the moment the content pack stopped being bundled,
// and `maps[0]` started meaning core's test arena.
const selectedMapId = ref(resolveMapId(maps, source.getMap()) ?? source.getMap());

const pickMap = (id: string): void => {
  if (!canEdit || id === selectedMapId.value) return;
  source.setMap(id);
  selectedMapId.value = id;
};

/** Whether the picker is up. A local ref: closing the panel should close it. */
const showMapPicker = ref(false);

const selectedMap = computed(() => maps.find(map => map.id === selectedMapId.value) ?? null);
const selectedMapName = computed(() => selectedMap.value?.name ?? selectedMapId.value);
const selectedMapMeta = computed(() => {
  const map = selectedMap.value;
  if (!map) return '';
  return `${map.size}×${map.size} · ${map.factions.length} phe · ${map.packId}`;
});
/**
 * How many rules this map bends, on the row that opens the picker.
 *
 * The number is the hook: a map that changes nothing says nothing here, and
 * one that changes nine things says so without being opened. Before this, a
 * map's rules were shipped and enforced and could only be read in the map
 * editor.
 */
const selectedMapRuleCount = computed(() => mapRuleCount(selectedMap.value?.tuning));
const mapSummary = computed(
  () =>
    `${selectedMapName.value}${selectedMapRuleCount.value ? ` · ${selectedMapRuleCount.value} luật riêng` : ''}`
);

/**
 * The map the running match is on, read once.
 *
 * `getMap()` is the *live* map in a match and unmoved by `setMap` (see its own
 * doc comment), and a live world cannot change maps — so one read at mount is
 * the whole truth for as long as this panel exists. Outside a match the same
 * call means the persisted choice instead, which is why it is gated on `live`.
 */
const liveMapId = live ? source.getMap() : null;

/** The running match's own map, by name — for the note below, in a match only. */
const liveMapName = computed(() => maps.find(map => map.id === liveMapId)?.name ?? liveMapId);

/**
 * Start again on the map just chosen. Asked for by `MapPickerModal`, which is
 * where the player finds out that choosing one mid-match changes nothing yet.
 *
 * Nothing is confirmed here: the modal asked, and the press that reaches this
 * *is* the answer. A second "chắc chưa?" over the top of it would be asking
 * the same question twice.
 */
const restartMatch = (): void => {
  live?.restart();
};

/**
 * ## The way out of the match
 *
 * Escape used to end it outright, with no confirmation and no way back. Escape
 * now opens this panel, so the exit has to live somewhere findable — and this
 * is the tab that means *this match*, which is what is being quit.
 *
 * Deliberately **not** beside the shell's close button in the tab row: two
 * adjacent controls whose outcomes differ by an entire match is exactly the
 * mis-hit being designed out.
 *
 * Two steps, and it is one of only two controls in the panel that confirm.
 * Bots, saved kits, champion swaps and every cheat are one press each, on
 * purpose, because each is cheap to redo. This one is not.
 */
const confirmingExit = ref(false);

const exitMatch = (): void => {
  if (!confirmingExit.value) {
    confirmingExit.value = true;
    return;
  }
  live?.requestExit();
};

/**
 * ## And the way back to a clean slate
 *
 * The panel persists everything it changes, which quietly took away the fresh
 * match every restart used to be: a player who spent an evening at 90% CDR with
 * nine bots and no jungle had no way back except editing `localStorage`. This is
 * that way back — it writes the defaults *and*, in a match, applies them while
 * you are looking at it.
 *
 * The second control that confirms, for both of the exit's reasons: it is not
 * recoverable, and it sits next to another irreversible control. The two arm
 * independently, so arming one and pressing the other cannot fire it.
 */
const confirmingReset = ref(false);
const resetting = ref(false);

const resetDefaults = async (): Promise<void> => {
  if (!canEdit || resetting.value) return;
  if (!confirmingReset.value) {
    confirmingReset.value = true;
    return;
  }
  confirmingReset.value = false;
  resetting.value = true;
  try {
    await source.resetToDefaults();
    // Every control on this tab is seeded from the source at mount, so the ones
    // this moved must be re-read instead of showing the old match.
    rules.value = source.getRules();
    world.value = source.getWorld();
    modeId.value = source.getMode();
    panel.invalidate();
  } finally {
    resetting.value = false;
  }
};

const resetLabel = computed(() =>
  resetting.value ? 'Đang đặt lại…' : confirmingReset.value ? 'Chắc chưa?' : 'Đặt lại mặc định'
);
</script>

<template>
  <div class="practice-tab-body">
    <!-- First, and before the controls it explains: a client that finds a
         greyed-out tab is owed the reason above it, not under it. -->
    <p v-if="!canEdit" class="practice-note practice-note-locked">
      <i class="fas fa-lock" aria-hidden="true"></i>
      Trận đấu mạng: chỉ <strong>chủ phòng</strong> đổi được cài đặt trận.
    </p>

    <!-- Five folding sections, each header a one-line summary of what is
         inside (`PanelSection.vue`). The mode leads and starts open: it is
         the shape of the evening, and the other four are what it can be tuned
         into. Everything else starts folded — the player asked for a tab that
         does not read as a wall on first open. -->
    <PanelSection id="match-mode" title="Chế độ" :summary="modeSummary" default-open>
      <!-- Pills rather than cards — a mode is a word. -->
      <div class="mode-field">
        <div class="mode-chips" role="group" aria-label="Chế độ">
          <button
            v-for="option in MATCH_MODES"
            :key="option.id"
            type="button"
            class="mode-chip"
            :id="`practice-mode-${option.id}`"
            :class="{ selected: option.id === modeId }"
            :aria-pressed="option.id === modeId"
            :disabled="!canEdit || switchingMode"
            @click="pickMode(option.id)"
            v-tap="() => pickMode(option.id)"
          >
            {{ option.name }}
          </button>
        </div>
        <p class="mode-blurb" id="practice-mode-blurb">
          {{ mode.blurb }}<template v-if="modeDrifted"> · <em>đã chỉnh</em></template>
        </p>
        <ul v-if="modeLines.length" class="mode-lines" id="practice-mode-lines">
          <li v-for="line in modeLines" :key="line">{{ line }}</li>
        </ul>

        <!-- Only in a match, only for a mode with a pending half, and only for
             whoever can restart it. Same gold as the map's pending note: it is
             the same fact — the room you picked is not the room you are in. -->
        <p v-if="live && canEdit && modePending" class="practice-note practice-note-pending">
          <i class="fas fa-clock" aria-hidden="true"></i>
          <span class="mode-pending-text">
            <template v-if="live.canRestart">
              <button type="button" class="mode-restart" id="practice-mode-restart"
                :class="{ confirming: confirmingModeRestart }" @click="restartForMode"
                v-tap="restartForMode">{{ confirmingModeRestart ? 'Chắc chưa?' : 'Chơi lại' }}</button>
              để áp dụng {{ modePending }} của chế độ này — luật và bot đã đổi ngay.
            </template>
            <template v-else>
              {{ modePending }} của chế độ này áp dụng cho trận sau — luật và bot đã đổi ngay.
            </template>
          </span>
        </p>
      </div>
    </PanelSection>

    <!-- The whole match under a name. Right after the mode, because it is the
         same kind of press — "give me this evening" — with the player's own
         evenings on the shelf instead of the game's. -->
    <PanelSection id="match-templates" title="Trận mẫu" :summary="templatesSummary">
      <div class="template-field" id="practice-templates">
        <p v-if="!templates.length" class="practice-note">
          Chưa có trận mẫu nào. Đặt tên rồi bấm lưu để giữ đội hình, cài đặt từng bot, trang bị và
          luật của thiết lập hiện tại — lần sau mở lại trong một lần bấm.
        </p>

        <ul v-if="templates.length" class="template-list">
          <li v-for="(template, i) in templates" :key="template.id" class="template-row">
            <template v-if="renamingId === template.id">
              <input
                type="text"
                class="template-name-input"
                :id="`practice-template-rename-input-${i}`"
                v-model="renameDraft"
                :maxlength="MATCH_TEMPLATE_NAME_MAX"
                @keydown.enter="commitRename"
                @keydown.esc="cancelRename"
              />
              <div class="template-actions">
                <button type="button" class="template-chip" :id="`practice-template-rename-commit-${i}`"
                  @click="commitRename" v-tap="commitRename">Lưu tên</button>
                <button type="button" class="template-chip" @click="cancelRename" v-tap="cancelRename">
                  Huỷ
                </button>
              </div>
            </template>

            <template v-else>
              <div class="template-main">
                <span class="template-title">
                  <strong class="template-name">{{ template.name }}</strong>
                  <span class="template-when">{{ formatWhen(template.savedAt, historyNow) }}</span>
                </span>
                <span class="template-meta">{{ templateMeta(template) }}</span>
                <!-- What this install cannot supply, before the press — the
                     apply itself skips these pieces quietly. -->
                <span v-if="templateGapLines.get(template.id)" class="template-gap" :id="`practice-template-gap-${i}`">
                  <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
                  {{ templateGapLines.get(template.id) }}
                </span>
              </div>
              <div class="template-actions">
                <!-- On the start screen the press is the whole point: apply and
                     boot. Everywhere else it is an apply — confirmed in a match,
                     where it replaces the roster standing on the map. -->
                <button
                  v-if="canStart && !live"
                  type="button"
                  class="template-chip template-start"
                  :id="`practice-template-start-${i}`"
                  :disabled="!canEdit || applyingTemplate"
                  @click="startTemplate(template)"
                  v-tap="() => startTemplate(template)"
                >
                  Bắt đầu
                </button>
                <button
                  v-else
                  type="button"
                  class="template-chip template-start"
                  :class="{ confirming: confirmingApplyId === template.id }"
                  :id="`practice-template-apply-${i}`"
                  :disabled="!canEdit || applyingTemplate"
                  @click="applyTemplate(template)"
                  v-tap="() => applyTemplate(template)"
                >
                  {{ live && confirmingApplyId === template.id ? 'Chắc chưa?' : 'Áp dụng' }}
                </button>
                <button type="button" class="template-chip" :id="`practice-template-rename-${i}`"
                  @click="startRename(template)" v-tap="() => startRename(template)">Đổi tên</button>
                <button
                  type="button"
                  class="template-chip"
                  :class="{ confirming: confirmingDeleteId === template.id }"
                  :id="`practice-template-delete-${i}`"
                  @click="removeTemplate(template)"
                  v-tap="() => removeTemplate(template)"
                >
                  {{ confirmingDeleteId === template.id ? 'Chắc chưa?' : 'Xoá' }}
                </button>
              </div>
            </template>
          </li>
        </ul>

        <div class="template-save">
          <input
            type="text"
            class="template-name-input"
            id="practice-template-name"
            v-model="templateName"
            :maxlength="MATCH_TEMPLATE_NAME_MAX"
            placeholder="Tên trận mẫu…"
            @keydown.enter="saveTemplate"
          />
          <button
            type="button"
            class="template-chip template-save-btn"
            id="practice-template-save"
            :disabled="!templateName.trim()"
            @click="saveTemplate"
            v-tap="saveTemplate"
          >
            <i class="fas fa-floppy-disk" aria-hidden="true"></i>
            Lưu thành trận mẫu
          </button>
        </div>

        <!-- Same vocabulary as the world switches' note: say what applies when.
             Only in a match — on the menu the apply and the boot are one press. -->
        <p v-if="live && canEdit && templates.length" class="practice-note">
          Áp dụng đổi ngay bot, cài đặt và trang bị; bản đồ của mẫu dành cho trận sau.
        </p>
      </div>
    </PanelSection>

    <PanelSection id="match-map" title="Bản đồ" :summary="mapSummary">
      <!-- A summary row that opens the picker, rather than the picker itself:
           the shape and the rules are why anyone picks a map, and neither
           fits in a card. Not disabled on a locked tab — a LAN client should
           still be able to look at the map it is about to play on; the modal
           refuses the *commit*, which is the half that was ever a permission.
           Not wrapped in `.pregame-field`: that rule sets `display: block` on
           every descendant `span`, wrong for the stacked lines in the row. -->
      <div class="map-field">
        <button type="button" id="practice-map-open" class="map-summary" @click="showMapPicker = true"
          v-tap="() => (showMapPicker = true)">
          <span class="map-summary-main">
            <strong>{{ selectedMapName }}</strong>
            <span class="map-summary-meta">
              {{ selectedMapMeta }}
              <template v-if="selectedMapRuleCount"> · {{ selectedMapRuleCount }} luật riêng</template>
            </span>
          </span>
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </button>

        <!-- Only in a match, only once the pick and the running map differ,
             and never on a locked tab: "cho trận sau" promises a next match
             this device does not choose. -->
        <p v-if="live && canEdit && selectedMapId !== liveMapId" class="practice-note practice-note-pending">
          <i class="fas fa-clock" aria-hidden="true"></i>
          Đã chọn <strong>{{ selectedMapName }}</strong> cho trận sau — trận đang chạy
          vẫn trên <strong>{{ liveMapName }}</strong>.
        </p>
      </div>
    </PanelSection>

    <PanelSection id="match-rules" title="Luật" :summary="rulesSummary">
      <label class="pregame-field" :class="{ locked: !canEdit }">
        <span>Giảm hồi chiêu:
          <strong id="practice-cdr-value">{{ rules.cooldownReductionPercent }}%</strong></span>
        <input type="range" id="practice-cdr" :min="CDR_PERCENT_MIN" :max="CDR_PERCENT_MAX" :step="CDR_PERCENT_STEP"
          :disabled="!canEdit" :value="rules.cooldownReductionPercent" @input="onCdrInput" @change="onCdrChange"
          @pointerdown="onCdrPointerDown" @pointerup="onCdrPointerUp" @pointercancel="onCdrPointerCancel" />
      </label>

      <label class="pregame-toggle" :class="{ locked: !canEdit }">
        <input type="checkbox" id="practice-urf" :disabled="!canEdit" :checked="rules.manaFree" @change="onUrfChange" />
        <span>URF (không tốn mana)</span>
      </label>

      <label class="pregame-toggle" :class="{ locked: !canEdit }">
        <input type="checkbox" id="practice-recall" :disabled="!canEdit" :checked="rules.recall" @change="onRecallChange" />
        <span>Hồi thành</span>
      </label>
    </PanelSection>

    <PanelSection id="match-world" title="Thế giới" :summary="worldSummary">
      <label class="pregame-toggle" :class="{ locked: !canEdit }">
        <input type="checkbox" id="practice-jungle" :disabled="!canEdit" :checked="world.jungle" @change="onJungleChange" />
        <span>Quái rừng</span>
      </label>

      <label class="pregame-toggle" :class="{ locked: !canEdit }">
        <input type="checkbox" id="practice-minions" :disabled="!canEdit" :checked="world.minions" @change="onMinionsChange" />
        <span>Lính</span>
      </label>

      <!-- Scoped to the two switches above it: CDR and URF are immediate. And
           only in a match — outside one there is no paused loop for anything
           to be waiting on. -->
      <p v-if="live && canEdit" class="practice-note">
        Quái rừng và lính: thay đổi có hiệu lực khi bạn đóng bảng và trận chạy tiếp.
      </p>
    </PanelSection>

    <!-- What the evenings added up to. After the controls, before the way
         out: it is about matches, not about this one. -->
    <PanelSection v-if="history.length" id="match-history" title="Trận gần đây" :summary="`${history.length} trận`">
      <div class="history-field" id="practice-history">
        <div class="history-head">
          <span class="history-count">{{ history.length }} trận</span>
          <button type="button" class="history-clear" :class="{ confirming: confirmingClearHistory }"
            id="practice-history-clear" @click="clearHistory" v-tap="clearHistory">
            {{ confirmingClearHistory ? 'Chắc chưa?' : 'Xoá lịch sử' }}
          </button>
        </div>
        <ul class="history-list">
          <li v-for="row in shownHistory" :key="row.id" class="history-row">
            <span class="history-champ">{{ row.championName }}</span>
            <span class="history-kda">
              <strong>{{ row.kills }}</strong>/<strong class="history-deaths">{{ row.deaths }}</strong>/<strong>{{ row.assists }}</strong>
              <span class="history-cs">· {{ row.cs }} CS</span>
            </span>
            <span class="history-meta">
              {{ matchModeFor(row.mode).name }} · {{ mapNameOf(row.mapId) }} · {{ formatDuration(row.durationMs) }}
            </span>
            <span class="history-when">{{ formatWhen(row.endedAt, historyNow) }}</span>
          </li>
        </ul>
        <button v-if="history.length > historyShown" type="button" class="history-more" id="practice-history-more"
          @click="historyShown += HISTORY_PAGE" v-tap="() => (historyShown += HISTORY_PAGE)">
          Xem thêm
        </button>
      </div>
    </PanelSection>

    <!-- Last in the flow and visually apart: the irreversible controls. See the
         file comment on why each is here and why both confirm. -->
    <div class="practice-tab-actions">
      <!-- Locked with the rest: it is the rules, the world, the map and the
           cheats in one press. The exit below it is never locked. -->
      <button type="button" class="practice-reset" :class="{ confirming: confirmingReset }"
        :disabled="resetting || !canEdit" id="practice-reset" @click="resetDefaults">
        <i class="fas fa-rotate-left" aria-hidden="true"></i>
        <span>{{ resetLabel }}</span>
      </button>

      <button v-if="live" type="button" class="practice-exit" :class="{ confirming: confirmingExit }" id="practice-exit"
        @click="exitMatch">
        <i class="fas fa-sign-out-alt" aria-hidden="true"></i>
        <span>{{ confirmingExit ? 'Chắc chưa?' : 'Thoát trận' }}</span>
      </button>

      <!-- Outside a match the equivalent is simply going back to the menu; it
           discards nothing, so it does not confirm. -->
      <button v-else type="button" class="practice-exit" id="pregame-back-btn" @click="emit('close')">
        <i class="fas fa-arrow-left" aria-hidden="true"></i>
        <span>Về menu</span>
      </button>
    </div>
  </div>

  <!-- Mounted last so its backdrop covers the tab, and `v-if` so a closed
       picker costs nothing — the preview it holds fetches a map's polygons. -->
  <MapPickerModal
    v-if="showMapPicker"
    :maps="maps"
    :selected-id="selectedMapId"
    :can-edit="canEdit"
    :load="id => source.loadMapGeometry(id)"
    :live-map-id="liveMapId"
    :can-restart="!!live?.canRestart"
    @pick="pickMap"
    @restart="restartMatch"
    @close="showMapPicker = false"
  />
</template>
