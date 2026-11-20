# Triangle Duel

Triangles balanced on their points, bumping each other off the stage. Touch
the stage with a top vertex, or fall off, and you lose a stock. 2–4 players,
local or online.

```
npm install
npm run dev        # play at the printed URL
npm test           # sim tests (Node, headless)
npm run bots       # headless bot matches with win/loss stats (--experiments for more)
npm run verify -- f.json  # check a downloaded match recording replays exactly
npm run cross-browser    # replay the fixture match in Node, Chrome, Firefox, WebKit and compare
npm run relay      # the online room relay, locally (Cloudflare Workers runtime via wrangler)
npm run relay:smoke  # end-to-end relay check: two clients, a match, identical tick streams
npm run netsim     # rollback behavior on simulated connections
npm run e2e        # browser test of the menu flow (screenshots in e2e-shots/)
```

Open it, pick a name (remembered in this browser), then play locally (map,
bots, stocks, bot level, optional 2nd player on the same keyboard) or online.
Controls: `←`/`→` rotate, `↓` charge (2nd local player: `A`/`D`/`S`).
`Esc` pauses (local) or opens the match menu (online); `R` restarts a local match.
`` ` `` (backtick) toggles the debug panel (params, juice, recordings, dev online controls).
The param panel edits the live match. Values persist in localStorage. Params
marked "(restart)" apply on restart because they change the body itself. Mode
switches and plumbing live in the collapsed "Advanced" folder; knobs for a mode
that's switched off are hidden.

## How it's put together

```
src/sim/        ← the game. No DOM, no clock, no randomness. Runs in Node.
  sim.ts          Sim: world setup, the per-tick order of operations, view,
                  save/restore/hash. Start reading here.
  types.ts        public types (Input, SimEvent, MatchOptions, FighterView...)
  movement.ts     grounded check, rotation, jumping, foot grip (the "feel")
  lives.ts        KOs, stocks, respawning, ghosting, match end
  platforms.ts    one-way platform solidity
  fighter.ts      a fighter's parts + the match context the rules operate on
  recording.ts    match recordings: record, play back, verify
  params.ts       every tunable number, with units and what "live" means
  geometry.ts     fighter shapes + stages as plain data, shared helpers
  detmath.ts      deterministic sin/cos (see "Determinism")
src/game.ts     the game: canvas loop, modes (menu backdrop / local / online / replay),
                and the small API the menus call
src/ui/         menus and overlays (Svelte): name, main menu, local setup, pause, end of match
src/stages.ts   the playable maps
src/session.ts  what the loop drives: LiveSession (one InputSource per player,
                recorded) or PlaybackSession. Online will be another Session.
src/net/        online: protocol.ts (messages), room.ts (relay logic, no
                Cloudflare APIs, tested in Node), client.ts (browser connection)
