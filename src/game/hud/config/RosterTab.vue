<script setup lang="ts">
/**
 * The team tab: who is in this match, which side each is on, and every knob on
 * each of them — kit, AI behaviour, and the practice cheats.
 *
 * This is the tab the two old panels disagreed about most. The setup screen had
 * a flat participant list with no sides and one set of AI flags for every bot;
 * the practice panel had sides, per-bot flags and per-unit cheats. It is one
 * list now, and both surfaces get all of it — the config has carried
 * `ai.botTeams` and `ai.botBehaviours` since long before the setup screen ever
 * showed them.
 *
 * ## Grouped by side, and the side is editable
 *
 * Đội Xanh and Đội Đỏ, in roster order within each. Every champion — the player
 * included — carries a switch that moves it to the other side. In a match that
 * is a real reassignment rather than a label: everything that reads a side reads
 * `teamId` at query time, so the fountain a unit respawns at, ally-from-enemy
 * targeting, turret protection and the fog's ally-vision all follow the moment
 * the switch is pressed.
 *
 * ## What a row *is* differs; what a row *shows* does not
 *
 * Outside a match a row is an entry in the stored config and removing one is an
 * array splice. Inside, it is a live unit holding a quadtree slot, a path agent
 * and a spell list mid-cooldown. `MatchConfigSource` is what makes both render
 * from the same markup — and it is also where the one difference that *must*
 * survive is written down: the row's title is the champion standing on the map
 * in a match, and the **loadout** outside one. Reading a rolled champion back
 * as a setting would silently pin a bot that is meant to keep re-rolling.
 *
 * ## What lands when
 *
 * In a match, add and remove need `ObjectManager.update()` — which flushes
 * `_objectToBeAdd` and sweeps `toRemove`, and cannot run until the panel closes.
 * The roster shows them immediately anyway, because the source counts both sets;
 * the note at the bottom says so. A team switch and the cheats are instant: they
 * read live fields the paused loop does not gate. Outside a match everything is
 * immediate, and the note hides.
 */
import { computed, inject, ref, shallowRef } from 'vue';
import { CONFIG_PANEL } from './panelState';
import { vTap } from '../tapGuard';
import { expandedRosterRows } from './expandedRows';
import type { ConfigRosterEntry, RosterItem } from './MatchConfigSource';
import {
  AI_COUNT_MAX,
  BOT_DIFFICULTY_ORDER,
  type BotDifficulty,
  type ChampionLoadout,
} from '@/game/config/PregameConfig';
import { MatchTeam, type MatchTeamId } from '@/game/config/MatchTeams';
import type { SpellDisplay } from '@/game/config/spellCatalog';
import {
  acceptPeerPack,
  forgetPeerPack,
  peerPackOrigin,
  peerPacks,
  peerPacksDismissed,
} from '@/content/peerPacks';
import LoadoutEditorModal from '@/scenes/setup/LoadoutEditorModal.vue';
import SpellDetailPane from '@/scenes/setup/SpellDetailPane.vue';

const panel = inject(CONFIG_PANEL)!;
const source = panel.source;

/** Read for the dependency, not for the value — see `panelState.ts`. */
const roster = computed<ConfigRosterEntry[]>(() => {
  void panel.version.value;
  return source.roster();
});

const live = computed(() => {
  void panel.version.value;
  return source.live;
});

/**
 * The roster and the practice cheats belong to the match, and on a LAN client
 * the match belongs to its host — `MatchConfigSource.canEditMatchSettings`.
 * Bất tử, hồi đầy, xoá hồi chiêu, vàng, đồ and the stack counters all write
 * straight into a simulation the host owns; a bot added here would walk a lane
 * only this device could see.
 *
 * The kit and side switches are deliberately *not* gated: those two cross the
 * wire as a request and come back as the host's own change. Neither is the
 * remove button, and it needs no gate of its own — it already hides on the
 * player's row and on every `remote` one, which on a client is every row there
 * is. The source refuses anyway.
 */
const canEditMatch = source.canEditMatchSettings;

const TEAMS: { id: MatchTeamId; name: string; modifier: string }[] = [
  { id: MatchTeam.BLUE, name: 'Đội Xanh', modifier: 'blue' },
  { id: MatchTeam.RED, name: 'Đội Đỏ', modifier: 'red' },
];

/** Both sides, always shown — an empty side still names itself so a unit has a place to go. */
const teams = computed(() =>
  TEAMS.map(team => ({ ...team, rows: roster.value.filter(row => row.team === team.id) }))
);

const botCount = computed(() => {
  void panel.version.value;
  return source.botCount();
});
const atCap = computed(() => !source.canAddBot() && botCount.value >= AI_COUNT_MAX);

const addingBot = ref(false);
const addDisabled = computed(() => addingBot.value || !source.canAddBot());

/**
 * Adding is per side, from the button at the end of that side's list — so the
 * bot lands where the player pressed rather than wherever a balancer put it.
 *
 * `addingBot` is shared by both buttons on purpose: a mid-match add has to
 * fetch a champion's kit, and `MatchDirector.addBotLoaded` de-duplicates
 * concurrent calls into one promise. Two enabled buttons would let a quick
 * second press be silently folded into the first — and land on the wrong side.
 */
