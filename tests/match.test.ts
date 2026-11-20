import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_BOT, HeuristicBot } from "../src/bots/heuristic";
import { WINGS_STAGE, spawnPoints } from "../src/sim/geometry";
import { DEFAULT_PARAMS, type Params } from "../src/sim/params";
import { DEFAULT_MATCH, NO_INPUT, Sim, initPhysics, type Input, type MatchOptions } from "../src/sim/sim";
import { LEFT, decodeInput, encodeInput } from "../src/sim/inputCodec";

beforeAll(() => initPhysics());

// No auto-hop, torque rotation: holding "turn" reliably tips you over.
const STILL: Params = { ...DEFAULT_PARAMS, jumpMode: "manual", rotationMode: "torque" };
const TIP: Input = { turn: 1, charge: false };
const { respawnDelayTicks, ghostTicks } = DEFAULT_MATCH;

function stepUntil(sim: Sim, inputs: () => Input[], done: () => boolean, max = 2000) {
  for (let t = 0; t < max && !done(); t++) sim.step(inputs());
}

describe("stocks", () => {
  it("a KO costs a stock, then you respawn upright above your spawn after the delay", () => {
    const sim = new Sim(WINGS_STAGE, STILL, { stocks: 3 });
    stepUntil(sim, () => [TIP, NO_INPUT], () => sim.view()[0].ko !== null);
    expect(sim.view()[0]).toMatchObject({ ko: "touched", stocks: 2 });
    expect(sim.result.over).toBe(false);

    for (let t = 0; t < respawnDelayTicks; t++) sim.step([NO_INPUT, NO_INPUT]);
    const f = sim.view()[0];
    expect(f.ko).toBeNull();
    expect(f.ghost).toBe(true);
    expect(f.x).toBeCloseTo(spawnPoints(WINGS_STAGE, 2)[0].x, 0);
    expect(f.y).toBeGreaterThan(WINGS_STAGE.respawnY - 0.5); // dropping in from above
  });

  it("losing every stock eliminates you and ends the match", () => {
    const sim = new Sim(WINGS_STAGE, STILL, { stocks: 3 });
    stepUntil(sim, () => [TIP, NO_INPUT], () => sim.result.over, 5000);
    expect(sim.result).toMatchObject({ over: true, winner: 1 });
    expect(sim.view()[0].stocks).toBe(0);
    for (let t = 0; t < respawnDelayTicks; t++) sim.step([NO_INPUT, NO_INPUT]);
    expect(sim.view()[0].eliminated).toBe(true);
  });

  it("a ghost can't be KO'd by touching the stage, but can once ghosting ends", () => {
    const sim = new Sim(WINGS_STAGE, STILL, { stocks: 3 });
    stepUntil(sim, () => [TIP, NO_INPUT], () => sim.view()[0].ko !== null);
    stepUntil(sim, () => [NO_INPUT, NO_INPUT], () => sim.view()[0].ko === null); // respawned
    // Tip over right away: lands flat while still a ghost.
    for (let t = 0; t < ghostTicks - 5; t++) sim.step([TIP, NO_INPUT]);
    expect(sim.view()[0]).toMatchObject({ ko: null, stocks: 2, ghost: true });
    stepUntil(sim, () => [TIP, NO_INPUT], () => sim.view()[0].ko !== null, 200);
    expect(sim.view()[0]).toMatchObject({ ko: "touched", stocks: 1 });
  });

  it("a ghost passes through fighters, and stays a ghost while overlapping one", () => {
    // P1 spawns below the blast zone, so it dies on tick 1 and respawns right
    // above P2, then falls straight through P2.
    const match: Partial<MatchOptions> = { stocks: 3, spawns: [{ x: 0, y: -50 }, { x: 0, y: 0.001 }] };
    const sim = new Sim(WINGS_STAGE, STILL, match);
    stepUntil(sim, () => [NO_INPUT, NO_INPUT], () => sim.view()[0].ko === null && sim.tick > 1);
    for (let t = 0; t < ghostTicks + 30; t++) sim.step([NO_INPUT, NO_INPUT]);
    const [ghost, other] = sim.view();
    expect(Math.abs(ghost.x - other.x)).toBeLessThan(0.3); // overlapping, nobody got shoved
    expect(other.ko).toBeNull();
    expect(other.x).toBeCloseTo(0, 1);
    expect(ghost.ghost).toBe(true); // past ghostTicks, but still overlapping
  });
});

