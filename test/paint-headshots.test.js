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
  let now = 1000;
  const target = { id: "target", matchId: "match", team: 2, health: 100,
    state: { x: 0, y: 1.8, z: 10, yaw: 0, crouched: false, lean: 0 } };
  const shooter = { matchId: "match", team: 1, health: 100, operatorId: "custom", customPrimary: "mk18", lastShotAt: 0,
    customLoadout: { primary: "mk18", secondary: "p45", breaching: "sledgehammer" },
    state: { x: 0, y: 1.8, z: 0, yaw: 0, pitch: 0, activeSlot: "primary" } };
  const context = { Math, Number, String, Date: { now: () => now }, players: new Map([[target.id, target]]),
    matches: new Map([["match", { phase: "live" }]]), operatorKits: {},
    playerLoadout: (player) => player.operatorId === "custom" ? player.customLoadout : {},
    hasActiveSniper: (player, state) => state.activeSlot === "primary" &&
      ["longwatch", "cmr", "loudwatch"].includes(player.customLoadout.primary),
    nearestShieldHit: () => Infinity, relayShieldImpact() {}, shootHostage() {},
    applyDamage(_match, _shooter, victim, amount) { victim.health = Math.max(0, victim.health - amount); } };
  const geometry = section(server, "function rayBox(", "function shootHostage(");
  const handler = section(server, '  if (message.type === "shoot" && player.matchId)', '  if (message.type === "paint"');
  vm.runInNewContext(`${geometry}\nfunction shoot(player, message) { ${handler} }`, context);
  return { context, shooter, target, setNow: (value) => { now = value; }, fire(direction = { x: 0, y: 0, z: 1 }, shotId, snapshotAt) {
    context.shoot(shooter, { type: "shoot", targetId: target.id, damage: 20, direction, shotId, snapshotAt });
  } };
}

test("operators can only be changed during an active match's preparation phase", () => {
  const handler = section(server, '  if (message.type === "select_operator")', '  if (message.type === "create_party")');
  const match = { phase: "prep", phaseEnd: 2000 };
  const player = { matchId: "match", operatorId: "mr-m", customLoadout: {} };
  const context = { matches: new Map([["match", match]]), operatorIds: new Set(["mr-m", "custom"]),
    operatorKits: { "mr-m": {}, custom: {} }, customItems: { primary: ["cougar-blade"] }, weaponFamilies: {},
    playerLoadout: (entry) => entry.customLoadout, sendPlayer: (_entry, message) => { context.rejection = message; },
    playerMaxHealth: (entry) => entry.customLoadout.primary === "cougar-blade" && entry.operatorId === "custom" ? 300 : 100,
    Date: { now: () => 1000 } };
  vm.runInNewContext(`function select(player, message) { ${handler} }`, context);
  context.select(player, { type: "select_operator", operatorId: "custom", loadout: { primary: "cougar-blade" } });
  assert.equal(player.operatorId, "custom");
  assert.equal(player.health, 300);
  match.phase = "live";
  context.select(player, { type: "select_operator", operatorId: "mr-m" });
  assert.equal(player.operatorId, "custom");
  assert.equal(context.rejection.type, "operator_rejected");
  assert.equal(context.rejection.operatorId, "custom");
  match.phase = "prep";
  match.phaseEnd = 1000;
  context.select(player, { type: "select_operator", operatorId: "mr-m" });
  assert.equal(player.operatorId, "custom");
});

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

test("Longwatch takes two body hits or one uncovered headshot, including beyond the usual range", () => {
  const sim = shooting();
  sim.shooter.customPrimary = "longwatch";
  sim.shooter.customLoadout.primary = "longwatch";
  sim.shooter.state.y = 1.3;
  sim.target.state.z = 150;
  sim.fire();
  assert.equal(sim.target.health, 25);
  sim.setNow(1400);
  sim.fire();
  assert.equal(sim.target.health, 0);

  const headshot = shooting();
  headshot.shooter.customPrimary = "longwatch";
  headshot.shooter.customLoadout.primary = "longwatch";
  headshot.target.state.z = 150;
  headshot.fire();
  assert.equal(headshot.target.health, 0);

  const exactHeadDamage = shooting();
  exactHeadDamage.shooter.customPrimary = "longwatch";
  exactHeadDamage.shooter.customLoadout.primary = "longwatch";
  exactHeadDamage.target.state.z = 150;
  exactHeadDamage.target.health = 150;
  exactHeadDamage.fire();
  assert.equal(exactHeadDamage.target.health, 50, "A Longwatch headshot deals exactly 100 damage at any range");

  const otherWeapon = shooting();
  otherWeapon.target.state.z = 150;
  otherWeapon.fire();
  assert.equal(otherWeapon.target.health, 100);
});

