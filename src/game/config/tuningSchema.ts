import type { MapTuning } from '@/content/ContentPack';

/**
 * Every number a map may retune, in the words a person editing one reads.
 *
 * ## Why this is in core and not in the editor
 *
 * It was in the editor, as a plain array in `src/mapEditor/ui.ts`, back when
 * the editor was browser JavaScript that no compiler ever saw. That made this
 * table a hand-written second opinion about `MapTuning`, and the failure when
 * the two drifted was the worst shape available: an author types a number into
 * a box, the map saves, `validatePack` sees a key it does not know, and the map
 * is **refused at install** behind a console line nobody reads — or, for a
 * local map, simply never appears in the picker.
 *
 * `editorTuningSchema.test.ts` existed to catch exactly that, by *scanning the
 * editor's source text* for this array and comparing the strings it found to
 * `validatePack`. It worked, and it was a text scanner standing in for a type
 * checker.
 *
 * ## What is locked, and what still is not
 *
 * **Groups are locked by the compiler.** `TUNING_GROUP_COVERAGE` below fails to
 * compile the day `MapTuning` grows a group this table does not offer — which
 * is the exact mistake `vision` made when it was added, and which was caught
 * that time only because somebody remembered.
 *
 * **Field paths are locked to one level of nesting.** `FieldPath` accepts a
 * key of the group's own type, or `parent.child` for a nested object — which
 * covers `reviveCurve.base` and `waves.intervalMs`, the two shapes that exist.
 * It does not walk deeper, so `minions.types.*` (a `Record` of user-named
 * minions) stays open, and the *runtime* half of the guarantee — that core
 * actually accepts a value written at each path — remains
 * `editorTuningSchema.test.ts`'s job. The type says the key exists; the test
 * says the validator takes it.
 *
 * ## Read by both sides
 *
 * The editor's config panel builds its rows from this, and the map picker's
 * rules list is next (`mapRuleLines.ts` currently formats its own labels).
 * One table, two surfaces, and the compiler between it and `MapTuning`.
 */

/**
 * A key of `T`, or `parent.child` for one level of nesting.
 *
 * `extends object` rather than `extends Record<string, unknown>`: an
 * *interface* is not assignable to that `Record` — it has no index signature —
 * so the `Record` form silently refused `bush.speedMultiplier` while accepting
 * `reviveCurve.base`, purely because one nested type is declared as an
 * interface and the other as an inline object. The array branch has to come
 * first, since an array is an object too.
 */
type FieldPath<T> = {
  [K in keyof T & string]: NonNullable<T[K]> extends readonly unknown[]
    ? K
    : NonNullable<T[K]> extends object
      ? K | `${K}.${keyof NonNullable<T[K]> & string}`
      : K;
}[keyof T & string];

/** One editable number, and how to label it. */
export interface TuningField<K extends keyof MapTuning = keyof MapTuning> {
  key: FieldPath<NonNullable<MapTuning[K]>>;
  label: string;
  /** Shown after the input — `ms`, `px`, `×`, `%`. */
  unit?: string;
  /** Placeholder: core's own default, so the box says what doing nothing means. */
  ph?: string;
  hint?: string;
}

/** One collapsible section of the config panel. */
export interface TuningGroup<K extends keyof MapTuning = keyof MapTuning> {
  key: K;
  label: string;
  hint?: string;
  fields: TuningField<K>[];
  /** The minion group alone grows a per-type table under its ordinary rows. */
  minions?: boolean;
}

/**
 * `satisfies`, not a type annotation, and the difference is the whole coverage
 * check. An annotated array reports its *declared* type, so
 * `(typeof TUNING_SCHEMA)[number]['key']` was the full union of group names
 * whatever the array actually held — `UncoveredGroup` below computed `never`
 * unconditionally and the guard passed with a group deleted. `satisfies`
 * checks the literal against the same shape while keeping the literal's own
 * type, so the guard reads what is really there. `TUNING_SCHEMA` below hands
 * consumers the widened view, because a literal type has no `hint` at all on
 * the entries that omit it and every reader loops over the lot.
 */
