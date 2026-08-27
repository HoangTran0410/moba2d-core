# LAN Multiplayer v1 — host-authoritative event sync

Status: v1 prototype shipped on `feat/lan-net-prototype`. This spec records
the decisions and their reasons; the "Unfinished" section at the bottom is
the honest ledger of what v1 deliberately does not do.

## 1. The model: host-authoritative, never lockstep

Two architectures can network an RTS-like game. **Lockstep** syncs only
inputs and requires every machine to simulate identically — full determinism.
**Host-authoritative** runs the one true simulation on one machine and treats
every other client as a renderer that sends orders.

This engine cannot do lockstep without a rewrite, and the evidence that the
rewrite is a project rather than a patch is Riot's own published record.
Their "Determinism in League of Legends" series (riotgames.com/en/news/
determinism-league-legends-introduction, -unified-clock, -implementation,
-fixing-divergences) describes making _only the server_ deterministic — same
binary, same machine class, replaying recorded inputs, i.e. the easy half of
the problem, with no cross-machine or cross-vendor floating point involved —
and it took a dedicated team from 2016 to a May 2017 v2.0, with divergence
hunts like an uninitialized vector field bisected across 580,000 constructor
call sites and their own conclusion that "there is not a one-size-fits-all
solution to resolving every divergence." And having built it, they still did
not network with it: determinism served Chronobreak (esports replay/rewind),
while the game stayed server-authoritative.

Our engine's specific disqualifiers, before floats are even discussed:

- Simulation advances by `deltaTime` per rendered tick — a 60Hz and a 144Hz
  machine integrate different step sizes (the `Camera.smoothingFor` lesson,
  engine-wide).
