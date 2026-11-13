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

test("grenade throw animation pulls the pin before the release", () => {
  const context = { Math, tNow: 0, grenadeThrowAction: { startedAt: 0, itemId: "frag" },
    qb(list, x0, x1, y0, y1, z0, z1, color, transform = (point) => point) {
      const points = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map(transform);
      [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]]
        .forEach((face) => list.push({ pts: face.map((index) => points[index]), color }));
    } };
  vm.runInNewContext(section("      function grenadeThrowActionQuads()", "      function tabletActionQuads()"), context);
  const drawAt = (time) => { context.tNow = time; return context.grenadeThrowActionQuads(); };
  const pinCenterX = (quads) => {
    const points = quads.filter((quad) => quad.color === "#cbd0cc").flatMap((quad) => quad.pts);
    assert.ok(points.length > 0, "The grenade pin should be visible before release");
    return points.reduce((sum, point) => sum + point[0] / points.length, 0);
  };
  const attached = drawAt(.08), pulled = drawAt(.35);
  assert.ok(pinCenterX(pulled) < pinCenterX(attached) - .15, "The left hand should pull the pin clear of the grenade");
  assert.ok(drawAt(.7).length > 0, "The throwing hand should remain visible during release");
});

test("grenade is released after the pin-pull delay and action then ends", () => {
  const context = { grenadeThrowAction: { startedAt: 0, thrown: false }, grenadeThrowReleaseAt: .64,
    grenadeThrowDuration: 1, tNow: 0, throws: 0, throwGrenade: () => { context.throws++; } };
  vm.runInNewContext(section("      function advanceGrenadeThrow()", "      const smokeFade"), context);
  context.tNow = .63;
  context.advanceGrenadeThrow();
  assert.equal(context.throws, 0);
  context.tNow = .64;
  context.advanceGrenadeThrow();
  assert.equal(context.throws, 1);
  assert.equal(context.grenadeThrowAction.thrown, true);
  context.tNow = 1;
  context.advanceGrenadeThrow();
  assert.equal(context.grenadeThrowAction, null);
});
