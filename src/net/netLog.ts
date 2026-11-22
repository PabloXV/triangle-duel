// Net log (?netlog=1): what an online match is doing, by the numbers. Every
// second it records a row (rollbacks, resim time, ping, frame advantage,
// freezes, how steps arrive, frame timing), shows the latest in a small
// overlay, and keeps them all for download (press L, or read
// window.triangleDuel.game.netLog.rows; scripts/netlog.ts does).

import type { OnlineSession } from "./onlineSession";

const PX_PER_M = 57; // ~a 1150 px wide view of 20 m (as in netsim)

export interface NetLogRow {
  t: number; // seconds since the match started
  you: number; // my fighter (-1: spectating)
  tick: number; // present step (what's drawn)
  confirmed: number; // steps final here (official inputs folded in)
  newest: number; // newest official step received from the relay
  frameAdvantage: number; // tick - newest: how far the present runs ahead of what the relay has confirmed
  predicting: number; // tick - confirmed: steps currently guessed
  relayAhead: number; // relay-clock estimate - newest: steps the relay has (by its clock) that haven't arrived yet
  aheadSteps: number; // lead the pacing aims for, past the relay's clock (round trip + margin - input delay)
  margin: number; // adaptive safety margin (steps)
  inputDelay: number; // steps between pressing and it taking effect
  rttMs: number | null; // ping to the relay (moving average)
  rollbacks: number; // this second
  avgDepth: number; // steps re-simulated per rollback, this second
  maxDepth: number;
  resimMs: number; // CPU spent rewinding + re-simulating, this second
  maxResimMs: number; // longest single rollback, this second
  corrAvgPx: number; // how far fighters visibly jumped per rollback (before smoothing), this second
  corrMaxPx: number;
  ownLate: number; // my own inputs that reached the relay too late (moved to a later step), this second
  frozen: number; // frames where the present waited for the relay (a step was due but it didn't run), this second
  slews: number; // tiny time-sync adjustments (a frame waited or doubled to stay on target), this second
  bursts: number; // frames that ran 3+ steps at once, this second
  ticksIn: number; // official steps received this second (60 = steady)
  maxGapMs: number; // longest wait between two received steps, this second
  fps: number; // frames drawn this second
  maxFrameMs: number; // longest time between two frames, this second
  workMs: number; // average time per frame spent in game logic (stepping, rollbacks), ms
}

export class NetLog {
  readonly rows: NetLogRow[] = [];
  private session: OnlineSession | null = null;
  private start = 0;
  private windowStart = 0;
  private w = NetLog.emptyWindow();
  private lastTickAt = 0;
  private lastFrameAt = 0;
  private lastStalls = 0;
  private lastSlews = 0;
  private overlay: HTMLPreElement | null = null;

  private static emptyWindow() {
    return { rollbacks: 0, depth: 0, maxDepth: 0, resimMs: 0, maxResimMs: 0, corr: 0, corrMax: 0, ownLate: 0, frozen: 0, slews: 0, bursts: 0, ticksIn: 0, maxGapMs: 0, frames: 0, maxFrameMs: 0, workMs: 0 };
  }

  static enabled(): boolean {
    return new URLSearchParams(location.search).get("netlog") === "1";
  }

  constructor() {
    const pre = document.createElement("pre");
    pre.className = "netlog";
    Object.assign(pre.style, {
      position: "fixed",
      left: "8px",
      bottom: "8px",
      margin: "0",
      padding: "6px 8px",
      font: "11px/1.35 ui-monospace, Menlo, monospace",
      color: "#e8ffe8",
      background: "rgba(0,0,0,.72)",
      borderRadius: "6px",
      pointerEvents: "none",
      zIndex: "50",
      whiteSpace: "pre",
    });
    pre.textContent = "net log: waiting for an online match";
    document.body.appendChild(pre);
    this.overlay = pre;
    addEventListener("keydown", (e) => {
      if (e.key === "l" || e.key === "L") this.download();
    });
  }

  /** A new online match: start a fresh log, and listen to its rollbacks. */
  attach(session: OnlineSession | null) {
    this.session = session;
    this.rows.length = 0;
    this.start = this.windowStart = performance.now();
    this.w = NetLog.emptyWindow();
    this.lastTickAt = 0;
    this.lastStalls = session ? session.stats.stalls + session.stats.capped : 0;
    this.lastSlews = session?.stats.slews ?? 0;
    if (!session) return;
    session.onRollback = (r) => {
      const w = this.w;
      w.rollbacks++;
      w.depth += r.depth;
      w.maxDepth = Math.max(w.maxDepth, r.depth);
      w.resimMs += r.ms;
      w.maxResimMs = Math.max(w.maxResimMs, r.ms);
      w.corr += r.jump;
      w.corrMax = Math.max(w.corrMax, r.jump);
      if (r.ownLate) w.ownLate++;
    };
  }

