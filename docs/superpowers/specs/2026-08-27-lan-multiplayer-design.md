# LAN Multiplayer v1 — host-authoritative event sync

Status: v1 prototype shipped on `feat/lan-net-prototype`; v1.5 (same
branch) added own-champion prediction, 30Hz snapshots, WebRTC DataChannel
transport with a deployed Cloudflare Worker signaling broker, per-network
room discovery and a menu lobby. This spec records the decisions and their
reasons; the "Unfinished" section at the bottom is the honest ledger of
what deliberately does not exist yet.

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
                 signaling only (SDP/ICE)                signaling only
host browser ───────────┐                  ┌──────────── client browser(s)
 (real Game)            ▼                  ▼              (gated Game + own-
              Cloudflare Worker + Durable Objects          champion prediction)
              (net/signaling/, or scripts/net-relay.mjs in dev)
host browser ◄════ RTCDataChannels, peer-to-peer ════► client browser(s)
              `r` reliable: hello/events/orders
              `u` unordered, maxRetransmits 0: snapshots
```

- **WebRTC DataChannels are the player wire** (`transport=rtc`, the
  default): the broker carries only the handshake, then traffic is direct
  peer-to-peer — on one LAN that is ICE _host candidates_, sub-millisecond,
  no server in the loop (`iceServers` is deliberately empty; internet play
  needs STUN/TURN — roadmap). Two channels per peer: `r` reliable/ordered
  for the hello, events and orders; `u` `ordered:false, maxRetransmits:0`
  for snapshots, which supersede each other 33ms apart anyway and whose
  stale arrivals the interpolation buffer already drops by match time.
  `src/game/net/transport.ts` is the seam: `RtcHostTransport`/
  `RtcClientTransport` and the relay transports are two implementations of
  one interface, and the sessions cannot tell them apart.
- **Signaling is a Cloudflare Worker + two Durable Object classes**
  (`net/signaling/`, deployed at
  `wss://lol2d-signal.99-hoangtran.workers.dev`, baked as the production
  default in `src/scenes/lanSignal.ts` and overridable with `?signal=`).
  `SignalRoom` speaks **exactly `scripts/net-relay.mjs`'s protocol** — one
  host, N joiners, `{from}`/`{to}` envelopes, join/leave notices — so the
  dev relay remains a drop-in signaling (and `transport=ws` full-transport)
  stand-in and `npm run e2e:lan` never touches the internet. `RoomDirectory`
  is one instance per public IP (`CF-Connecting-IP`): a room registers with
  its host's network directory while the host stays connected (DO-alarm
  heartbeat, unregister on disconnect), and `GET /rooms` answers the open
  rooms _on the caller's network_ — which is how two devices behind one NAT
  find each other with no typing, the closest browsers get to mDNS.
- **The menu got a lobby** (`MenuScene.vue` + `src/scenes/lanSignal.ts`,
  which lives under `src/scenes/` because everything under `/src/game/` is
  pinned to the game chunk and a menu import from there would be the banned
  pregame→game edge): Tạo phòng LAN (5-char code), the same-network room
  list polled from the broker with one-click join, and a join-by-code
  fallback. The lobby only ever writes the same URL parameters a hand-typed
  link (or the e2e driver) writes, then presses the ordinary play path —
  `GameScene.startGame`'s net arming stays the single seam.
- **The host runs the match unchanged.** `HostSession` (`src/game/net/
HostSession.ts`) attaches after `new Game(...)` and:
  - broadcasts a snapshot every 33ms (30Hz — LoL's own quantum): per tracked unit
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
- **The own champion is predicted, not interpolated** (v1.5, after the
  measurement: 67ms from keypress to visible cast, 66 of it the cast event
  waiting for the snapshot-cadence flush). Every client intercept sends the
  order _and_ lets the local seam run — real walk, real cast, real cooldown
  the same tick the key lands — while the host's echo cast event is dropped
  and reconciliation compares against the newest raw snapshot: resources,
  death and cooldowns applied verbatim, position pulled gently past 60
  units of drift and snapped past 300 (a knockback prediction cannot see).
  Cast events also flush the tick they commit instead of riding the
  snapshot cadence. Measured after: own cast 1-4ms, remote commit 2-8ms, on
  both transports.

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

URL-armed (`?net=host|join&room=CODE[&transport=rtc|ws][&signal=wss://…]`),
or through the menu's LAN box, which writes exactly those parameters and
presses the ordinary play path. On
join the host rolls a random champion for the client (loading its spell
chunks first), spawns it on the smaller team, and sends `hello` with the
map id, rules (`cooldownMultiplier`/`manaFree`, applied onto the client's
`matchRules` in place), the client's own `KitPlan` + id, and spawn events
for every unit already alive.

## 6. Roadmap (v2+)

Landed since v1: WebRTC DataChannels with the lossy snapshot lane, the
deployed Worker signaling with per-network discovery, own-champion
prediction with reconciliation, 30Hz snapshots, the menu lobby. Ahead:

1. **Fixed 30Hz simulation tick on the host** (accumulator in
   `Game.update`) — also equalizes single-player feel across refresh rates.
2. **Movement as path replication**: `NavigationSystem` already produces
   waypoint lists and minions already walk them — replicate orders + paths,
   send low-rate corrections, and snapshots shrink by an order of
   magnitude.
3. **STUN/TURN for internet play** — the RTC config is deliberately
   host-candidates-only today; crossing NATs needs at least STUN, and
   symmetric NATs need TURN (Cloudflare's TURN service pairs naturally with
   the existing Worker).
4. **Fog-of-war interest culling**, through the same
   `PredefinedFilters.visibleTo` seam the engine already routes sight
   through.
5. **Seed handshake for cosmetics + a replay recorder** (inputs + seed on
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
- **Snapshot format is JSON** (~3-6KB × 30Hz ≈ 100-180KB/s) — fine for a
  LAN and trivial for a DataChannel; binary is v2's problem.
- **Prediction mispredicts are cosmetic and uncorrected**: a locally-played
  cast the host refused (a silence landed first, death raced the key) shows
  a ghost animation; authoritative state overwrites within a snapshot.
- **The lobby's room list needs the broker reachable**: a fully offline LAN
  (no internet at all) needs the dev relay pointed at by `?signal=`; room
  codes still work against any reachable broker.
- **A stale `?net=` in the address bar re-arms LAN on the next plain Chơi**
  — the params are deliberately the API; clearing them is the player's (or
  a future lobby toggle's) job.
