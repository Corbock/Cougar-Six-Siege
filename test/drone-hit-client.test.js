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
    curSlot: "primary", recordHit() {}, mark() {}, say() {}, showShieldImpact() {}, paintHit() {},
    hurtDummy(dummy, damage) { dummy.hp -= damage; } };
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

test("practice headshots eliminate with primaries and the magnum, but not other sidearms", () => {
  for (const [slot, id, expected] of [["primary", "mk18", 0], ["primary", "hammer", 0],
    ["secondary", "magnum", 0], ["secondary", "p45", 60]]) {
    const sim = client();
    sim.curSlot = slot;
    sim.dummies.push({ x: 0, z: 10, hp: 100 });
    sim.trace({ item: { id }, kind: { mult: 4 }, stats: { dmg: 5 } }, 30, 1);
    assert.equal(sim.dummies[0].hp, expected, id);
  }
});

test("barricade shots send cell paint without creating a floating splash", () => {
  const sim = client(), hits = [], splashes = [];
  sim.paintColor = () => "#32a6ef";
  sim.paintHit = (...args) => splashes.push(args);
  sim.hitBarricade = (...args) => hits.push(args);
  sim.colliders.push({ x0: -1, x1: 1, y0: 0, y1: 3, z0: 3, z1: 3.2, bar: { id: "cover" } });
  sim.trace({ item: { id: "mk18" }, kind: { mult: 4 }, stats: { dmg: 5 } }, 30, 1);
  assert.equal(hits[0].at(-1), "#32a6ef");
  assert.equal(sim.sent[0].paint, "#32a6ef");
  assert.equal(splashes.length, 0);
});

test("player paint is sent before damage can end the match", () => {
  const sim = client();
  sim.multiplayer.socket = { send: (message) => sim.sent.push(JSON.parse(message)) };
  sim.multiplayer.remotePlayers.set("target", { id: "target", team: 2, health: 100,
    state: { x: 0, y: 1.8, z: 10, yaw: 0 } });
  sim.paintHit = () => sim.sent.push({ type: "paint" });
  sim.trace({ item: { id: "mk18" }, kind: { mult: 4 }, stats: { dmg: 5 } }, 30, 1);
  assert.deepEqual(sim.sent.map((message) => message.type), ["paint", "shoot"]);
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
