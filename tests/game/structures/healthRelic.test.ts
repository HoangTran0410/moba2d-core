import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexObjects } from '@/testing';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '@/testing/spellWorld';
import TeamId from '@/game/enums/TeamId';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import HealCut from '@/game/gameObject/buffs/HealCut';
import {
  healthRelicFor,
  RELIC_BEAM_DELAY_MS,
  RELIC_BEAM_MISSING_SHARE,
  RELIC_BEAM_RADIUS,
  RELIC_PICKUP_MISSING_SHARE,
  RELIC_PICKUP_RADIUS,
  RELIC_RESPAWN_MS,
  relicRespawnMs,
} from '@/game/gameObject/structures/HealthRelic';

/**
 * **Cổ Vật Hồi Máu**, and the things about it that are invisible from the file.
 *
 * It is the one thing core stands on a map that is not a body to fight, so
 * most of what is asserted here is a seam rather than a number: that a champion
 * *walking over* it is what takes it, that the beam it calls down does not ask
 * whose side you are on, that it pays a share of what is **missing**, that it
 * heals through the door a wound can reach, and that it goes away and comes
 * back rather than paying for ever.
 *
 * The load-bearing one is the second. An allied-only heal is what a "healing
 * pickup" naturally becomes, and it is the one shape this object must not have:
 * the beam heals **every champion under it, both teams**, which is what makes
 * taking one a fight rather than a collection.
 *
 * It shipped in a content pack first. Moving it into core changed none of the
 * below — these cases came with it, unedited except for how the world is built
 * — which is the honest way to say the move was a move and not a rewrite.
 */

let game: TestGame;

/** The relic, built the way `Game.spawnJungle` builds one. */
const relicAt = (x = 0, y = 0, r = 0) =>
  healthRelicFor({ role: 'relic', x, y, r }, game) as unknown as {
    update(): void;
  };

/**
 * A real `Champion`, because "a champion walks over it" is the rule and the
 * shared `createUnit` fixture builds a bare `AttackableUnit` — a minion is not
 * supposed to be able to take one, nor to drink from the beam.
 */
const champion = (teamId: string, x: number, hurt = false) => {
  const unit = new Champion({
    game,
    teamId,
    position: createVector(x, 0),
  } as never) as ReturnType<typeof createUnit> & { stats: { maxMana: { baseValue: number } } };
  if (hurt) {
    unit.stats.maxHealth.baseValue = 1_000;
    unit.stats.health.baseValue = 200;
  }
  return unit;
};

/** What the beam owes a body that is missing `missing` points. */
const beamHeal = (missing: number) => Math.round(missing * RELIC_BEAM_MISSING_SHARE);

const capture = () => {
  const built: { update(): void; toRemove: boolean }[] = [];
  vi.spyOn(game.objectManager, 'addObject').mockImplementation(object => {
    built.push(object as never);
  });
  return built;
};

/** Run an object for `ms`, at the stubbed frame. */
const run = (object: { update(): void }, ms: number, step = 100): void => {
  vi.stubGlobal('deltaTime', step);
  for (let elapsed = 0; elapsed < ms; elapsed += step) object.update();
};

