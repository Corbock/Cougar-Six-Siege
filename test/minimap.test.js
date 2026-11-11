const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function context(log) {
  const ctx = { log };
  for (const method of ["fillRect", "clearRect", "drawImage", "save", "restore", "translate", "rotate",
    "beginPath", "moveTo", "lineTo", "rect", "arc", "closePath", "stroke"]) {
    ctx[method] = (...args) => log.push([method, ...args]);
  }
  ctx.fill = () => log.push(["fill", ctx.fillStyle]);
  return ctx;
}

test("minimap renders map geometry and updates player, spawn, drone, teammates and active objectives", () => {
  const screenLog = [], backgroundLog = [];
  const screen = context(screenLog), background = context(backgroundLog);
  const canvas = { width: 480, height: 320, getContext: () => screen };
  const sandbox = { document: { createElement: () => ({ getContext: () => background }) } };
  vm.runInNewContext(fs.readFileSync("minimap.js", "utf8"), sandbox);
  const minimap = sandbox.GameMinimap.create(canvas, { x0: 0, x1: 100, z0: 0, z1: 100 }, [
    { x0: 10, x1: 20, z0: 10, z1: 20, y0: 0, y1: 4 },
    { x0: 20, x1: 25, z0: 20, z1: 25, y0: 3, y1: 4 }
  ]);
  assert.equal(backgroundLog.filter((entry) => entry[0] === "fillRect").length, 3, "walls are drawn but ceilings are omitted");
  minimap.draw({
    player: { x: 50, z: 50, yaw: Math.PI / 2 },
    drone: { x: 60, z: 60 },
    spawn: { x: 10, z: 10 },
    teammates: [{ x: 20, z: 20 }, { x: 30, z: 30 }],
    objectives: [{ kind: "bomb", x: 40, z: 40 }, { kind: "bomb", x: 70, z: 70, armed: true },
      { kind: "hostage", x: 80, z: 80, alive: false }]
  });
  assert.deepEqual(screenLog.filter((entry) => entry[0] === "fill").map((entry) => entry[1]),
    ["#64b6ff", "#ffd75b", "#ff7866", "#67d68c", "#67d68c", "#ffffff", "#65e4ef"]);
  assert.ok(screenLog.some((entry) => entry[0] === "rotate" && entry[1] === -Math.PI / 2));
  screenLog.length = 0;
  minimap.draw({ player: { x: 51, z: 50, yaw: 0 }, spawn: { x: 10, z: 10 }, drone: null, teammates: [], objectives: [] });
  assert.deepEqual(screenLog.filter((entry) => entry[0] === "fill").map((entry) => entry[1]), ["#64b6ff", "#ffffff"]);
  assert.equal(screenLog.filter((entry) => entry[0] === "clearRect").length, 1);
});

test("client minimap excludes enemies and dead teammates, resets objectives, and uses the operator position while droning", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const start = html.indexOf("      function updateMinimap()"), end = html.indexOf("      const tagElements", start);
  assert.ok(start >= 0 && end > start);
  const draws = [];
  const cam = { x: 10, z: 15 }, body = { x: 2, z: 3 }, spawn = { x: 1, z: 1 };
  const multiplayer = { match: { team: 1, spawn }, round: { phase: "live" }, objectives: [{ kind: "bomb", x: 4, z: 4 }],
    remotePlayers: new Map([
      ["friend", { team: 1, health: 100, state: { x: 5, z: 5 } }],
      ["dead", { team: 1, health: 0, state: { x: 6, z: 6 } }],
      ["enemy", { team: 2, health: 100, state: { x: 7, z: 7 } }]
    ]) };
  const sandbox = { multiplayer, cam, drone: { active: true, returnTo: body }, practiceSpawn: { x: 0, z: 0 },
    isDead: () => false, ownEntry: () => null, minimap: { draw: (data) => draws.push(data) } };
  vm.runInNewContext(html.slice(start, end), sandbox);
  sandbox.updateMinimap();
  assert.equal(draws[0].player, body);
  assert.equal(draws[0].drone, cam);
  assert.equal(draws[0].spawn, spawn);
  assert.equal(draws[0].teammates.length, 1);
  assert.equal(draws[0].teammates[0].x, 5);
  assert.equal(draws[0].objectives.length, 1);
  multiplayer.round.phase = "roundEnd";
  sandbox.updateMinimap();
  assert.equal(draws[1].objectives.length, 0);
  multiplayer.match = null;
  sandbox.drone.active = false;
  sandbox.updateMinimap();
  assert.equal(draws[2].spawn, sandbox.practiceSpawn);
  assert.equal(draws[2].teammates.length, 0);
  assert.equal(draws[2].objectives.length, 0);
});
