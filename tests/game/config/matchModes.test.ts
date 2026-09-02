import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_MODE_ID,
  MATCH_MODES,
  applyMode,
  describeMode,
  isMatchModeId,
  matchModeFor,
  mergeTuning,
  modeDrift,
} from '../../../src/game/config/matchModes';
import { DEFAULT_PREGAME_CONFIG, sanitizePregameConfig } from '../../../src/game/config/PregameConfig';
import { checkMapTuning } from '../../../src/content/validate';
import type { MapTuning } from '../../../src/content/ContentPack';

const classic = matchModeFor('classic');

describe('the mode table', () => {
  it('has unique ids, classic first, and answers classic for an id nothing knows', () => {
    const ids = MATCH_MODES.map(mode => mode.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(DEFAULT_MATCH_MODE_ID);
    expect(matchModeFor('ranked').id).toBe('classic');
    expect(matchModeFor(undefined).id).toBe('classic');
    expect(isMatchModeId('urf')).toBe(true);
    expect(isMatchModeId('ranked')).toBe(false);
    expect(isMatchModeId(3)).toBe(false);
  });

  it('classic is the defaults — rules, world and bot count — so it is the way back', () => {
    expect(classic.rules).toEqual(DEFAULT_PREGAME_CONFIG.rules);
    expect(classic.world).toEqual(DEFAULT_PREGAME_CONFIG.world);
    // A literal in the table (the file comment says why); pinned here.
    expect(classic.bots).toBe(DEFAULT_PREGAME_CONFIG.ai.count);
    expect(classic.tuning).toBeUndefined();
    expect(classic.allRandom).toBeUndefined();
  });

  it('every mode’s tuning is one the map validator would accept', () => {
    for (const mode of MATCH_MODES) {
      if (!mode.tuning) continue;
      const errors: string[] = [];
      checkMapTuning(mode.tuning, mode.id, errors);
      expect(errors, mode.id).toEqual([]);
    }
  });

  it('every mode declares whole rules and a whole world, never a patch', () => {
    for (const mode of MATCH_MODES) {
      expect(Object.keys(mode.rules).sort()).toEqual(['cooldownReductionPercent', 'manaFree', 'recall']);
      expect(Object.keys(mode.world).sort()).toEqual(['jungle', 'minions']);
    }
  });

  it('URF is CDR at 80 with mana off; the brawl is random kits with no recall and no jungle', () => {
    const urf = matchModeFor('urf');
    expect(urf.rules).toEqual({ cooldownReductionPercent: 80, manaFree: true, recall: true });
    const brawl = matchModeFor('brawl');
    expect(brawl.allRandom).toBe(true);
    expect(brawl.rules.recall).toBe(false);
    expect(brawl.world.jungle).toBe(false);
    expect(matchModeFor('duel').bots).toBe(1);
    expect(matchModeFor('war').bots).toBe(9);
  });
});

describe('applyMode', () => {
  it('writes rules, world and bot count into a copy and leaves the input alone', () => {
    const before = sanitizePregameConfig(DEFAULT_PREGAME_CONFIG);
    const after = applyMode(before, matchModeFor('duel'));
    expect(after.mode).toBe('duel');
    expect(after.ai.count).toBe(1);
    expect(after.rules).toEqual(matchModeFor('duel').rules);
    expect(before.ai.count).toBe(DEFAULT_PREGAME_CONFIG.ai.count);
    expect(before.mode).toBe('classic');
  });

  it('leaves the bot count alone for a mode with no opinion on it', () => {
    const before = { ...sanitizePregameConfig(DEFAULT_PREGAME_CONFIG) };
    before.ai = { ...before.ai, count: 7 };
    expect(applyMode(before, matchModeFor('urf')).ai.count).toBe(7);
  });

  it('survives sanitising, which is what the source does to it', () => {
    const applied = sanitizePregameConfig(applyMode(sanitizePregameConfig({}), matchModeFor('brawl')));
    expect(applied.mode).toBe('brawl');
    expect(applied.rules.recall).toBe(false);
    expect(applied.world.jungle).toBe(false);
  });
});

describe('modeDrift', () => {
  const knobsOf = (id: string, botCount = 3) => {
    const mode = matchModeFor(id);
    return { rules: { ...mode.rules }, world: { ...mode.world }, botCount };
  };

  it('is false when the knobs are where the mode put them', () => {
    expect(modeDrift(matchModeFor('urf'), knobsOf('urf'))).toBe(false);
    expect(modeDrift(classic, knobsOf('classic', 3))).toBe(false);
  });

  it('is true once any declared knob moves', () => {
    const urf = matchModeFor('urf');
    const knobs = knobsOf('urf');
    expect(modeDrift(urf, { ...knobs, rules: { ...knobs.rules, cooldownReductionPercent: 40 } })).toBe(true);
    expect(modeDrift(urf, { ...knobs, world: { ...knobs.world, jungle: false } })).toBe(true);
    expect(modeDrift(classic, knobsOf('classic', 5))).toBe(true);
  });

  it('ignores the bot count for a mode that says nothing about bots', () => {
    expect(modeDrift(matchModeFor('urf'), knobsOf('urf', 9))).toBe(false);
  });
});

describe('describeMode', () => {
  it('lists only what deviates from the defaults', () => {
    expect(describeMode(classic)).toEqual(['3 bot']);
    expect(describeMode(matchModeFor('urf'))).toEqual(['Giảm hồi chiêu 80%', 'Không tốn mana']);
    expect(describeMode(matchModeFor('brawl'))).toEqual([
      'Tướng ngẫu nhiên cho tất cả',
      'Không hồi thành',
      'Không quái rừng',
    ]);
    expect(describeMode(matchModeFor('blitz'))).toEqual([]);
  });
});

describe('mergeTuning', () => {
  it('is undefined for nothing over nothing, and the map’s own object when the mode says nothing', () => {
    expect(mergeTuning(undefined, undefined)).toBeUndefined();
    const map: MapTuning = { economy: { startingGold: 700 } };
    expect(mergeTuning(map, undefined)).toBe(map);
  });

  it('lays the overlay field by field, keeping the map’s other numbers and its absences', () => {
    const map: MapTuning = {
      economy: { startingGold: 700, minionBounty: 25 },
      champions: { healthMult: 1.2 },
    };
    const merged = mergeTuning(map, { economy: { startingGold: 2000 }, champions: { speedMult: 1.15 } })!;
    expect(merged.economy).toEqual({ startingGold: 2000, minionBounty: 25 });
    expect(merged.champions).toEqual({ healthMult: 1.2, speedMult: 1.15 });
    // Untouched groups stay absent: a reader's own default must still apply.
    expect(merged.turrets).toBeUndefined();
    expect('monsters' in merged).toBe(false);
  });

  it('mutates neither side', () => {
    const map: MapTuning = { economy: { startingGold: 700 } };
    const overlay: MapTuning = { economy: { passiveGoldPerSecond: 6 } };
    mergeTuning(map, overlay);
    expect(map).toEqual({ economy: { startingGold: 700 } });
    expect(overlay).toEqual({ economy: { passiveGoldPerSecond: 6 } });
  });

  it('merges one level deeper for nested objects, and replaces a minion roster whole', () => {
    const map: MapTuning = {
      champions: { reviveCurve: { base: 8000, perMinute: 2500, max: 60000 } },
      minions: {
        types: { melee: { health: 1, damage: 1, speed: 1, attackRange: 1, attackSpeed: 1, aggroRange: 1 } },
        waves: { intervalMs: 30000, liveCap: 60 },
      },
    } as MapTuning;
    const merged = mergeTuning(map, {
      champions: { reviveCurve: { base: 3000 } as never },
      minions: {
        types: { siege: { health: 2, damage: 2, speed: 2, attackRange: 2, attackSpeed: 2, aggroRange: 2 } },
        waves: { intervalMs: 15000 },
      },
    } as MapTuning)!;
    expect(merged.champions?.reviveCurve).toEqual({ base: 3000, perMinute: 2500, max: 60000 });
    expect(Object.keys(merged.minions?.types ?? {})).toEqual(['siege']);
    expect(merged.minions?.waves).toEqual({ intervalMs: 15000, liveCap: 60 });
  });

  it('skips undefined overlay fields rather than writing them', () => {
    const merged = mergeTuning({ economy: { startingGold: 700 } }, { economy: { startingGold: undefined } })!;
    expect(merged.economy?.startingGold).toBe(700);
  });
});