beforeEach(() => {
  installSpellObjectGlobals();
  installSketchMathGlobals();
  vi.stubGlobal('deltaTime', 100);
  game = createGame() as TestGame;
  // `AttackableUnit.isAllied` asks the world who the player is, and every heal
  // below goes through a unit method that reads it. Parked far off the map and
  // never indexed, so it is in no query here.
  game.setPlayer(champion(TeamId.BLUE, -5_000));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('taking the relic', () => {
  it('is a champion walking over it, and it calls down a beam', () => {
    const relic = relicAt();
    indexObjects(game, [champion(TeamId.BLUE, 30)] as never);
    const built = capture();

    relic.update();

    expect(built).toHaveLength(1);
  });

  it('is not taken by a body standing just outside it', () => {
    const relic = relicAt();
    indexObjects(game, [champion(TeamId.BLUE, RELIC_PICKUP_RADIUS + 60)] as never);
    const built = capture();

    relic.update();

    expect(built).toHaveLength(0);
  });

  /**
   * A slot carries its own `r` and the map drew that circle for a reason, so a
   * relic on a wide pad is takeable from the edge of it. The constant is only
   * the floor, for a slot drawn as a point.
   */
  it('is takeable from anywhere inside a slot drawn wider than the floor', () => {
    const wide = RELIC_PICKUP_RADIUS + 200;
    const relic = relicAt(0, 0, wide);
    indexObjects(game, [champion(TeamId.BLUE, wide - 20)] as never);
    const built = capture();

    relic.update();

    expect(built).toHaveLength(1);
  });

  /** The taker is paid at once, and less than the beam pays. */
  it('heals whoever took it immediately, and by less than the beam will', () => {
    const relic = relicAt();
    const taker = champion(TeamId.BLUE, 30, true);
    indexObjects(game, [taker] as never);
    capture();

    relic.update();

    expect(taker.stats.health.value).toBe(200 + Math.round(800 * RELIC_PICKUP_MISSING_SHARE));
    expect(RELIC_PICKUP_MISSING_SHARE).toBeLessThan(RELIC_BEAM_MISSING_SHARE);
  });

  /**
   * And then it is gone. Before this the relic re-fired every frame a champion
   * stood on it, which is not a pickup — it is a fountain.
   */
  it('goes dark and comes back on its own clock', () => {
    const relic = relicAt();
    indexObjects(game, [champion(TeamId.BLUE, 30)] as never);
    const built = capture();

    relic.update();
    expect(built).toHaveLength(1);

    run(relic, RELIC_BEAM_DELAY_MS + RELIC_RESPAWN_MS - 1_000);
    expect(built).toHaveLength(1);

    run(relic, 2_000);
    expect(built).toHaveLength(2);
  });

  /**
   * The match's cooldown-reduction slider reaches it, because a relic is on a
   * cooldown in every sense a player uses the word. Ninety seconds is tuned
   * for a full-length game; core also runs practice matches whose
   * whole point is that the sliders move, and one that shortens every ability
   * while leaving the pad at a minute and a half reads as a broken slider.
   */
  it('comes back sooner under the match’s cooldown reduction', () => {
    game.matchRules = { cooldownMultiplier: 0.5, manaFree: false, recall: true };
    const relic = relicAt();
    indexObjects(game, [champion(TeamId.BLUE, 30)] as never);
    const built = capture();

    relic.update();
    expect(built).toHaveLength(1);

    // Past the *full* ninety and still nothing, if the rule were ignored.
    run(relic, RELIC_BEAM_DELAY_MS + RELIC_RESPAWN_MS / 2 - 1_000);
    expect(built).toHaveLength(1);

    run(relic, 2_000);
    expect(built, 'the relic waited its full tuning number under 50% CDR').toHaveLength(2);
  });

  /**
   * And the wait it started under is the wait it serves. `MatchDirector`
   * mutates the rules in place, so a slider dragged while a relic is dark must
   * not retune the clock already running — the same contract
   * `Spell.reducedCooldown` keeps by reading the rule when a countdown starts.
   */
  it('keeps the wait it started under when the slider moves mid-cooldown', () => {
    game.matchRules = { cooldownMultiplier: 0.5, manaFree: false, recall: true };
    const relic = relicAt();
    indexObjects(game, [champion(TeamId.BLUE, 30)] as never);
    const built = capture();

    relic.update();
    // In place, and cast to get there: the context publishes the rules as
    // `Readonly` because nothing in the world may retune a match, but
    // `MatchDirector.setRules` does exactly this to the same object so that
    // every spell already holding the reference sees the new number. Replacing
    // the whole object here would test a weaker thing.
    (game.matchRules as { cooldownMultiplier: number }).cooldownMultiplier = 1;

    run(relic, RELIC_BEAM_DELAY_MS + RELIC_RESPAWN_MS / 2 + 1_000);
    expect(built).toHaveLength(2);
  });

  /**
   * The beam delay is not a wait, it is the decision the object exists to
   * ask — an ally arriving to share it, the enemy on the pad being healed
   * twice what you were. Shrinking it with the slider deletes the object
   * rather than speeding it up.
   */
  it('leaves the beam delay alone, whatever the slider says', () => {
    expect(relicRespawnMs(0.5)).toBe(RELIC_RESPAWN_MS / 2);
    expect(relicRespawnMs(undefined), 'a headless world has no match rules').toBe(RELIC_RESPAWN_MS);

    game.matchRules = { cooldownMultiplier: 0.1, manaFree: false, recall: true };
    const relic = relicAt();
    indexObjects(game, [champion(TeamId.BLUE, 30)] as never);
    const built = capture();
    relic.update();

    const beam = built[0] as unknown as { update(): void; toRemove: boolean };
    run(beam, RELIC_BEAM_DELAY_MS - 200);
    const taker = champion(TeamId.BLUE, 30, true);
    indexObjects(game, [taker] as never);
    run(beam, 400);

    // Struck on its own two and a half seconds, not on a tenth of them.
    expect(taker.stats.health.value).toBe(200 + Math.round(800 * RELIC_BEAM_MISSING_SHARE));
  });
});

describe('the beam it calls down', () => {
  /** Takes the relic and hands back the beam it dropped. */
  const beamFrom = (takerTeam: string = TeamId.BLUE) => {
    const relic = relicAt();
    const taker = champion(takerTeam, 30);
    indexObjects(game, [taker] as never);
    const built = capture();
    relic.update();
    vi.restoreAllMocks();
    return { beam: built[0], taker };
  };

  /** Long enough for the strike, and no longer. */
  const strike = (beam: { update(): void }) => run(beam, RELIC_BEAM_DELAY_MS + 100);

  it('waits before it lands, so taking one is a decision and not a pickup', () => {
    const { beam } = beamFrom();
    const ally = champion(TeamId.BLUE, 120, true);
    indexObjects(game, [ally] as never);

    run(beam, RELIC_BEAM_DELAY_MS - 500);
    expect(ally.stats.health.value).toBe(200);

    run(beam, 1_000);
    expect(ally.stats.health.value).toBe(200 + beamHeal(800));
  });

  /**
   * **The one that matters.** The beam does not ask whose side
   * you are on, and an enemy standing on the pad drinks exactly as deeply —
   * which is what makes taking a relic under a fight a real mistake.
   */
  it('heals the enemy standing in it too, not only the taker’s side', () => {
    const { beam } = beamFrom(TeamId.BLUE);
    const ally = champion(TeamId.BLUE, 120, true);
    const enemy = champion(TeamId.RED, 200, true);
    indexObjects(game, [ally, enemy] as never);

    strike(beam);

    expect(enemy.stats.health.value).toBe(200 + beamHeal(800));
    expect(enemy.stats.health.value).toBe(ally.stats.health.value);
  });

  /**
   * A share of what is **missing**, not of the pool. It is worth nothing to
   * somebody standing there at full health, and worth the same to a tank and
   * to a marksman who have each lost half of themselves — which a share of the
   * maximum cannot do.
   */
  it('pays a share of what each body is missing', () => {
    const { beam } = beamFrom();
    const scratched = champion(TeamId.BLUE, 100, true);
    scratched.stats.health.baseValue = 900;
    const broken = champion(TeamId.BLUE, 160, true);
    const whole = champion(TeamId.BLUE, 220, true);
    whole.stats.health.baseValue = 1_000;
    indexObjects(game, [scratched, broken, whole] as never);

    strike(beam);

    expect(broken.stats.health.value).toBe(200 + beamHeal(800));
    expect(scratched.stats.health.value).toBe(900 + beamHeal(100));
    expect(whole.stats.health.value).toBe(1_000);
  });

  it('does not reach a body standing outside it', () => {
    const { beam } = beamFrom();
    const far = champion(TeamId.BLUE, RELIC_BEAM_RADIUS + 300, true);
    indexObjects(game, [far] as never);

    strike(beam);

    expect(far.stats.health.value).toBe(200);
  });

  /**
   * Champions only, which is the rule and not an oversight:
   * a beam that also topped up the wave would make taking a relic a way to
   * stall a push.
   */
  it('leaves the wave alone', () => {
    const { beam } = beamFrom();
    const minion = createUnit(game, 120, TeamId.BLUE);
    minion.stats.maxHealth.baseValue = 1_000;
    minion.stats.health.baseValue = 200;
    indexObjects(game, [minion] as never);

    strike(beam);

    expect(minion.stats.health.value).toBe(200);
  });

  /**
   * Through `takeHeal`, never `stats.health.baseValue`. A relic that put the
   * points back by hand would heal exactly the same and be the one heal in the
   * game that no Vết Thương Sâu in the shop can argue with — invisibly. Said
   * from the other end: the restore counts as self-healing and takes healing
   * modifiers.
   */
  it('heals through the door a wound can reach', () => {
    const { beam } = beamFrom();
    const cut = champion(TeamId.BLUE, 120, true);
    const enemy = champion(TeamId.RED, 3_000);
    const wound = new HealCut(10_000, enemy, cut);
    wound.healCut = 0.5;
    cut.addBuff(wound);
    indexObjects(game, [cut] as never);

    strike(beam);

    expect(cut.stats.health.value - 200).toBeLessThan(beamHeal(800));
    expect(cut.stats.health.value).toBeGreaterThan(200);
  });

  it('strikes once and is gone, rather than paying every frame', () => {
    const { beam } = beamFrom();
    const ally = champion(TeamId.BLUE, 120, true);
    indexObjects(game, [ally] as never);

    run(beam, RELIC_BEAM_DELAY_MS + 5_000);

    expect(ally.stats.health.value).toBe(200 + beamHeal(800));
    expect((beam as unknown as { toRemove: boolean }).toRemove).toBe(true);
  });

  /**
   * The same share, off missing mana. Asserted through `restoreMana` — the
   * granting door — rather than by reading the pool, because naming the pool
   * is what the `mana-spend` seam refuses: a test that reads it is one edit
   * away from a *spell* that writes it, and that is the seam's whole point.
   * The pool is widened rather than drained for the same reason.
   */
  it('refills mana the same way, off what is missing', () => {
    const { beam } = beamFrom();
    const mage = champion(TeamId.BLUE, 120, true);
    // A champion starts full, so the missing half comes from raising the roof:
    // 1000 max over core's own 500 starting pool.
    mage.stats.maxMana.baseValue = 1_000;
    const restored = vi.spyOn(mage, 'restoreMana');
    indexObjects(game, [mage] as never);

    strike(beam);

    expect(restored).toHaveBeenCalledWith(beamHeal(500));
  });
});