const SCHEMA = [
  {
    key: "champions",
    label: "Tướng",
    hint: "Chết bao lâu thì sống lại, và map nhân chỉ số tướng lên bao nhiêu.",
    fields: [
    // Hệ số nhân chứ không phải số tuyệt đối, y hệt lý do bên quái: gốc là
    // của pack, và map không biết gốc là bao nhiêu. Sáu mươi tướng mỗi
    // tướng một bảng máu, nên "ai cũng 400 máu" là câu map không có tư cách
    // nói — còn "ở map này ai cũng dày gấp đôi" thì có.
    { key: "healthMult", label: "Máu", unit: "×", ph: "1" },
    { key: "damageMult", label: "Sát thương đánh thường", unit: "×", ph: "1", hint: "chỉ đánh thường, không đụng tới chiêu" },
    { key: "speedMult", label: "Tốc chạy", unit: "×", ph: "1" },
    { key: "reviveTime", label: "Hồi sinh", unit: "ms", ph: "5000" },
    { key: "reviveCurve.base", label: "Hồi sinh — mốc đầu", unit: "ms", hint: "khai cả ba ô thì đường cong thắng ô phẳng ở trên" },
    { key: "reviveCurve.perMinute", label: "Cộng mỗi phút", unit: "ms" },
    { key: "reviveCurve.max", label: "Trần", unit: "ms" },
  ]},
  {
    key: "economy",
    label: "Kinh tế",
    hint: "Vàng khởi đầu, thu nhập, và giết cái gì được bao nhiêu. Đây là cần gạt đổi nhịp trận mạnh nhất mà không phải vẽ lại gì.",
    fields: [
      { key: "startingGold", label: "Vàng khởi đầu", unit: "g", ph: "500" },
      { key: "passiveGoldPerSecond", label: "Vàng mỗi giây", unit: "g/s", ph: "2" },
      { key: "minionBounty", label: "Giết lính", unit: "g", ph: "20" },
      { key: "monsterBounty", label: "Giết quái", unit: "g", ph: "32" },
      { key: "championBounty", label: "Giết tướng", unit: "g", ph: "200" },
      { key: "turretBounty", label: "Phá trụ", unit: "g", ph: "150" },
      // Nửa còn lại của việc kinh tế siết chặt tới đâu: 0.7 nghĩa là mua
      // nhầm một món tốn 30% để sửa, và đúng cái giá đó khiến việc chốt
      // build trở thành một quyết định. Map muốn thử đồ thoải mái thì để 1;
      // muốn mua là dứt khoát thì để 0.
      { key: "sellRefund", label: "Bán lại được", unit: "×", ph: "0.7", hint: "phần trăm giá gốc, 0…1" },
      // Mạng hỗ trợ: cửa sổ tính công, và một mạng hỗ trợ đáng bao nhiêu so
      // với tiền của người kết liễu. Tiền hỗ trợ được cộng thêm chứ không
      // chia ra từ tiền mạng, nên chỉnh cái này không làm solo kill yếu đi.
      { key: "assistWindowMs", label: "Cửa sổ hỗ trợ", unit: "ms", ph: "10000", hint: "0 để tắt hẳn" },
      { key: "assistGoldShare", label: "Tiền hỗ trợ", unit: "×", ph: "0.5", hint: "phần của tiền mạng, 0…1" },
      // Đánh tướng địch xuống máu rồi để trụ/lính/quái kết liễu thì mạng vẫn
      // là của người đánh, miễn là cú đánh cuối của họ nằm trong cửa sổ này.
      // Để 0 nghĩa là ai chạm cuối người đó ăn mạng, kể cả con lính.
      { key: "killCreditWindowMs", label: "Cửa sổ ăn mạng", unit: "ms", ph: "10000", hint: "0 để last hit quyết định" },
    ],
  },
  {
    key: "turrets",
    label: "Trụ",
    hint: "Trụ đánh mạnh cỡ nào, xa cỡ nào, gãy xong bao lâu mọc lại.",
    fields: [
    { key: "health", label: "Máu", unit: "hp", ph: "400" },
    { key: "damage", label: "Sát thương", unit: "dmg", ph: "12" },
    { key: "attackRange", label: "Tầm bắn", unit: "px", ph: "430" },
    { key: "attackInterval", label: "Nhịp bắn", unit: "ms", ph: "1300" },
    { key: "size", label: "Kích thước", unit: "px", ph: "92" },
    { key: "rebuildTime", label: "Xây lại", unit: "ms", ph: "30000" },
    { key: "repairDelay", label: "Chờ tự sửa", unit: "ms", ph: "6000" },
    { key: "repairRate", label: "Tốc tự sửa", unit: "hp/frame", ph: "0.4" },
  ]},
  {
    key: "fountain",
    label: "Bệ đá cổ",
    hint: "Về nhà hồi máu/mana nhanh hay chậm, và phải về gần tới đâu mới mua được đồ.",
    fields: [
    { key: "tickInterval", label: "Nhịp hồi", unit: "ms", ph: "500" },
    { key: "healPercent", label: "Hồi máu", unit: "×", ph: "0.12" },
    { key: "manaPercent", label: "Hồi mana", unit: "×", ph: "0.12" },
    // Tách khỏi bán kính bệ đá, và đó mới là điểm của nó: `r` vừa là chỗ
    // hồi máu vừa là hình được vẽ, nên nới `r` ra để mua đồ từ xa cũng là
    // phát cho cả map một tấm đệm hồi máu khổng lồ. Để trống = đúng luật
    // cũ, phải đứng trong bệ đá. Số to = mua ở đâu cũng được. Con số thú vị
    // nằm ở giữa: bằng nửa chiều rộng map nghĩa là mua được ở nửa sân nhà
    // mà không mua được ở sân đối thủ.
    { key: "shopRange", label: "Tầm mua đồ", unit: "px", ph: "= bán kính bệ" },
  ]},
  {
    key: "monsters",
    label: "Quái rừng",
    hint: "Hệ số nhân lên chỉ số pack khai, quái đuổi xa tới đâu, và bao lâu mới hồi máu lại.",
    fields: [
    { key: "healthMult", label: "Máu", unit: "×", ph: "1" },
    { key: "damageMult", label: "Sát thương", unit: "×", ph: "1" },
    { key: "speedMult", label: "Tốc chạy", unit: "×", ph: "1" },
    { key: "attackIntervalMult", label: "Nhịp đánh", unit: "×", ph: "1" },
    { key: "aggroRangeMult", label: "Tầm phát hiện", unit: "×", ph: "1" },
    { key: "reviveTimeMult", label: "Hồi sinh", unit: "×", ph: "1" },
    { key: "chaseMargin", label: "Tầm đuổi thêm", unit: "px", ph: "350" },
    { key: "giveUpDelayMs", label: "Chờ bỏ cuộc", unit: "ms", ph: "2000" },
    { key: "regenDelayMs", label: "Trễ hồi máu", unit: "ms", ph: "4000" },
  ]},
  {
    key: "terrain",
    label: "Địa hình",
    hint: "Đi trong bụi và dưới sông nhanh chậm thế nào.",
    fields: [
    { key: "bush.speedMultiplier", label: "Tốc trong bụi", unit: "×", ph: "1" },
    { key: "water.speedMultiplier", label: "Tốc dưới sông", unit: "×", ph: "1" },
  ]},
  {
    key: "minions",
    label: "Lính",
    hint: "Nhịp ra wave, và map có thể tự khai loại lính của riêng nó.",
    minions: true,
    fields: [
    { key: "waves.intervalMs", label: "Cách wave", unit: "ms", ph: "30000" },
    { key: "waves.firstDelayMs", label: "Wave đầu sau", unit: "ms", ph: "1000" },
    { key: "waves.releaseIntervalMs", label: "Cách từng con", unit: "ms", ph: "650" },
    { key: "waves.liveCap", label: "Trần lính sống", unit: "con", ph: "160" },
  ]},
  {
    key: "vision",
    label: "Tầm nhìn",
    hint: "Đánh trong bụi thì bị lộ bao lâu, và lộ rộng bao nhiêu. Để 0 giây là bụi thành tàng hình thật.",
    fields: [
    { key: "attackRevealMs", label: "Lộ trong", unit: "ms", ph: "2000" },
    { key: "attackRevealRadius", label: "Vùng bị lộ", unit: "px", ph: "300" },
  ]},
] satisfies readonly { [K in keyof MapTuning]-?: TuningGroup<K> }[keyof MapTuning][];

