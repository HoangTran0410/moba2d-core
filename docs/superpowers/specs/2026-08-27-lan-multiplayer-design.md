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
  `wss://moba2d-signal.99-hoangtran.workers.dev`, baked as the default in
  dev **and** production by `src/scenes/lanSignal.ts` — a fresh
  `npm run dev` must not spray connection refusals at a relay nobody
  started — and overridable with `?signal=`). `SignalRoom` speaks **exactly
  `scripts/net-relay.mjs`'s protocol** — one host, N joiners,
  `{from}`/`{to}` envelopes, join/leave notices — so the dev relay remains
  a drop-in signaling (and `transport=ws` full-transport) stand-in behind
  an explicit `?signal=ws://localhost:8790`, which is what
  `npm run e2e:lan` passes to never touch the internet. `RoomDirectory`
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

- ~~Shop/gold are not synced~~ — **landed 2026-08-28.** The bag crosses as a
  `bag` event (qualified ids per slot, diffed hook-free in `discover` the way
  the world itself is, and carried in the hello so a joiner sees boots bought
  before it arrived); the client rebuilds the real `HeldItem` through the same
  `buildHeldItem` a purchase uses, slot by slot through `equipItem`/
  `unequipItem`, so icons, passives, actives and stat modifiers are genuine.
  Gold rides the snapshot beside `cds`, for the champions a client is actually
  playing and nobody else. Buying, selling and dragging go to the host as
  `buy`/`sell`/`swap` and have **no local half** — the gold and the fountain
  rule are the host's. Item actives cross as an ordinary `cast`/`rel`/`stop`
  with `row: 'item'`, which is what the wire had been missing: the slot used
  to index `champion.spells` only, so a client's item actives ran locally and
  therefore did nothing.

  The one thing this forced elsewhere: a client's champion now carries
  modifiers of its own, so the snapshot's composed stat can no longer be
  written straight into `baseValue` — the belt would be added twice.
  `ClientSession.setComposedValue` inverts the composition instead, which
  keeps the documented invariant (the client shows the host's number, never
  one it computed) and closes the same latent hole for buffs.
- **StatusFlags are not transmitted** (only `actionState`): client-side CC
  presentation may lag reality between snapshots.
- **Touch controls are intercepted** as of 2026-08-28. The claim they were
  not was always broader than the truth: spell buttons, charge press/release,
  recall and the minimap's tap-teleport were never a separate path — a thumb
  and a mouse meet at `createContext`, and the whole touch layer went through
  the same seams. The one hole was the *joystick*: `steerPlayer` called
  `moveTo` locally with nothing on the wire, so a phone's stick moved only
  its own screen and reconciliation pulled the champion back — a rubber band,
  not a dead control, which is why it read as the whole of touch being
  broken. It now crosses as its own `steer` message (push sampled on the
  right-click window, release sent unconditionally) — see `protocol.ts` for
  why it is not a `move`.
- **Charge spells on *puppets* release instantly** at min charge — the cast
  event still carries no hold duration. The *own champion's* charges are
  real since the press/release wire landed (2026-08-28): the client sends
  `cast` on press and `rel` on release (`stop` for a called-off charge), so
  the host's authoritative copy charges for as long as the real thumb held
  — puppets only mis-time the visual, positions ride snapshots regardless.
- **A client's kit and side changes sync; the rest of the panel does
  not.** The editor also *opens* on the client's real kit: `loadoutOf` is
  seeded from the hello plan (`preset.loadoutFromPlan`), not from this
  device's stored pregameConfig — two tabs on one machine share
  `localStorage`, which the host tab persists its own loadout into, so the
  client's đổi-tướng modal used to open showing the host's kit. Đổi tướng
  crosses as a `loadout` message carrying the applied
  plan (`net/kitWire.ts`), đổi phe as a `team` message (both through
  `MatchDirector`'s own methods, whose net hooks re-broadcast — the champ
  event always carries the current team). `Game.pause()` refuses while a
  net session is attached, so the panel opens over the running match on
  both ends (the shop's old rule) — and the **away-handler is skipped
  entirely in a net match** (`GameScene._leavePage`): it used to suspend
  the runtime unconditionally and open the panel, and with `pause()`
  refusing, the panel's close button had no `unpause()` to resume
  through — a blurred client froze for ever, and a blurred host froze
  everyone's match. A client's *other* panel mutations — rules, world,
  map, reset and the practice cheats — **are gated as of 2026-08-28**:
  `MatchConfigSource.canEditMatchSettings` is `!isNetClient()`, refused in
  `MatchDirectorSource` itself (not only in the tabs, because `v-tap` binds
  touch events straight to the element and they still fire on a disabled
  `<button>`), with the Trận đấu tab rendering its controls disabled — the
  host's real CDR greyed out rather than a tab that says nothing — and the
  Đội tab's "Luyện tập" group hidden on the client's own row, the one row
  there that is not `remote`. Untouched on purpose: the Cài đặt tab (input
  mode, render quality, FPS, zoom, `revealMap`, debug layers — this screen,
  not the match), the way out, and kit/side, which cross the wire as a
  request. `tests/game/config/netClientMatchSettings.test.ts` asserts both
  halves. **Adding and removing bots is still ungated and still desyncs** —
  a client's local bot count is forced to 0 at construction, so an added bot
  is a body only that device can see.
- **No reconnect, no host migration**: a dropped socket is a dead session.
  A departed client's champion is swept off the host (and, via 'gone', off
  every other client) the moment the transport reports the leave; coming
  back is an ordinary new join with a fresh champion.
