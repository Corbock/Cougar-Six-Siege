const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync("index.html", "utf8");

function section(start, end) {
  const first = html.indexOf(start), last = html.indexOf(end, first);
  assert.ok(first >= 0 && last > first, start);
  return html.slice(first, last);
}

function simulation() {
  const context = { Math, Float32Array, Array, Infinity, tNow: 0, barricades: [], colliders: [],
    BAR_TH: .12, CELL: .2, CELL_HP: 50, STEEL_HP: 150, WOODS: ["#8b5e34"], barricadeBuildDuration: 1.35,
    multiplayer: { match: {} }, remoteBarricadeActions: new Map(), spawnDebris() {}, paintSkinById: (id) => id === "circuit" ? { id } : null,
    qb(list, x0, x1, y0, y1, z0, z1, color) { list.push({ x0, x1, y0, y1, z0, z1, color,
      pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] }); } };
  vm.runInNewContext(section("      function barBox(", "      function spawnDebris(") +
    section("      const barById =", "      function aimedBarricade(") +
    section("      function makeBarricade(", "      function resetBarricades()"), context);
  const b = context.makeBarricade({ id: "bar", ax: 2, ta: 0, n: 0, a0: 0, a1: 1, y0: 0, y1: 1 });
  return { context, b };
}

test("new barricades are added row by row instead of appearing all at once", () => {
  const { context: sim, b } = simulation();
  const existingSolids = sim.colliders.length;
  const building = sim.makeBarricade({ id: "building", ax: 2, ta: 0, n: 1, a0: 0, a1: 1, y0: 0, y1: 1, building: true });
  assert.equal(sim.barricadeQuads(building).length, 0);
  assert.equal(sim.colliders.length, existingSolids);
  sim.tNow = .675;
  const partial = sim.barricadeQuads(building);
  assert.ok(partial.length > 0 && partial.length < building.quads.length);
  assert.ok(partial.every((quad) => quad.buildRow < Math.floor(.5 * building.rows)));
  assert.ok(sim.colliders.length > existingSolids && sim.colliders.length < existingSolids + building.solids.length);
  sim.tNow = 1.35;
  assert.equal(sim.barricadeQuads(building).length, building.quads.length);
  assert.equal(sim.colliders.length, existingSolids + building.solids.length);
  assert.equal(building.buildStartedAt, null);
  assert.ok(b.quads.length > 0);
});

test("remote placement animates the barricade and the player who builds it", () => {
  const { context: sim } = simulation();
  sim.remoteBarricade({ op: "place", id: "remote", from: "builder",
    fit: { ax: 2, n: 1, a0: 0, a1: 1, y0: 0, y1: 1 } });
  const barricade = sim.barricades.find((entry) => entry.id === "remote");
  assert.equal(barricade.buildStartedAt, 0);
  assert.equal(sim.remoteBarricadeActions.get("builder"), 0);
  barricade.hp[0] = 0;
  sim.tNow = .2;
  sim.remoteBarricade({ op: "repair", id: "remote", from: "builder" });
  assert.equal(barricade.repairStartedAt, .2);
  assert.equal(sim.remoteBarricadeActions.get("builder"), .2);
});

test("repairs restore damaged rows over the same animation period", () => {
  const { context: sim, b } = simulation(), cap = b.steel ? 150 : 50;
  b.hp[0] = 0;
  b.hp[(b.rows - 1) * b.cols] = 0;
  sim.startBarricadeRepair(b);
  assert.equal(b.hp[0], 0);
  sim.tNow = .675;
  sim.barricadeQuads(b);
  assert.equal(b.hp[0], cap, "Lower rows should be repaired first");
  assert.equal(b.hp[(b.rows - 1) * b.cols], 0, "Upper damage should remain until its row is reached");
  sim.tNow = 1.35;
  sim.barricadeQuads(b);
  assert.equal(b.hp[(b.rows - 1) * b.cols], cap);
  assert.equal(b.repairStartedAt, null);
});

