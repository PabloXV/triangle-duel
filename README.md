# Triangle Duel

Prototype. Two triangles balanced on their points on one platform. Touch the
platform with a top vertex, or fall off, and you lose.

```
npm install
npm run dev        # play at the printed URL
npm test           # sim tests (Node, headless)
npm run probe:*    # diagnostic experiments, see scripts/
npm run bots       # headless bot matches with win/loss stats (--experiments for more)
npm run verify -- f.json  # check a downloaded match recording replays exactly
```

Controls: P1 `←`/`→` rotate, `↓` charge. P2 (if human) `A`/`D` rotate, `S` charge.
`R` restart. P3 and P4 are always bots. The panel's Match section sets player
count (2–4) and stocks.
The param panel edits the live match. Values persist in localStorage. Params
marked "(restart)" apply on restart because they change the body itself. Mode
switches and plumbing live in the collapsed "Advanced" folder; knobs for a mode
that's switched off are hidden.

## How it's put together

```
src/sim/      ← the game. No DOM, no clock, no randomness. Runs in Node.
  params.ts     every tunable number, with units and what "live" means
  geometry.ts   fighter shapes + stages as plain data
  sim.ts        Sim class: step(inputs) advances one 1/60 s tick
  detmath.ts    the one place sin/cos come from (see "Determinism")
src/bots/     bots: read FighterView, return Input, same as a keyboard
src/input.ts  keyboard → Input { turn, charge }
src/render.ts canvas renderer; reads sim state, never writes it
src/panel.ts  lil-gui param panel
src/camera.ts follow cam (pan/zoom to fit fighters) + screen shake
src/koReplay.ts final-KO instant replay (plays back recorded frames)
src/main.ts   fixed-timestep loop gluing the above together
tests/        sim behavior tests
scripts/      probes that measured the foot/rotation behavior
```

**The one rule:** the only way to affect a match is `sim.step(inputs)`.
Keyboard, future bots and future network peers all produce the same `Input`
struct. That's what makes bots, replays, rollback netcode and headless testing
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

`npm run probe:release` shows the difference: in torque mode a 3-tick lean then
release is always a KO; in servo mode you settle back near upright.

## The foot problem

**Symptom:** rotating lifts your foot off the ground, so you can't jump.

**Cause:** torque spins the body around its center. The foot is below the
center, so it swings sideways and up, and with enough torque it leaves the
ground. `npm run probe:foot` reproduces it: with grip off and torque 15, the
foot is airborne by tick 4.

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

## Juice (camera, shake, final-KO replay)

All presentation; none of it touches the sim. The panel's "Juice" section
toggles each.

- **Camera** (`src/camera.ts`): pans and zooms to fit living fighters, with
  zoom limits, and doesn't dive after someone falling to a KO.
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
