import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';
import CombatText, {
  COMBAT_TEXT_LIFETIME_MS,
  HEADLINE_WINDOW_MS,
  PUNCH_MS,
} from '../../../src/game/gameObject/helpers/CombatText';
import { damageTextScale } from '../../../src/game/render/hitFeedback';

const combatTexts = (game: ReturnType<typeof createGame>): CombatText[] =>
  [...game.objectManager.objects, ...game.objectManager._objectToBeAdd].filter(
    (object): object is CombatText => object instanceof CombatText
  );

/** Advances the sim by roughly `ms`, in the fixture's fixed 16ms steps. */
const tick = (game: ReturnType<typeof createGame>, ms: number): void => {
  for (let elapsed = 0; elapsed < ms; elapsed += 16) game.objectManager.update();
};

// See the doc comment on `CombatText` for the rule this file is pinning down:
// merge per (victim, kind, color) while the existing text is still alive,
// immediately on the first hit, with no separate scheduler or tick.
describe('CombatText.show merges per victim and kind', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('merges two damage hits on the same unit into one running total', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    CombatText.show(unit, 'damage', 15, [255, 0, 0]);
    CombatText.show(unit, 'damage', 10, [255, 0, 0]);

    const texts = combatTexts(game);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe('-25');
    expect(texts[0].amount).toBe(25);
  });

  it('keeps two victims apart: 15 and 15 stay two numbers, never one 30', () => {
    const game = createGame();
    const a = createUnit(game, 0, 'blue');
    const b = createUnit(game, 100, 'blue');

    CombatText.show(a, 'damage', 15, [255, 0, 0]);
    CombatText.show(b, 'damage', 15, [255, 0, 0]);

    const texts = combatTexts(game);
    expect(texts).toHaveLength(2);
    expect(texts.map(t => t.text).sort()).toEqual(['-15', '-15']);
  });

  it('does not merge across kinds on the same unit', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    CombatText.show(unit, 'damage', 15, [255, 0, 0]);
    CombatText.show(unit, 'heal', 10, [0, 255, 0]);

    const texts = combatTexts(game);
    expect(texts).toHaveLength(2);
    expect(texts.map(t => t.text).sort()).toEqual(['+10', '-15']);
  });

  it('does not merge two differently-colored shields on the same unit', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    // Two different casters' shields, e.g. Malphite W then Lux W landing on
    // the same ally: each has its own color and must show its own number.
    CombatText.show(unit, 'shield', 8, [180, 170, 205]);
    CombatText.show(unit, 'shield', 6, [255, 225, 140]);

    expect(combatTexts(game)).toHaveLength(2);
  });

  it('merges repeated hits eaten by the same shield instance', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    const color = [255, 205, 90];

    CombatText.show(unit, 'shield', 8, color);
    CombatText.show(unit, 'shield', 6, color);

    const texts = combatTexts(game);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe('14');
  });

  it('updates the same instance in place rather than replacing it', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    CombatText.show(unit, 'damage', 15, [255, 0, 0]);
    const first = combatTexts(game)[0];

    CombatText.show(unit, 'damage', 5, [255, 0, 0]);
    const texts = combatTexts(game);

    expect(texts).toHaveLength(1);
    expect(texts[0]).toBe(first);
  });

  it('refreshes the lifetime on merge, extending how long it stays on screen', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    CombatText.show(unit, 'damage', 15, [255, 0, 0]);
    tick(game, COMBAT_TEXT_LIFETIME_MS / 2);
    const text = combatTexts(game)[0];
    expect(text.age).toBeGreaterThan(0);

    CombatText.show(unit, 'damage', 5, [255, 0, 0]);
    expect(text.age).toBe(0);
  });

  it('starts a fresh text once the merged one has fully faded, rather than reviving it', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    CombatText.show(unit, 'damage', 15, [255, 0, 0]);
    tick(game, COMBAT_TEXT_LIFETIME_MS + 200);

    CombatText.show(unit, 'damage', 8, [255, 0, 0]);

    const live = combatTexts(game).filter(text => !text.toRemove);
    expect(live).toHaveLength(1);
    expect(live[0].text).toBe('-8');
  });

  it('drops a zero-amount event instead of creating an empty text', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    CombatText.show(unit, 'damage', 0, [255, 0, 0]);

    expect(combatTexts(game)).toHaveLength(0);
  });
});

