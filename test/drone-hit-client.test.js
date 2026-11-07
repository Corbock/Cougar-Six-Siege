const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync("index.html", "utf8");

function section(start, end) {
  const first = html.indexOf(start), last = html.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return html.slice(first, last);
}

function client() {
  const sent = [], math = Object.create(Math);
  math.random = () => .5;
  const context = { Math: math, cam: { x: 0, y: 1.8, z: 0, yaw: 0, pitch: 0 },
    renderCam: { x: 0, y: 1.8, z: 0 }, selectedOperatorId: "ms-a", keys: new Set(),
    currentKeybinds: { sprint: "shift" }, EYE: 1.8, CROUCH_EYE: 1.05,
    colliders: [], dummies: [], sent, sendMatch: (message) => sent.push(message),
    multiplayer: { match: { team: 1 }, round: { phase: "live" }, remotePlayers: new Map() },
    recordHit() {}, mark() {}, say() {}, showShieldImpact() {} };
  vm.runInNewContext(section("      const rayBox =", "      const hudMsg =") +
    section("      function trace(", "      function hurtDummy("), context);
  return context;
}

test("shots target enemy companion or camera drones before players and stop at cover", () => {
  const sim = client();
  const weapon = { item: { id: "vector" }, kind: { mult: 4 }, stats: { dmg: 4 } };
  const owner = { id: "enemy", team: 2, health: 100, state: { x: 0, y: 1.8, z: 10, yaw: 0,
    companions: [{ slot: 2, x: 0, y: 1.8, z: 5 }] } };
  sim.multiplayer.remotePlayers.set(owner.id, owner);
  sim.trace(weapon, 30, 1);
  assert.equal(sim.sent[0].type, "drone_hit");
  assert.equal(sim.sent[0].slot, 2);
  assert.equal(sim.sent[0].ownerId, "enemy");
  sim.sent.length = 0;
  owner.state.companions = [];
  owner.state.droneState = { x: 0, y: 1.8, z: 5 };
  sim.trace(weapon, 30, 1);
  assert.equal(sim.sent[0].slot, "camera");
  sim.sent.length = 0;
  sim.colliders.push({ x0: -1, x1: 1, y0: 0, y1: 3, z0: 3, z1: 3.2 });
  sim.trace(weapon, 30, 1);
  assert.equal(sim.sent.length, 0);
});

test("destroyed owned drones are removed and piloted cameras return control", () => {
  const effects = [], messages = [];
  const context = { multiplayer: { match: {}, playerId: "self", remotePlayers: new Map() },
    drone: { active: true, cameraDestroyed: false, companions: [{ slot: 0 }, { slot: 1 }, { slot: 2 }] },
    spawnDebris: (...args) => effects.push(args), recallDrone() { context.drone.active = false; },
    say: (message) => messages.push(message), Number };
  vm.runInNewContext(section("      function droneDestroyed(", "      function useHeld("), context);
  context.droneDestroyed({ ownerId: "self", slot: 1, x: 1, y: 2, z: 3 });
  assert.deepEqual(Array.from(context.drone.companions, (entry) => entry.slot), [0, 2]);
  context.droneDestroyed({ ownerId: "self", slot: "camera", x: 1, y: 2, z: 3 });
  assert.equal(context.drone.active, false);
  assert.equal(context.drone.cameraDestroyed, true);
  assert.equal(effects.length, 2);
  assert.equal(messages.length, 2);
});
