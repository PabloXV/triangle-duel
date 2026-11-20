import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type MatchSetup, type ServerMsg } from "../src/net/protocol";
import { RoomCore, type Outgoing } from "../src/net/room";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { balanceShape, shapeIssue } from "../src/sim/shapes";
import { EYE_STYLES } from "../src/look/eyes";
import { PLAYER_COLORS } from "../src/theme";
import { LEFT } from "../src/sim/inputCodec";
import { DEFAULT_MATCH } from "../src/sim/types";

const send = (msg: object) => JSON.stringify(msg);
const hello = (name = "p") => send({ type: "hello", version: PROTOCOL_VERSION, name });
const setup = (players: number): MatchSetup => ({ stage: WINGS_STAGE, match: { ...DEFAULT_MATCH, players }, params: DEFAULT_PARAMS });
const msgsTo = (out: Outgoing[], id: string) => out.filter((o) => o.to === id || o.to === "all").map((o) => o.msg);
const ofType = <T extends ServerMsg["type"]>(out: Outgoing[], type: T) =>
  out.map((o) => o.msg).filter((m): m is Extract<ServerMsg, { type: T }> => m.type === type);

/** A room with `n` players joined (ids "a", "b", ...). */
function roomWith(n: number) {
  const room = new RoomCore("ABCD");
  const ids = "abcd".slice(0, n).split("");
  for (const id of ids) {
    room.connect(id);
    room.receive(id, hello(id));
  }
  return { room, ids };
}

function started(n: number) {
  const r = roomWith(n);
  r.room.receive("a", send({ type: "start", setup: setup(n) }));
  return r;
}

describe("room: joining", () => {
  it("seats players in order; the first is host", () => {
    const room = new RoomCore("ABCD");
    room.connect("a");
    expect(msgsTo(room.receive("a", hello("Ana")), "a")).toContainEqual({ type: "welcome", room: "ABCD", slot: 0 });
    room.connect("b");
    const out = room.receive("b", hello("Bo"));
    expect(ofType(out, "roster")[0].players).toEqual([
      { slot: 0, name: "Ana", host: true, bot: false, shape: null, eyes: 0, color: 0 },
      { slot: 1, name: "Bo", host: false, bot: false, shape: null, eyes: 0, color: 1 },
    ]);
  });

  it("a 5th player waits as a spectator; a wrong protocol version is rejected", () => {
    const { room } = roomWith(4);
    room.connect("e");
    const out = room.receive("e", hello("e"));
    expect(out[0]).toEqual({ to: "e", msg: { type: "welcome", room: "ABCD", slot: null } });
    expect(ofType(out, "roster")[0].spectators).toEqual(["e"]);

    const r2 = new RoomCore("WXYZ");
    r2.connect("x");
    expect(r2.receive("x", send({ type: "hello", version: 999, name: "x" }))[0]).toMatchObject({ close: true });

  });

  it("ignores malformed messages and requires hello first", () => {
    const room = new RoomCore("ABCD");
    room.connect("a");
    expect(room.receive("a", "not json")[0].msg).toEqual({ type: "error", message: "malformed message" });
    expect(room.receive("a", send({ type: "ping", id: 1 }))[0].msg).toEqual({ type: "error", message: "say hello first" });
    expect(room.receive("a", send({ type: "nope" }))[0].msg).toEqual({ type: "error", message: "malformed message" });
  });

  it("hosting passes on when the host leaves; a freed slot is reused", () => {
    const { room } = roomWith(3);
    const out = room.disconnect("a");
    expect(ofType(out, "roster")[0].players.map((p) => [p.slot, p.host])).toEqual([
      [1, true],
      [2, false],
    ]);
    room.connect("z");
    expect(msgsTo(room.receive("z", hello()), "z")[0]).toEqual({ type: "welcome", room: "ABCD", slot: 0 });
  });

  it("answers pings", () => {
    const { room } = roomWith(1);
    expect(room.receive("a", send({ type: "ping", id: 42 }))).toEqual([{ to: "a", msg: { type: "pong", id: 42 } }]);
  });
});

