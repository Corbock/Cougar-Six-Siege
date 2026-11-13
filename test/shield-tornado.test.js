const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const net = require("node:net");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");

const html = fs.readFileSync("index.html", "utf8");
function section(start, end) {
  const first = html.indexOf(start), last = html.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing section: ${start}`);
  return html.slice(first, last);
}

function shieldModel() {
  const source = section("      shield: { mounts: {}, parts: [", "      drone: { mounts:");
  return vm.runInNewContext(`const box = (x,y,z,w,h,d,m) => ({c:[x,y,z],s:[w,h,d],m}); ({${source}}).shield`);
}

test("shield window has an unobstructed opening surrounded by a solid frame", () => {
  const parts = shieldModel().parts;
  const glass = parts.find((part) => part.m === "glass");
  assert.ok(glass);
  for (const y of [.8, 1.2, 1.6]) {
    for (const z of [-.8, 0, .8]) {
      assert.equal(parts.some((part) => part.m !== "glass" &&
        Math.abs(y - part.c[1]) < part.s[1] / 2 && Math.abs(z - part.c[2]) < part.s[2] / 2), false);
    }
  }
  for (const [y, z] of [[0, 0], [2, 0], [1.2, -1.2], [1.2, 1.2]]) {
    assert.ok(parts.some((part) => part.m === "body" &&
      Math.abs(y - part.c[1]) < part.s[1] / 2 && Math.abs(z - part.c[2]) < part.s[2] / 2));
  }
});

test("first-person shield has one translucent window centered near the crosshair", () => {
  const context = { Math, K: .06, tNow: 0, sprintPose: 0, ads: 0, skinOf: () => null, colorOf: (_w, m) => m };
  vm.runInNewContext(section("    function buildPolys(parts)", "    const inspector =") +
    section("      function viewmodelQuads(", "      function droneViewmodelQuads("), context);
  const parts = shieldModel().parts.map((p) => ({ ...p, k: "box" }));
  const polys = context.buildPolys(parts);
  const all = polys.flatMap((poly) => poly.v);
  const mid = [0, 1, 2].map((i) => (Math.min(...all.map((p) => p[i])) + Math.max(...all.map((p) => p[i]))) / 2);
  const weapon = { item: { id: "shield" }, kind: { held: true, vs: 2.6, at: [0, -.072, .42] },
    polys, mid, kick: 0, reloadEnd: 0, magPolys: [], flash: 0 };
  const quads = context.viewmodelQuads(weapon, false);
  const glass = quads.filter((q) => q.shieldGlass);
  assert.equal(glass.length, 1);
  const average = (axis) => glass[0].pts.reduce((sum, p) => sum + p[axis], 0) / 4;
  assert.ok(Math.abs(average(0)) < .001);
  assert.ok(Math.abs(average(1)) < .005);
  assert.ok(average(2) > .1 && average(2) < .5);
  assert.ok(quads.some((q) => !q.shieldGlass));
});

test("shield sidearm view follows the P45 recoil and reload state", () => {
  const context = { Math, K: .06, tNow: 0, sprintPose: 0, ads: 1, skinOf: () => null, colorOf: () => "#ffffff" };
  vm.runInNewContext(section("      function viewmodelQuads(", "      function droneViewmodelQuads("), context);
  const gun = { item: { id: "p45" }, kind: { reload: 2 }, kick: 0, rear: 1, reloadEnd: 0, magPolys: [], flash: 0,
    mid: [0, 0, 0], polys: [{ m: "body", v: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] }] };
  const rest = context.viewmodelQuads(gun, false, true)[0].pts[0];
  assert.ok(rest[0] > .2 && rest[2] > .1);
  gun.kick = 1;
  const recoiling = context.viewmodelQuads(gun, false, true)[0].pts[0];
  assert.ok(recoiling[2] < rest[2]);
  gun.kick = 0; gun.reloadStart = 0; gun.reloadEnd = 2; context.tNow = 1;
  const reloading = context.viewmodelQuads(gun, false, true)[0].pts[0];
  assert.ok(reloading[1] > rest[1] + .05 && reloading[1] < rest[1] + .15,
    "Reload pose should lift the weapon slightly while keeping it in view");
});

test("sprinting keeps the weapon viewmodel within the camera frame", () => {
  const context = { Math, K: .06, tNow: 0, sprintPose: 1, ads: 0, skinOf: () => null, colorOf: () => "#ffffff" };
  vm.runInNewContext(section("      function viewmodelQuads(", "      function droneViewmodelQuads("), context);
  const weapon = { item: { id: "mk18" }, kind: {}, kick: 0, rear: 5, reloadEnd: 0, magPolys: [], flash: 0,
    mid: [0, 0, 0], polys: [{ m: "body", v: [[-5, -.4, 0], [5, -.4, 0], [5, .4, 0], [-5, .4, 0]] }] };
  const points = context.viewmodelQuads(weapon, true).flatMap((quad) => quad.pts);
  const centerY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  const centerZ = points.reduce((sum, point) => sum + point[2], 0) / points.length;
  assert.ok(centerZ > .1, "Sprint pose should keep the weapon in front of the camera");
  assert.ok(centerY > -centerZ / 1.8, "Sprint pose should keep the weapon above the bottom of the view");
});

test("reload removes the magazine, leaves the well empty, and seats it again", () => {
  const context = { Math, K: .06, tNow: 0, sprintPose: 0, ads: 0, skinOf: () => null, colorOf: (_w, m) => m };
  vm.runInNewContext(section("      function viewmodelQuads(", "      function droneViewmodelQuads("), context);
  const weapon = { item: { id: "mk18" }, kind: { reload: 2 }, kick: 0, rear: 0, reloadEnd: 0, reloadStart: 0, flash: 0,
    mid: [0, 0, 0], polys: [{ m: "body", v: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] }],
    magPolys: [{ m: "paint", v: [[0, -1, 0], [.2, -1, 0], [.2, 0, 0], [0, 0, 0]] }] };
  const magazine = () => context.viewmodelQuads(weapon, false).find((quad) => quad.color === "paint");
  const seated = magazine().pts[0];
  assert.notDeepEqual(context.viewmodelQuads(weapon, false)[0].pts[0], context.viewmodelQuads(weapon, true)[0].pts[0],
    "Walking should add sway to the weapon pose");
  weapon.reloadEnd = 2;
  context.tNow = .32;
  let pose = context.viewmodelQuads(weapon, false), removed = pose.find((quad) => quad.color === "paint");
  assert.ok(removed.pts[3][1] < pose[0].pts[0][1] - .05, "Old magazine should pull free and drop");
  assert.ok(pose.some((quad) => quad.color === "#c89170"), "Hand should grab the old magazine");
  context.tNow = .8;
  assert.equal(magazine(), undefined, "Magazine well should be visibly empty");
  context.tNow = .9;
  assert.equal(context.viewmodelQuads(weapon, false).some((quad) => quad.color === "#c89170"), false,
    "Hand should leave the screen between magazines");
  context.tNow = 1.2;
  pose = context.viewmodelQuads(weapon, false);
  const inserted = pose.find((quad) => quad.color === "paint");
  assert.ok(inserted.pts[3][1] < pose[0].pts[0][1] - .05, "Fresh magazine should start below the weapon");
  assert.ok(pose.some((quad) => quad.color === "#c89170"), "Hand should return with the fresh magazine");
  context.tNow = 1.98;
  const reloaded = magazine();
  assert.ok(Math.abs(reloaded.pts[0][1] - seated[1]) < .05, "Magazine should return to its seated position");
  assert.equal(context.viewmodelQuads(weapon, false).some((quad) => quad.color === "#c89170"), false,
    "Hand should leave the weapon after insertion");
});

test("compact medkit opens away from the player, shows remaining bandages, then wraps the forearm", () => {
  const context = { Math, tNow: 0, medkitActionStart: 0, medkitActionDuration: 4.2, charges: { medkit: 3 },
    qb(list, x0, x1, y0, y1, z0, z1, color, transform = (point) => point) {
      const points = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map(transform);
      [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]]
        .forEach((face) => list.push({ pts: face.map((index) => points[index]), color }));
    } };
  vm.runInNewContext(section("      function medkitActionQuads()", "      function droneViewmodelQuads("), context);
  const drawAt = (time) => { context.tNow = time; return context.medkitActionQuads(); };
  const average = (quads, color, axis) => {
    const points = quads.filter((quad) => quad.color === color).flatMap((quad) => quad.pts);
    return points.reduce((sum, point) => sum + point[axis], 0) / points.length;
  };
  const closed = drawAt(.5), open = drawAt(.9);
  assert.ok(average(open, "#f1f2eb", 1) - average(open, "#d9ded5", 1) >
    average(closed, "#f1f2eb", 1) - average(closed, "#d9ded5", 1) + .04, "Lid should hinge upward");
  assert.ok(average(open, "#f1f2eb", 2) - average(open, "#d9ded5", 2) >
    average(closed, "#f1f2eb", 2) - average(closed, "#d9ded5", 2) + .04, "Lid should swing away from the player");
  const casePoints = open.filter((quad) => quad.color === "#d9ded5").flatMap((quad) => quad.pts);
  const caseSpans = [0, 1, 2].map((axis) => Math.max(...casePoints.map((point) => point[axis])) -
    Math.min(...casePoints.map((point) => point[axis])));
  assert.ok(Math.max(...caseSpans) <= .38, "Medkit case should stay compact");
  const remainingRollCaps = (count) => {
    context.charges.medkit = count;
    return drawAt(1.5).filter((quad) => quad.color === "#d3d8d0").length;
  };
  assert.equal(remainingRollCaps(3), 6, "Three bandage rolls should be visible before using a charge");
  assert.equal(remainingRollCaps(2), 4, "One roll should disappear after using a charge");
  assert.equal(remainingRollCaps(1), 2, "Only one roll should remain after two uses");
  const wrapped = drawAt(3.8);
  assert.equal(wrapped.some((quad) => quad.color === "#d9ded5"), false, "Medkit should drop out of view");
  assert.ok(wrapped.filter((quad) => quad.color === "#f7f5ea").length >= 60,
    "Bandage should form a visible spiral around the forearm");
  const spiralPoints = wrapped.filter((quad) => quad.color === "#f7f5ea" &&
    quad.pts.reduce((sum, point) => sum + point[0], 0) / quad.pts.length > -.6 &&
    quad.pts.reduce((sum, point) => sum + point[0], 0) / quad.pts.length < -.2)
    .flatMap((quad) => quad.pts);
  assert.ok(Math.min(...spiralPoints.map((point) => point[2])) > .48 &&
    Math.max(...spiralPoints.map((point) => point[2])) < .525,
  "Bandage should sit outside the front surface of the arm");
  const armStart = [-.45, -.28];
  const armEndX = -.19;
  const armEndY = -.15;
  const armDx = armEndX - armStart[0], armDy = armEndY - armStart[1];
  const armLength = Math.hypot(armDx, armDy);
  const forearmFractions = spiralPoints.map((point) =>
    ((point[0] - armStart[0]) * armDx + (point[1] - armStart[1]) * armDy) / armLength ** 2);
  assert.ok(Math.min(...forearmFractions) >= .63 && Math.max(...forearmFractions) <= 1.01,
    "Bandage should stay on the exposed left forearm instead of drifting onto the hand or sleeve");
  assert.ok(Math.max(...spiralPoints.map((point) => point[0])) < 0,
    "Bandage should wrap the left arm rather than the right");
  const projectedPoints = spiralPoints.map((point) =>
    [point[0] * 1.8 * 9 / 16 / point[2], point[1] * 1.8 / point[2]]);
  assert.ok(projectedPoints.every(([x, y]) => Math.abs(x) < 1 && Math.abs(y) < 1),
    "Bandage should stay fully in frame");
  const applyingHand = wrapped.filter((quad) => quad.color === "#c89170")
    .flatMap((quad) => quad.pts).filter((point) => point[2] <= .405);
  assert.ok(applyingHand.length > 0 &&
    Math.max(...applyingHand.map((point) => point[1] * 1.8 / point[2])) < -.4,
  "Applying hand should stay in the lower half of the screen");
  const wrappedHand = wrapped.filter((quad) => quad.color === "#c89170" &&
    quad.pts.reduce((sum, point) => sum + point[2], 0) / quad.pts.length > .54)
    .flatMap((quad) => quad.pts).filter((point) => point[0] < 0);
  assert.ok(wrappedHand.length > 0 && Math.max(...wrappedHand.map((point) => point[1])) > -.11,
    "Wrapped left forearm and hand should be prominent on screen");
});

test("full-health medkits are usable in freeplay but remain blocked in multiplayer", () => {
  const useMedkit = ({ freeplayMode, match, round, health }) => {
    const messages = [], sent = [], patient = health === null ? null : { health };
    const context = { freeplayMode, multiplayer: { match, round, socket: { send: (message) => sent.push(JSON.parse(message)) } },
      charges: { medkit: 3 }, ownEntry: () => patient, medkitActionStart: -1, tNow: 5,
      renderCam: { x: 0, y: 1.8, z: 0 }, aimDir: () => [0, 0, 1], say: (message) => messages.push(message) };
    vm.runInNewContext(section("      function useHeld(w)", "      const smokeFade ="), context);
    context.useHeld({ item: { id: "medkit" }, kind: { uses: 3 }, kick: 0 });
    return { context, messages, sent, patient };
  };
  const freeplay = useMedkit({ freeplayMode: true, match: null, health: 100 });
  assert.equal(freeplay.context.charges.medkit, 2);
  assert.equal(freeplay.context.medkitActionStart, 5);
  assert.deepEqual(freeplay.messages, ["MEDKIT USED"]);
  assert.equal(freeplay.patient.health, 100);
  assert.deepEqual(freeplay.sent, []);

  const multiplayer = useMedkit({ freeplayMode: false, match: {}, health: 100 });
  assert.equal(multiplayer.context.charges.medkit, 3);
  assert.equal(multiplayer.context.medkitActionStart, -1);
  assert.deepEqual(multiplayer.messages, ["NO INJURIES TO TREAT"]);

  const prep = useMedkit({ freeplayMode: false, match: {}, round: { phase: "prep" }, health: 60 });
  assert.equal(prep.context.charges.medkit, 3);
  assert.equal(prep.context.medkitActionStart, -1);
  assert.deepEqual(prep.messages, ["NO INJURIES TO TREAT"]);

  const injured = useMedkit({ freeplayMode: false, match: {}, round: { phase: "live" }, health: 60 });
  assert.equal(injured.context.charges.medkit, 2);
  assert.equal(injured.patient.health, 100);
  assert.deepEqual(injured.sent, [{ type: "heal" }]);
});

test("shield retains an equipped P45 and safely handles other Custom secondaries", () => {
  const shield = { item: { id: "shield" } }, pistol = { item: { id: "p45" } }, rifle = { item: { id: "mk18" } };
  const context = { loadout: { secondary: "p45" }, weapons: { p45: pistol } };
  vm.runInNewContext(section("      const shieldWeapon =", "      function refreshWeapons()") +
    "this.chooseShieldWeapon = shieldWeapon;", context);
  assert.equal(context.chooseShieldWeapon(shield), pistol);
  assert.equal(context.chooseShieldWeapon(rifle), rifle);
  context.loadout.secondary = "rattler";
  assert.equal(context.chooseShieldWeapon(shield), shield);
});

function renderViewmodel(operator, item, droneActive = false) {
  const calls = [], gl = {
    BLEND: "blend", SRC_ALPHA: "src", ONE_MINUS_SRC_ALPHA: "inverse",
    enable: (v) => calls.push(["enable", v]), disable: (v) => calls.push(["disable", v]),
    blendFunc: () => {}, depthMask: (v) => calls.push(["depth", v]),
    uniform1f: (_location, value) => calls.push(["alpha", value])
  };
  const context = { fwd: 0, str: 0, dead: false, optic: null, drone: { active: droneActive, deploying: null },
    cw: { item: { id: item } }, selectedOperatorId: operator, weapons: { p45: { item: { id: "p45" } } },
    grenadeThrowActionActive: () => false, grenadeThrowActionQuads: () => [],
    medkitActionActive: () => false, medkitActionQuads: () => [{}],
    barricadeActionActive: () => false, barricadeActionQuads: () => [],
    gl, u: () => "alpha",
    viewmodelQuads: (w, _moving, sidearm) => {
      calls.push(["model", w.item.id, Boolean(sidearm)]);
      return w.item.id === "shield" ? [{ shieldGlass: true }, {}] : [{}];
    },
    droneViewmodelQuads: () => [{}],
    drawDynamic: (list) => calls.push(["draw", list.length, Boolean(list[0]?.shieldGlass)]),
    drawSkinned: () => {}
  };
  vm.runInNewContext(section("        const moving = fwd !== 0 || str !== 0;", "        updateTeamTags();"), context);
  return calls;
}

test("only Ms C sees the P45 with her shield, and glass is drawn after opaque geometry", () => {
  const calls = renderViewmodel("ms-c", "shield");
  assert.deepEqual(calls.filter((call) => call[0] === "model"), [["model", "shield", false], ["model", "p45", true]]);
  assert.deepEqual(calls.filter((call) => call[0] === "draw"), [["draw", 2, false], ["draw", 1, true]]);
  assert.deepEqual(calls.filter((call) => call[0] === "depth"), [["depth", false], ["depth", true]]);
  assert.deepEqual(calls.filter((call) => call[0] === "alpha"), [["alpha", .22], ["alpha", 1]]);
  assert.equal(renderViewmodel("custom", "shield").filter((call) => call[0] === "model").length, 1);
  assert.equal(renderViewmodel("ms-c", "mk18").filter((call) => call[0] === "model").length, 1);
  assert.equal(renderViewmodel("ms-c", "shield", true).filter((call) => call[0] === "model").length, 0);
});

test("tornado funnels grow, spiral, rotate, fade, and leave ordinary smoke unchanged", () => {
  const draws = [], uniforms = {};
  const context = { Math, Float32Array, SMOKE_LIFE: 16, SMOKE_R: 4.5, tNow: 0,
    smokes: [], renderCam: { x: 0, y: 0, z: 0 }, prog: {},
    gl: { BLEND: 1, SRC_ALPHA: 2, ONE_MINUS_SRC_ALPHA: 3, enable() {}, disable() {}, blendFunc() {}, depthMask() {},
      getUniformLocation: (_program, name) => name,
      uniform4fv: (name, value) => { uniforms[name] = Array.from(value); },
      uniform3fv: (name, value) => { uniforms[name] = Array.from(value); },
      uniform1f: (name, value) => { uniforms[name] = value; } },
    drawDynamic: (quads) => draws.push(quads)
  };
  vm.runInNewContext(section("      const smokeFade =", "      function remoteThrow("), context);
  context.smokeFade = vm.runInNewContext("smokeFade", context);
  const tornado = { x: 4, y: 1.5, z: 3, t0: 0, tornado: true };
  context.smokes.push(tornado, { x: 0, y: 1.5, z: 0, t0: 0, tornado: false });
  context.tNow = 2;
  context.setSmoke(context.prog, true);
  assert.equal(uniforms.smf[0], 1);
  assert.ok(Math.abs(uniforms.smf[1] - .35) < .00001);
  const first = context.tornadoQuads(tornado);
  assert.equal(first.length, 128);
  const radius = (p) => Math.hypot(p[0] - tornado.x, p[2] - tornado.z);
  assert.ok(radius(first[31].pts[2]) > radius(first[0].pts[0]) * 10);
  assert.ok(first[31].pts[2][1] > first[0].pts[0][1] + 6);
  context.drawTornadoes();
  assert.equal(draws.length, 1);
  context.tNow = 3;
  const later = context.tornadoQuads(tornado);
  assert.notDeepEqual(Array.from(first[0].pts[0]), Array.from(later[0].pts[0]));
  context.tNow = 14;
  assert.equal(context.smokeFade(tornado), .5);
  context.tNow = 16;
  context.setSmoke(context.prog, true);
  assert.equal(context.smokes.length, 0);
  context.drawTornadoes();
  assert.equal(draws.length, 1);
});

test("remote explosions retain the server's tornado type without a projectile copy", () => {
  const context = { multiplayer: { match: {}, remotePlayers: new Map() }, projectiles: [], smokes: [], tNow: 3, Math };
  vm.runInNewContext(section("      function remoteThrow(", "      const detonate ="), context);
  context.remoteExplosion({ id: "missing", kind: "smoke", x: 1, y: 0, z: 2, tornado: true });
  context.remoteExplosion({ id: "normal", kind: "smoke", x: 1, y: 0, z: 2, tornado: false });
  assert.equal(context.smokes[0].tornado, true);
  assert.equal(context.smokes[1].tornado, false);
});

test("snapshot restores a missed tornado with the right age without duplicating effects", () => {
  const context = { multiplayer: { match: {}, remotePlayers: new Map() }, projectiles: [], smokes: [], tNow: 10,
    SMOKE_LIFE: 16, SMOKE_R: 4.5, performance: { now: () => 10000 }, Math };
  vm.runInNewContext(section("      const smokeFade =", "      function rechargeGrenades()") +
    section("      function remoteThrow(", "      const detonate ="), context);
  context.syncTornadoes([{ id: "storm", x: 0, y: 0, z: 0, age: 3 }]);
  assert.equal(context.smokes.length, 1);
  assert.equal(context.smokes[0].t0, 7);
  assert.ok(context.tornadoCurrent(context.smokes[0], 4, 0)[0] < -7);
  context.syncTornadoes([{ id: "storm", x: 0, y: 0, z: 0, age: 3.2 }]);
  context.remoteExplosion({ id: "storm", kind: "smoke", x: 0, y: 0, z: 0, tornado: true });
  assert.equal(context.smokes.length, 1);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await sleep(20);
  }
  throw new Error(message);
}

test("server relays operator-derived tornado type for throws and explosions", async (t) => {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const server = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT: String(port), PREP_SECONDS: "0", QUEUE_SECONDS: "1" },
    stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  t.after(() => server.kill("SIGTERM"));
  await waitFor(() => output.includes("listening"), "Server did not start");
  const sockets = [new WebSocket(`ws://127.0.0.1:${port}/ws`), new WebSocket(`ws://127.0.0.1:${port}/ws`)];
  const messages = [[], []];
  t.after(() => sockets.forEach((socket) => socket.terminate()));
  sockets.forEach((socket, i) => socket.on("message", (data) => messages[i].push(JSON.parse(data))));
  await Promise.all(sockets.map((socket) => new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); })));
  const send = (i, message) => sockets[i].send(JSON.stringify(message));
  send(0, { type: "select_operator", operatorId: "mr-l" });
  send(1, { type: "select_operator", operatorId: "custom" });
  sockets.forEach((_socket, i) => send(i, { type: "queue", mode: "duel" }));
  await waitFor(() => messages[0].some((m) => m.type === "snapshot" && m.phase === "live"), "Match did not start");
  for (const [owner, id, expected] of [[0, "tornado", true], [1, "smoke", false]]) {
    const receiver = 1 - owner;
    send(owner, { type: "throw", id, kind: "smoke", tornado: !expected, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 1 });
    const thrown = await waitFor(() => messages[receiver].find((m) => m.type === "throw" && m.id === id), "Throw was not relayed");
    assert.equal(thrown.tornado, expected);
    send(owner, { type: "explode", id, x: 0, y: 0, z: 0 });
    const explosion = await waitFor(() => messages[receiver].find((m) => m.type === "explosion" && m.id === id), "Explosion was not relayed");
    assert.equal(explosion.tornado, expected);
    if (expected) {
      for (const index of [0, 1]) {
        const snapshot = await waitFor(() => messages[index].find((m) => m.type === "snapshot" && m.tornadoes?.some((entry) => entry.id === id)), "Tornado was not synchronized");
        const tornado = snapshot.tornadoes.find((entry) => entry.id === id);
        assert.ok(tornado.age >= 0 && tornado.age < 16);
      }
    }
  }
});
