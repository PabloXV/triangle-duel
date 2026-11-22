// Every tunable number in the game lives here.
//
// `live: true` params are re-read by the sim every tick, so dragging a slider
// changes the current match. `live: false` params are only read when a match is
// created (they change the body itself: its shape or mass), so they apply on restart.
//
// Units: meters, seconds, kilograms (Rapier's units). Y points up in the sim.

export interface Params {
  // world
  gravity: number; // m/s^2, downward
  // fighter body
  triWidth: number; // width of the top edge (m)
  triHeight: number; // foot to top edge (m)
  density: number; // kg/m^2, so mass = density * area
  friction: number; // Coulomb friction coefficient
  restitution: number; // bounciness, 0..1
  angularDamping: number; // spin decay rate (Rapier damping coefficient)
  // rotation control
  rotationMode: "torque" | "servo"; // what rotate input means, see Sim.applyRotation
  rotateTorque: number; // N·m: torque while holding (torque mode), or the motor cap (servo mode)
  servoSpeed: number; // rad/s target spin while holding (servo mode only)
  servoStiffness: number; // N·m per rad/s of spin error (servo mode only)
  airRotation: boolean; // allow rotating while airborne?
  airRotationScale: number; // torque multiplier when airborne
  // jumping
  jumpMode: "auto" | "manual"; // see Sim.applyJump
  hopSpeed: number; // m/s along "up" for an auto-hop
  idleHop: boolean; // auto mode: hop on every landing when not charging (default true; off: stand still, only charged jumps leave the ground)
  jumpMinSpeed: number; // m/s along "up" for a zero-charge jump
  jumpMaxSpeed: number; // m/s along "up" for a full charge
  jumpChargeTicks: number; // ticks of holding to reach full charge
  // foot / ground contact
  footTolerance: number; // foot counts as grounded within this distance of a surface (m)
  coyoteTicks: number; // can still jump this many ticks after leaving the ground
  jumpCooldownTicks: number; // after a jump: count as airborne (no re-jump, no grip) this long
  gripStrength: number; // foot-pull force, as a multiple of body weight. 0 = off
  gripRange: number; // grip pulls the foot only while within this distance of the surface (m)
  // KO
  koTolerance: number; // a top vertex within this distance of a surface = KO (m)
}

export const DEFAULT_PARAMS: Params = {
  gravity: 10.5,
  triWidth: 1.25,
  triHeight: 1.2,
  density: 1.0,
  friction: 1.0,
  restitution: 0.0,
  angularDamping: 1.0,
  rotationMode: "servo",
  rotateTorque: 5.5,
  servoSpeed: 3,
  servoStiffness: 30,
  airRotation: true,
  airRotationScale: 0.5,
  jumpMode: "auto",
  hopSpeed: 2.3,
  idleHop: true,
  jumpMinSpeed: 5,
  jumpMaxSpeed: 7.5,
  jumpChargeTicks: 40,
  footTolerance: 0.05,
  coyoteTicks: 6,
  jumpCooldownTicks: 8,
  gripStrength: 2,
  gripRange: 0.3,
  koTolerance: 0.03,
};

type NumKey = { [K in keyof Params]: Params[K] extends number ? K : never }[keyof Params];

export type ParamGroup = "World" | "Body" | "Movement" | "Charge jump" | "Advanced";

export interface ParamMeta {
  group: ParamGroup;
  live: boolean;
  range?: [min: number, max: number, step: number];
  options?: string[];
  /** Only show in the panel when this is true (e.g. params of a mode that's off). */
  showIf?: (p: Params) => boolean;
}

const servo = (p: Params) => p.rotationMode === "servo";

// UI metadata, kept here so the panel never has to guess what a param means.
// Main groups hold the knobs that shape the game. "Advanced" holds the mode
// switches (decided: servo, auto, air rotation on) and the plumbing that makes
// the core feel right but rarely needs touching.
export const PARAM_META: Record<keyof Params, ParamMeta> & Record<NumKey, { range: [number, number, number] }> = {
  gravity: { group: "World", live: true, range: [0, 40, 0.5] },

  triWidth: { group: "Body", live: false, range: [0.3, 3, 0.05] },
  triHeight: { group: "Body", live: false, range: [0.3, 3, 0.05] },
  density: { group: "Body", live: false, range: [0.1, 5, 0.1] },
  friction: { group: "Body", live: true, range: [0, 3, 0.05] },
  gripStrength: { group: "Body", live: true, range: [0, 10, 0.1] },

  rotateTorque: { group: "Movement", live: true, range: [0, 40, 0.1] },
  servoSpeed: { group: "Movement", live: true, range: [0, 15, 0.1], showIf: servo },
  airRotationScale: { group: "Movement", live: true, range: [0, 2, 0.05], showIf: (p) => p.airRotation },
  hopSpeed: { group: "Movement", live: true, range: [0, 15, 0.1], showIf: (p) => p.jumpMode === "auto" },
  idleHop: { group: "Movement", live: true, showIf: (p) => p.jumpMode === "auto" },

  jumpMinSpeed: { group: "Charge jump", live: true, range: [0, 30, 0.5] },
  jumpMaxSpeed: { group: "Charge jump", live: true, range: [0, 40, 0.5] },
  jumpChargeTicks: { group: "Charge jump", live: true, range: [1, 120, 1] },

  rotationMode: { group: "Advanced", live: true, options: ["servo", "torque"] },
  jumpMode: { group: "Advanced", live: true, options: ["auto", "manual"] },
  airRotation: { group: "Advanced", live: true },
  servoStiffness: { group: "Advanced", live: true, range: [0, 200, 1], showIf: servo },
  angularDamping: { group: "Advanced", live: true, range: [0, 10, 0.1] },
  restitution: { group: "Advanced", live: true, range: [0, 1, 0.05] },
  footTolerance: { group: "Advanced", live: true, range: [0, 0.5, 0.01] },
  coyoteTicks: { group: "Advanced", live: true, range: [0, 30, 1] },
  jumpCooldownTicks: { group: "Advanced", live: true, range: [0, 30, 1] },
  gripRange: { group: "Advanced", live: true, range: [0, 1, 0.01] },
  koTolerance: { group: "Advanced", live: true, range: [0, 0.2, 0.005] },
};

export const PARAM_GROUPS: ParamGroup[] = ["World", "Body", "Movement", "Charge jump", "Advanced"];