describe("room: starting", () => {
  it("only the host can start, with at least 2 players, and a setup matching the player count", () => {
    const { room } = roomWith(2);
    expect(room.receive("b", send({ type: "start", setup: setup(2) }))[0].msg).toEqual({ type: "error", message: "only the host can start" });
    expect(room.receive("a", send({ type: "start", setup: setup(3) }))[0].msg).toMatchObject({ type: "error" });
    const solo = roomWith(1).room;
    expect(solo.receive("a", send({ type: "start", setup: setup(1) }))[0].msg).toEqual({ type: "error", message: "need at least 2 players (add a bot?)" });
  });

  it("tells each player which fighter they are", () => {
    const { room } = roomWith(3);
    room.disconnect("b"); // slots 0 and 2 remain
    const out = room.receive("a", send({ type: "start", setup: setup(2) }));
    const starts = out.filter((o) => o.msg.type === "start");
    expect(starts.map((o) => [o.to, o.msg])).toEqual([
      ["a", { type: "start", setup: setup(2), fighters: [0, 2], you: 0, drive: [0] }],
      ["c", { type: "start", setup: setup(2), fighters: [0, 2], you: 1, drive: [1] }],
    ]);
  });
});

describe("room: the official input stream", () => {
  it("finalizes one step per advance, numbering from 0", () => {
    const { room } = started(2);
    expect(ofType(room.advance(), "tick")).toEqual([{ type: "tick", t: 0 }]);
    expect(ofType(room.advance(), "tick")).toEqual([{ type: "tick", t: 1 }]);
  });

  it("an input takes effect at the step it was scheduled for", () => {
    const { room } = started(2);
    room.receive("b", send({ type: "input", tick: 2, input: "5" }));
    expect(room.advance()[0].msg).toEqual({ type: "tick", t: 0 });
    expect(room.advance()[0].msg).toEqual({ type: "tick", t: 1 });
    expect(room.advance()[0].msg).toEqual({ type: "tick", t: 2, c: [[1, "5"]] });
  });

  it("a late input is applied at the next open step, never waited for", () => {
    const { room } = started(2);
    room.advance(); // step 0
    room.advance(); // step 1
    room.receive("a", send({ type: "input", tick: 1, input: "2" })); // step 1 is already final
    expect(room.advance()[0].msg).toEqual({ type: "tick", t: 2, c: [[0, "2"]] });
  });

  it("only broadcasts real changes; the latest input within a step wins", () => {
    const { room } = started(2);
    room.receive("a", send({ type: "input", tick: 0, input: "0" }));
    room.receive("a", send({ type: "input", tick: 0, input: "2" })); // replaces "0"
    room.receive("b", send({ type: "input", tick: 0, input: "1" })); // "1" = idle = no change
    expect(room.advance()[0].msg).toEqual({ type: "tick", t: 0, c: [[0, "2"]] });
    room.receive("a", send({ type: "input", tick: 1, input: "2" })); // same as current
    expect(room.advance()[0].msg).toEqual({ type: "tick", t: 1 });
  });

  it("rejects inputs scheduled absurdly far ahead", () => {
    const { room } = started(2);
    expect(room.receive("a", send({ type: "input", tick: 10_000, input: "2" }))[0].msg).toMatchObject({ type: "error" });
  });

  it("a player who disconnects mid-match leaves it: LEFT at the next step", () => {
    const { room } = started(2);
    room.receive("b", send({ type: "input", tick: 0, input: "5" }));
    room.advance();
    room.disconnect("b");
    expect(room.advance()[0].msg).toEqual({ type: "tick", t: 1, c: [[1, LEFT]] });
  });

  it("clients can't send LEFT themselves (only the relay injects it)", () => {
    const { room } = started(2);
    expect(room.receive("a", send({ type: "input", tick: 0, input: LEFT }))[0].msg).toEqual({ type: "error", message: "malformed message" });
  });

  it("the host can end the match; ticking stops; the room can start again from step 0", () => {
    const { room } = started(2);
    room.advance();
    const out = room.receive("a", send({ type: "lobby" }));
    expect(ofType(out, "lobby")).toHaveLength(1);
    expect(room.advance()).toEqual([]);
    room.receive("a", send({ type: "start", setup: setup(2) }));
    expect(room.advance()[0].msg).toEqual({ type: "tick", t: 0 });
  });
});

