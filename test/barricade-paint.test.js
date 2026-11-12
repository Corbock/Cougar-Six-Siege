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
    BAR_TH: .12, CELL: .2, CELL_HP: 50, STEEL_HP: 150, WOODS: ["#8b5e34"],
    multiplayer: { match: {} }, spawnDebris() {},
    qb(list, x0, x1, y0, y1, z0, z1, color) { list.push({ x0, x1, y0, y1, z0, z1, color }); } };
  vm.runInNewContext(section("      function barBox(", "      function spawnDebris(") +
    section("      const barById =", "      function aimedBarricade(") +
    section("      function makeBarricade(", "      function resetBarricades()"), context);
  const b = context.makeBarricade({ id: "bar", ax: 2, ta: 0, n: 0, a0: 0, a1: 1, y0: 0, y1: 1 });
  return { context, b };
}

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
