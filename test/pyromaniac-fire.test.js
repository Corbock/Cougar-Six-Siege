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

function flameSimulation(targetOperator = "custom", targetDistance = 10) {
  let now = 1000;
  const attacker = { id: "attacker", matchId: "match", team: 1, health: 100, kills: 0, deaths: 0,
    operatorId: "pyromaniac", lastShotAt: 0, lastFlameShotAt: 0,
    state: { x: 0, y: 1.8, z: 0, yaw: 0, pitch: 0, activeSlot: "primary" },
    customLoadout: { primary: "f451", secondary: "p45", gadget: "drone", equipment: "frag" } };
  const target = { id: "target", matchId: "match", team: 2, health: 100, operatorId: targetOperator,
    state: { x: 0, y: 1.8, z: targetDistance, yaw: 0, pitch: 0, crouched: false, lean: 0 } };
  const match = { id: "match", phase: "live", players: [attacker.id, target.id], fireZones: new Map() };
  const events = [];
  const context = {
    Math, Number, String, Set, Date: { now: () => now },
    players: new Map([[attacker.id, attacker], [target.id, target]]),
    matches: new Map([[match.id, match]]),
    operatorKits: { pyromaniac: { primary: "f451", secondary: "sledgehammer", gadget: "steel-bars", equipment: "molotov" } },
    sendPlayer: (_player, message) => events.push(message),
    nearestShieldHit: () => Infinity,
    relayShieldImpact() {},
    shootHostage() {},
    hasActiveSniper: () => false,
    applyDamage(_match, _attacker, victim, amount) { victim.health = Math.max(0, victim.health - amount); }
  };
  const geometry = section(server, "function rayBox(", "function shootHostage(");
  const fire = section(server, "const blastRadius =", "const finite =");
  const handler = section(server, '  if (message.type === "shoot" && player.matchId)', '  if (message.type === "paint"');
  vm.runInNewContext(`${geometry}\n${fire}\nfunction shoot(player, message) { ${handler} }`, context);
  return {
    attacker, target, match, events, context,
    setNow(value) { now = value; },
    shoot() {
      context.shoot(attacker, { type: "shoot", targetId: target.id, damage: 99,
        direction: { x: 0, y: 0, z: 1 }, snapshotAt: now });
    }
  };
}

test("Pyromaniac has the requested locked kit and both incendiary items have usable models", () => {
  const operatorCards = section(html, '<section class="operator-strip"', '<p class="operator-ability"');
  assert.match(operatorCards, /id="operator-count">01 \/ 08/);
  assert.match(operatorCards, /data-id="pyromaniac"[^>]*>[\s\S]*?<span class="operator-name">Pyromaniac<\/span>/);
  const roster = section(html, "const loadoutSlots = [", "const defaultOperatorId =");
  const context = { Math, box: (...values) => values, cyl: (...values) => values, ball: (...values) => values };
  vm.runInNewContext(`${roster}\nglobalThis.slots = loadoutSlots; globalThis.operators = operatorRoster;`, context);
  const pyromaniac = context.operators.find((operator) => operator.id === "pyromaniac");
  assert.deepEqual({ ...pyromaniac.loadout }, {
    primary: "f451", secondary: "sledgehammer", gadget: "steel-bars", equipment: "molotov"
  });
  const serverKit = section(server, "const operatorIds =", "const customItems =");
  vm.runInNewContext(`${serverKit}\nglobalThis.ids = operatorIds; globalThis.kits = operatorKits;`, context);
  assert.equal(context.ids.has("pyromaniac"), true);
  assert.deepEqual({ ...context.kits.pyromaniac }, { ...pyromaniac.loadout });
  assert.equal(context.slots.find((slot) => slot.id === "primary").items.find((item) => item.id === "f451").type, "FLAMETHROWER");
  assert.equal(context.slots.find((slot) => slot.id === "equipment").items.find((item) => item.id === "molotov").type, "INCENDIARY");
  assert.equal(context.slots.find((slot) => slot.id === "primary").items.find((item) => item.id === "f451").presetOnly, true);
  assert.equal(context.slots.find((slot) => slot.id === "equipment").items.find((item) => item.id === "molotov").presetOnly, true);
  assert.equal(context.slots.find((slot) => slot.id === "primary").items.find((item) => item.id === "f451").dmg, 6);
  assert.equal(context.slots.find((slot) => slot.id === "primary").items.find((item) => item.id === "f451").rng, 3);
  const customCatalog = section(server, "const customItems = {", "const paintColors =");
  vm.runInNewContext(`${customCatalog}\nglobalThis.customItems = customItems;`, context);
  assert.equal(context.customItems.primary.includes("f451"), false);
  assert.equal(context.customItems.equipment.includes("molotov"), false);
  const loadoutFilter = section(html, "const loadoutItemsFor =", "if (!karambitUnlocked())");
  const filterContext = { selectedOperatorId: "custom", karambitUnlocked: () => true };
  vm.runInNewContext(`${loadoutFilter}\nglobalThis.filter = loadoutItemsFor;`, filterContext);
  const incendiarySlots = { items: [
    { id: "mk18" }, { id: "f451", presetOnly: true },
    { id: "frag" }, { id: "molotov", presetOnly: true }
  ] };
  assert.deepEqual([...filterContext.filter(incendiarySlots).map(({ id }) => id)], ["mk18", "frag"]);
  filterContext.selectedOperatorId = "pyromaniac";
  assert.deepEqual([...filterContext.filter(incendiarySlots).map(({ id }) => id)], ["mk18", "f451", "frag", "molotov"]);

  const models = section(html, "const modelDefs = {", "const finishes =");
  const modelContext = { Math, box: (...values) => values, cyl: (...values) => values, ball: (...values) => values };
  vm.runInNewContext(`${models}\nglobalThis.defs = modelDefs;`, modelContext);
  for (const id of ["f451", "molotov"]) assert.ok(modelContext.defs[id].parts.length >= 10, id);
  assert.equal(modelContext.defs.molotov.parts.filter((part) => part[6] === "wick").length, 3);
});