test("Magnum body hits deal 25 damage regardless of client-reported damage", () => {
  const sim = shooting();
  sim.shooter.state.activeSlot = "secondary";
  sim.shooter.customLoadout.secondary = "magnum";
  sim.shooter.state.y = 1.3;
  sim.fire();
  assert.equal(sim.target.health, 75);
});

test("Horn Chopper accepts its faster 50 ms server cadence without speeding up other guns", () => {
  const horn = shooting();
  horn.shooter.state.y = 1.3;
  horn.shooter.customLoadout.primary = "horn-chopper-2000";
  horn.fire();
  horn.setNow(1050);
  horn.fire();
  assert.equal(horn.target.health, 60);

  const rifle = shooting();
  rifle.shooter.state.y = 1.3;
  rifle.fire();
  rifle.setNow(1050);
  rifle.fire();
  assert.equal(rifle.target.health, 80);
});

test("Slug V, Loudwatch, Cougar Blade, and melee variants use their special damage rules", () => {
  const slug = shooting();
  slug.shooter.customLoadout.primary = "slug-v";
  slug.fire();
  assert.equal(slug.target.health, 10);

  const loudwatch = shooting();
  loudwatch.shooter.customLoadout.primary = "loudwatch";
  loudwatch.fire();
  assert.equal(loudwatch.target.health, 88, "Loudwatch stays low damage and cannot headshot");

  const blade = shooting();
  blade.shooter.customLoadout.primary = "cougar-blade";
  blade.fire();
  assert.equal(blade.target.health, 60);

  const lunchbox = shooting();
  lunchbox.shooter.state.activeSlot = "breaching";
  lunchbox.shooter.customLoadout.breaching = "lunchbox";
  lunchbox.fire();
  assert.equal(lunchbox.target.health, 0, "Lunchbox head strikes eliminate in one hit");
});

test("Loudwatch impact marks and blinds enemies near the impact point", () => {
  const shooter = { id: "shooter", matchId: "match", team: 1, health: 100, operatorId: "custom",
    customLoadout: { primary: "loudwatch" }, state: { x: 0, y: 1.8, z: 0, activeSlot: "primary" } };
  const enemy = { id: "enemy", matchId: "match", team: 2, health: 100,
    state: { x: 1, y: 1.8, z: 10 } };
  const ally = { id: "ally", matchId: "match", team: 1, health: 100,
    state: { x: 1, y: 1.8, z: 10 } };
  let now = 1000;
  const sent = [], context = { Date: { now: () => now },
    matches: new Map([["match", { phase: "live", players: [shooter.id, enemy.id, ally.id] }]]),
    players: new Map([[shooter.id, shooter], [enemy.id, enemy], [ally.id, ally]]),
    playerLoadout: (player) => player.customLoadout,
    sendPlayer: (player, message) => sent.push([player.id, message]) };
  const handler = section(server, '  if (message.type === "loudwatch_impact"', '  if (message.type === "shoot"');
  vm.runInNewContext(`function impact(player, message) { ${handler} }`, context);
  context.impact(shooter, { type: "loudwatch_impact", point: [0, 1.8, 10] });
  assert.equal(enemy.markedUntil, 7000);
  assert.ok(sent.some(([id, message]) => id === enemy.id && message.type === "player_blinded"));
  assert.equal(ally.markedUntil, undefined);
  now += 100;
  context.impact(shooter, { type: "loudwatch_impact", point: [0, 1.8, 10] });
  assert.equal(sent.filter(([, message]) => message.type === "player_blinded").length, 1);
});

