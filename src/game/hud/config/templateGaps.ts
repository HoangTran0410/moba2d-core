/**
 * What a saved "Trận mẫu" asks for that this install cannot supply.
 *
 * A template outlives the packs it was saved from, and the policy everywhere
 * is skip-and-carry-on: a champion nobody installs resolves to random
 * (`preset.ts`), a bag id that names nothing is dropped
 * (`ItemShop.grantTemplateBag`), a missing map falls back
 * (`GameScene.startGame`). This module is the *visible* half of that policy —
 * the row in the panel says what will be skipped before the press, so the
 * silence downstream is never a surprise.
 *
 * Lives beside the panel rather than in `config/matchTemplates.ts`, because
 * answering it takes the content catalogue and that module is pure data by
 * the same rule `PregameConfig.ts` is. `@/content/catalog` is already a
 * legal import here — `PregameConfigSource` reads it for the map list — and
 * pulls nothing from the game chunk (`matchConfigChunk.test.ts`).
 */
import { contentCatalog } from '@/content/catalog';
import type { ChampionLoadout } from '@/game/config/PregameConfig';
import type { MatchTemplateSetup } from '@/game/config/matchTemplates';

export interface TemplateGaps {
  /** Champion names the template asks for that no installed pack offers. */
  champions: string[];
  /** How many stored bag ids resolve to no installed item. */
  missingItems: number;
  /** Whether the stored map id names no installed map. */
  mapMissing: boolean;
}

const championOf = (loadout: ChampionLoadout): string | null =>
  loadout.mode === 'champion' && loadout.championName !== 'random' ? loadout.championName : null;

/**
 * Checked against what is installed *now*, so the answer moves when packs do
 * — which is the point: the same template reads clean again the day its pack
 * comes back.
 */
export const templateGaps = (setup: MatchTemplateSetup): TemplateGaps => {
  const catalog = contentCatalog();
  const installed = new Set<string>();
  for (const champion of catalog.champions()) installed.add(champion.name);

  const missing = new Set<string>();
  const check = (loadout: ChampionLoadout): void => {
    const name = championOf(loadout);
    if (name && !installed.has(name)) missing.add(name);
  };
  check(setup.config.player);
  for (let i = 0; i < setup.config.ai.count; i++) check(setup.config.ai.bots[i]);

  let missingItems = 0;
  const countBag = (bag: readonly string[]): void => {
    for (const id of bag) if (!catalog.item(id)) missingItems++;
  };
  countBag(setup.items.player);
  for (let i = 0; i < setup.config.ai.count && i < setup.items.bots.length; i++)
    countBag(setup.items.bots[i]);

  let mapMissing = true;
  for (const map of catalog.maps()) if (map.id === setup.config.mapId) mapMissing = false;

  return { champions: [...missing], missingItems, mapMissing };
};

/**
 * The gaps as one Vietnamese line for the row, or `null` for a template this
 * install can serve whole. "Thiếu" and never a champion name invented here:
 * the names printed are the template's own stored strings.
 */
export const describeTemplateGaps = (gaps: TemplateGaps): string | null => {
  const parts: string[] = [];
  if (gaps.champions.length) parts.push(`tướng ${gaps.champions.join(', ')}`);
  if (gaps.missingItems) parts.push(`${gaps.missingItems} trang bị`);
  if (gaps.mapMissing) parts.push('bản đồ');
  if (!parts.length) return null;
  return `Thiếu ${parts.join(' · ')} — phần này sẽ bỏ qua khi áp dụng.`;
};