  /** An official step arrived from the relay. */
  tickArrived() {
    const now = performance.now();
    if (this.lastTickAt) this.w.maxGapMs = Math.max(this.w.maxGapMs, now - this.lastTickAt);
    this.lastTickAt = now;
    this.w.ticksIn++;
  }

  /** Once per drawn frame: how many steps it ran, and how long the game logic took. */
  frame(now: number, steps: number, workMs: number) {
    const s = this.session;
    if (!s) return;
    const w = this.w;
    if (this.lastFrameAt) w.maxFrameMs = Math.max(w.maxFrameMs, now - this.lastFrameAt);
    this.lastFrameAt = now;
    w.frames++;
    w.workMs += workMs;
    // Stalls/slews come from the session's counters (on a 120 Hz screen, half the frames have no step due: not a freeze).
    // (A step refused at the prediction cap is a freeze too.)
    const stalls = s.stats.stalls + s.stats.capped;
    w.frozen += stalls - this.lastStalls;
    this.lastStalls = stalls;
    w.slews += s.stats.slews - this.lastSlews;
    this.lastSlews = s.stats.slews;
    if (steps >= 3) w.bursts++;
    if (now - this.windowStart >= 1000) this.flush(now);
  }

  private flush(now: number) {
    const s = this.session!;
    const w = this.w;
    const p = s.pacing;
    const secs = (now - this.windowStart) / 1000;
    const r1 = (x: number) => Math.round(x * 10) / 10;
    const r2 = (x: number) => Math.round(x * 100) / 100;
    this.rows.push({
      t: r1((now - this.start) / 1000),
      you: s.you,
      tick: s.sim.tick,
      confirmed: s.confirmedTick,
      newest: p.newest,
      frameAdvantage: s.sim.tick - p.newest,
      predicting: s.predicting,
      relayAhead: p.relayStep - p.newest,
      aheadSteps: p.aheadSteps,
      margin: p.margin,
      inputDelay: s.inputDelay,
      rttMs: s.rttMs === null ? null : Math.round(s.rttMs),
      rollbacks: w.rollbacks,
      avgDepth: r1(w.rollbacks ? w.depth / w.rollbacks : 0),
      maxDepth: w.maxDepth,
      resimMs: r2(w.resimMs),
      maxResimMs: r2(w.maxResimMs),
      corrAvgPx: r1(w.rollbacks ? (w.corr / w.rollbacks) * PX_PER_M : 0),
      corrMaxPx: Math.round(w.corrMax * PX_PER_M),
      ownLate: w.ownLate,
      frozen: w.frozen,
      slews: w.slews,
      bursts: w.bursts,
      ticksIn: w.ticksIn,
      maxGapMs: Math.round(w.maxGapMs),
      fps: Math.round(w.frames / secs),
      maxFrameMs: Math.round(w.maxFrameMs),
      workMs: r2(w.frames ? w.workMs / w.frames : 0),
    });
    this.windowStart = now;
    this.w = NetLog.emptyWindow();
    this.show();
  }

  private show() {
    const r = this.rows.at(-1);
    if (!r || !this.overlay) return;
    const n = this.rows.length;
    const sum = (k: keyof NetLogRow) => this.rows.reduce((a, x) => a + (x[k] as number), 0);
    this.overlay.textContent = [
      `NET LOG  t=${r.t}s  fighter ${r.you}  (L: download)`,
      `ping ${r.rttMs ?? "?"} ms   input delay ${r.inputDelay}f   margin ${r.margin}f   aiming ${r.aheadSteps}f ahead`,
      `frame adv ${r.frameAdvantage}f (tick ${r.tick} - newest ${r.newest})   predicting ${r.predicting}f   relay ahead ${r.relayAhead}f`,
      `rollbacks ${r.rollbacks}/s  depth avg ${r.avgDepth} max ${r.maxDepth}   resim ${r.resimMs} ms (max ${r.maxResimMs})`,
      `jumps avg ${r.corrAvgPx}px max ${r.corrMaxPx}px   own late ${r.ownLate}   frozen ${r.frozen}   time-sync ${r.slews}   bursts ${r.bursts}`,
      `steps in ${r.ticksIn}/s  max gap ${r.maxGapMs} ms   fps ${r.fps}  max frame ${r.maxFrameMs} ms  work ${r.workMs} ms/frame`,
      `match so far: ${sum("rollbacks")} rollbacks (${(sum("rollbacks") / n).toFixed(1)}/s), ${sum("frozen")} frozen, ${sum("ownLate")} own late`,
    ].join("\n");
  }

  download() {
    const blob = new Blob([JSON.stringify(this.rows, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `netlog-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