describe("room: desync detection", () => {
  const hash = (step: number, h: string) => send({ type: "hash", step, hash: h });

  it("matching fingerprints: nothing to report", () => {
    const { room } = started(2);
    for (let i = 0; i < 61; i++) room.advance();
    expect(room.receive("a", hash(60, "aaaaaaaa"))).toEqual([]);
    expect(room.receive("b", hash(60, "aaaaaaaa"))).toEqual([]);
  });

  it("differing fingerprints: everyone is told, once, with each fighter's hash", () => {
    const { room } = started(2);
    for (let i = 0; i < 121; i++) room.advance();
    room.receive("a", hash(60, "aaaaaaaa"));
    expect(room.receive("b", hash(60, "bbbbbbbb"))).toEqual([
      { to: "all", msg: { type: "desync", step: 60, hashes: [[0, "aaaaaaaa"], [1, "bbbbbbbb"]] } },
    ]);
    room.receive("a", hash(120, "cccccccc"));
    expect(room.receive("b", hash(120, "dddddddd"))).toEqual([]); // already reported
  });

  it("rejects fingerprints for steps that aren't final yet, and malformed hashes", () => {
    const { room } = started(2);
    room.advance();
    expect(room.receive("a", hash(500, "aaaaaaaa"))[0].msg).toMatchObject({ type: "error" });
    expect(room.receive("a", hash(1, "not-hex!"))[0].msg).toEqual({ type: "error", message: "malformed message" });
  });
});

describe("room: bots", () => {
  const addBot = send({ type: "addBot" });
  const removeBot = send({ type: "removeBot" });

  it("the host can add bot seats, which show in the roster with a random (legal) shape", () => {
    const { room } = roomWith(1);
    const out = room.receive("a", addBot);
    const [human, bot] = ofType(out, "roster")[0].players;
    expect(human).toEqual({ slot: 0, name: "a", host: true, bot: false, shape: null, eyes: 0, color: 0 });
    expect(bot).toMatchObject({ slot: 1, name: "bot 1", host: false, bot: true });
    expect(bot.shape).not.toBeNull();
    expect(shapeIssue(bot.shape!)).toBeNull();
    // It keeps that shape while seated.
    expect(ofType(room.receive("a", send({ type: "ping", id: 1 })).concat(room.receive("a", addBot)), "roster")[0].players[1].shape).toEqual(bot.shape);
  });

  it("a match with random-shaped bots passes the relay's shape check", () => {
    const { room } = roomWith(1);
    room.receive("a", addBot);
    const out = room.receive("a", addBot);
    const shapes = ofType(out, "roster")[0].players.map((p) => p.shape);
    const s = { ...setup(3), match: { ...setup(3).match, shapes } };
    expect(ofType(room.receive("a", send({ type: "start", setup: s })), "start")).toHaveLength(1);
  });

  it("only the host, only in the lobby, and only while there's room", () => {
    const { room } = roomWith(2);
    expect(room.receive("b", addBot)[0].msg).toEqual({ type: "error", message: "only the host can add bots" });
    room.receive("a", addBot);
    room.receive("a", addBot); // 4 seats now
    expect(room.receive("a", addBot)[0].msg).toEqual({ type: "error", message: "room is full (4 players)" });
    room.connect("e");
    expect(room.receive("e", hello())[0].msg).toEqual({ type: "welcome", room: "ABCD", slot: null }); // spectates
    const { room: r2 } = started(2);
    expect(r2.receive("a", addBot)[0].msg).toEqual({ type: "error", message: "can't change seats during a match" });
  });

  it("removing takes away the last bot", () => {
    const { room } = roomWith(1);
    room.receive("a", addBot);
    room.receive("a", addBot);
    const out = room.receive("a", removeBot);
    expect(ofType(out, "roster")[0].players.map((p) => p.name)).toEqual(["a", "bot 1"]);
    room.receive("a", removeBot);
    expect(room.receive("a", removeBot)[0].msg).toEqual({ type: "error", message: "there are no bots" });
  });

  it("you can start against bots alone; the host drives them", () => {
    const { room } = roomWith(1);
    room.receive("a", addBot);
    room.receive("a", addBot);
    const out = room.receive("a", send({ type: "start", setup: setup(3) }));
    expect(ofType(out, "start")).toEqual([{ type: "start", setup: setup(3), fighters: [0, 1, 2], you: 0, drive: [0, 1, 2] }]);
  });

  it("the host may send a bot's inputs; other players may not", () => {
    const { room } = roomWith(2);
    room.receive("a", addBot); // slot 2 → fighter 2
    room.receive("a", send({ type: "start", setup: setup(3) }));
    room.receive("a", send({ type: "input", tick: 0, input: "2", fighter: 2 }));
    expect(room.receive("b", send({ type: "input", tick: 0, input: "0", fighter: 2 }))[0].msg).toEqual({
      type: "error",
      message: "you can't send inputs for fighter 2",
    });
    expect(room.receive("b", send({ type: "input", tick: 0, input: "0", fighter: 0 }))[0].msg).toMatchObject({ type: "error" });
    expect(room.advance()[0].msg).toEqual({ type: "tick", t: 0, c: [[2, "2"]] });
  });

  it("if the host leaves mid-match: they leave, their bots idle and pass to the new host", () => {
    const { room } = roomWith(2);
    room.receive("a", addBot);
    room.receive("a", send({ type: "start", setup: setup(3) }));
    room.receive("a", send({ type: "input", tick: 0, input: "5" }));
    room.receive("a", send({ type: "input", tick: 0, input: "5", fighter: 2 }));
    room.advance();
    const out = room.disconnect("a");
    expect(out).toContainEqual({ to: "b", msg: { type: "drive", fighters: [2] } });
    expect(ofType(out, "roster")[0].players.find((p) => p.name === "b")?.host).toBe(true);
    expect(room.advance()[0].msg).toEqual({ type: "tick", t: 1, c: [[0, LEFT], [2, "1"]] });
    // The new host may now drive the bot.
    expect(room.receive("b", send({ type: "input", tick: 2, input: "2", fighter: 2 }))).toEqual([]);
    expect(room.advance()[0].msg).toEqual({ type: "tick", t: 2, c: [[2, "2"]] });
  });

  it("if the last human leaves mid-match, the room resets (bots too)", () => {
    const { room } = roomWith(1);
    room.receive("a", addBot);
    room.receive("a", send({ type: "start", setup: setup(2) }));
    room.advance();
    room.disconnect("a");
    expect(room.phase).toBe("lobby");
    expect(room.advance()).toEqual([]);
  });

  it("bots go when everyone leaves", () => {
    const { room } = roomWith(1);
    room.receive("a", addBot);
    room.disconnect("a");
    room.connect("z");
    const out = room.receive("z", hello("z"));
    expect(ofType(out, "roster")[0].players.map((p) => p.name)).toEqual(["z"]);
  });
});

