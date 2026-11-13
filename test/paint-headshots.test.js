const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const server = fs.readFileSync("server.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, start);
  return source.slice(first, last);
}

function shooting() {
  const target = { id: "target", matchId: "match", team: 2, health: 100,
    state: { x: 0, y: 1.8, z: 10, yaw: 0, crouched: false, lean: 0 } };
  const shooter = { matchId: "match", team: 1, health: 100, operatorId: "custom", lastShotAt: 0,
    customLoadout: { primary: "mk18", secondary: "p45" },
    state: { x: 0, y: 1.8, z: 0, yaw: 0, pitch: 0, activeSlot: "primary" } };
  const context = { Math, Number, String, Date: { now: () => 1000 }, players: new Map([[target.id, target]]),
    matches: new Map([["match", { phase: "live" }]]), operatorKits: {}, hasActiveSniper: () => false,
    nearestShieldHit: () => Infinity, relayShieldImpact() {}, shootHostage() {},
    applyDamage(_match, _shooter, victim, amount) { victim.health = Math.max(0, victim.health - amount); } };
  const geometry = section(server, "function rayBox(", "function shootHostage(");
  const handler = section(server, '  if (message.type === "shoot" && player.matchId)', '  if (message.type === "paint"');
  vm.runInNewContext(`${geometry}\nfunction shoot(player, message) { ${handler} }`, context);
  return { context, shooter, target, fire(direction = { x: 0, y: 0, z: 1 }, shotId) {
    context.shoot(shooter, { type: "shoot", targetId: target.id, damage: 20, direction, shotId });
  } };
}

test("only primaries and the magnum eliminate on uncovered headshots", () => {
  for (const [slot, secondary, expected] of [["primary", "p45", 0], ["secondary", "magnum", 0], ["secondary", "p45", 80], ["secondary", "rattler", 80]]) {
    const sim = shooting();
    sim.shooter.state.activeSlot = slot;
    sim.shooter.customLoadout.secondary = secondary;
    sim.fire();
    assert.equal(sim.target.health, expected, `${slot} ${secondary}`);
  }
  const wounded = shooting();
  wounded.target.health = 35;
  wounded.shooter.state.activeSlot = "primary";
  wounded.fire();
  assert.equal(wounded.target.health, 0, "A headshot should kill a wounded player in one shot");
  const body = shooting();
  body.shooter.state.y = 1.3;
  body.fire();
  assert.equal(body.target.health, 80);
  const crouched = shooting();
  crouched.target.state.crouched = true;
  crouched.target.state.y = 1.05;
  crouched.shooter.state.y = 1.4;
  crouched.fire();
  assert.equal(crouched.target.health, 0);
  const helmet = shooting();
  helmet.shooter.state.y = 1.99;
  helmet.fire();
  assert.equal(helmet.target.health, 80);
  const shield = shooting();
  shield.context.nearestShieldHit = () => 5;
  shield.fire();
  assert.equal(shield.target.health, 100);
});

test("a later shotgun pellet can land a headshot in the same volley", () => {
  const sim = shooting();
  sim.shooter.customLoadout.primary = "hammer";
  sim.shooter.state.y = 1.55;
  sim.fire({ x: 0, y: 0, z: 1 }, "volley");
  assert.equal(sim.target.health, 80);
  sim.fire({ x: 0, y: 0, z: 1 }, "volley");
  assert.equal(sim.target.health, 80);
  const angle = Math.atan2(.25, 10);
  sim.fire({ x: 0, y: Math.sin(angle), z: Math.cos(angle) }, "volley");
  assert.equal(sim.target.health, 0);
});