// Bug report (phone testing): under sustained fire, the number "keeps falling
// forever and leaves the viewport." Root cause: `update()` integrated
// `movedVector += velocity; velocity += gravity` every tick with no ceiling,
// and a merge reset `age` but deliberately left `velocity`/`movedVector`
// alone — so under repeated merges `age` never crossed `lifeTime` (the text
// never died) while `velocity` accumulated `gravity` forever. This is the
// probe that catches it: drive a merged text across many times one lifetime
// and check its offset from the owner stays inside a stated envelope.
describe('CombatText arc stays bounded under sustained merges', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('does not run away when the same (victim, kind) merges every tick for 5s', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    // 5s of sustained fire — 5x COMBAT_TEXT_LIFETIME_MS, so a text that never
    // dies (because every tick refreshes `age`) would, pre-fix, have
    // integrated gravity for 5x as long as any single-hit text ever lives.
    const totalMs = 5_000;
    for (let elapsed = 0; elapsed < totalMs; elapsed += 16) {
      CombatText.show(unit, 'damage', 1, [255, 0, 0]);
      game.objectManager.update();
    }

    const [text] = combatTexts(game);
    expect(text).toBeDefined();
    // Generous envelope: a single, un-merged hit's whole arc — rise and
    // fall — stays within roughly this range over its one lifetime (see
    // ARC_LINEAR_PX/ARC_QUADRATIC_PX in CombatText.ts: peak ~10px up,
    // settle ~30px down). A merged text held alive far longer must still
    // stay inside it, not grow with how long the fire lasted. Pre-fix this
    // reached 2113.8px — clearly off the bottom of a phone screen.
    expect(Math.abs(text.offsetY)).toBeLessThan(100);
    expect(Math.abs(text.offsetX)).toBeLessThan(100);
  });
});

// Research: real League anchors floating combat text above the health bar,
// not over the character model — a forum complaint about text that "floats
// behind the health bar" is the same failure mode this guards against, from
// a different cause. See PERF-COMBATTEXT.md for the full citation.
describe('CombatText anchors above the unit and its health bar', () => {
  let textMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    installSpellObjectGlobals();
    textMock = vi.fn();
    vi.stubGlobal('push', vi.fn());
    vi.stubGlobal('pop', vi.fn());
    vi.stubGlobal('stroke', vi.fn());
    vi.stubGlobal('fill', vi.fn());
    vi.stubGlobal('strokeWeight', vi.fn());
    vi.stubGlobal('textStyle', vi.fn());
    vi.stubGlobal('textSize', vi.fn());
    vi.stubGlobal('BOLD', 'bold');
    vi.stubGlobal('color', () => ({ setAlpha: () => undefined }));
    vi.stubGlobal(
      'map',
      (value: number, a: number, b: number, c: number, d: number) =>
        c + ((value - a) / (b - a)) * (d - c)
    );
    vi.stubGlobal('text', textMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('draws above the top of the unit body, not at its centre or feet', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    const combatText = new CombatText(unit);
    combatText.text = '-10';

    combatText.draw();

    expect(textMock).toHaveBeenCalledTimes(1);
    const [, , y] = textMock.mock.calls[0] as [string, number, number];
    const topOfUnit = unit.position.y - unit.stats.size.value / 2;
    // Smaller y is higher on screen: the number must start above the unit's
    // own top edge, clear of the health bar sitting just above that edge.
    expect(y).toBeLessThan(topOfUnit);
  });
});

// The number has weight: see `render/hitFeedback.ts`'s `damageTextScale`.
// Only damage weighs itself against the victim's pool, and a crit is told
// by size and outline — never by colour, which the type already owns.
describe('CombatText sizes damage by its share of the pool', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => vi.unstubAllGlobals());

  const victim = (game: ReturnType<typeof createGame>) => {
    const unit = createUnit(game, 0, 'blue');
    unit.stats.maxHealth.baseValue = 100;
    unit.stats.health.baseValue = 100;
    return unit;
  };

  it('draws a scratch near the base size and a quarter-pool hit half again as big', () => {
    const game = createGame();
    const unit = victim(game);
    CombatText.show(unit, 'damage', 1, [255, 0, 0]);
    CombatText.show(unit, 'damage', 25, [0, 0, 255]);
    const [scratch, heavy] = combatTexts(game);
    expect(scratch.textSize).toBeCloseTo(20 * damageTextScale(0.01, false), 5);
    expect(heavy.textSize).toBe(30);
  });

  it('sizes a same-frame burst by its coalesced headline', () => {
    const game = createGame();
    const unit = victim(game);
    CombatText.show(unit, 'damage', 5, [255, 0, 0]);
    CombatText.show(unit, 'damage', 5, [255, 0, 0]);
    CombatText.show(unit, 'damage', 15, [255, 0, 0]);
    const [text] = combatTexts(game);
    expect(text.amount).toBe(25);
    expect(text.recent).toBe(25);
    expect(text.textSize).toBe(30);
  });

  it('marks a crit by size, and an ordinary hit in the same group keeps the mark', () => {
    const game = createGame();
    const unit = victim(game);
    CombatText.show(unit, 'damage', 10, [255, 0, 0], { crit: true });
    const [text] = combatTexts(game);
    expect(text.crit).toBe(true);
    expect(text.textSize).toBeCloseTo(20 * 1.2 * 1.3, 5);
    CombatText.show(unit, 'damage', 10, [255, 0, 0]);
    expect(text.crit).toBe(true);
    expect(combatTexts(game)).toHaveLength(1);
  });

  it('caps the crit-times-heavy product so a one-shot stays readable', () => {
    const game = createGame();
    const unit = victim(game);
    CombatText.show(unit, 'damage', 100, [255, 0, 0], { crit: true });
    expect(combatTexts(game)[0].textSize).toBeCloseTo(20 * 1.9, 5);
  });

  it('leaves heals and gold at the base size', () => {
    const game = createGame();
    const unit = victim(game);
    CombatText.show(unit, 'heal', 100, [0, 255, 0]);
    CombatText.show(unit, 'gold', 100, [255, 206, 92]);
    expect(combatTexts(game).map(text => text.textSize)).toEqual([20, 20]);
  });

  it('re-arms the landing punch on every merge and lets it settle', () => {
    const game = createGame();
    const unit = victim(game);
    CombatText.show(unit, 'damage', 5, [255, 0, 0]);
    const [text] = combatTexts(game);
    expect(text.punchMs).toBe(PUNCH_MS);
    tick(game, PUNCH_MS + 32);
    expect(text.punchMs).toBeLessThanOrEqual(0);
    CombatText.show(unit, 'damage', 5, [255, 0, 0]);
    expect(text.punchMs).toBe(PUNCH_MS);
  });
});