describe("room: settings and kick", () => {
  const settings = (stageId: string, stocks: number) => send({ type: "settings", settings: { stageId, stocks } });

  it("everyone sees the room's settings; the host changes them", () => {
    const { room } = roomWith(1);
    room.connect("b");
    expect(ofType(room.receive("b", hello("b")), "roster")[0].settings).toEqual({ stageId: "wings", stocks: 3 });
    expect(ofType(room.receive("a", settings("island", 1)), "roster")[0].settings).toEqual({ stageId: "island", stocks: 1 });
  });

  it("only the host, only in the lobby, and only sane values", () => {
    const { room } = roomWith(2);
    expect(room.receive("b", settings("island", 1))[0].msg).toEqual({ type: "error", message: "only the host can change settings" });
    expect(room.receive("a", settings("island", 9))[0].msg).toEqual({ type: "error", message: "malformed message" });
    expect(room.receive("a", settings("Bad Id!", 3))[0].msg).toEqual({ type: "error", message: "malformed message" });
    const { room: r2 } = started(2);
    expect(r2.receive("a", settings("island", 1))[0].msg).toEqual({ type: "error", message: "can't change settings during a match" });
  });

  it("the host can kick a player: they're told and disconnected, everyone else sees them gone", () => {
    const { room } = roomWith(3);
    const out = room.receive("a", send({ type: "kick", slot: 1 }));
    expect(out[0]).toEqual({ to: "b", msg: { type: "kicked" }, close: true });
    expect(ofType(out, "roster")[0].players.map((p) => p.name)).toEqual(["a", "c"]);
    expect(room.receive("b", send({ type: "ping", id: 1 }))).toEqual([]); // b is gone
  });

  it("kicking a bot seat removes the bot; you can't kick yourself; only the host kicks", () => {
    const { room } = roomWith(2);
    room.receive("a", send({ type: "addBot" })); // slot 2
    expect(ofType(room.receive("a", send({ type: "kick", slot: 2 })), "roster")[0].players.map((p) => p.name)).toEqual(["a", "b"]);
    expect(room.receive("a", send({ type: "kick", slot: 0 }))[0].msg).toEqual({ type: "error", message: "you can't kick yourself (leave instead)" });
    expect(room.receive("b", send({ type: "kick", slot: 0 }))[0].msg).toEqual({ type: "error", message: "only the host can kick" });
    expect(room.receive("a", send({ type: "kick", slot: 3 }))[0].msg).toEqual({ type: "error", message: "nobody in that seat" });
  });

  it("kicking mid-match removes their fighter from the match (LEFT)", () => {
    const { room } = started(2);
    room.receive("b", send({ type: "input", tick: 0, input: "5" }));
    room.advance();
    room.receive("a", send({ type: "kick", slot: 1 }));
    expect(room.advance()[0].msg).toEqual({ type: "tick", t: 1, c: [[1, LEFT]] });
  });

  it("settings reset when the room empties", () => {
    const { room } = roomWith(1);
    room.receive("a", settings("island", 1));
    room.disconnect("a");
    room.connect("z");
    expect(ofType(room.receive("z", hello("z")), "roster")[0].settings).toEqual({ stageId: "wings", stocks: 3 });
  });
});

