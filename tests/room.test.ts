import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type MatchSetup, type ServerMsg } from "../src/net/protocol";
import { RoomCore, type Outgoing } from "../src/net/room";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
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
      { slot: 0, name: "Ana", host: true },
      { slot: 1, name: "Bo", host: false },
    ]);
  });

  it("rejects a 5th player, a wrong protocol version, and joining mid-match", () => {
    const { room } = roomWith(4);
    room.connect("e");
    expect(room.receive("e", hello())).toEqual([{ to: "e", msg: { type: "error", message: "room is full (4 players)" }, close: true }]);

    const r2 = new RoomCore("WXYZ");
    r2.connect("x");
    expect(r2.receive("x", send({ type: "hello", version: 999, name: "x" }))[0]).toMatchObject({ close: true });

    const { room: r3 } = started(2);
    r3.connect("late");
    expect(r3.receive("late", hello())[0].msg).toEqual({ type: "error", message: "a match is in progress in this room" });
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
    expect(solo.receive("a", send({ type: "start", setup: setup(1) }))[0].msg).toEqual({ type: "error", message: "need at least 2 players" });
  });

  it("tells each player which fighter they are", () => {
    const { room } = roomWith(3);
    room.disconnect("b"); // slots 0 and 2 remain
    const out = room.receive("a", send({ type: "start", setup: setup(2) }));
    const starts = out.filter((o) => o.msg.type === "start");
    expect(starts.map((o) => [o.to, o.msg])).toEqual([
      ["a", { type: "start", setup: setup(2), fighters: [0, 2], you: 0 }],
      ["c", { type: "start", setup: setup(2), fighters: [0, 2], you: 1 }],
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

  it("a player who disconnects mid-match goes idle", () => {
    const { room } = started(2);
    room.receive("b", send({ type: "input", tick: 0, input: "5" }));
    room.advance();
    room.disconnect("b");
    expect(room.advance()[0].msg).toEqual({ type: "tick", t: 1, c: [[1, "1"]] });
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