const addBot = async (team: MatchTeamId): Promise<void> => {
  if (addingBot.value) return;
  addingBot.value = true;
  try {
    await source.addBot(team);
    panel.invalidate();
  } finally {
    addingBot.value = false;
  }
};

const removeBot = (row: ConfigRosterEntry): void => {
  source.removeBot(row.id);
  panel.invalidate();
};

const otherTeam = (team: MatchTeamId): MatchTeamId =>
  team === MatchTeam.BLUE ? MatchTeam.RED : MatchTeam.BLUE;

const teamNameOf = (team: MatchTeamId): string =>
  TEAMS.find(entry => entry.id === team)?.name ?? '';

const switchTeam = (row: ConfigRosterEntry): void => {
  source.setTeam(row.id, otherTeam(row.team));
  panel.invalidate();
};

/** The three booleans only: `difficulty` is the same record's fourth field and has its own row. */
type BehaviourFlag = 'autoMove' | 'autoAttack' | 'autoCast';

const BEHAVIOUR_FLAGS: { key: BehaviourFlag; label: string }[] = [
  { key: 'autoMove', label: 'Tự di chuyển' },
  { key: 'autoAttack', label: 'Tự tấn công' },
  { key: 'autoCast', label: 'Tự dùng kỹ năng' },
];

const onFlagChange = (row: ConfigRosterEntry, flag: BehaviourFlag, event: Event): void => {
  source.setBotBehaviour(row.id, { [flag]: (event.target as HTMLInputElement).checked });
  panel.invalidate();
};

/**
 * How well this one bot plays — `BOT_DIFFICULTY_ORDER` is the config's own copy
 * of the three tiers, easiest first. It is deliberately *not*
 * `BOT_DIFFICULTIES` from `game/ai/Difficulty.ts`: that is a runtime value in
 * the match chunk, and this panel is mounted over the menu, where importing it
 * would fetch and parse the whole game before the logo (`matchConfigChunk` and
 * `pregameBootPath` are the two tests that say so).
 *
 * The labels live here rather than beside the tiers because they are this
 * screen's words, the same way `SettingsTab`'s debug-layer labels are. A
 * `Record<BotDifficulty, string>` is what makes a fourth tier a compile error
 * here instead of a blank button — that much `vue-tsc` does check, unlike the
 * `v-if` guard below it (`strict: false`, so no `strictNullChecks`).
 */
const DIFFICULTY_LABELS: Record<BotDifficulty, string> = {
  easy: 'Dễ',
  normal: 'Thường',
  hard: 'Khó',
};

/**
 * Both handlers, on purpose. `GameScene` calls `preventDefault()` on every
 * touch on the page, so the browser synthesises no trailing `click` and a
 * `@click`-only button is dead under a thumb while being perfect under a mouse
 * — the `.prevent` on the touch half then stops the pair firing twice where the
 * click *is* synthesised. `tests/game/hud/rosterTabDifficulty.test.ts` checks
 * both are still there and still reach this same call.
 */
const setDifficulty = (row: ConfigRosterEntry, difficulty: BotDifficulty): void => {
  source.setBotBehaviour(row.id, { difficulty });
  panel.invalidate();
};

/**
 * Which cards have their drawer open — module state, not a `ref` here.
 *
 * A `const` at the top of `<script setup>` is rebuilt on every mount, and both
 * HUD views mount this panel with `v-if`, so every drawer used to close itself
 * every time the panel did. See `expandedRows.ts`; `panelTab.ts` is the same
 * decision one file over.
 */
const isExpanded = (row: ConfigRosterEntry): boolean => expandedRosterRows.value.has(row.id);

const toggleExpanded = (row: ConfigRosterEntry): void => {
  // A new Set rather than mutating in place: `ref` tracks the reference, and a
  // `Set` mutated through it does not notify.
  const next = new Set(expandedRosterRows.value);
  if (!next.delete(row.id)) next.add(row.id);
  expandedRosterRows.value = next;
};

// ------------------------------------------------------------------- cheats

const onInvulnerableChange = (row: ConfigRosterEntry, event: Event): void => {
  source.setInvulnerable(row.id, (event.target as HTMLInputElement).checked);
  panel.invalidate();
};

const refill = (row: ConfigRosterEntry): void => {
  live.value?.refill(row.id);
  panel.invalidate();
};

const clearCooldowns = (row: ConfigRosterEntry): void => {
  live.value?.clearCooldowns(row.id);
  panel.invalidate();
};

const stacksOf = (row: ConfigRosterEntry) => {
  void panel.version.value;
  return live.value?.stacksOf(row.id) ?? [];
};

const addStacks = (row: ConfigRosterEntry, spellId: string, amount: number): void => {
  live.value?.addStacks(row.id, spellId, amount);
  panel.invalidate();
};

const clearStacks = (row: ConfigRosterEntry, spellId: string): void => {
  live.value?.clearStacks(row.id, spellId);
  panel.invalidate();
};

const STACK_STEPS = [1, 10, 100];