describe("room: spectators", () => {
  it("joining mid-match: you spectate, with everything needed to catch up", () => {
    const { room } = started(2);
    room.receive("b", send({ type: "input", tick: 1, input: "2" }));
    for (let i = 0; i < 5; i++) room.advance(); // steps 0..4 final
    room.connect("s");
    const out = room.receive("s", hello("Sam"));
    expect(out[0]).toEqual({ to: "s", msg: { type: "welcome", room: "ABCD", slot: null } });
    expect(out[1]).toEqual({ to: "s", msg: { type: "spectate", setup: setup(2), names: ["a", "b"], log: [[1, [[1, "2"]]]], next: 5 } });
    expect(ofType(out, "roster")[0].spectators).toEqual(["Sam"]);
  });

  it("spectators get the live stream but can't play", () => {
    const { room } = started(2);
    room.connect("s");
    room.receive("s", hello("Sam"));
    expect(room.advance()[0].to).toBe("all"); // ticks go to everyone, spectators included
    expect(room.receive("s", send({ type: "input", tick: 5, input: "2" }))).toEqual([]); // ignored
    expect(room.receive("s", send({ type: "start", setup: setup(2) }))[0].msg).toMatchObject({ type: "error" });
  });

  it("when the match ends, spectators get seats (in join order) if there's room", () => {
    const { room } = started(2);
    room.connect("s1");
    room.receive("s1", hello("S1"));
    room.connect("s2");
    room.receive("s2", hello("S2"));
    const out = room.receive("a", send({ type: "lobby" }));
    expect(out).toContainEqual({ to: "s1", msg: { type: "welcome", room: "ABCD", slot: 2 } });
    expect(out).toContainEqual({ to: "s2", msg: { type: "welcome", room: "ABCD", slot: 3 } });
    const roster = ofType(out, "roster")[0];
    expect(roster.players.map((p) => p.name)).toEqual(["a", "b", "S1", "S2"]);
    expect(roster.spectators).toEqual([]);
  });

  it("a full room: spectators wait, and get a seat as soon as one frees up", () => {
    const { room } = roomWith(4);
    room.connect("e");
    room.receive("e", hello("E"));
    const out = room.disconnect("d"); // a seat frees up
    expect(out).toContainEqual({ to: "e", msg: { type: "welcome", room: "ABCD", slot: 3 } });
    expect(ofType(out, "roster")[0].spectators).toEqual([]);
  });

  it("removing a bot frees its seat for a waiting spectator", () => {
    const { room } = roomWith(3);
    room.receive("a", send({ type: "addBot" })); // full: a, b, c, bot
    room.connect("e");
    room.receive("e", hello("E"));
    expect(room.receive("a", send({ type: "removeBot" }))).toContainEqual({ to: "e", msg: { type: "welcome", room: "ABCD", slot: 3 } });
  });

  it("spectators waiting in a full lobby watch the next match", () => {
    const { room } = roomWith(4);
    room.connect("e");
    room.receive("e", hello("E"));
    const out = room.receive("a", send({ type: "start", setup: setup(4) }));
    expect(out).toContainEqual({ to: "e", msg: { type: "spectate", setup: setup(4), names: ["a", "b", "c", "d"], log: [], next: 0 } });
  });

  it("at most 8 spectators", () => {
    const { room } = started(2);
    for (let i = 0; i < 8; i++) {
      room.connect(`s${i}`);
      room.receive(`s${i}`, hello());
    }
    room.connect("s9");
    expect(room.receive("s9", hello())[0]).toEqual({ to: "s9", msg: { type: "error", message: "room is full" }, close: true });
  });
});