test("F 451 shots deal fixed damage, ignite after sustained hits, and burn rapidly for three seconds", () => {
  const sim = flameSimulation();
  for (let shot = 0; shot < 4; shot++) {
    sim.setNow(1000 + shot * 200);
    sim.shoot();
  }
  assert.equal(sim.target.health, 76, "Damage is fixed at 6 per hit, not the client-supplied value");
  assert.equal(sim.target.burning.until, 4600);
  assert.ok(sim.events.some((event) => event.type === "player_burning" && event.burning));

  sim.context.tickFireEffects(sim.match, 1849);
  assert.equal(sim.target.health, 76);
  for (let tick = 1850; tick <= 4350; tick += 250) sim.context.tickFireEffects(sim.match, tick);
  assert.equal(sim.target.health, 21);
  sim.context.tickFireEffects(sim.match, 4599);
  assert.equal(sim.target.health, 21);
  sim.context.tickFireEffects(sim.match, 4600);
  assert.equal(sim.target.health, 16);
  assert.equal(sim.target.burning, null);
  assert.ok(sim.events.some((event) => event.type === "player_burning" && !event.burning));
});

test("the F 451 is cadence-limited and Pyromaniac is immune to flame damage", () => {
  const cadence = flameSimulation();
  cadence.shoot();
  cadence.setNow(1050);
  cadence.shoot();
  assert.equal(cadence.target.health, 94, "Shots faster than the configured rate are ignored");

  const outOfRange = flameSimulation("custom", 11);
  outOfRange.shoot();
  assert.equal(outOfRange.target.health, 100, "Flames stop at the shorter close-combat range");

  const immune = flameSimulation("pyromaniac");
  for (let shot = 0; shot < 4; shot++) {
    immune.setNow(1000 + shot * 200);
    immune.shoot();
  }
  assert.equal(immune.target.health, 100);
  assert.equal(immune.target.burning, undefined);
});

test("F 451 fuel drains smoothly while held instead of consuming a round per flame check", () => {
  const drain = section(html, "function drainFlamethrowerAmmo(", "function updateWeapon(");
  const drainContext = { Math };
  vm.runInNewContext(`${drain}\nglobalThis.drain = drainFlamethrowerAmmo;`, drainContext);
  const weapon = { ammo: 60, kind: { rate: 5 } };
  assert.equal(drainContext.drain(weapon, .1), false);
  assert.equal(weapon.ammo, 59.5);
  assert.equal(drainContext.drain(weapon, .1), false);
  assert.equal(weapon.ammo, 59);
  assert.equal(drainContext.drain(weapon, 20), true);
  assert.equal(weapon.ammo, 0);

  const firing = section(html, "function fire(w)", "function startReload(w)");
  const fireContext = { tNow: 1, shots: [], trace: (...args) => fireContext.shots.push(args), startReload() {} };
  vm.runInNewContext(`${firing}\nglobalThis.fire = fire;`, fireContext);
  const flameWeapon = { item: { id: "f451" }, kind: { rate: 5 }, ammo: 59, kick: 0, flash: 0 };
  fireContext.fire(flameWeapon);
  assert.equal(flameWeapon.ammo, 59);
  assert.equal(flameWeapon.kick, 0);
  assert.equal(flameWeapon.flash, 0);
  assert.equal(fireContext.shots.length, 1);
});