/**
 * The gold cheat's steps.
 *
 * Buttons rather than a text field, and relative rather than absolute, for the
 * same reason `STACK_STEPS` is: this panel has to work under a thumb on a
 * phone, where opening a keyboard over a modal to type "2500" is a control
 * that does not work.
 *
 * A component and a finished item was the original pairing, and it was the
 * wrong pair for what the buttons are actually used for: nobody cheats gold to
 * buy one component. They cheat it to skip to a build, and 200 at a time is
 * twenty taps to get there. A finished item and a whole build is the pairing
 * that matches — one tap to shop, five taps to be done shopping for the match.
 */
const GOLD_STEPS = [1_000, 5_000];

const goldOf = (row: ConfigRosterEntry): number => {
  void panel.version.value;
  return live.value?.goldOf(row.id) ?? 0;
};

const grantGold = (row: ConfigRosterEntry, amount: number): void => {
  live.value?.grantGold(row.id, amount);
  panel.invalidate();
};

const itemStock = computed(() => {
  void panel.version.value;
  return live.value?.itemStock() ?? [];
});

/**
 * The six squares on the row. A per-row call rather than a `computed`, like
 * `scoreOf` and `stacksOf` beside it: there is one of these per participant,
 * and `panel.version` is the single dependency every one of them re-reads on.
 */
const itemsOf = (row: ConfigRosterEntry) => {
  void panel.version.value;
  return live.value?.itemsOf(row.id) ?? [];
};

/**
 * Hand this unit the shop.
 *
 * No `panel.invalidate()`: the panel is being closed, not repainted — see
 * `MatchConfigSource.openShopFor`, which also unpauses on the way out because
 * the shop deliberately does not pause and two full-width panels do not fit in
 * 390px.
 */
const openShop = (row: ConfigRosterEntry): void => {
  live.value?.openShopFor(row.id);
};

/**
 * Which bag square is open, if any — one at a time, across the whole roster.
 *
 * The squares used to carry a `title` and nothing else, on the argument that a
 * shop-sized description belongs in the shop and the shop is one button away.
 * That argument is about *your own* bag. This tab is the only place a player
 * sees what the other nine champions are carrying, the shop button beside a
 * row opens a shop to *buy* in rather than a way to read what is already
 * owned, and a hover title does not exist under a thumb at all.
 *
 * Held as `{ rowId, slot }` rather than as a flag on the row: rows are rebuilt
 * from the source on every `panel.version` bump, so anything stored on one is
 * gone the next time a bot buys something.
 */
const openedItem = ref<{ rowId: string; slot: number } | null>(null);

const isItemOpen = (row: ConfigRosterEntry, slot: number): boolean =>
  openedItem.value?.rowId === row.id && openedItem.value?.slot === slot;

const toggleItem = (row: ConfigRosterEntry, slot: number, item: RosterItem): void => {
  // One card at a time: a bag square and a kit icon open into the same strip
  // between the row and its stat sheet, so opening either closes the other.
  openedSpell.value = null;
  // An empty square has nothing to say. Tapping one closes whatever is open,
  // which is also the way out of the card without hunting for its own corner.
  if (!item.filled) {
    openedItem.value = null;
    return;
  }
  openedItem.value = isItemOpen(row, slot) ? null : { rowId: row.id, slot };
};

/** The open square's contents, re-read from the live bag rather than remembered. */
const openedItemOf = (row: ConfigRosterEntry): RosterItem | null => {
  const open = openedItem.value;
  if (!open || open.rowId !== row.id) return null;
  const item = itemsOf(row)[open.slot];
  // Sold, swapped or replaced while the card was open: the slot is still a
  // slot, so this asks the bag rather than trusting what was there.
  return item?.filled ? item : null;
};

const clearItems = (row: ConfigRosterEntry): void => {
  live.value?.clearItems(row.id);
  panel.invalidate();
};

const scoreOf = (row: ConfigRosterEntry) => {
  void panel.version.value;
  return live.value?.scoreOf(row.id) ?? { kills: 0, deaths: 0, cs: 0 };
};

const statGroupsOf = (row: ConfigRosterEntry) => {
  void panel.version.value;
  return live.value?.statGroupsOf(row.id) ?? [];
};

// ----------------------------------------------------------- ability preview
//
// A kit icon is a description, in both places. It used to be one only on the
// setup screen — in the panel the same icons were decorative — which is one of
// the divergences this rewrite closes. The row is a transparent full-width
// button with the icons as real buttons stacked above it (`position: relative`,
// so they win the click), the shape `ParticipantCard.vue` used: a nested
// `<button>` is not valid markup.

