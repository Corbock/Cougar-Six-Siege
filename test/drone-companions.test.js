const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createSimulation() {
  const html = fs.readFileSync("index.html", "utf8");
  const start = html.indexOf("      function droneCanSee(");
  const end = html.indexOf("      function markEnemiesAround(", start);
  const deployStart = html.indexOf("      function deployDrone()", end);
  const deployEnd = html.indexOf("      function recallDrone()", deployStart);
  assert.ok(start >= 0 && end > start && deployStart > end && deployEnd > deployStart);
  const context = {
    drone: { active: false, uses: 3, companions: [], tags: new Map() },
    cam: { x: 0, y: 1.8, z: 0, yaw: 0, pitch: 0, vy: 0 },
    selectedOperatorId: "mr-m",
    lean: 0, crouched: false, mouseDown: false,
    multiplayer: { match: null, round: null },
    colliders: [], smokes: [], SMOKE_LIFE: 16, SMOKE_R: 4.5,
    tNow: 0, targets: [], dummies: [{ hp: 100, x: 5, z: 0 }], shots: [], messages: [], pings: 0,
    isDead: () => false,
    droneTargets() { return context.targets; },
    rayBox(_origin, _direction, collider) { return collider.block ? 0 : Infinity; },
    smokeFade: () => 1,
    playDronePing() { context.pings++; },
    say(message) { context.messages.push(message); },
    hurtDummy(dummy, damage) { dummy.hp -= damage; context.shots.push(context.tNow); },
    addPaint() {}, paintColor: () => "#f6df35",
    sendMatch(message) { context.shots.push(message); },
    aimDir: () => [0, 0, 1],
    startDroneHum() {},
    Math
  };
  vm.runInNewContext(html.slice(start, end) + html.slice(deployStart, deployEnd), context);
  return context;
}

test("Mr M deploys scanner, attacker, scanner together without controlling a camera", () => {
  const sim = createSimulation();
  for (let i = 0; i < 4; i++) sim.deployDrone();
  assert.equal(sim.drone.active, false);
  assert.equal(sim.drone.uses, 0);
  assert.equal(sim.drone.companions.length, 3);
  assert.deepEqual(Array.from(sim.drone.companions, (entry) => entry.mode), ["scanner", "attacker", "scanner"]);
  assert.equal(sim.cam.y, 1.8);
  assert.match(sim.messages.at(-1), /NO DRONES LEFT/);
  sim.tNow = 1;
  sim.updateCompanionDrones();
  assert.ok(sim.drone.companions.every((entry) => entry.y > sim.cam.y));
});

test("scanners mark visible enemies every 45 seconds", () => {
  const sim = createSimulation();
  sim.targets = [{ id: "dummy-0", name: "TARGET", x: 5, y: 1.8, z: 0 }];
  sim.deployDrone();
  sim.tNow = 44.99;
  sim.updateCompanionDrones();
  assert.equal(sim.drone.tags.size, 0);
  sim.tNow = 45;
  sim.updateCompanionDrones();
  assert.equal(sim.drone.tags.get("dummy-0").expires, 53);
  assert.equal(sim.pings, 1);
  sim.tNow = 89.99;
  sim.updateCompanionDrones();
  assert.equal(sim.pings, 1);
  sim.tNow = 90;
  sim.updateCompanionDrones();
  assert.equal(sim.pings, 2);
});

test("attacker waits two continuous seconds and stops firing behind cover", () => {
  const sim = createSimulation();
  sim.targets = [{ id: "dummy-0", name: "TARGET", x: 5, y: 1.8, z: 0 }];
  sim.deployDrone();
  sim.deployDrone();
  sim.updateCompanionDrones();
  sim.tNow = 1.99;
  sim.updateCompanionDrones();
  assert.equal(sim.shots.length, 0);
  sim.tNow = 2;
  sim.updateCompanionDrones();
  assert.equal(sim.dummies[0].hp, 96);
  sim.tNow = 2.19;
  sim.updateCompanionDrones();
  assert.equal(sim.shots.length, 1);
  sim.tNow = 2.2;
  sim.updateCompanionDrones();
  assert.equal(sim.shots.length, 2);
  sim.colliders.push({ block: true });
  sim.tNow = 2.4;
  sim.updateCompanionDrones();
  assert.equal(sim.drone.companions[1].target, null);
  assert.equal(sim.shots.length, 2);
  sim.colliders.length = 0;
  sim.tNow = 3;
  sim.updateCompanionDrones();
  sim.tNow = 4.99;
  sim.updateCompanionDrones();
  assert.equal(sim.shots.length, 2);
  sim.tNow = 5;
  sim.updateCompanionDrones();
  assert.equal(sim.shots.length, 3);
});

test("smoke breaks targeting and a dead owner loses companions", () => {
  const sim = createSimulation();
  sim.targets = [{ id: "dummy-0", name: "TARGET", x: 5, y: 1.8, z: 0 }];
  sim.deployDrone();
  sim.deployDrone();
  sim.updateCompanionDrones();
  assert.ok(sim.drone.companions[1].target);
  sim.smokes.push({ x: 3, y: 2, z: 0, t0: 0 });
  sim.tNow = 1;
  sim.updateCompanionDrones();
  assert.equal(sim.drone.companions[1].target, null);
  sim.isDead = () => true;
  sim.updateCompanionDrones();
  assert.equal(sim.drone.companions.length, 0);
});

test("Hallway Monitor and Custom retain controllable drones", () => {
  for (const [operator, mode] of [["hallway-monitor", "camera"], ["custom", "scanner"]]) {
    const sim = createSimulation();
    sim.selectedOperatorId = operator;
    sim.deployDrone();
    assert.equal(sim.drone.active, true);
    assert.equal(sim.drone.mode, mode);
    assert.equal(sim.drone.companions.length, 0);
    assert.equal(sim.cam.y, .42);
    assert.equal(sim.drone.returnTo.y, 1.8);
  }
});

test("multiplayer attacker targets a real player and sends shots after two seconds", () => {
  const sim = createSimulation();
  sim.multiplayer = { match: { team: 1 }, round: { phase: "live" } };
  sim.targets = [{ id: "player-enemy-id", name: "ENEMY", x: 5, y: 1.8, z: 0 }];
  sim.deployDrone(); sim.deployDrone();
  sim.updateCompanionDrones();
  sim.tNow = 2;
  sim.updateCompanionDrones();
  assert.equal(sim.drone.companions[1].targetId, "player-enemy-id");
  assert.equal(sim.shots.length, 1);
  assert.equal(sim.shots[0].type, "drone_attack");
  assert.equal(sim.shots[0].targetId, "enemy-id");
});

test("losing a drone does not change the remaining deployment order", () => {
  const sim = createSimulation();
  sim.deployDrone(); sim.deployDrone();
  sim.drone.companions.shift();
  sim.deployDrone();
  assert.deepEqual(Array.from(sim.drone.companions, (entry) => [entry.slot, entry.mode]), [[1, "attacker"], [2, "scanner"]]);
});