test("paint impacts use item color, orient to surfaces, follow players, and exclude melee", () => {
  const sent = [], target = { state: { x: 0, y: 1.8, z: 10 } };
  const context = { Math, Number, tNow: 1, dummies: [], multiplayer: { playerId: "self", match: {},
    remotePlayers: new Map([["target", target]]) }, ownEntry: () => null,
    paintColors: [{ c: "#32a6ef" }], paintColor: () => "#32a6ef", appearance: { paintSkin: "circuit" },
    paintSkinById: (id) => id === "circuit" ? { id } : null, sendMatch: (m) => sent.push(m) };
  vm.runInNewContext(section(html, "      let paintMarks = [];", "      function remoteBarricade("), context);
  const box = { x0: -1, x1: 1, y0: 0, y1: 2, z0: 10, z1: 11 };
  const gun = { item: { id: "mk18" }, kind: {} };
  context.paintHit(gun, [0, 1, 0], [0, 0, 1], 10, box, "target");
  assert.equal(sent[0].color, "#32a6ef");
  assert.equal(sent[0].size, .11);
  assert.equal(sent[0].paintSkin, "circuit");
  assert.deepEqual(Array.from(sent[0].normal), [0, 0, -1]);
  context.paintHit({ item: { id: "hammer" }, kind: { pellets: 8 } }, [0, 1, 0], [0, 0, 1], 10, box);
  assert.ok(sent[1].size > sent[0].size);
  context.paintHit({ item: { id: "sledgehammer" }, kind: { melee: true } }, [0, 1, 0], [0, 0, 1], 10, box);
  assert.equal(sent.length, 2);
  const before = [];
  context.paintQuads(before);
  assert.equal(before[0].skin.id, "circuit");
  assert.equal(before[0].uv.length, before[0].pts.length);
  target.state.x = 2;
  const after = [];
  context.paintQuads(after);
  assert.equal(after[0].pts[0][0] - before[0].pts[0][0], 2);
  context.tNow = 22;
  const expired = [];
  context.paintQuads(expired);
  assert.equal(expired.length, 0);
});

test("remote player paint renders before snapshots and follows the sender's target anchor", () => {
  const context = { Math, Number, tNow: 1, dummies: [], multiplayer: { playerId: "self", match: {},
    remotePlayers: new Map() }, ownEntry: () => null,
    paintColors: [{ c: "#32a6ef" }], paintSkinById: () => null, sendMatch() {} };
  vm.runInNewContext(section(html, "      let paintMarks = [];", "      function remoteBarricade("), context);
  context.remotePaint({ point: [0, 1, 10], normal: [0, 0, -1], color: "#32a6ef", size: .11,
    targetId: "target", targetAnchor: [0, 1.8, 10] });
  const before = [];
  context.paintQuads(before);
  assert.ok(before.length > 0);
  context.multiplayer.remotePlayers.set("target", { state: { x: 2, y: 1.8, z: 10 } });
  const after = [];
  context.paintQuads(after);
  assert.equal(after[0].pts[0][0] - before[0].pts[0][0], 2);
});

test("inspect models retain their paint-colored magazine geometry", () => {
  const context = { Math, customOf: () => ({ optic: "none", muzzle: "none", grip: "none" }) };
  vm.runInNewContext(section(html, "    const box = (cx", "    const finishes =") +
    section(html, "    function attachmentParts(", "    const inspector =") +
    section(html, "    function buildInspectModel(", "    function rebuildModel()"), context);
  for (const id of ["mk18", "vector", "longwatch", "p45", "rattler"]) {
    const model = context.buildInspectModel({ id });
    assert.ok(model.polys.some((poly) => poly.m === "paint"), id);
  }
  assert.equal(context.buildInspectModel({ id: "magnum" }).polys.some((poly) => poly.m === "paint"), false);
});