// One text, two numbers: the headline is the hit (or the same-frame burst) that
// just landed, the total is everything since the text was born. See "The
// headline and the total" on the class — the merge rule stays, and so does the
// object count; only what the one object *says* changed.
describe('CombatText keeps the headline apart from the total', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => vi.unstubAllGlobals());

  const victim = (game: ReturnType<typeof createGame>) => {
    const unit = createUnit(game, 0, 'blue');
    unit.stats.maxHealth.baseValue = 100;
    unit.stats.health.baseValue = 100;
    return unit;
  };

  it('shows a lone hit as one number and no total', () => {
    const game = createGame();
    const unit = victim(game);
    CombatText.show(unit, 'damage', 15, [255, 0, 0]);
    const [text] = combatTexts(game);
    expect(text.text).toBe('-15');
    expect(text.showsTotal).toBe(false);
  });

  it('replaces the headline with the next hit once the window has passed, and sums the total', () => {
    const game = createGame();
    const unit = victim(game);
    CombatText.show(unit, 'damage', 15, [255, 0, 0]);
    tick(game, HEADLINE_WINDOW_MS * 2);
    CombatText.show(unit, 'damage', 10, [255, 0, 0]);

    const texts = combatTexts(game);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe('-10');
    expect(texts[0].amount).toBe(25);
    expect(texts[0].totalText).toBe('-25');
    expect(texts[0].showsTotal).toBe(true);
  });

  it('coalesces hits inside one window into one headline', () => {
    const game = createGame();
    const unit = victim(game);
    CombatText.show(unit, 'damage', 4, [255, 0, 0]);
    tick(game, 48);
    CombatText.show(unit, 'damage', 4, [255, 0, 0]);
    tick(game, 48);
    CombatText.show(unit, 'damage', 4, [255, 0, 0]);
    const [text] = combatTexts(game);
    expect(text.text).toBe('-12');
    expect(text.showsTotal).toBe(false);
  });

  it('reads a crit at its own number, not the pile it lands on', () => {
    const game = createGame();
    const unit = victim(game);
    for (let i = 0; i < 4; i++) {
      CombatText.show(unit, 'damage', 5, [255, 0, 0]);
      tick(game, HEADLINE_WINDOW_MS * 2);
    }
    CombatText.show(unit, 'damage', 30, [255, 0, 0], { crit: true });
    const [text] = combatTexts(game);
    expect(text.text).toBe('-30');
    expect(text.crit).toBe(true);
    expect(text.totalText).toBe('-50');
    expect(text.textSize).toBeCloseTo(20 * 1.9, 5);
  });

  it('drops the crit mark when an ordinary hit opens the next group', () => {
    const game = createGame();
    const unit = victim(game);
    CombatText.show(unit, 'damage', 30, [255, 0, 0], { crit: true });
    tick(game, HEADLINE_WINDOW_MS * 2);
    CombatText.show(unit, 'damage', 5, [255, 0, 0]);
    const [text] = combatTexts(game);
    expect(text.crit).toBe(false);
    expect(text.text).toBe('-5');
  });

  it('sizes by the headline, so a chain of pokes never looks like one blow', () => {
    const game = createGame();
    const unit = victim(game);
    for (let i = 0; i < 5; i++) {
      CombatText.show(unit, 'damage', 5, [255, 0, 0]);
      tick(game, HEADLINE_WINDOW_MS * 2);
    }
    const [text] = combatTexts(game);
    expect(text.amount).toBe(25);
    expect(text.textSize).toBeCloseTo(20 * damageTextScale(0.05, false), 5);
    expect(text.textSize).toBeLessThan(30);
  });
});