- **`UNIT`-targeted casts re-resolve on the client** from the aim point, so
  the puppet may visually strike a different-but-nearby target than the
  host did; damage is host-truth either way.
- **Snapshot format is JSON** (~3-6KB × 30Hz ≈ 100-180KB/s) — fine for a
  LAN and trivial for a DataChannel; binary is v2's problem.
- **Prediction mispredicts are cosmetic and uncorrected**: a locally-played
  cast the host refused (a silence landed first, death raced the key) shows
  a ghost animation; authoritative state overwrites within a snapshot.
- **The lobby's room list needs the broker reachable**: a fully offline LAN
  (no internet at all) needs the dev relay pointed at by `?signal=` — which
  now serves the same `GET /rooms` listing+announce endpoint the Worker
  does, so discovery works offline too.
- **A room exists the moment its code is on screen** (2026-08-28): the
  lobby's 4s `/rooms` poll carries `?announce=<code>`, so the broker lists
  the room under the *poll's own* IP — before any match or WebSocket
  exists. This is what fixed "tạo phòng mà tab bên cạnh không thấy": the
  old sole registrar was the match-start WebSocket, and a dual-stack host
  could even register under IPv6 while a neighbour listed under IPv4.
  Announced entries live 15s past their last poll; WS entries keep the 90s
  heartbeat leash, and an in-match room may sit in both per-family
  directories at once. The room DO also **replays `sys:joined`** to a host
  that connects late, so a friend can press Vào while the host is still in
  the menu and simply waits at the loading screen for the hello.