test("fastest configured gun cadence and current shooter aim are accepted", () => {
  const cadence = shooting();
  cadence.shooter.state.y = 1.3;
  cadence.shooter.lastShotAt = 935;
  cadence.fire();
  assert.equal(cadence.target.health, 80, "A valid 65 ms firing interval should not be dropped");

  const staleAim = shooting();
  staleAim.shooter.state.y = 1.3;
  staleAim.shooter.state.yaw = Math.PI / 2;
  staleAim.shooter.stateHistory = [{ at: 900, state: { ...staleAim.shooter.state, yaw: 0 } }];
  staleAim.fire(undefined, undefined, 900);
  assert.equal(staleAim.target.health, 80, "Aim aligned to the firing snapshot should not be rejected");

  const currentAim = shooting();
  currentAim.shooter.state.y = 1.3;
  currentAim.shooter.stateHistory = [{ at: 900, state: { ...currentAim.shooter.state, yaw: Math.PI / 2 } }];
  currentAim.fire(undefined, undefined, 900);
  assert.equal(currentAim.target.health, 80, "Aim aligned to the latest accepted state should not be rejected");
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

test("inspect models retain paint surfaces in their weapon-specific geometry", () => {
  const context = { Math, ArrayBuffer, DataView, Uint8Array, TextDecoder,
    customOf: () => ({ optic: "none", muzzle: "none", grip: "none" }) };
  vm.runInNewContext(section(html, "    const box = (cx", "    const finishes =") +
    section(html, "    function attachmentParts(", "    const inspector =") +
    section(html, "    function buildInspectModel(", "    function rebuildModel()"), context);
  const glb = context.parseMk18Glb(Uint8Array.from(fs.readFileSync("ItemModels/paintball_ar.glb")).buffer);
  context.glbParts = glb.parts;
  context.glbMagazine = glb.mag;
  vm.runInNewContext("modelDefs.mk18.parts = glbParts; modelDefs.mk18.mag = glbMagazine", context);
  for (const id of ["mk18", "vector", "longwatch", "p45", "rattler"]) {
    const model = context.buildInspectModel({ id });
    const paintSurface = id === "mk18" ? "mk18Orange" : "paint";
    assert.ok(model.polys.some((poly) => poly.m === paintSurface && poly.uv), id);
  }
  const magnumModel = context.buildInspectModel({ id: "magnum" });
  assert.ok(magnumModel.polys.some((poly) => poly.m === "body" && poly.uv));
});

test("operator paint skins are not unlocked by eliminations", () => {
  const saved = new Map([["c6-appearance", JSON.stringify({ kills: 19, hat: "cap", paintSkin: "circuit" })]]);
  const context = { Number, JSON, console, skins: ["night", "tiger", "circuit", "ember"].map((id) => ({ id, name: id })),
    localStorage: { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) }, showToast() {} };
  vm.runInNewContext(section(html, "    const hats = [", "    const keychains ="), context);
  assert.equal(vm.runInNewContext("appearance.paintSkin", context), "none");
  assert.equal(vm.runInNewContext("appearance.hat", context), "cap");
  context.recordElimination();
  assert.equal(JSON.parse(saved.get("c6-appearance")).kills, 20);
  assert.equal(vm.runInNewContext("appearance.paintSkin", context), "none");
});

test("piloted drones move faster, with Hallway Monitor's camera fastest", () => {
  const movement = section(html, "        const speedBonus = (", "        const fwd =");
  const speed = (mode, operator) => vm.runInNewContext(`${movement}\nsp`, {
    selectedOperatorId: operator, drone: { active: true, mode }, sprinting: false, crouched: false,
    cw: { item: { id: "p45" }, stats: { mob: 1 } }, dt: 1
  });
  assert.ok(speed("scanner", "custom") > 3.5);
  assert.ok(speed("camera", "hallway-monitor") > speed("scanner", "custom"));
});

test("holding the karambit increases movement speed by 15 percent", () => {
  const movement = section(html, "        const speedBonus = (", "        const fwd =");
  const speed = (weapon) => vm.runInNewContext(`${movement}\nsp`, {
    selectedOperatorId: "custom", drone: { active: false }, sprinting: true, crouched: false,
    cw: { item: { id: weapon }, stats: { mob: 10 } }, dt: 1
  });
  assert.equal(speed("karambit") / speed("p45"), 1.15);
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