/**
 * Which ability's card is open — `{ rowId, letter }`, the same shape as
 * `openedItem` above and held for the same reason: rows are rebuilt from the
 * source on every `panel.version` bump, so anything stored on one is gone the
 * next time a bot buys something.
 *
 * ## It was a modal holding a snapshot, and both halves were wrong
 *
 * A dialog over the list, to read one paragraph about one spell, while the
 * bag square directly beside it answered the same kind of question by opening
 * a card *in* the list. Two shapes for one act, and the heavier of the two on
 * the lighter question — reported as "sao ko dùng chung slot detail inline
 * của item luôn". So the kit icon now opens into the same strip the bag
 * square does, and reuses `SpellDetailPane` exactly as the modal did.
 *
 * The state is the *identity* of the open ability rather than a resolved
 * `SpellDisplay`, which is the half that fixes the numbers: a display taken
 * once at open time is a description that stops being true the moment the
 * champion buys the ability power it quotes. `openedSpellOf` re-describes on
 * every read, the way `openedItemOf` re-reads the bag.
 */
const openedSpell = ref<{ rowId: string; letter: string } | null>(null);

const isSpellOpen = (row: ConfigRosterEntry, letter: string): boolean =>
  openedSpell.value?.rowId === row.id && openedSpell.value?.letter === letter;

const toggleSpell = (row: ConfigRosterEntry, letter: string): void => {
  const open = isSpellOpen(row, letter);
  openedItem.value = null;
  openedSpell.value = open ? null : { rowId: row.id, letter };
};

/**
 * The open ability, re-described from the live spell rather than remembered.
 *
 * `void panel.version.value` is what makes the numbers move: the panel bumps
 * on its own tick, so an item bought while this card is open redraws it with
 * the damage that item just paid for.
 */
const openedSpellOf = (row: ConfigRosterEntry): SpellDisplay | null => {
  void panel.version.value;
  const open = openedSpell.value;
  if (!open || open.rowId !== row.id) return null;
  return source.describeAbility(row.id, open.letter);
};

// ------------------------------------------------------------ loadout editor

const editing = shallowRef<ConfigRosterEntry | null>(null);
/** Which slot the editor opens on. Q by default, the way the editor itself defaults. */
const editingSlot = shallowRef(1);

const openEditor = (row: ConfigRosterEntry, slot = 1): void => {
  editing.value = row;
  editingSlot.value = slot;
};

const editingLoadout = computed<ChampionLoadout>(() =>
  editing.value ? source.loadoutOf(editing.value.id) : source.roster()[0].loadout
);

const applyLoadout = async (loadout: ChampionLoadout): Promise<void> => {
  const row = editing.value;
  if (!row) return;
  editing.value = null;
  await source.applyLoadout(row.id, loadout);
  panel.invalidate();
};

/**
 * The shell routes Escape here first; see `MatchConfigPanel.vue`. Returns
 * whether there was an inner layer to close, so Escape falls through to the
 * panel when there was not.
 */
defineExpose({
  closeEditor: (): boolean => {
    // The ability card is deliberately not a layer here, exactly as the bag
    // square's card is not: both are rows in the list rather than something
    // over it, and Escape with one open should close the panel the way it
    // does with an item card open.
    if (!editing.value) return false;
    editing.value = null;
    return true;
  },
});

/**
 * ## The editor is teleported out of the panel, and it has to be
 *
 * `.practice-panel` is `position: fixed` *with a transform* (it is centred with
 * `translate(-50%, -50%)`), and a transform makes an element the containing
 * block for its `position: fixed` descendants. Rendered in place, the editor's
 * `.pregame-modal-backdrop` — `position: fixed; inset: 0` — would resolve
 * `inset: 0` against the panel's box instead of the viewport: a "full-screen"
 * backdrop the size of the panel, with the dialog overflowing it.
 *
 * Teleporting to `<body>` puts both back in the viewport's coordinate space and
 * in the root stacking context. The host is `display: contents` so it adds no
 * box of its own.
 */
</script>