test("first-person barricade action swings a visible hammer into repeated strikes", () => {
  const context = { Math, tNow: .08, barricadeActionStart: 0, barricadeBuildDuration: 1.35,
    qb(list, x0, x1, y0, y1, z0, z1, color, transform = (point) => point) {
      const points = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map(transform);
      [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]]
        .forEach((face) => list.push({ pts: face.map((index) => points[index]), color }));
    } };
  vm.runInNewContext(section("      function barricadeActionQuads()", "      function droneViewmodelQuads("), context);
  const drawAt = (time) => { context.tNow = time; return context.barricadeActionQuads(); };
  const hammerHeadY = (quads) => {
    const points = quads.filter((quad) => quad.color === "#858b8a").flatMap((quad) => quad.pts);
    return points.reduce((sum, point) => sum + point[1], 0) / points.length;
  };
  const braceHandY = (quads) => {
    const points = quads.filter((quad) => quad.color === "#b9a17c").flatMap((quad) => quad.pts);
    return points.reduce((sum, point) => sum + point[1], 0) / points.length;
  };
  const hammerHeadWidth = (quads) => {
    const points = quads.filter((quad) => quad.color === "#858b8a").flatMap((quad) => quad.pts);
    return Math.max(...points.map((point) => point[0])) - Math.min(...points.map((point) => point[0]));
  };
  const raised = drawAt(.08), impact = drawAt(.185), secondHit = drawAt(.605);
  assert.ok(raised.some((quad) => quad.color === "#858b8a"), "Hammer head should be visible");
  assert.ok(hammerHeadWidth(raised) > .2, "Hammer should have a broad crosswise head");
  assert.ok(hammerHeadY(impact) < hammerHeadY(raised) - .04, "Hammer should swing down into the barricade");
  assert.ok(braceHandY(impact) < braceHandY(raised) - .04, "The bracing hand should pull back on impact");
  assert.ok(hammerHeadY(secondHit) < hammerHeadY(raised) - .04, "Hammer should strike more than once");
  const impactScreen = impact.filter((quad) => quad.color === "#858b8a").flatMap((quad) => quad.pts)
    .map((point) => [point[0] * 1.8 * 9 / 16 / point[2], point[1] * 1.8 / point[2]]);
  assert.ok(impactScreen.every(([x, y]) => Math.abs(x) < 1 && y < 0),
    "Hammer strikes should stay visible in the lower half of the view");
});

test("shots stain the struck cell, and breaking it stains surviving neighbors without covering the hole", () => {
  const { context: sim, b } = simulation(), point = [.5, .5, 0], middle = 2 * b.cols + 2;
  sim.hitBarricade(b, point, .01, 20, false, "bullet", "#32a6ef");
  assert.equal(b.paint.filter(Boolean).length, 1);
  assert.equal(b.paint[middle].color, "#32a6ef");
  sim.rebuildBarricade(b);
  assert.ok(b.quads.some((q) => q.color === "#32a6ef" && q.x0 <= .5 && q.x1 >= .5 && q.y0 < .5 && q.y1 > .5));
  sim.tNow = 1;
  sim.hitBarricade(b, point, .01, 40, false, "bullet", "#f04c9b");
  assert.equal(b.hp[middle], 0);
  assert.equal(b.paint[middle], null);
  assert.equal(b.paint.filter(Boolean).length, 8);
  assert.ok(b.paint.filter(Boolean).every((mark) => mark.color === "#f04c9b"));
  sim.rebuildBarricade(b);
  assert.ok(!b.quads.some((q) => q.x0 < .5 && q.x1 > .5 && q.y0 < .5 && q.y1 > .5));
  assert.ok(!sim.colliders.some((q) => q.x0 < .5 && q.x1 > .5 && q.y0 < .5 && q.y1 > .5));
  sim.tNow = 21;
  sim.expireBarricadePaint(b);
  assert.equal(b.paint.filter(Boolean).length, 0);
  assert.equal(b.dirty, true);
});

test("reinforced cells stain without taking bullet damage; repairs clear stains and melee leaves none", () => {
  const { context: sim, b } = simulation(), point = [.5, .5, 0], middle = 2 * b.cols + 2;
  b.steel = true;
  b.hp.fill(150);
  sim.hitBarricade(b, point, .01, 20, false, "bullet", "#32a6ef");
  assert.equal(b.hp[middle], 150);
  assert.equal(b.paint[middle].color, "#32a6ef");
  sim.remoteBarricade({ id: "bar", op: "repair" });
  assert.equal(b.paint.filter(Boolean).length, 0);
  sim.hitBarricade(b, point, .01, 20, false, "hammer", null);
  assert.equal(b.paint.filter(Boolean).length, 0);
});

test("a relayed hit reproduces the same stained cells and holes for another player", () => {
  const sender = simulation(), receiver = simulation();
  const message = { id: "bar", op: "hit", p: [.5, .5, 0], radius: .01, power: 55, chip: false, src: "bullet", paint: "#32a6ef" };
  sender.context.hitBarricade(sender.b, message.p, message.radius, message.power, message.chip, message.src, message.paint);
  receiver.context.remoteBarricade(message);
  assert.deepEqual(Array.from(receiver.b.hp), Array.from(sender.b.hp));
  assert.deepEqual(Array.from(receiver.b.paint, (mark) => mark?.color || null), Array.from(sender.b.paint, (mark) => mark?.color || null));
  receiver.context.rebuildBarricade(receiver.b);
  assert.ok(receiver.b.quads.some((quad) => quad.color === message.paint));
});

test("paint skins are retained for relayed stains and mapped to surviving cells", () => {
  const { context: sim, b } = simulation();
  sim.remoteBarricade({ id: "bar", op: "hit", p: [.5, .5, 0], radius: .01, power: 20,
    chip: false, src: "bullet", paint: "#32a6ef", paintSkin: "circuit" });
  sim.rebuildBarricade(b);
  assert.equal(b.paint[2 * b.cols + 2].skin, "circuit");
  assert.ok(b.quads.some((quad) => quad.skin?.id === "circuit" && quad.uv.length === quad.pts.length));
});
