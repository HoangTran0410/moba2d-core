/**
 * A pack failure's `stage`, in Vietnamese.
 *
 * `PackLoadError.stage` (`@/content/packSource`) is a five-value machine enum
 * — `fetch manifest compat import shape` — and two more strings reach the same
 * two displays from outside it: `runtimePacks.ts` reports `'registry'` when a
 * loaded pack is refused by `PackRegistry`, and `LoadingScene.ts` reports
 * `'install'` for a boot-time failure that never produced a `PackLoadError` of
 * its own. All seven used to be printed raw, so the menu's banner read
 * "Chưa tải được nội dung (shape)" and the packs screen "shape: … has no
 * default export function" — English, internal, and addressed to a player who
 * has no way to act on either word.
 *
 * **Deliberately in `src/scenes/` rather than beside the enum it translates.**
 * `vite.config.ts` pins `src/content/` to the `pregame` chunk, and
 * `MenuScene.vue` — which renders the banner — is on the boot path
 * (`tests/scenes/menuBootPath.test.ts`). A label table is not worth an edge
 * from the menu into the content layer, so this module imports nothing at all.
 *
 * Which is also why `stage` is typed `string` and not `PackLoadStage`: the
 * union would be a type-only edge and cost nothing at runtime, but the two
 * strings above are not members of it, and widening the parameter is what
 * keeps the unknown-stage fallback reachable instead of dead.
 * `tests/scenes/packStageLabel.test.ts` scans `src/` for every stage string
 * any code path can produce and fails when one has no entry here.
 */
const STAGE_LABELS: Record<string, string> = {
  fetch: 'không tải được từ nguồn',
  manifest: 'thông tin pack không hợp lệ',
  compat: 'pack không hợp với phiên bản game',
  import: 'không chạy được mã của pack',
  shape: 'nội dung pack sai định dạng',
  registry: 'game từ chối nội dung của pack',
  install: 'cài đặt không xong',
};

/**
 * The player-facing name of a failure stage.
 *
 * An unrecognised value comes back unchanged rather than as "lỗi không rõ": a
 * stage this table has not heard of is still a real word from a real code
 * path, and printing it is how it gets reported and then added above.
 */
export function packStageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}