test("paint skins unlock every twenty multiplayer eliminations and persist independently of hats", () => {
  const saved = new Map([["c6-appearance", JSON.stringify({ kills: 19, hat: "cap", paintSkin: "circuit" })]]);
  const context = { Number, JSON, console, skins: ["night", "tiger", "circuit", "ember"].map((id) => ({ id, name: id })),
    localStorage: { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) }, showToast() {} };
  vm.runInNewContext(section(html, "    const hats = [", "    const keychains ="), context);
  assert.equal(vm.runInNewContext("appearance.paintSkin", context), "none");
  assert.equal(vm.runInNewContext("appearance.hat", context), "cap");
  assert.deepEqual(Array.from(vm.runInNewContext("skins.map(paintSkinUnlocked)", context)), [false, false, false, false]);
  context.recordElimination();
  assert.deepEqual(Array.from(vm.runInNewContext("skins.map(paintSkinUnlocked)", context)), [true, false, false, false]);
  assert.equal(JSON.parse(saved.get("c6-appearance")).kills, 20);
  vm.runInNewContext("appearance.kills = 80", context);
  assert.deepEqual(Array.from(vm.runInNewContext("skins.map(paintSkinUnlocked)", context)), [true, true, true, true]);
});

test("piloted drones move faster, with Hallway Monitor's camera fastest", () => {
  const movement = section(html, '        const speedBonus = selectedOperatorId === "hallway-monitor"', "        const fwd =");
  const speed = (mode, operator) => vm.runInNewContext(`${movement}\nsp`, {
    selectedOperatorId: operator, drone: { active: true, mode }, sprinting: false, crouched: false,
    cw: { stats: { mob: 1 } }, dt: 1
  });
  assert.ok(speed("scanner", "custom") > 3.5);
  assert.ok(speed("camera", "hallway-monitor") > speed("scanner", "custom"));
});

test("frag and mine blasts leave larger paint splashes on nearby surfaces and targets", () => {
  for (const type of ["frag", "claymore"]) {
    const marks = [], dummy = { x: 1.5, z: 0, hp: 100 };
    const context = { Math, dummies: [dummy], colliders: [{}], barricades: [],
      multiplayer: { remotePlayers: new Map() },
      rayBox: (_origin, direction) => direction[0] === 1 ? 2 : Infinity,
      addPaint: (...args) => marks.push(args), hurtDummy() {}, hitBarricade() {}, spawnDebris() {} };
    vm.runInNewContext(section(html, "      function explode(", "      function stepProjectiles("), context);
    context.explode({ type, own: true, x: 0, y: 0, z: 0, paint: "#f04c9b" }, 5, 260);
    assert.ok(marks.some((mark) => mark[2] === "#f04c9b" && mark[3] === .55));
    assert.ok(marks.some((mark) => mark[2] === "#f04c9b" && mark[3] === .45 && mark[4] === "dummy-0"));
    marks.length = 0;
    context.explode({ type, own: false, x: 0, y: 0, z: 0, paint: "#f04c9b" }, 5, 260);
    assert.equal(marks.length, 0, "Remote copies must not broadcast duplicate marks");
  }
});

test("explosive hits on barricades stain cells instead of creating floating splashes", () => {
  const marks = [], hits = [], bar = { ax: 0, ta: 2, n: 2, a0: -1, a1: 1, y0: 0, y1: 2 };
  const context = { Math, dummies: [], colliders: [{ bar }], barricades: [bar],
    multiplayer: { remotePlayers: new Map() },
    rayBox: (_origin, direction) => direction[0] === 1 ? 2 : Infinity,
    addPaint: (...args) => marks.push(args), hurtDummy() {}, hitBarricade: (...args) => hits.push(args), spawnDebris() {} };
  vm.runInNewContext(section(html, "      function explode(", "      function stepProjectiles("), context);
  context.explode({ own: true, x: 0, y: 1, z: 0, paint: "#f04c9b" }, 5, 260);
  assert.equal(hits[0].at(-1), "#f04c9b");
  assert.ok(!marks.some((mark) => mark[0][0] === 2));
});

test("explosive paint is sent before explosion damage can end the match", () => {
  const messages = [], context = { sendMatch: (message) => messages.push(message.type),
    applyEffect: () => messages.push("paint") };
  vm.runInNewContext(section(html, "      const detonate =", "      function explode(") +
    "\nthis.detonate = detonate;", context);
  context.detonate({ pid: "frag", x: 0, y: 0, z: 0 });
  assert.deepEqual(messages, ["paint", "explode"]);
});
