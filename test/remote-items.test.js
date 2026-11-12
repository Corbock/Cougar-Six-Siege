const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync("index.html", "utf8");

function section(start, end) {
  const first = html.indexOf(start), last = html.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing ${start}`);
  return html.slice(first, last);
}

function simulation() {
  const testSkin = { id: "test-skin" };
  const context = { Math, EYE: 1.8, CROUCH_EYE: 1.05, paintColors: [{ c: "#f6df35" }], materials: {
    body: "#3d413c", dark: "#252825", metal: "#80857a", accent: "#d3ef59", glass: "#4fa3b8", red: "#df563c",
    medical: "#d9ded5", medicalWhite: "#f7f5ea", medicalRed: "#c42a30", medicalTrim: "#68716b"
  }, keychains: [
    { id: "none", name: "None", color: "#3d413c", shape: "none" },
    { id: "cougar-tag", name: "Cougar Tag", color: "#d3ef59", shape: "tag" }
  ], weaponSkin: (_id, skinId) => skinId === "test-skin" ? testSkin : null, testSkin, operatorRoster: [
    { id: "ms-c", loadout: { primary: "mk18", secondary: "p45", gadget: "shield", equipment: "frag" } },
    { id: "custom", loadout: {} }
  ] };
  vm.runInNewContext(section("    const box = (cx", "    const finishes =") +
    section("    function attachmentParts(", "    function buildPolys(") +
    section("    function buildPolys(parts)", "    const inspector =") +
    section("      const qb =", "      function dummyQuads(") +
    section("      const worldItemModels =", "      function droneWorldQuads("), context);
  return context;
}

test("all equipped item types produce world geometry at the player", () => {
  const sim = simulation();
  for (const [slot, ids] of Object.entries({
    primary: ["mk18", "vector", "hammer", "longwatch"],
    secondary: ["p45", "rattler", "magnum", "sledgehammer"],
    gadget: ["drone", "camera-drone", "steel-bars", "medkit"],
    equipment: ["frag", "flash", "smoke", "claymore"]
  })) {
    for (const id of ids) {
      const quads = [], state = { x: 10, y: 1.8, z: 3, yaw: Math.PI / 2, pitch: .2, activeSlot: slot };
      sim.worldItemQuads(quads, id, state);
      assert.ok(quads.length > 0, id);
      assert.ok(quads.every((q) => /^#[0-9a-f]{6}$/i.test(q.color)), id);
      assert.ok(quads.flatMap((q) => q.pts).every((p) => Math.hypot(p[0] - 10, p[1] - 1.3, p[2] - 3) < 1.5), id);
    }
  }
});

test("medkit world model has a light case, medical cross and reinforced trim", () => {
  const sim = simulation(), parts = vm.runInNewContext("modelDefs.medkit.parts", sim);
  assert.ok(parts.some((part) => part.m === "medicalWhite"));
  assert.ok(parts.some((part) => part.m === "medicalRed"));
  assert.ok(parts.some((part) => part.m === "medicalTrim"));
  const quads = [];
  sim.worldItemQuads(quads, "medkit", { x: 0, y: 1.8, z: 0, yaw: 0, pitch: 0, activeSlot: "gadget" });
  assert.ok(quads.some((quad) => quad.color === "#c42a30"), "Medical cross should render in red");
});

test("equipped weapon keychains and skins appear on third-person weapon models", () => {
  const sim = simulation(), state = { x: 0, y: 1.8, z: 0, yaw: 0, pitch: 0, activeSlot: "primary" };
  const plain = [], customized = [];
  sim.worldItemQuads(plain, "mk18", state);
  sim.worldItemQuads(customized, "mk18", state, .28, "#f6df35", { keychain: "cougar-tag", skin: "test-skin" });
  assert.ok(customized.length > plain.length, "Equipped keychain should add model geometry");
  assert.ok(customized.some((quad) => quad.color === "#d3ef59"), "Keychain color should render");
  assert.ok(customized.some((quad) => quad.skin === sim.testSkin), "Equipped weapon skin should render");
});

test("casual third-person models retain equipped shields and Ms C's pistol", () => {
  const sim = simulation();
  const state = { x: 0, y: 1.8, z: 0, yaw: 0, pitch: 0, activeSlot: "gadget", equippedItem: "shield", shieldActive: true };
  const custom = [], msC = [];
  sim.operatorMeshQuads(custom, { operatorId: "custom", state }, "#ffffff");
  sim.operatorMeshQuads(msC, { operatorId: "ms-c", state }, "#ffffff");
  assert.ok(custom.some((q) => q.pts.every((p) => Math.abs(p[2] - .58) < 1e-8)));
  assert.ok(msC.length > custom.length);
  const other = [];
  sim.operatorMeshQuads(other, { operatorId: "ms-c", state: { ...state, activeSlot: "primary", equippedItem: "mk18", shieldActive: false } }, "#ffffff");
  assert.ok(other.length > 100, "Rifle model should be rendered");
  assert.ok(msC.some((quad) => quad.color === "#d7ad8e"), "Ms C should have a visible face");
  const customBody = [];
  sim.operatorMeshQuads(customBody, { operatorId: "custom", state: { ...state, activeSlot: "primary", equippedItem: null, shieldActive: false } }, "#ffffff");
  assert.ok(customBody.some((quad) => quad.color === "#c99778"), "Custom should have a visible face");
  assert.ok(customBody.some((quad) => quad.color === "#58656a"), "Custom should wear casual clothes");
  assert.equal(customBody.some((quad) => quad.color === "#414a3d" || quad.color === "#303831"), false, "The body should not have tactical armor");
  assert.notDeepEqual(customBody.map((quad) => quad.color), msC.map((quad) => quad.color));
});

test("equipped item uses synchronized Custom state and preset fallback", () => {
  const sim = simulation();
  assert.equal(sim.remoteEquippedItem({ operatorId: "custom", state: { activeSlot: "secondary", equippedItem: "magnum" } }), "magnum");
  assert.equal(sim.remoteEquippedItem({ operatorId: "ms-c", state: { activeSlot: "gadget" } }), "shield");
  assert.equal(sim.remoteEquippedItem({ operatorId: "custom", state: { shieldActive: true } }), "shield");
  assert.equal(sim.remoteEquippedItem({ operatorId: "custom", state: { activeSlot: "primary" } }), null);
});