describe("room: fighter shapes", () => {
  const custom = balanceShape([{ x: 0, y: 0 }, { x: 1.4, y: 1.3 }, { x: -0.3, y: 1.0 }], 0)!;
  const giant = { ...custom, vertices: custom.vertices.map((v) => ({ x: v.x * 3, y: v.y * 3 })) };

  it("a player's shape shows in the roster; null = back to standard", () => {
    const { room } = roomWith(2);
    expect(ofType(room.receive("b", send({ type: "shape", shape: custom })), "roster")[0].players[1].shape).toEqual(custom);
    expect(ofType(room.receive("b", send({ type: "shape", shape: null })), "roster")[0].players[1].shape).toBeNull();
  });

  it("the relay rejects shapes outside the limits (no cheating in a giant fighter)", () => {
    const { room } = roomWith(1);
    expect(room.receive("a", send({ type: "shape", shape: giant }))[0].msg).toEqual({
      type: "error",
      message: "that fighter shape isn't allowed (wrong size)",
    });
    const needle = balanceShape([{ x: 0, y: 0 }, { x: 0.15, y: 3 }, { x: -0.15, y: 3 }], 0)!;
    expect(room.receive("a", send({ type: "shape", shape: needle }))[0].msg).toEqual({
      type: "error",
      message: "that fighter shape isn't allowed (too tall)",
    });
  });

  it("a match setup with an invalid shape is refused", () => {
    const { room } = roomWith(2);
    const bad = { ...setup(2), match: { ...setup(2).match, shapes: [giant, null] } };
    expect(room.receive("a", send({ type: "start", setup: bad }))[0].msg).toEqual({ type: "error", message: "the setup has an invalid fighter shape" });
    const ok = { ...setup(2), match: { ...setup(2).match, shapes: [custom, null] } };
    expect(ofType(room.receive("a", send({ type: "start", setup: ok })), "start")).toHaveLength(2);
  });
});

describe("room: eye styles", () => {
  it("a player's eye style shows in the roster; bots get one too", () => {
    const { room } = roomWith(1);
    const out = room.receive("a", send({ type: "eyes", eyes: 5 }));
    expect(ofType(out, "roster")[0].players[0].eyes).toBe(5);
    const bot = ofType(room.receive("a", send({ type: "addBot" })), "roster")[0].players[1];
    expect(bot.eyes).toBeGreaterThanOrEqual(0);
    expect(bot.eyes).toBeLessThan(EYE_STYLES.length);
  });

  it("unknown eye styles are refused", () => {
    const { room } = roomWith(1);
    for (const eyes of [-1, EYE_STYLES.length, 2.5]) {
      const out = room.receive("a", send({ type: "eyes", eyes }));
      expect(ofType(out, "roster")).toHaveLength(0);
    }
    expect(ofType(room.receive("a", send({ type: "eyes", eyes: 99 })), "error")[0].message).toMatch(/eye style/);
  });
});

describe("room: colors", () => {
  const colors = (out: ReturnType<RoomCore["receive"]>) => ofType(out, "roster")[0].players.map((p) => p.color);

  it("everyone gets a different color, in order by default (bots too)", () => {
    const { room } = roomWith(2);
    expect(colors(room.receive("a", send({ type: "addBot" })))).toEqual([0, 1, 2]);
  });

  it("asking for a free color gets it", () => {
    const { room } = roomWith(2);
    expect(colors(room.receive("b", send({ type: "color", color: 6 })))).toEqual([0, 6]);
  });

  it("a color another player has is refused (no change); one a bot has is swapped", () => {
    const { room } = roomWith(2);
    room.receive("a", send({ type: "addBot" })); // bot: color 2
    expect(colors(room.receive("b", send({ type: "color", color: 0 })))).toEqual([0, 1, 2]);
    expect(colors(room.receive("b", send({ type: "color", color: 2 })))).toEqual([0, 2, 1]);
  });

  it("a spectator's wish applies when they get a seat, if still free", () => {
    const { room } = roomWith(4);
    room.connect("e");
    room.receive("e", hello("e")); // full: spectating
    room.receive("e", send({ type: "color", color: 5 }));
    const out = room.disconnect("b"); // a seat frees up
    const roster = ofType(out, "roster")[0].players;
    expect(roster.find((p) => p.name === "e")?.color).toBe(5);
  });

  it("unknown colors are refused", () => {
    const { room } = roomWith(1);
    for (const color of [-1, PLAYER_COLORS.length, 1.5]) expect(ofType(room.receive("a", send({ type: "color", color })), "roster")).toHaveLength(0);
  });
});