describe("free-for-all", () => {
  it("4 players spawn evenly spaced across the floor", () => {
    const sim = new Sim(WINGS_STAGE, DEFAULT_PARAMS, { players: 4 });
    const feet = sim.view().map((f) => f.vertices[f.footIndex].x);
    expect(feet.map((x) => Math.round(x))).toEqual([-6, -2, 2, 6]);
  });

  it("4-bot FFA plays out to a single winner", () => {
    const sim = new Sim(WINGS_STAGE, DEFAULT_PARAMS, { players: 4 });
    const bots = [0, 1, 2, 3].map((i) => new HeuristicBot(i, { ...DEFAULT_BOT, seed: i + 1 }));
    stepUntil(sim, () => bots.map((b) => b.think(sim.view(), sim.stage, DEFAULT_PARAMS)), () => sim.result.over, 60 * 60 * 3);
    expect(sim.result.over).toBe(true);
    const r = sim.result;
    if (r.over && r.winner !== null) {
      // Everyone else is out of stocks; the winner isn't.
      sim.view().forEach((f, i) => expect(f.stocks > 0).toBe(i === r.winner));
    }
  });
});

describe("leaving mid-match", () => {
  const LEAVE: Input = { turn: 0, charge: false, left: true };
  const idle3 = (): Input[] => [NO_INPUT, NO_INPUT, NO_INPUT];

  it("a player who leaves is removed immediately; the match goes on if 2+ remain", () => {
    const sim = new Sim(WINGS_STAGE, DEFAULT_PARAMS, { players: 3, stocks: 3 });
    for (let t = 0; t < 30; t++) sim.step(idle3());
    sim.step([NO_INPUT, LEAVE, NO_INPUT]);
    expect(sim.events).toContainEqual({ type: "ko", fighter: 1, reason: "left", stocksLeft: 0, final: false });
    expect(sim.view()[1]).toMatchObject({ ko: "left", stocks: 0, eliminated: true });
    expect(sim.result.over).toBe(false);
    for (let t = 0; t < 120; t++) sim.step([NO_INPUT, LEAVE, NO_INPUT]); // the relay keeps repeating LEFT
    expect(sim.view()[1].eliminated).toBe(true);
    expect(sim.events.filter((e) => e.type === "ko")).toEqual([]); // repeats are ignored
  });

  it("if only one fighter is left, they win", () => {
    const sim = new Sim(WINGS_STAGE, DEFAULT_PARAMS, { players: 2 });
    for (let t = 0; t < 30; t++) sim.step([NO_INPUT, NO_INPUT]);
    sim.step([LEAVE, NO_INPUT]);
    expect(sim.result).toMatchObject({ over: true, winner: 1 });
    expect(sim.events).toContainEqual({ type: "ko", fighter: 0, reason: "left", stocksLeft: 0, final: true });
  });

  it("leaving while KO'd (waiting to respawn) means no respawn", () => {
    const sim = new Sim(WINGS_STAGE, STILL, { players: 3, stocks: 3 });
    stepUntil(sim, () => [TIP, NO_INPUT, NO_INPUT], () => sim.view()[0].ko !== null);
    sim.step([LEAVE, NO_INPUT, NO_INPUT]);
    for (let t = 0; t < respawnDelayTicks + 30; t++) sim.step([LEAVE, NO_INPUT, NO_INPUT]);
    expect(sim.view()[0]).toMatchObject({ ko: "left", stocks: 0, eliminated: true });
  });

  it("a leave survives a recording round trip (it's just an input)", () => {
    expect(decodeInput(encodeInput(LEAVE))).toEqual(LEAVE);
    expect(encodeInput(LEAVE)).toBe(LEFT);
  });
});