- One global `Math.random` stream serves gameplay (crit rolls, `'random'`
  kit resolution, muster scatter, bot roaming) _and_ per-frame cosmetics.
  Seeding it at handshake — the obvious idea — keeps two machines aligned
  only if they draw the same count in the same order forever; one extra
  particle on the faster machine desyncs the stream silently and for good.
  A seed handshake is therefore a _replay_ feature (record inputs + seed,
  play back on the same build and machine — exactly Chronobreak's trick)
  and a cosmetics nicety, not a sync foundation.
- `Math.sin/cos/atan2` are implementation-defined across JS engines.

Host-authority sidesteps all of it: non-determinism stops mattering when
there is one truth.

## 2. What LoL's shipped model actually is

From the League wiki's "Tick and updates" page and widely-documented client
behaviour: the server simulates at a fixed 30.30Hz (33ms ticks) and does all
logic — input, AI, pathing, positions, damage; clients render at any frame
rate with no gameplay advantage; cast times quantize up to the next tick.
Movement replicates as _orders and paths_ (click-to-move compresses to a
waypoint list plus speed, corrected rarely) rather than per-tick positions,
and the server culls updates by fog of war (anti-maphack and bandwidth).

That is the ceiling this design climbs toward. v1 takes the shape (authority,
events, interpolation) and defers the optimizations (fixed tick, path
replication, fog culling) — see §6.

## 3. v1 architecture

```
host browser ──ws── scripts/net-relay.mjs ──ws── client browser(s)
 (real Game)          (dumb room fan-out)         (gated Game, puppets)
```

- **Relay, not WebRTC.** Browsers cannot listen on sockets, and WebRTC needs
  a signaling step anyway; a ~100-line `ws` room relay (`scripts/
net-relay.mjs`) is the v1 transport. It knows nothing about the game: one
  host per room, N joiners, `{to}`-addressed or broadcast JSON frames,
  join/leave notices to the host.
- **The host runs the match unchanged.** `HostSession` (`src/game/net/
HostSession.ts`) attaches after `new Game(...)` and:
  - broadcasts a snapshot every ~66ms (15Hz): per tracked unit
    `[id, x, y, hp, maxHp, mana, dead, actionState, cooldowns?]`, stamped
    with `matchTimeMs`;
  - discovers units by diffing `objectManager.objects` against its id map —
    no hook inside `MinionSpawner` or anywhere else; a new champion/minion
    gets a spawn event, a removed object a `gone` event;
  - broadcasts every committed cast: the engine already funnels every real
    cast of every activation pattern through one delegate that emits
    `EventType.ON_POST_CAST_SPELL` (`Spell.ts`), so one listener covers 300+
    spells without touching any of them;
  - applies client orders (`move`, `cast`, `recall`) to the champion it
    spawned for that client, through the same seams local input uses —
    `issuePointerOrder`, `createSpellContext` + `spell.press`.
- **The client boots the same `GameScene`, sim-gated.** The client is told
  the map id, match rules, its own kit (a `KitPlan` — already plain
  serializable data) and the roster; it loads those spells and that
  geometry, then constructs `Game` with no bots and applies snapshots.
  Identity: champions and minions carry host-assigned ids delivered by spawn
  events; turrets and jungle monsters are matched _by construction order_
  (`t<i>`, `m<i>`), which is deterministic because both sides build them
  from the same map data — the handshake refuses a client whose map id does
  not resolve.
- **Interpolation** (`InterpolationBuffer.ts`, pure): keep the last few
  snapshots; each render tick, lerp between the two newest by local elapsed
  time (~one snapshot interval of latency), per-time not per-frame; snap
  instead of lerp when a unit moved more than a dash threshold between
  snapshots, so blinks read as blinks.

## 4. The gates — four seams, no sprinkling

The client must not simulate outcomes, and the codebase's single-funnel
seams make that four early-returns behind one flag (`src/game/net/
netRole.ts`, a dependency-free module anything may import):

| Seam                        | Gate                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `AttackableUnit.takeDamage` | no-op on net-client — health is snapshot truth; every damage source in the game already funnels here                             |
| `Spell.effectiveMana`       | returns 0 on net-client — the single expression of mana cost, so puppet casts are never refused for a resource the snapshots own |
| `MinionSpawner.update`      | no-op on net-client — minions exist only via spawn events                                                                        |
| `Game` constructor          | on net-client: skip the bot loop (remote champions arrive as spawn events) and take the player's team/kit from the handshake     |

Client input is intercepted at the three places local orders are born (the
right-click block in `Game.fixedUpdate`, the kit controller's
`createContext`, `Game.recall`) and serialized to the host instead of
executed. Everything else — spell visuals, buffs' cosmetic halves, walk
animation — runs untouched: a puppet's cast plays the full spell locally,
its damage dies in the gated `takeDamage`, and the 15Hz snapshots keep
positions and health honest.

The client's own champion is deliberately _not_ predicted in v1: its orders
go to the host, and its casts come back as ordinary cast events (~RTT + one
snapshot interval late — small on LAN). One code path for every unit.

## 5. Joining

URL-armed, no menu UI: `?net=host&server=ws://<ip>:8790&room=r1` on the
hosting machine, `?net=join&...` on the client, both then press Chơi. On
join the host rolls a random champion for the client (loading its spell
chunks first), spawns it on the smaller team, and sends `hello` with the
map id, rules (`cooldownMultiplier`/`manaFree`, applied onto the client's
`matchRules` in place), the client's own `KitPlan` + id, and spawn events
for every unit already alive.

## 6. Roadmap (v2+)

1. **Fixed 30Hz simulation tick on the host** (accumulator in
   `Game.update`) — LoL's 33ms quantum; also equalizes single-player feel
   across refresh rates.
2. **Movement as path replication**: `NavigationSystem` already produces
   waypoint lists and minions already walk them — replicate orders + paths,
   send low-rate corrections, and snapshots shrink by an order of
   magnitude.
3. **WebRTC DataChannel + QR/copy-paste signaling** — serverless LAN, and
   unreliable-mode snapshots stop head-of-line blocking casts.
4. **Client-side prediction for the own champion**, with snapshot
   reconciliation.
5. **Fog-of-war interest culling**, through the same
   `PredefinedFilters.visibleTo` seam the engine already routes sight
   through.
6. **Seed handshake for cosmetics + a replay recorder** (inputs + seed on
   one build/machine — the Chronobreak shape).

## 7. Unfinished in v1 (deliberate cuts, in the open)

- **Shop/gold are not synced**: the client's shop UI operates on local,
  meaningless gold; host-side purchases do sync their stat effects via
  snapshots (health/mana) but item icons/actives do not appear on the
  client. Cut because the economy rides `MatchDirector` paths v1 does not
  touch.
- **StatusFlags are not transmitted** (only `actionState`): client-side CC
  presentation may lag reality between snapshots.
- **Touch controls on a net client are not intercepted** (`steerPlayer`
  writes locally); keyboard/mouse only for v1 clients.
- **Charge spells on puppets release instantly** at min charge — the cast
  event carries no hold duration yet.
- **No reconnect, no mid-match join after the first hello race, no host
  migration**: a dropped socket is a dead session.
- **`UNIT`-targeted casts re-resolve on the client** from the aim point, so
  the puppet may visually strike a different-but-nearby target than the
  host did; damage is host-truth either way.
- **Snapshot format is JSON** (~3-6KB × 15Hz ≈ 50-90KB/s) — fine for LAN,
  binary is v2's problem.