test("Molotovs damage and ignite nearby enemies but not Pyromaniac", () => {
  let now = 1000;
  const attacker = { id: "attacker", matchId: "match", team: 1, health: 100, kills: 0, deaths: 0, operatorId: "pyromaniac" };
  const target = { id: "target", matchId: "match", team: 2, health: 100, operatorId: "custom",
    state: { x: 2, y: 1.8, z: 0 } };
  const immune = { id: "immune", matchId: "match", team: 2, health: 100, operatorId: "pyromaniac",
    state: { x: 1, y: 1.8, z: 0 } };
  const match = { id: "match", phase: "live", players: [attacker.id, target.id, immune.id],
    projectiles: new Map([["molotov-id", { owner: attacker.id, kind: "molotov", paint: "#f6df35" }]]),
    objectives: [], fireZones: new Map() };
  const sent = [];
  const context = {
    Math, Number, String, Set, Date: { now: () => now },
    players: new Map([[attacker.id, attacker], [target.id, target], [immune.id, immune]]),
    matches: new Map([[match.id, match]]),
    relayToMatch: (_match, _player, message) => sent.push(message),
    sendPlayer: (_player, message) => sent.push(message),
    applyDamage(_match, _attacker, victim, amount) { victim.health = Math.max(0, victim.health - amount); }
  };
  const fire = section(server, "const blastRadius =", "const finite =");
  const numbers = section(server, "const finite =", "function relayToMatch(");
  const handler = section(server, '  if (message.type === "explode" && player.matchId)', '  if (message.type === "bar"');
  vm.runInNewContext(`${fire}\n${numbers}\nfunction explodeMessage(player, message) { ${handler} }`, context);
  context.explodeMessage(attacker, { type: "explode", id: "molotov-id", x: 0, y: 0, z: 0 });

  assert.equal(target.health, 85);
  assert.equal(target.burning.until, 4000);
  assert.equal(immune.health, 100);
  assert.equal(immune.burning, undefined);
  assert.equal(match.fireZones.size, 1);
  now = 1250;
  context.tickFireEffects(match, now);
  assert.equal(target.health, 80);
  now = 1500;
  context.tickFireEffects(match, now);
  assert.equal(target.health, 75);
});

test("Pyromaniac recharges one Molotov every 15 seconds up to two", () => {
  const messages = [];
  const context = { selectedOperatorId: "pyromaniac", charges: { molotov: 1 },
    weapons: { molotov: { kind: { uses: 2 } } }, tNow: 15, nextGrenadeRecharge: 15, messages,
    say: (message) => messages.push(message) };
  const recharge = section(html, "function rechargeGrenades()", "function setSmoke(");
  vm.runInNewContext(`${recharge}\nglobalThis.recharge = rechargeGrenades;`, context);
  context.recharge();
  assert.equal(context.charges.molotov, 2);
  assert.equal(context.nextGrenadeRecharge, 30);
  assert.deepEqual([...context.messages], ["MOLOTOV RECHARGED"]);

  context.tNow = 30;
  context.recharge();
  assert.equal(context.charges.molotov, 2, "Charges cannot exceed capacity");
  assert.equal(context.messages.length, 1);
});

test("Molotov draw animation shows a cloth wick and lights it after the left hand reaches it", () => {
  const action = section(html, "function grenadeThrowActionQuads()", "function tabletActionQuads()");
  const flameMesh = section(html, "function addFlameMesh(", "const medkitActionActive =");
  const context = {
    Math, tNow: .2, grenadeThrowAction: { startedAt: 0, itemId: "molotov" },
    qb(list, x0, x1, y0, y1, z0, z1, color, transform = (point) => point) {
      const points = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map(transform);
      [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]]
        .forEach((face) => list.push({ pts: face.map((index) => points[index]), color }));
    }
  };
  vm.runInNewContext(`${flameMesh}\n${action}\nglobalThis.draw = grenadeThrowActionQuads;`, context);
  const unlit = context.draw();
  assert.ok(unlit.some((quad) => quad.color === "#c5b99c"), "The bottle has a cloth wick");
  assert.ok(unlit.some((quad) => quad.color === "#c89170"), "The left hand reaches the wick");
  assert.equal(unlit.some((quad) => quad.color === "#fff1b8"), false, "The wick starts unlit");
  context.tNow = .5;
  const lit = context.draw();
  assert.ok(lit.some((quad) => quad.color === "#fff1b8"), "The wick lights after the hand reaches it");
  assert.ok(lit.every((quad) => quad.pts.length === 4), "Flames are curved quad meshes, not triangular spikes");

  const advance = section(html, "function advanceGrenadeThrow()", "const smokeFade =");
  const throwContext = {
    tNow: .41, grenadeThrowAction: { startedAt: 0, itemId: "molotov", lit: false, thrown: false },
    grenadeThrowReleaseAt: .64, grenadeThrowDuration: 1, messages: [], throws: 0,
    throwGrenade() { throwContext.throws++; }
  };
  throwContext.say = (message) => throwContext.messages.push(message);
  vm.runInNewContext(`${advance}\nglobalThis.advance = advanceGrenadeThrow;`, throwContext);
  throwContext.advance();
  assert.equal(throwContext.grenadeThrowAction.lit, false);
  throwContext.tNow = .42;
  throwContext.advance();
  assert.equal(throwContext.grenadeThrowAction.lit, true);
  assert.deepEqual([...throwContext.messages], ["MOLOTOV LIT"]);
  throwContext.tNow = .64;
  throwContext.advance();
  assert.equal(throwContext.throws, 1);
});