/**
 * The table as a *reader* wants it.
 *
 * Authoring is locked (`SCHEMA` above); reading is not, and the two cannot be
 * the same type. `TuningGroup<K>` ties a field's key to its own group, so the
 * union `TuningGroup<keyof MapTuning>` asks for the keys common to *every*
 * group — an intersection, which is empty. A consumer loops over the groups
 * and indexes a path by string; this is that view, and nothing is checked
 * through it because nothing needs to be.
 */
export interface TuningGroupView {
  key: keyof MapTuning;
  label: string;
  hint?: string;
  fields: { key: string; label: string; unit?: string; ph?: string; hint?: string }[];
  minions?: boolean;
}

export const TUNING_SCHEMA: readonly TuningGroupView[] = SCHEMA;

/**
 * A group in `MapTuning` that this table does not offer.
 *
 * `never` when every group is covered, and the *name of the missing group*
 * when one is not — so the compile error reads
 * `Type '"vision"' is not assignable to type 'never'` rather than pointing at
 * a line number and leaving the reader to work out which key it meant.
 */
type UncoveredGroup = Exclude<keyof MapTuning, (typeof SCHEMA)[number]['key']>;

/** The assertion itself. Deliberately unused at runtime. */
const TUNING_GROUP_COVERAGE: never = undefined as never as UncoveredGroup;
void TUNING_GROUP_COVERAGE;
