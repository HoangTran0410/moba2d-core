import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import TeamId from '../../../src/game/enums/TeamId';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import makeRecall from '../../../src/game/gameObject/coreSpells/Recall';

const Recall = makeRecall(buildContentApi());

/**
 * `MatchRules.recall` — the brawl's one rule. The spell reads it at press time
 * like CDR and URF, so a bare world (no `matchRules` at all) means on.
 */
describe('the recall rule', () => {
  let game: TestGame & { matchRules?: { recall?: boolean } };

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const champion = () => {
    const unit = new Champion({ game, position: createVector(100, 100), teamId: TeamId.BLUE });
    game.setPlayer(unit);
    return unit;
  };

  it('is castable in a world that states no rules, and with the rule on', () => {
    const recall = new Recall(champion());
    expect(recall.isCastableNow).toBe(true);
    game.matchRules = { recall: true };
    expect(recall.isCastableNow).toBe(true);
  });

  it('refuses every press while the rule is off, and comes back when it is switched on', () => {
    const recall = new Recall(champion());
    game.matchRules = { recall: false };
    expect(recall.isCastableNow).toBe(false);
    game.matchRules.recall = true;
    expect(recall.isCastableNow).toBe(true);
  });
});