server/         the relay Worker + Room Durable Object (thin wrapper over room.ts)
src/bots/       bots: read FighterView, return Input, same as a keyboard
src/input.ts    keyboard → Input { turn, charge } (KeyboardSource)
src/render.ts canvas renderer; reads sim state, never writes it
src/panel.ts  lil-gui param panel
src/camera.ts follow cam (pan/zoom to fit fighters) + screen shake
src/koReplay.ts final-KO instant replay (plays back recorded frames)
src/main.ts   entry point: starts the game, mounts the menus, attaches the debug panel
tests/        sim behavior tests
scripts/      bot arena, recording verify, cross-browser check, fixture generator
```

**The one rule:** the only way to affect a match is `sim.step(inputs)`.
Keyboard, bots, recordings and (soon) network peers all produce the same
`Input` struct, through the `InputSource` interface in `src/session.ts`.
That's what makes bots, replays, rollback netcode and headless testing
possible without a rewrite.

**Fixed timestep:** `main.ts` runs the sim in exact 1/60 s ticks no matter the
frame rate, and the renderer interpolates between the last two ticks so motion
stays smooth on 120Hz screens.

**Rapier vs. our rules:** Rapier handles bodies, contacts, friction and
collisions. `sim.ts` adds everything game-specific on top: rotation control,
jump charging, coyote time, foot grip and KO detection. Grounded and KO checks
are plain geometry (vertex distance to platform rectangles), not Rapier contact
events. That's simpler to reason about and gives one consistent definition of
"touching".

## Jumping: two modes (`jumpMode`)

- **auto** (default): every landing triggers a small hop (`hopSpeed`) along your
  "up", so leaning plus hopping is how you move. Holding charge makes the next
  landing plant you and charge instead. Release to jump at that charge; reach
  the cap (`jumpChargeTicks`) and you jump at full power automatically. If you
  lose your footing past coyote time while charging, the charge is lost.
- **manual**: charge builds while held (even mid-air), release to jump if
  grounded or within coyote time.

Jumps **set** your speed along "up" to the jump speed (or leave it if you're
  already faster) instead of adding to it. Auto-hops fire on the landing tick
  while you're still moving down, and adding would cancel most of the hop.

Things to know when tuning auto mode:
- You're "grounded" for only 1 tick per hop (about 13 ticks per cycle at
  defaults), so `airRotationScale` is effectively your main rotation strength.
- `jumpCooldownTicks`: for this long after any jump you count as airborne (no
  re-jump, no grip). Otherwise the foot is still within `footTolerance` right
  after takeoff and a jump could fire twice.

## Rotation: two modes (`rotationMode`)

Both use a capped torque, so you can always be overpowered.

- **torque**: holding applies `rotateTorque`. Spin keeps building while you
  hold, and releasing doesn't stop it. That's physically literal, and an
  inverted pendulum always keeps falling once released.
- **servo**: holding sets a target spin rate (`servoSpeed`, or 0 when released).
  A motor pushes toward it with force `servoStiffness × error`, capped at
  `rotateTorque`. Releasing brakes. At big leans gravity beats the cap.

The tests in `tests/sim.test.ts` ("rotation modes") pin the difference: in
torque mode a 3-tick lean then release is always a KO; in servo mode you
settle back near upright.

## The foot problem

**Symptom:** rotating lifts your foot off the ground, so you can't jump.

**Cause:** torque spins the body around its center. The foot is below the
center, so it swings sideways and up, and with enough torque it leaves the
ground. Measured early on (probe scripts, since removed; see git history): with
grip off and torque 15, the foot was airborne by tick 4.

**What's implemented (all tunable, all can be switched off):**

1. **`footTolerance`**: "grounded" means within this distance of a surface, not
   exactly touching.
2. **`coyoteTicks`**: you can still jump for a few ticks after leaving the
   ground. This is standard platformer forgiveness.
3. **`gripStrength`**: a downward pull on the foot vertex while it's near a
   platform top, measured in multiples of body weight. While the foot touches
   the ground, the ground pushes back at the same point, so grip adds **no
   torque**. It only means (a) more friction and (b) the foot gets pulled back
   if it starts to lift. It's capped, so a big hit still knocks the foot loose.
   It's off during `jumpCooldownTicks` after a jump, and only acts while you're
   grounded or within coyote time. Without that rule it also dragged you down
   out of low hops.


I didn't implement a hard lock (a joint pinning the foot). It would kill
sliding and bumping, which is the whole game. A "sticky but slides" constraint
is roughly what grip already approximates with a force.

Known side effect: more grip means more friction, so you're harder to shove
along the ground.

## Stage and one-way platforms

`WINGS_STAGE` in `src/sim/geometry.ts`: a 16 m floor plus two one-way "wing"
platforms up and out at the sides. Stages are plain data, camera framing
included.

A one-way platform is solid for a fighter only when the fighter is above it
(`Sim.updateOneWaySolidity`): you jump up through it and land on top. The same
per-tick decision feeds the Rapier contact hook, the grounded check, grip, and
KO checks, so a fighter passing through a wing can't be KO'd by brushing it.
Two details that came from debugging, explained in the code comments:
- Becoming solid allows for one tick of fall speed, and once solid it stays
  solid until you're a full platform thickness below the top. Rapier pushes out
  of overlaps gradually, so without this a landing fighter fell through.
- **Rapier quirk:** `world.step()` silently ignores physics hooks unless you also
  pass an event queue. The sim passes one only for that reason.

## Stocks and FFA

Match setup (`MatchOptions` in `sim.ts`) is separate from tuning params:
player count, stocks, respawn delay, ghost time. Spawns spread evenly along the
stage's `spawnLine`.

A KO costs a stock. The body lies where it fell for `respawnDelayTicks`
(passing through fighters), then drops back in above that player's spawn point
as a **ghost** for `ghostTicks`: passes through other fighters, immune to
touch-KOs (falling still counts). Ghosting doesn't end while still overlapping
someone, because re-enabling collisions mid-overlap makes Rapier shove the
bodies apart violently. Out of stocks = removed from the stage. Last one with
stocks wins.

## Online (relay)

One Cloudflare Durable Object per room code: a single instance worldwide, so
every player's messages are handled in one place, in order. It owns the
match clock and the official input stream:

- Clients send an input only when it changes, tagged with the step it should
  apply on (a few steps ahead). That keeps traffic, and Cloudflare requests,
  low.
- At 60 Hz the room finalizes the next step and broadcasts it, with any input
  changes. A late input moves to the next open step; the relay never waits,
  so one laggy player can't stall everyone. A player who disconnects goes idle.
- Every client simulates that same stream, which works because the sim is
  deterministic (see below).

The logic is plain TypeScript in `src/net/room.ts` (tested in Node);
`server/room-do.ts` only connects WebSockets and the clock to it.
`npm run relay:smoke` runs the real local Workers runtime with two clients.

**Playing online (rollback):** `src/net/onlineSession.ts` runs your own full
copy of the match on two timelines. *Confirmed* = steps the relay finalized
(official inputs). *Present* = what's on screen, about one round trip + 2
steps ahead: other players are predicted to keep their last input, and your
own input applies immediately (and is sent for that same step). When official
inputs differ from the prediction, the sim rewinds to that step (Sim.restore)
and re-simulates to the present. Prediction is capped at 30 steps; past that
it stalls instead of guessing. Recordings and desync fingerprints use only
the confirmed timeline, so they mean the same on every client: if two
clients ever differ, the relay tells everyone the exact step
(`DESYNC at step N`). Online matches can be watched/downloaded after.

Corrections are smoothed visually (`src/smoothing.ts`): after a rollback the
drawn fighter glides to its corrected spot over ~80 ms instead of snapping.
Presentation only, so it can't affect sync.

`npm run netsim` measures rollback on simulated connections (bots playing).
Typical: corrections of a fraction of a pixel to a few pixels, rare big ones
(17–76 px; smoothing cuts the worst per-frame snap ~3×), and well under 1% CPU.
Bots change input ~17×/s, several times more than people do, so real matches
have proportionally fewer rollbacks.

`tests/online.test.ts` runs the real relay logic and two OnlineSessions in one
process over a fake network (`tests/onlineHarness.ts`; equal, lopsided,
jittery and terrible latency) with bots playing: confirmed matches must end
bit-identical, rollbacks must actually occur, late own inputs must be
corrected, prediction must stay bounded, your own input must apply on the
next step, and a client with a corrupted setup must be caught as a desync.

To try it: `npm run relay` and `npm run dev`, two tabs, Play online: create a
room in one, join with its code in the other. The host picks the map and
stocks (everyone sees them live; the relay only accepts changes from the
host), adds bots, kicks, and starts. Online, everyone uses the arrow keys.
When a match ends, everyone returns to the room together: the relay doesn't
simulate, so the host's browser tells it, a few seconds after the *confirmed*
timeline shows the result (the present can briefly show a win a rollback
undoes). If the host leaves the room, the next player becomes host.

**Leaving mid-match** (closing the tab, "Leave match", or being kicked): the
relay puts a special LEFT input into the official stream for that fighter, at
the next step. Every client's sim removes the fighter when it sees it, so the
leave happens at the same step everywhere, and in recordings, with no special
cases (clients can't send LEFT themselves). If that leaves one fighter, they
win. If the leaver was host, the next player becomes host and the relay tells
their browser to drive the bots from then on (they idle for a moment in
between). Online sessions report events from re-simulated steps too
(`takeEvents`), since a leave or KO often first happens in a rollback.

**Bots online:** the host can add/remove bot seats in the lobby (Online →
add bot). The host's browser runs them and sends their inputs through the
relay like a player's (the relay only accepts bot inputs from the host); to
everyone else a bot is just another remote player. Each bot thinks once per
step; on a rollback the host reuses the decision it already sent. If the host
disconnects mid-match, their bots go idle. Note: bots change input far more
often than people (~17×/s), so non-host players see more rollbacks when
playing against bots.

## Juice (camera, shake, final-KO replay)

All presentation; none of it touches the sim. The panel's "Juice" section
toggles each.

- **Camera** (`src/camera.ts`): pans and zooms to fit living fighters, with
  zoom limits, and doesn't dive after someone falling to a KO. It has dead zones
  so it ignores hop-sized motion: zoom-in only once the action shrinks 15%,
  and a vertical "push" camera that only moves when someone nears the edge.
  Without them the stage bobbed ~28 px per quarter second (every fighter hops
  ~4.5×/s), which read as stutter; `tests/camera.test.ts` keeps it under 10 px
  and checks on-stage fighters never leave the frame.
- **Shake**: the sim reports `SimEvent`s each tick: fighter-vs-fighter
  `impact`s (Rapier contact force) and `ko`s. Force maps to shake on a curve
  measured from bot matches (median contact ~39 N; top 1% > 126 N), and
  strength goes with trauma², so ordinary bumps barely register.
- **Final-KO replay** (`src/koReplay.ts`): when the match-ending KO lands, the
  sim pauses and the last few seconds replay from just before the decisive
  moment (the loser's last collision, else their last moment on the ground),
  in slow motion and letterboxed. It's a replay rather than slowing time at the
  KO because a fall only counts as a KO when the body leaves the blast zone,
  well after (and below) the hit that caused it.

## Determinism

The sim uses Rapier's deterministic build (bit-identical across platforms).
A test runs a 600-tick scripted match twice and compares physics snapshots
byte for byte. Our own JS on top must be deterministic too: `src/sim/detmath.ts` has sin/cos
ported from fdlibm using only exact operations (bit-identical in every engine,
~1 ulp from `Math.sin`). `tests/detmath.test.ts` locks golden output bits and
scans `src/sim/` for engine-dependent or nondeterministic operations
(`Math.sin`, `Math.random`, `Date.now`, `**`, ...), so that rule is enforced
rather than remembered.

### Recordings (replays)

`src/sim/recording.ts`: a recording is match setup (stage, match options,
params, plus any mid-match panel tweaks) and every tick's inputs, one character
per player per tick (a 1-minute 2-player match is ~4 KB). A state fingerprint
(`Sim.hash()`) is stored every second, so playback reports the first tick that
diverges, not just "the ending differs". The panel's Misc section can watch,
download, and load matches; `npm run verify -- file.json` replays one in Node.
A match recorded in Chrome verified exactly in Node.

### Cross-engine check

`npm run cross-browser` replays `tests/fixtures/match-4p.json` (a 4-bot match
with a mid-match param change) in Node, Chrome (V8), Firefox (SpiderMonkey) and
WebKit (JavaScriptCore) via `verify.html`, and compares final fingerprints.
`tests/fixture.test.ts` locks the expected hash. Result (Nov 2026, macOS):
all four engines identical. Note: on this Mac the engines' *native*
`Math.sin`/`cos` also agreed, so the fdlibm port is insurance for other
platforms (Windows/Linux/Android libms differ) rather than a fix for an
observed mismatch. One-time setup: `npx playwright-core install firefox webkit`.

### Save / restore (for rollback)

`sim.save()` returns a deep-copied `SimState` (Rapier snapshot + our rule
state); `sim.restore(state)` rewinds to it. Per-fighter rule state lives in a
plain-data `FighterState` so a new field can't be forgotten by save/restore.
`tests/state.test.ts` checks the property rollback depends on: save, restore
(into a fresh sim, or in place after mispredicted inputs), continue, and the
result is bit-identical to never stopping. It includes a landing-on-a-wing
case, because one-way solidity depends on the previous tick's value.
Measured cost (4 players): step 33 µs, save 11 µs, restore 47 µs, so a
worst-case 8-tick rollback is ~0.4 ms of a 16.7 ms frame.

## Bot (`src/bots/heuristic.ts`)

A hand-written decision list, run every tick: recover if leaning dangerously,
head back if the predicted stopping point is past the edge, lunge if the
opponent is close and we're steady, otherwise walk toward them. Movement is
*speed* control (pick a target speed, lean in proportion to the error), which
is what stopped it from skidding off the stage.

Handicap: `reactionTicks` delays what it sees of the opponent (panel: "bot
reaction"). Its own body is seen almost live (`selfReactionTicks`), because
balancing with a long delay is unstable and it just falls over.

Known limits, from `npm run bots -- --experiments`:
- Brittle: small config changes flip results from 30/30 to 0/30.
- Faster reactions don't help, because it only attacks after slowing down, which
  in practice means after bumping into the opponent.
- Whoever lunges first from farther away tends to win. That's a balance
  signal about the game, not just the bot.
- Platforms: it climbs to an opponent on a higher platform (walks under it,
  charges just enough to jump up through, using gravity/jump speeds from the
  params) and drops down to one below (walks off an edge that has ground under
  it). Edge safety only guards edges with nothing below them.

## Open design questions

- Can you jump off an opponent's head? (Currently no: grounded only counts stage surfaces.)
- Does charging a jump lock rotation? (Currently no: you can aim while charging.)
- Grip only works on platform tops. Fine for now; it matters for slanted/moving platforms.