<template>
  <div class="practice-tab-body practice-roster-body">
    <!-- Why the add button and the Luyện tập drawer are missing. Says what a
         client *can* still do, because that half is the surprising one: the
         kit and side switches on its own row are real, and go through the
         host. -->
    <p v-if="!canEditMatch" class="practice-note practice-note-locked">
      <i class="fas fa-lock" aria-hidden="true"></i>
      Trận đấu mạng: đội hình do <strong>chủ phòng</strong> quyết. Bạn vẫn đổi được tướng và phe của
      mình.
    </p>

    <!-- What a client brought that this machine has never downloaded.
         Deliberately an offer and not an install: a pack is spell code, and a
         room code is all it takes to join. The origin is shown because it is
         the part worth reading before pressing. See `content/peerPacks.ts`. -->
    <section v-if="canEditMatch && !peerPacksDismissed && peerPacks.length" id="peer-pack-offer"
      class="practice-note peer-pack-offer" role="alert">
      <p>
        Người chơi khác đang dùng nội dung máy bạn chưa có — tướng của họ hiện ô chữ cái thay
        vì ảnh.
      </p>
      <div v-for="pack in peerPacks" :key="pack.manifestUrl" class="peer-pack-row">
        <span class="peer-pack-origin">{{ peerPackOrigin(pack.manifestUrl) }}</span>
        <span v-if="pack.failed" class="peer-pack-failed">Tải không được</span>
        <button type="button" class="peer-pack-accept" :disabled="pack.installing"
          @click="acceptPeerPack(pack.manifestUrl)"
          @touchend.prevent="acceptPeerPack(pack.manifestUrl)">
          {{ pack.installing ? 'Đang tải…' : pack.failed ? 'Thử lại' : 'Cài pack này' }}
        </button>
        <button type="button" class="peer-pack-skip" @click="forgetPeerPack(pack.manifestUrl)"
          @touchend.prevent="forgetPeerPack(pack.manifestUrl)">
          Bỏ qua
        </button>
      </div>
      <button type="button" class="peer-pack-dismiss" @click="peerPacksDismissed = true"
        @touchend.prevent="peerPacksDismissed = true">
        Không hỏi lại trận này
      </button>
    </section>

    <section
      v-for="team of teams"
      :key="team.id"
      class="practice-team"
      :class="`practice-team--${team.modifier}`"
    >
      <header class="practice-team-header">
        <span class="practice-team-dot" aria-hidden="true"></span>
        <span class="practice-team-name">{{ team.name }}</span>
        <span class="practice-team-count">{{ team.rows.length }}</span>
      </header>

      <p v-if="team.rows.length === 0" class="practice-team-empty">Chưa có ai bên này.</p>

      <div
        v-for="row of team.rows"
        :key="row.id"
        class="practice-roster-row"
        :class="{ 'is-player': row.isPlayer }"
      >
        <!-- `has-bag` is a layout fact the stylesheet cannot work out for
             itself: with a bag the row becomes a two-line grid (identity and
             numbers above, the item strip below, one action rail beside both
             — see hud.css's "The in-match row, gridded"), because the
             one-line flex row never fit that much fixed content and the kit
             icons painted under the item strip. With no bag there is no
             second line and the row stays the one-line flex it always was —
             the shape the menu always sees, since items only exist inside a
             match. -->
        <div class="practice-roster-main" :class="{ 'has-bag': live && itemStock.length }">
          <!-- The invisible "open the editor" button covers the identity zone
               and *only* it — never the toggle, the side switch or the delete
               beside them. That was the objection to this shape when the row
               was built (an invisible sheet across a row full of controls is an
               overlapping tap target); scoped to the portrait and the name it
               is the same situation `ParticipantCard` used it in, where the
               only things stacked over it are the kit icons. -->
          <div class="practice-roster-identity">
            <button
              v-if="!row.remote"
              type="button"
              class="practice-roster-open"
              :aria-label="`Đổi tướng của ${row.label}`"
              @click="openEditor(row)"
            ></button>

            <span
              class="practice-roster-portrait"
              :class="{ 'is-empty': !row.avatarUrl }"
              aria-hidden="true"
            >
              <img crossorigin="anonymous" v-if="row.avatarUrl" :src="row.avatarUrl" alt="" />
              <i v-else class="fas fa-random"></i>
            </span>

            <span class="practice-roster-text">
              <span class="practice-roster-label">
                {{ row.label }}
                <!-- Legible without opening anything: cheats persist now, so a
                     player can come back days later to a match they do not
                     remember configuring. -->
                <i
                  v-if="row.invulnerable"
                  class="fas fa-shield-halved practice-roster-badge"
                  title="Đang bất tử"
                  :data-invulnerable="row.id"
                ></i>
              </span>
              <span class="practice-roster-name">{{ row.title }}</span>
              <span class="practice-roster-spells">
                <button
                  v-for="ability of row.abilities"
                  :key="ability.letter"
                  type="button"
                  class="practice-roster-spell"
                  :class="{
                    'is-inert': !ability.describable,
                    'is-open': isSpellOpen(row, ability.letter),
                  }"
                  :title="ability.describable ? 'Xem mô tả chiêu' : ability.letter"
                  :aria-expanded="
                    ability.describable ? isSpellOpen(row, ability.letter) : undefined
                  "
                  @click="ability.describable && toggleSpell(row, ability.letter)"
                  v-tap="() => ability.describable && toggleSpell(row, ability.letter)"
                >
                  <img crossorigin="anonymous" v-if="ability.url" :src="ability.url" alt="" />
                  <span v-else class="practice-roster-spell-empty">{{ ability.letter }}</span>
                </button>
              </span>
            </span>
          </div>

          <!--
            The bag, on the row itself.

            The drawer below is where this would naturally have gone — the gold
            cheat and the shop button are already there — and that would have
            shown the items while missing the point of showing them: reading
            two champions' builds against each other takes both being visible
            at once, without opening anything. It also fills the dead strip
            that sat between the name and the KDA at any width above a phone.

            Always six squares, empty ones drawn as sunken frames. See
            `RosterItem`: a strip as wide as the champion is fed would shift
            the numbers beside it every time anyone bought anything.

            Inert, unlike the ability icons above — an item's stats and its
            recipe are a shop-sized description, and the shop is one button
            away in the drawer. The name in a `title` is what a square owes.

            Behind `itemStock.length`, the same guard the Cửa hàng button in
            the drawer carries: an empty *bag* is worth drawing, an empty
            *shelf* is not. A pack that predates items has nothing that could
            ever land in these frames, and six dashed squares under every name
            would be the row explaining a feature that build does not have.
          -->
          <span v-if="live && itemStock.length" class="practice-roster-items">
            <!--
              A `<button>`, not the `<span>` this was: it opens a card now, and
              a control that only answers a mouse click is one a keyboard and a
              screen reader cannot reach. `v-tap` beside `@click` for the reason
              every other control in this file carries it — `GameScene` cancels
              every touch on the page, so a `@click`-only control is perfect
              under a mouse and dead under a thumb.
            -->
            <button
              v-for="(item, slot) of itemsOf(row)"
              :key="slot"
              type="button"
              class="practice-roster-item"
              :class="{ 'is-empty': !item.filled, 'is-open': isItemOpen(row, slot) }"
              :title="item.name || undefined"
              :aria-expanded="item.filled ? isItemOpen(row, slot) : undefined"
              :aria-label="item.filled ? `Chi tiết ${item.name}` : 'Ô trống'"
              @click="toggleItem(row, slot, item)"
              v-tap="() => toggleItem(row, slot, item)"
            >
              <img crossorigin="anonymous" v-if="item.url" :src="item.url" alt="" />
            </button>
          </span>

          <!-- KDA doubles as the drawer toggle in a match; outside one there is
               no score to show, so the caret carries the drawer on its own.
               The wallet rides in the same cell, above the score: both are
               numbers about this champion, and grouping them leaves the whole
               middle of the row to the bag. -->
          <button
            type="button"
            class="practice-stat-toggle"
            :id="`practice-row-toggle-${row.index}`"
            :aria-expanded="isExpanded(row)"
            :aria-label="`Chỉ số và luyện tập của ${row.label}`"
            @click="toggleExpanded(row)"
          >
            <span v-if="live" class="practice-roster-gold">
              <i class="fas fa-coins" aria-hidden="true"></i>
              {{ goldOf(row) }}
            </span>
            <span v-if="live" class="practice-score">
              <span class="practice-score-k">{{ scoreOf(row).kills }}</span>
              <span class="practice-score-sep">/</span>
              <span class="practice-score-d">{{ scoreOf(row).deaths }}</span>
              <span class="practice-score-sep">/</span>
              <span class="practice-score-cs">{{ scoreOf(row).cs }}</span>
            </span>
            <i
              class="fas practice-stat-caret"
              :class="isExpanded(row) ? 'fa-chevron-up' : 'fa-chevron-down'"
              aria-hidden="true"
            ></i>
          </button>

          <!-- Both hidden on a LAN row: its side and its existence belong to
               the machine actually driving it, and a control that no-ops is
               worse than none. -->
          <button
            v-if="!row.remote"
            type="button"
            class="practice-team-switch"
            :aria-label="`Chuyển ${row.label} sang ${teamNameOf(otherTeam(row.team))}`"
            :title="`Chuyển sang ${teamNameOf(otherTeam(row.team))}`"
            @click="switchTeam(row)"
          >
            <i class="fas fa-right-left" aria-hidden="true"></i>
          </button>

          <button
            v-if="!row.isPlayer && !row.remote"
            type="button"
            class="practice-remove-bot"
            :aria-label="`Xoá ${row.label}`"
            title="Xoá bot này"
            @click="removeBot(row)"
          >
            <i class="fas fa-times"></i>
          </button>
          <!-- The player cannot be deleted. In the menu's one-line flex row
               this spacer keeps the columns of neighbouring rows aligned —
               without it one row just ends 44px early. The in-match grid
               (`has-bag`) hides it instead: grid tracks align by
               construction, and the switch takes the whole rail on the one
               row that has no delete. -->
          <span v-else class="practice-roster-gap" aria-hidden="true"></span>
        </div>

        <!--
          The open square's card, between the row and its stat sheet.

          The shop's own pane (`shop/ShopDetail.vue`) is not reused: that one
          buys and sells, prices against the champion's wallet and draws the
          whole build tree, and every one of those is wrong here — this is a
          read of somebody else's bag. What is left is what a player is
          actually asking, in the order they ask it: what is it, what does it
          give, what does it do.
        -->
        <div v-if="openedItemOf(row)" class="practice-item-card">
          <div class="practice-item-head">
            <img
              crossorigin="anonymous"
              v-if="openedItemOf(row)!.url"
              :src="openedItemOf(row)!.url"
              alt=""
            />
            <h4>{{ openedItemOf(row)!.name }}</h4>
            <span v-if="openedItemOf(row)!.cost > 0" class="practice-item-cost">
              <i class="fas fa-coins" aria-hidden="true"></i>
              {{ openedItemOf(row)!.cost }}
            </span>
          </div>
          <!-- One stat to a line, in the shop card's own order and through the
               shop card's own builder (`itemStatLines.ts`), so the same item
               never reads two ways in two panels. -->
          <ul v-if="openedItemOf(row)!.stats.length" class="practice-item-stats">
            <li v-for="line of openedItemOf(row)!.stats" :key="line.label">
              <span class="practice-item-amount">{{ line.amount }}</span> {{ line.label }}
            </li>
          </ul>
          <p
            v-if="openedItemOf(row)!.description"
            class="practice-item-body"
            v-html="openedItemOf(row)!.description"
          ></p>
        </div>

        <!--
          The kit icon's card, in the same strip and directly under the same
          rule as the bag square's above it: one open at a time, full width,
          between the row and its stat sheet.

          `SpellDetailPane` is the pregame screen's own — the component the
          modal this replaces was already wrapping — so a spell reads the same
          here, in the loadout editor's peek panel, and on the setup screen.
        -->
        <div v-if="openedSpellOf(row)" class="practice-spell-card">
          <SpellDetailPane :display="openedSpellOf(row)" placeholder="" />
        </div>

        <div v-if="isExpanded(row)" class="practice-stat-sheet">
          <!-- Live only: a stat sheet with no unit behind it would be a column
               of zeroes pretending to be a reading. -->
          <div v-if="live" class="practice-stat-columns">
            <section
              v-for="group of statGroupsOf(row)"
              :key="group.title"
              class="practice-stat-group"
            >
              <h4 class="practice-stat-title">{{ group.title }}</h4>
              <div v-for="stat of group.rows" :key="stat.label" class="practice-stat-row">
                <span class="practice-stat-label">
                  <i
                    class="fas practice-stat-icon"
                    :class="stat.icon"
                    :style="stat.tint ? { color: stat.tint } : undefined"
                    aria-hidden="true"
                  ></i>
                  {{ stat.label }}
                </span>
                <!-- `tint` is a legend, not decoration: the two resistances
                     wear the colour of the damage each one stops, which is the
                     only thing on screen that says what the amber, violet and
                     white floating numbers mean. See `StatRow.tint`. -->
                <span
                  class="practice-stat-value"
                  :style="stat.tint ? { color: stat.tint } : undefined"
                  >{{ stat.value }}</span
                >
              </div>
            </section>
          </div>

          <!-- No cheats on a LAN row — the drawer keeps the stat sheet, which
               is the half a spectator can actually use. And none anywhere on a
               LAN *client*, whose own row is the one row here that is not
               `remote`: every control in this group writes into the host's
               simulation. See `canCheat`. -->
          <section v-if="!row.remote && canEditMatch" class="practice-cheat-group">
            <h4 class="practice-stat-title">Luyện tập</h4>

            <!-- Bots only: how the AI plays this champion. The player drives its
                 own movement, attacks and casts and has none. -->
            <div v-if="row.behaviour" class="practice-cheat-behaviour">
              <label
                v-for="flag of BEHAVIOUR_FLAGS"
                :key="flag.key"
                class="pregame-toggle practice-cheat-flag"
              >
                <input
                  type="checkbox"
                  :checked="row.behaviour[flag.key]"
                  @change="onFlagChange(row, flag.key, $event)"
                />
                <span>{{ flag.label }}</span>
              </label>

              <!-- Inside the same `v-if`, so the tier is offered exactly where a
                   behaviour exists to hold it: the player's row has none, and
                   nothing but this guard says so — `strict: false` means
                   `row.behaviour.difficulty` compiles anywhere. A scan test
                   holds it here. `v-tap` beside `@click` because `GameScene`
                   cancels every touch on the page, and a bare `@touchend`
                   would also fire for the touchend of a scroll — see
                   `tapGuard.ts`. -->
              <div class="practice-difficulty" role="group" aria-label="Trình độ">
                <span class="practice-difficulty-title">Trình độ</span>
                <span class="practice-difficulty-row">
                  <button
                    v-for="tier of BOT_DIFFICULTY_ORDER"
                    :key="tier"
                    type="button"
                    class="practice-difficulty-btn"
                    :class="{ selected: row.behaviour.difficulty === tier }"
                    :id="`practice-difficulty-${tier}-${row.index}`"
                    :aria-pressed="row.behaviour.difficulty === tier"
                    @click="setDifficulty(row, tier)"
                    v-tap="() => setDifficulty(row, tier)"
                  >
                    {{ DIFFICULTY_LABELS[tier] }}
                  </button>
                </span>
              </div>
            </div>

            <label class="pregame-toggle practice-cheat-invuln">
              <input
                type="checkbox"
                :id="`practice-cheat-invuln-${row.index}`"
                :checked="row.invulnerable"
                @change="onInvulnerableChange(row, $event)"
              />
              <span>Bất tử</span>
            </label>

            <!-- Actions on a unit, so there is nothing to press before a match
                 starts and nothing to store about them. -->
            <div v-if="live" class="practice-cheat-actions">
              <button
                type="button"
                class="practice-cheat-btn"
                :id="`practice-cheat-refill-${row.index}`"
                @click="refill(row)"
              >
                Hồi đầy
              </button>
              <button
                type="button"
                class="practice-cheat-btn"
                :id="`practice-cheat-cooldowns-${row.index}`"
                @click="clearCooldowns(row)"
              >
                Xoá hồi chiêu
              </button>
            </div>

            <!--
              Gold and items: the two cheats that exist because bots do not buy
              anything. The player earns gold and shops; a bot earns gold and
              has nowhere to spend it, so a match drifts one-sided a few
              minutes in. Until the AI has a shop of its own this row is the
              way to a fair fight — and it is deliberately manual, so it does
              not pre-empt what that AI should eventually decide for itself.

              `v-tap` beside every `@click`: `GameScene` cancels every touch
              on the page, so a `@click`-only button is dead under a thumb —
              and a bare `@touchend` fired for scrolls too, which is what
              `tapGuard.ts` tells apart.
            -->
            <div v-if="live" class="practice-cheat-stack">
              <span class="practice-cheat-stack-name">
                Vàng
                <strong class="practice-cheat-stack-count">{{ goldOf(row) }}</strong>
              </span>
              <span class="practice-cheat-stack-actions">
                <button
                  v-for="step of GOLD_STEPS"
                  :key="step"
                  type="button"
                  class="practice-cheat-btn"
                  :id="`practice-cheat-gold-${step}-${row.index}`"
                  @click="grantGold(row, step)"
                  v-tap="() => grantGold(row, step)"
                >
                  +{{ step }}
                </button>
              </span>
            </div>

            <!-- Nothing to show when no installed pack sells anything, which
                 is every pack that predates items. -->
            <!-- The real shop, aimed at this unit: its gold, its bag, its
                 recipes. It replaced a `<select>` of item names plus a "Cho",
                 which handed items over free and could show neither a stat
                 line nor a build path — and which quietly made the gold
                 buttons above it decorative, since nothing in the panel spent
                 any. Hidden when no installed pack sells anything. -->
            <div v-if="live && itemStock.length" class="practice-cheat-item">
              <span class="practice-cheat-stack-actions">
                <button
                  type="button"
                  class="practice-cheat-btn"
                  :id="`practice-cheat-shop-${row.index}`"
                  @click="openShop(row)"
                  v-tap="() => openShop(row)"
                >
                  <i class="fas fa-store" aria-hidden="true"></i>
                  Cửa hàng
                </button>
                <button
                  type="button"
                  class="practice-cheat-btn"
                  @click="clearItems(row)"
                  v-tap="() => clearItems(row)"
                >
                  Xoá đồ
                </button>
              </span>
            </div>

            <div
              v-for="stack of stacksOf(row)"
              :key="stack.spellId"
              class="practice-cheat-stack"
              :data-cheat-stack="stack.spellId"
            >
              <span class="practice-cheat-stack-name">
                {{ stack.name }}
                <strong class="practice-cheat-stack-count">{{ stack.count }}</strong>
              </span>
              <span class="practice-cheat-stack-actions">
                <button
                  v-for="step of STACK_STEPS"
                  :key="step"
                  type="button"
                  class="practice-cheat-btn"
                  @click="addStacks(row, stack.spellId, step)"
                >
                  +{{ step }}
                </button>
                <button
                  type="button"
                  class="practice-cheat-btn"
                  @click="clearStacks(row, stack.spellId)"
                >
                  Xoá
                </button>
              </span>
            </div>
          </section>
        </div>
      </div>

      <!-- One per side, at the end of that side's list, scrolling with it.
           It used to be a single button pinned to the bottom of the scroller,
           which cost a permanent 45px strip over the roster *and* said nothing
           about where the bot would go. Here the position is the answer.

           The count is on the button rather than in a note beside it: at the
           cap, the control the player is pressing is the one that has to
           explain itself. -->
      <!-- Hidden rather than disabled on a LAN client, unlike the Trận đấu
           tab's rows. The difference is what the control carries: a greyed CDR
           slider still tells a client what the host set, and a greyed "Thêm
           bot" tells it nothing it cannot see by counting the rows above. -->
      <button
        v-if="canEditMatch"
        type="button"
        class="practice-add-bot"
        :id="`practice-add-bot-${team.modifier}`"
        :disabled="addDisabled"
        :aria-label="`Thêm bot vào ${team.name}`"
        @click="addBot(team.id)"
      >
        <i class="fas fa-plus" aria-hidden="true"></i>
        <!-- "Thêm bot", not "Thêm bot vào Đội Xanh": the button sits inside that
             side's own tinted box, so the words would only repeat where it
             already is — and on a narrow phone they wrap. The side stays in the
             `aria-label`, where position is not available. -->
        <span>{{
          addingBot ? 'Đang tải…' : atCap ? `Đã đủ ${AI_COUNT_MAX} bot` : 'Thêm bot'
        }}</span>
        <span class="practice-add-bot-count">{{ botCount }}/{{ AI_COUNT_MAX }}</span>
      </button>
    </section>

    <!-- Scoped to add and remove, and only in a match: outside one there is no
         paused loop to wait for. -->
    <p v-if="live" class="practice-note">
      Thêm và xoá có hiệu lực khi bạn đóng bảng và trận chạy tiếp.
    </p>

    <Teleport to="body">
      <div v-if="editing" class="practice-editor-host">
        <LoadoutEditorModal
          :title="`Đổi tướng — ${editing.label}`"
          :loadout="editingLoadout"
          :initial-slot="editingSlot"
          :match-rules="source.matchRules"
          :is-touch-ui="source.touchUi"
          @change="applyLoadout"
          @close="editing = null"
        />
      </div>
    </Teleport>
  </div>
</template>
