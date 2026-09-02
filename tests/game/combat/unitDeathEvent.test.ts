import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import AttackableUnit, {
  type UnitDeathEvent,
} from '@/game/gameObject/attackableUnits/AttackableUnit';
import EventType from '@/game/enums/EventType';

/**
 * `EventType.ON_DIE` was declared for a long time and emitted by nobody. It
 * now fires once per death, on the transition, after the kill is counted —
 * the kill feed (`combat/Announcer.ts`) is its first listener.
 */
describe('the ON_DIE event', () => {
  let game: TestGame;
  let heard: UnitDeathEvent[];

  const unit = (x: number, teamId: string): AttackableUnit => {
    const created = new AttackableUnit({ game, position: createVector(x, 0), teamId });
    created.stats.health.baseValue = 100;
    created.stats.maxHealth.baseValue = 100;
    return created;
  };

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    heard = [];
    game.eventManager.on(EventType.ON_DIE, (event: UnitDeathEvent) => heard.push(event));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires once per death with the killer and the victim's credit, after the kill is counted", () => {
    const killer = unit(0, 'blue');
    const victim = unit(100, 'red');
    game.setPlayer(killer);
    indexObjects(game, [killer, victim]);
    victim.die({ attacker: killer, reviveAfter: 1000 });
    victim.die({ attacker: killer, reviveAfter: 1000 });

    expect(heard).toHaveLength(1);
    expect(heard[0].unit).toBe(victim);
    expect(heard[0].killer).toBe(killer);
    expect(heard[0].credit).toBe('minion');
    expect(killer.tally.minionsKilled).toBe(1);
  });

  it('reports a death nobody caused with no killer, and never the victim as its own killer', () => {
    const victim = unit(0, 'red');
    victim.die({ reviveAfter: 1000 });
    victim.respawn();
    victim.die({ attacker: victim, reviveAfter: 1000 });
    expect(heard.map(e => e.killer)).toEqual([undefined, undefined]);
  });

  it('is heard with the corpse already a corpse', () => {
    const victim = unit(0, 'red');
    let deadWhenHeard: boolean | null = null;
    game.eventManager.on(EventType.ON_DIE, (event: UnitDeathEvent) => {
      deadWhenHeard = event.unit.isDead;
    });
    victim.die({ reviveAfter: 1000 });
    expect(deadWhenHeard).toBe(true);
  });
});