- **Synced since 2026-08-28, beyond the original cuts**: the minimap's
  tap-teleport (`tp`, the one wire-only intercept — predicting it locally
  just got snapped back), each client's own death recap (`died`, host →
  that client, since a client's damage ledger is gated empty), the Đội
  tab's read-only LAN rows on both ends (`NetGameHooks.netRosterUnits`),
  a host-added mid-match champion's spell chunks (the client fetches
  before building the puppet instead of degrading every slot to a basic
  attack), **champion basic-attack visuals** (`atk` events replayed through
  `BasicAttackController.replayLaunch` — a champion's controller only fires
  on orders, which puppets never hold, while minions/monsters/turrets swing
  on their own local timers at both ends and are deliberately not
  forwarded), **summoned pets by adoption** (a `Pet` is a `Champion`, so
  the host already broadcast it — as an avatar-less default-sized puppet
  beside the client's own locally-played summon, two bears of which only
  the ugly one was real; the client now *claims the local body* for the
  host's spawn event — `ClientSession.adoptLocalPet`, nearest unclaimed
  same-team pet within 300u — so the pack subclass's own draw survives,
  with a core-`Pet` rebuild as the fallback for a summon with no local
  twin, e.g. one predating the join. `Pet.update` keeps only the clock on
  a net client — brain/leash/expiry are host facts — and an unclaimed
  local pet past `NET_PET_ADOPT_GRACE_MS` was a misprediction, removed
  quietly. Champ events carry `pet.{size, lifeMs(remaining), ownerId}`;
  pets stay off the Đội tab), and every floating damage number (`dmg` events in the ordinary
  flush — `AttackableUnit.takeDamage` announces the post-mitigation figure
  on `EventType.ON_TAKE_DAMAGE` in the same breath it floats it, and the
  client replays it through the same `CombatText.show`; a client's gated
  `takeDamage` can float nothing of its own). Still local-only: score
  tallies on a client (snapshots carry no KDA), heal/shield/gold combat
  text (heals still run in the puppets' local sim; gold is unsynced), and
  every panel mutation other than the own-champion loadout.
- **A stale `?net=` in the address bar re-arms LAN on the next plain Chơi**
  — the params are deliberately the API. Clearing them was "the player's (or
  a future lobby toggle's) job"; **the lobby is that toggle as of
  2026-08-28**, so backing out of it strips `net` and `room` and leaves
  every other parameter (`signal`, `transport`) alone. A hand-typed link is
  still honoured verbatim right up until someone opens the lobby and leaves
  it, which is a deliberate gesture and reads as one.
- **The lobby is its own scene** (`scenes/LanScene.{ts,vue}`,
  `styles/lan-scene.css`, `#lan-scene` in `index.html`), reached from the
  menu's second big button. It was a fold-out drawer on the menu, where
  "Chơi", "Cấu Hình Trận Đấu" and "Chơi LAN" were three identical
  `.hextech-btn`s and the drawer produced a fourth for "Tạo phòng LAN" —
  create and join, the one real choice on the screen, arrived as a flat list
  of four equal things. Two named sections now, and a room code big enough
  to read out loud. **Joining waits *in the lobby*, with no deadline**
  (`game/net/lobbyJoin.ts`): pressing Vào used to arm the URL and go straight
  to `GameScene`, which connected and gave the host fifteen seconds to
  answer — and a host that has made a room but not pressed Vào trận is not
  connected to the broker at all, so the ordinary "make a room, read the code
  out, then start" flow ended in *"net: WebRTC handshake timed out — is the
  host still up?"* about a host in the same room. Nothing on the wire was
  wrong: the `sys:joined` replay above exists precisely so a joiner may
  arrive first. The fix is `timeoutMs: Infinity` on both halves of the wait
  (the handshake and the hello) plus moving the wait onto the lobby screen,
  where it is a spinner beside the host's own code rather than a dead loading
  screen. `RtcClientTransport.connect` takes `{ timeoutMs, abort }` for it,
  and **must not hand `Infinity` to `setTimeout`** — a delay past 2^31-1 wraps
  and fires at once, so the timer is only created when the deadline is
  finite. The lobby's connection is then **handed over** rather than remade
  (`takeHeldRoom`): by the time the hello lands the channel already holds the
  host's opening events, and a second dial would wait for a second hello that
  is never sent. Cancelling (Huỷ, or Quay lại) aborts and closes, or the
  broker goes on counting a joiner who walked away. A hand-typed
  `?net=join&room=…` straight into Chơi is untouched and keeps the ordinary
  deadlines — there the host *is* supposed to be playing already, and silence
  is a real failure.
- **The room has a player list, and the host holds the room open from Tạo
  phòng** (`game/net/lobbyHost.ts`). The host used to connect to the broker
  only at Vào trận, so it could not see that anyone had joined — a code on
  screen and no way to tell an empty room from a full one. Now the wire is up
  while the code is: a joiner announces itself with `iam` (its configured
  champion, or "Ngẫu nhiên"), the host broadcasts the whole roster back as
  `lobby`, and both screens show the same people. Each screen names its own
  row "Bạn" and the other end "Chủ phòng"; the seats are numbered because the
  default name is the same word on every row.
  **The handover is the dangerous part and has two halves, both of which have
  already bitten.** `HostSession` builds a champion for a client *only* on
  that client's `joined` event, and `setImmediate` replaces the handler
  without replaying anything — so (a) peers who joined while the lobby was up
  must be replayed on subscription, or the match starts believing the room is
  empty while every waiting client sits on a channel nobody answers; and (b)
  the lobby's own listener stays installed on the real transport, so once the
  match has taken over it must **stop consuming** membership and pass it
  through, or a player joining *after* Vào trận is absorbed into a lobby
  nobody is looking at and never gets a body. `HeldHostTransport` does both
  (`live` is the flag); `tests/game/net/lobbyHost.test.ts` is what found (b),
  and `npm run e2e:lan-flow` drives the whole sequence — host makes a room,
  client waits, both see the list, host starts, latecomer walks straight in —
  on three real browsers against the dev relay.
  **`scenes/lanSignal.ts` is pinned to the `pregame` chunk
  in `vite.config.ts`**, which is not optional: it is imported from both
  `LanScene.vue` and `game/net/netRole.ts`, and the first build after the
  split found Rollup hoisting it into `game` — a 5.6KB lobby with a static
  edge to the whole match. `chunks:check` has a `LanScene` rule for the
  compiled half and `tests/scenes/lanBootPath.test.ts` for the source half.
