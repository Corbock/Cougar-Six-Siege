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
  const context = { Math, ArrayBuffer, DataView, Uint8Array, TextDecoder, EYE: 1.8, CROUCH_EYE: 1.05, tNow: 0, barricadeBuildDuration: 1.35,
    remoteBarricadeActions: new Map(), paintColors: [{ c: "#f6df35" }],
    faceSkin: { id: "face", img: { width: 256, height: 256 } },
    skins: [{ id: "circuit", img: { complete: true, naturalWidth: 512 } }], materials: {
    body: "#3d413c", dark: "#252825", metal: "#80857a", blade: "#9da8ad", edge: "#e5eaeb", accent: "#d3ef59", glass: "#4fa3b8", red: "#df563c"
  }, keychains: [
    { id: "none", name: "None", color: "#3d413c", shape: "none" },
    { id: "cougar-tag", name: "Cougar Tag", color: "#d3ef59", shape: "tag" }
  ], weaponSkin: (_id, skinId) => skinId === "test-skin" ? testSkin : null, testSkin, operatorRoster: [
    { id: "ms-c", loadout: { primary: "mk18", secondary: "p45", gadget: "shield", equipment: "frag" } },
    { id: "custom", loadout: {} }
  ] };
  vm.runInNewContext(section("    const box = (cx", "    const finishes =") +
    section("    function parseWeaponGlb(", "    const inspector =") +
    section("    function attachmentParts(", "    function buildPolys(") +
    section("    function buildPolys(parts)", "    const inspector =") +
    section("      const qb =", "      function dummyQuads(") +
    section("      const worldItemModels =", "      function droneWorldQuads("), context);
  const { parts, mag, colors } = context.parseMk18Glb(Uint8Array.from(fs.readFileSync("ItemModels/paintball_ar.glb")).buffer);
  context.glbParts = parts;
  context.glbMagazine = mag;
  Object.assign(context.materials, colors);
  const longwatch = context.parseLongwatchGlb(Uint8Array.from(fs.readFileSync("ItemModels/paintball_sniper.glb")).buffer);
  context.longwatchParts = longwatch.parts;
  context.longwatchMagazine = longwatch.mag;
  context.longwatchMounts = longwatch.mounts;
  context.longwatchSight = longwatch.sight;
  Object.assign(context.materials, longwatch.colors);
  const vector = context.parseVectorGlb(Uint8Array.from(fs.readFileSync("ItemModels/V9_vector.glb")).buffer);
  context.vectorParts = vector.parts;
  context.vectorMounts = vector.mounts;
  context.vectorSight = vector.sight;
  Object.assign(context.materials, vector.colors);
  const magnum = context.parseMagnumGlb(Uint8Array.from(fs.readFileSync("ItemModels/magnum44.glb")).buffer);
  context.magnumParts = magnum.parts;
  context.magnumMounts = magnum.mounts;
  context.magnumSight = magnum.sight;
  Object.assign(context.materials, magnum.colors);
  const hammer = context.parseHammer12Glb(Uint8Array.from(fs.readFileSync("ItemModels/hammer12.glb")).buffer);
  context.hammerParts = hammer.parts;
  context.hammerMounts = hammer.mounts;
  context.hammerSight = hammer.sight;
  Object.assign(context.materials, hammer.colors);
  const karambit = context.parseKarambitGlb(Uint8Array.from(fs.readFileSync("ItemModels/karambit.glb")).buffer);
  context.karambitParts = karambit.parts;
  Object.assign(context.materials, karambit.colors);
  const sledgehammer = context.parseSledgehammerGlb(Uint8Array.from(fs.readFileSync("ItemModels/sledgehammer.glb")).buffer);
  context.sledgehammerParts = sledgehammer.parts;
  Object.assign(context.materials, sledgehammer.colors);
  const drone = context.parseDroneGlb(Uint8Array.from(fs.readFileSync("ItemModels/drone.glb")).buffer);
  context.droneParts = drone.parts;
  Object.assign(context.materials, drone.colors);
  const bombDefuser = context.parseBombDefuserGlb(Uint8Array.from(fs.readFileSync("ItemModels/bomb_and_defuser.glb")).buffer);
  context.bombDefuserParts = bombDefuser.parts;
  Object.assign(context.materials, bombDefuser.colors);
  const medkit = context.parseMedkitGlb(Uint8Array.from(fs.readFileSync("ItemModels/medkit.glb")).buffer);
  context.medkitBodyParts = medkit.bodyParts;
  context.medkitLidParts = medkit.lidParts;
  context.medkitParts = medkit.parts;
  Object.assign(context.materials, medkit.colors);
  vm.runInNewContext("modelDefs.mk18.parts = glbParts; modelDefs.mk18.mag = glbMagazine; modelDefs.longwatch.parts = longwatchParts; modelDefs.longwatch.mag = longwatchMagazine; modelDefs.longwatch.mounts = longwatchMounts; modelDefs.longwatch.sight = longwatchSight; modelDefs.vector.parts = vectorParts; modelDefs.vector.mounts = vectorMounts; modelDefs.vector.sight = vectorSight; modelDefs.magnum.parts = magnumParts; modelDefs.magnum.mounts = magnumMounts; modelDefs.magnum.sight = magnumSight; modelDefs.hammer.parts = hammerParts; modelDefs.hammer.mounts = hammerMounts; modelDefs.hammer.sight = hammerSight; modelDefs.medkit.parts = medkitParts; modelDefs.karambit.parts = karambitParts; modelDefs.sledgehammer.parts = sledgehammerParts; modelDefs.drone.parts = droneParts", context);
  vm.runInNewContext(section("      function droneModelQuads(", "      function droneLaserQuads(") +
    section("      function droneViewmodelQuads()", "      const skinTex"), context);
  return context;
}

test("MK18 uses the supplied GLB triangles and material colors", () => {
  const sim = simulation(), parts = vm.runInNewContext("modelDefs.mk18.parts", sim);
  assert.equal(parts.every((part) => part.k === "mesh"), true);
  assert.equal(parts.reduce((count, part) => count + part.triangles.length, 0), 440);
  const magazine = vm.runInNewContext("modelDefs.mk18.mag", sim);
  assert.equal(magazine.every((part) => part.k === "mesh"), true);
  assert.equal(magazine.reduce((count, part) => count + part.triangles.length, 0), 24);
  assert.ok(magazine.some((part) => part.m === "paint"), "Magazine body retains paint customization");
  const magazinePoints = magazine.flatMap((part) => part.triangles.flat());
  const magazineMinX = Math.min(...magazinePoints.map((point) => point[0]));
  const magazineMaxY = Math.max(...magazinePoints.map((point) => point[1]));
  assert.ok(magazineMinX > .1 && magazineMinX < .2, "Magazine node translation should be applied");
  assert.ok(magazineMaxY > -.5 && magazineMaxY < -.4, "Magazine should sit below the receiver");
  assert.deepEqual([...new Set(parts.map((part) => part.m))].sort(),
    ["mk18Body", "mk18Dark", "mk18Orange", "mk18Silver"]);
  const points = parts.flatMap((part) => part.triangles.flat());
  const bounds = [0, 1, 2].map((axis) => [
    Math.min(...points.map((point) => point[axis])),
    Math.max(...points.map((point) => point[axis]))
  ]);
  assert.ok(Math.abs(bounds[0][0] + 4.7) < .01 && Math.abs(bounds[0][1] - 6.5) < .01);
  assert.equal(sim.materials.mk18Body, "#121214");
  assert.equal(sim.materials.mk18Orange, "#ff660d");
});

test("Longwatch uses the supplied sniper GLB without replacement geometry", () => {
  const sim = simulation(), parts = vm.runInNewContext("modelDefs.longwatch.parts", sim);
  assert.equal(parts.every((part) => part.k === "mesh"), true);
  assert.ok(parts.length > 0);
  assert.deepEqual([...new Set(parts.map((part) => part.m))].sort(),
    ["dark", "longwatchLight", "metal", "paint"]);
  const triangleCount = parts.reduce((count, part) => count + part.triangles.length, 0);
  assert.equal(triangleCount, 994);
  assert.equal(vm.runInNewContext("modelDefs.longwatch.mag.length", sim), 0);
  const world = [];
  sim.worldItemQuads(world, "longwatch", { x: 10, y: 1.8, z: 3, yaw: Math.PI / 2, pitch: .2, activeSlot: "primary" });
  assert.equal(world.length, 994);
  assert.ok(world.flatMap((quad) => quad.pts).every((point) => point.every(Number.isFinite)));
  const meshPoints = parts.flatMap((part) => part.triangles.flat());
  const minX = Math.min(...meshPoints.map((point) => point[0]));
  const maxX = Math.max(...meshPoints.map((point) => point[0]));
  const minMuzzlePoint = meshPoints.filter((point) => point[0] === maxX);
  const rearPoints = meshPoints.filter((point) => point[0] === minX);
  assert.ok(minMuzzlePoint.length > 0 && rearPoints.length > 0);
  assert.ok(maxX > 0 && minX < 0, "The GLB length should remain centered across local X");
});

test("Vector uses the supplied V9 GLB geometry, node transform, and material names", () => {
  const sim = simulation(), parts = vm.runInNewContext("modelDefs.vector.parts", sim);
  assert.ok(parts.length > 0);
  assert.ok(parts.every((part) => part.k === "mesh"));
  assert.equal(parts.reduce((count, part) => count + part.triangles.length, 0), 2201);
  assert.deepEqual([...new Set(parts.map((part) => part.m))].sort(), [
    "vectorBlack", "vectorBlackLight", "vectorBody", "vectorBrass", "vectorBrown", "vectorDark", "vectorWhite"
  ]);
  const points = parts.flatMap((part) => part.triangles.flat());
  const bounds = [0, 1, 2].map((axis) => [
    Math.min(...points.map((point) => point[axis])),
    Math.max(...points.map((point) => point[axis]))
  ]);
  assert.ok(bounds[0][0] < -2.9 && bounds[0][1] > 2.9, "The transformed GLB length should span local X");
  assert.ok(bounds[1][1] > .5 && bounds[1][0] < -.5, "The transformed GLB should retain its vertical geometry");
  assert.ok(sim.materials.vectorBrass);
  assert.ok(vm.runInNewContext("modelDefs.vector.mounts.optic[1]", sim) > 0);
  assert.ok(vm.runInNewContext("modelDefs.vector.mounts.muzzle[0]", sim) > 2.9);
  assert.equal(vm.runInNewContext("modelDefs.vector.mag.length", sim), 0);
});

test("Magnum uses the supplied GLB, faces muzzle-forward, and keeps its materials isolated", () => {
  const sim = simulation(), parts = vm.runInNewContext("modelDefs.magnum.parts", sim);
  assert.ok(parts.length > 0);
  assert.ok(parts.every((part) => part.k === "mesh"));
  assert.equal(parts.reduce((count, part) => count + part.triangles.length, 0), 830);
  assert.deepEqual([...new Set(parts.map((part) => part.m))].sort(), ["magnumBody", "magnumSteel"]);
  const muzzle = parts.find((part) => part.m === "magnumSteel").triangles.flat();
  const grip = parts.find((part) => part.m === "magnumBody").triangles.flat();
  assert.ok(Math.max(...muzzle.map((point) => point[0])) > 2.3);
  assert.ok(Math.max(...grip.map((point) => point[0])) < 0, "The grip should remain behind the barrel");
  assert.equal(sim.materials.magnumBody, "#210f03");
  assert.equal(sim.materials.magnumSteel, "#101010");
  const world = [];
  sim.worldItemQuads(world, "magnum", { x: 10, y: 1.8, z: 3, yaw: Math.PI / 2, pitch: .2, activeSlot: "secondary" });
  assert.equal(world.length, 830);
  assert.ok(world.flatMap((quad) => quad.pts).every((point) => point.every(Number.isFinite)));
});

test("Hammer 12 uses the supplied hammer12.glb mesh and material regions", () => {
  const sim = simulation(), parts = vm.runInNewContext("modelDefs.hammer.parts", sim);
  assert.ok(parts.length > 0);
  assert.ok(parts.every((part) => part.k === "mesh"));
  assert.deepEqual([...new Set(parts.map((part) => part.m))].sort(), ["body", "dark"]);
  assert.ok(/^#[0-9a-f]{6}$/i.test(sim.materials.body));
  assert.ok(/^#[0-9a-f]{6}$/i.test(sim.materials.dark));
  const barrel = parts.find((part) => part.m === "dark").triangles.flat();
  const receiver = parts.find((part) => part.m === "body").triangles.flat();
  assert.ok(Math.max(...barrel.map((point) => point[0])) >
    Math.max(...receiver.map((point) => point[0])), "The barrel should face the positive local X axis");
  const world = [];
  sim.worldItemQuads(world, "hammer", { x: 10, y: 1.8, z: 3, yaw: Math.PI / 2, pitch: .2, activeSlot: "primary" });
  assert.equal(world.length, parts.reduce((count, part) => count + part.triangles.length, 0));
  assert.ok(world.flatMap((quad) => quad.pts).every((point) => point.every(Number.isFinite)));
});

test("Sledgehammer uses the supplied GLB mesh and transformed material", () => {
  const sim = simulation(), parts = vm.runInNewContext("modelDefs.sledgehammer.parts", sim);
  assert.ok(parts.length > 0);
  assert.ok(parts.every((part) => part.k === "mesh"));
  assert.equal(parts.reduce((count, part) => count + part.triangles.length, 0), 178);
  assert.deepEqual([...new Set(parts.map((part) => part.m))], ["sledgehammerBody"]);
  const points = parts.flatMap((part) => part.triangles.flat());
  const span = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])) -
    Math.min(...points.map((point) => point[axis])));
  assert.ok(span[0] > 7.9 && span[1] > .7 && span[2] > 1.6,
    `The GLB should retain its handle length and hammer-head dimensions: ${span.join(", ")}`);
  assert.equal(sim.materials.sledgehammerBody, "#ffffff");
});

test("first-person Magnum sits lower than other pistols in the viewmodel", () => {
  const sim = simulation();
  Object.assign(sim, { K: .06, tNow: 0, sprintPose: 0, ads: 0, skinOf: () => null,
    colorOf: (_weapon, material) => material });
  vm.runInNewContext(section("      function viewmodelQuads(", "      function droneViewmodelQuads("), sim);
  const parts = vm.runInNewContext("modelDefs.magnum.parts", sim);
  const polys = sim.buildPolys(parts);
  const points = polys.flatMap((poly) => poly.v);
  const mid = [0, 1, 2].map((axis) =>
    (Math.min(...points.map((point) => point[axis])) + Math.max(...points.map((point) => point[axis]))) / 2);
  const weapon = { item: { id: "magnum" }, kind: {}, kick: 0, rear: 2.4, reloadEnd: 0, magPolys: [],
    mid, polys, flash: 0 };
  const averageY = (item) => {
    const points = sim.viewmodelQuads({ ...weapon, item }, false).flatMap((quad) => quad.pts);
    return points.reduce((sum, point) => sum + point[1] / points.length, 0);
  };
  assert.ok(averageY({ id: "magnum", type: "REVOLVER" }) < averageY({ id: "p45", type: "PISTOL" }));
});

test("the bomb and defuser GLB preserves its transformed mesh and material regions", () => {
  const sim = simulation(), parts = sim.bombDefuserParts;
  assert.ok(parts.length > 0);
  assert.ok(parts.every((part) => part.k === "mesh"));
  assert.ok(parts.flatMap((part) => part.triangles.flat()).every((point) => point.every(Number.isFinite)));
  assert.equal(new Set(parts.map((part) => part.m)).size, 10);
  assert.ok(parts.reduce((count, part) => count + part.triangles.length, 0) > 1000);
});

test("planting and defusing draws the C4 with one tapping index finger", () => {
  const sim = simulation();
  const context = { Math, tNow: 1, bombDefuserParts: sim.bombDefuserParts, materials: sim.materials,
    qb(list, x0, x1, y0, y1, z0, z1, color, tf) {
      const points = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map((point) => tf ? tf(point) : point);
      [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]]
        .forEach((face) => list.push({ pts: face.map((index) => points[index]), color }));
    } };
  vm.runInNewContext(section("      function bombDefuserActionQuads(", "      function beginRound("), context);
  const atRest = context.bombDefuserActionQuads({ progress: .2 });
  const pressing = context.bombDefuserActionQuads({ progress: .23 });
  const fingertip = (quads) => quads.filter((quad) => quad.color === "#d9a07c");
  assert.equal(fingertip(pressing).length, 6, "Only the index fingertip should be animated on the keypad");
  assert.ok(fingertip(pressing).some((quad, index) =>
    quad.pts.some((point, vertex) => point[2] < fingertip(atRest)[index].pts[vertex][2])));
  const screen = pressing.filter((quad) => quad.color === sim.materials.c4Screen);
  assert.ok(screen.length > 0, "The keypad should face the player");
  assert.ok(screen.every((quad) => {
    const [a, b, c] = quad.pts;
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0;
  }), "The keypad face should be rotated toward the player");
  assert.ok(screen.every((quad) => quad.pts.every((point) => point[1] > -.25)),
    "The keypad should be upright and above the center of the held device");
  const leftHand = pressing.filter((quad) => quad.color === "#c89170")
    .map((quad) => quad.pts.reduce((sum, point) => sum + point[1] / quad.pts.length, 0));
  assert.ok(Math.min(...leftHand) < 0, "The support hand should hold the device beneath the keypad");
  const bomb = pressing.filter((quad) => quad.color === sim.materials.c4Body);
  assert.ok(bomb.every((quad) => quad.pts.every((point) => {
    const depth = point[2];
    return Math.abs(point[1] * 1.8 / depth) < 1;
  }), "The complete held device should remain inside the vertical view"));
  const tapPoints = [.23, .33, .43, .53, .63, .73].map((progress) =>
    fingertip(context.bombDefuserActionQuads({ progress }))[0].pts
      .reduce((sum, point) => sum + point[0] / 4, 0));
  assert.ok(new Set(tapPoints.map((point) => point.toFixed(3))).size > 3,
    "The index finger should tap different keypad positions");
  const fingertipCenter = fingertip(pressing)[0].pts.reduce((sum, point) => sum.map((value, axis) => value + point[axis] / 4), [0, 0, 0]);
  const screenCenter = screen.flatMap((quad) => quad.pts)
    .reduce((sum, point, index, points) => sum.map((value, axis) => value + point[axis] / points.length), [0, 0, 0]);
  assert.ok(Math.abs(fingertipCenter[0] - screenCenter[0]) < .12 &&
    Math.abs(fingertipCenter[1] - screenCenter[1]) < .08 &&
    fingertipCenter[2] > screenCenter[2] - .02 && fingertipCenter[2] < screenCenter[2] + .04,
  `The index fingertip should contact the keypad rather than the indicator above it: ${JSON.stringify({ fingertipCenter, screenCenter })}`);
  assert.ok(pressing.length > sim.bombDefuserParts.reduce((count, part) => count + part.triangles.length, 0));
});

test("training bomb defusal lets one player plant and then disarm locally", () => {
  const objective = { id: "training-bomb", kind: "bomb", armed: false, actor: null, progress: 0 };
  const keys = new Set(), context = { trainingDefuseMode: true, trainingPlayerId: "training-player",
    currentKeybinds: { interact: "e" }, keys, multiplayer: { objectives: [objective] }, interactState: { id: null },
    practiceInteractStartedAt: 0, practiceInteractBlocked: false, tNow: 10,
    nearbyObjective: () => objective, sendMatch() {}, say() {} };
  vm.runInNewContext(section("      function updateInteract()", "      function objectiveQuads("), context);
  keys.add("e");
  context.updateInteract();
  context.tNow = 12.5; context.updateInteract();
  assert.equal(objective.progress, .5);
  context.tNow = 15; context.updateInteract();
  assert.equal(objective.armed, true);
  assert.equal(objective.actor, null);
  assert.equal(objective.progress, 0);
  context.tNow = 16; context.updateInteract();
  assert.equal(objective.armed, true, "Holding interact should not immediately start another action");
  keys.delete("e"); context.updateInteract();
  keys.add("e"); context.tNow = 20; context.updateInteract();
  context.tNow = 25; context.updateInteract();
  assert.equal(objective.armed, false);
});

test("the drone uses the supplied GLB mesh for world and first-person models", () => {
  const sim = simulation(), parts = vm.runInNewContext("modelDefs.drone.parts", sim);
  assert.equal(parts.every((part) => part.k === "mesh"), true);
  assert.equal(parts.reduce((count, part) => count + part.triangles.length, 0), 1764);
  assert.deepEqual([...new Set(parts.map((part) => part.nodeName))].sort(),
    ["DroneBody", "Prop_BL", "Prop_BR", "Prop_FL", "Prop_FR"]);
  assert.deepEqual([...new Set(parts.map((part) => part.m))].sort(),
    ["droneAccentTeal", "droneArmBlack", "droneBodyGray", "droneBodyLight", "droneLedGreen",
      "droneLedRed", "droneLens", "droneMotor", "dronePropBlack", "droneRubber"]);
  assert.ok(parts.some((part) => part.m === "droneLens"));

  const world = [];
  sim.droneWorldQuads(world, { x: 10, y: 1, z: 3, yaw: 0 });
  assert.equal(world.length, 1764);
  const worldPoints = world.flatMap((quad) => quad.pts);
  assert.ok(worldPoints.every((point) => point.every(Number.isFinite)));
  assert.ok(Math.max(...worldPoints.map(([x]) => x)) - Math.min(...worldPoints.map(([x]) => x)) > .9);
  assert.ok(worldPoints.every(([x, y, z]) => Math.hypot(x - 10, z - 3) < .7 && y > 1 && y < 1.5));

  sim.tNow = .5;
  const spinning = [];
  sim.droneWorldQuads(spinning, { x: 10, y: 1, z: 3, yaw: 0 });
  assert.ok(world.some((quad, index) => quad.pts.some((point, pointIndex) =>
    point.some((value, axis) => value !== spinning[index].pts[pointIndex][axis]))),
  "GLB propeller meshes should rotate");
  const viewmodel = sim.droneViewmodelQuads();
  assert.equal(viewmodel.length, 1764);
  assert.ok(viewmodel.flatMap((quad) => quad.pts).every((point) => point.every(Number.isFinite)));
});

test("MK18's GLB magazine separates and returns during the existing reload animation", () => {
  const context = { Math, ArrayBuffer, DataView, Uint8Array, TextDecoder, K: .06, tNow: 0,
    sprintPose: 0, ads: 0, skinOf: () => null, colorOf: (_weapon, material) => material };
  vm.runInNewContext(section("    function buildPolys(parts)", "    const inspector =") +
    section("    function parseMk18Glb(buffer)", "    const inspector =") +
    section("      function viewmodelQuads(", "      function droneViewmodelQuads("), context);
  const { parts, mag } = context.parseMk18Glb(Uint8Array.from(fs.readFileSync("ItemModels/paintball_ar.glb")).buffer);
  const polys = context.buildPolys(parts), magPolys = context.buildPolys(mag);
  const points = [...polys, ...magPolys].flatMap((poly) => poly.v);
  const mid = [0, 1, 2].map((axis) =>
    (Math.min(...points.map((point) => point[axis])) + Math.max(...points.map((point) => point[axis]))) / 2);
  const weapon = { item: { id: "mk18" }, kind: { reload: 2 }, kick: 0, rear: 0, reloadEnd: 0,
    reloadStart: 0, flash: 0, mid, polys, magPolys };
  const magazineQuads = () => context.viewmodelQuads(weapon, false).filter((quad) => quad.color === "paint");
  const seated = magazineQuads();
  assert.ok(seated.length > 0, "The GLB magazine should render as separate geometry");
  weapon.reloadEnd = 2;
  context.tNow = .8;
  assert.equal(magazineQuads().length, 0, "Reload should leave the magazine well empty");
  context.tNow = 1.2;
  assert.ok(magazineQuads().length > 0, "Reload should animate the detached magazine back into the weapon");
  context.tNow = 1.98;
  assert.equal(magazineQuads().length, seated.length, "Reload should finish with the GLB magazine seated");
});

test("Longwatch reload reaches to the right-side bolt and returns to the trigger", () => {
  const context = { Math, ArrayBuffer, DataView, Uint8Array, TextDecoder, K: .06, tNow: 0,
    sprintPose: 0, ads: 0, skinOf: () => null, colorOf: (_weapon, material) => material };
  vm.runInNewContext(section("    function buildPolys(parts)", "    const inspector =") +
    section("    function parseMk18Glb(buffer)", "    const inspector =") +
    section("      function viewmodelQuads(", "      function droneViewmodelQuads("), context);
  const longwatch = context.parseLongwatchGlb(Uint8Array.from(fs.readFileSync("ItemModels/paintball_sniper.glb")).buffer);
  const polys = context.buildPolys(longwatch.parts);
  const points = polys.flatMap((poly) => poly.v);
  const mid = [0, 1, 2].map((axis) =>
    (Math.min(...points.map((point) => point[axis])) + Math.max(...points.map((point) => point[axis]))) / 2);
  const weapon = { item: { id: "longwatch" }, kind: { reload: 2 }, cfg: { optic: "none" },
    kick: 0, rear: 0, reloadEnd: 0, reloadStart: 0, flash: 0, mid, tip: 5.6,
    sight: longwatch.sight, muzzle: [0, 0], polys, magPolys: [], lastShot: -1 };
  const render = () => context.viewmodelQuads(weapon, false);
  weapon.lastShot = 1;
  context.tNow = 1.24;
  const afterShot = render();
  assert.ok(afterShot.some((quad) => quad.color === "#c89170"), "A right hand should appear after firing");
  assert.ok(!afterShot.some((quad) => quad.color === "#80857a"), "The animation should not add a floating gray bolt box");
  assert.ok(afterShot.flatMap((quad) => quad.pts).every((point) => point.every(Number.isFinite)));
  context.tNow = 0;
  weapon.lastShot = -1;
  weapon.reloadEnd = 2;
  context.tNow = 1;
  const cocking = render();
  assert.ok(cocking.some((quad) => quad.color === "#c89170"));
  assert.ok(!cocking.some((quad) => quad.color === "#80857a"));
  assert.ok(cocking.flatMap((quad) => quad.pts).every((point) => point.every(Number.isFinite)));
});

test("Longwatch ADS reaches 4x zoom without an equipped scope while other sights are unchanged", () => {
  const context = {};
  vm.runInNewContext(section("      function adsViewScale(", "      const keys = new Set()"), context);
  assert.equal(context.adsViewScale(1, true), 1.8 / 4);
  assert.equal(context.adsViewScale(0, true), 1.8);
  assert.equal(context.adsViewScale(1, false), 1.8 * 1.2);
  assert.equal(context.adsViewScale(1, false, "longwatch"), 1.8 / 4);
  assert.equal(context.adsOpticFor("longwatch", "none"), "scope");
  assert.equal(context.adsOpticFor("mk18", "none"), "none");
});

test("Longwatch defaults to the 4x scope while other weapons default to iron sights", () => {
  const context = {};
  vm.runInNewContext(section("    function defaultOpticFor(", "    const customOf ="), context);
  assert.equal(context.defaultOpticFor({ id: "longwatch" }), "scope");
  assert.equal(context.defaultOpticFor({ id: "mk18" }), "none");
});

test("reloading keeps the weapon in its normal aim pose instead of tipping it down", () => {
  const context = { Math, K: .06, tNow: 1, sprintPose: 0, ads: 0,
    skinOf: () => null, colorOf: (_weapon, material) => material };
  vm.runInNewContext(section("      function viewmodelQuads(", "      function droneViewmodelQuads("), context);
  const points = [[-1, -.4, -.2], [1, -.4, -.2], [0, .5, .2]];
  const polys = [{ v: points, c: [0, 0, 0], m: "body" }];
  for (const id of ["mk18", "vector", "longwatch", "p45", "rattler"]) {
    const weapon = { item: { id }, kind: { reload: 2 }, cfg: { optic: "none" },
      kick: 0, rear: 0, mid: [0, 0, 0], tip: 1, sight: [0, 0, 0], muzzle: [0, 0],
      polys, magPolys: [], reloadEnd: 0, reloadStart: 0, flash: 0, lastShot: -1 };
    const idle = context.viewmodelQuads(weapon, false);
    weapon.reloadEnd = 2;
    const reloading = context.viewmodelQuads(weapon, false);
    assert.deepEqual(reloading[0].pts, idle[0].pts, `${id} should not tilt down while reloading`);
  }
});

test("all equipped item types produce world geometry at the player", () => {
  const sim = simulation();
  for (const [slot, ids] of Object.entries({
    primary: ["mk18", "vector", "hammer", "longwatch"],
    secondary: ["p45", "rattler", "magnum"],
    gadget: ["drone", "camera-drone", "steel-bars", "medkit"],
    equipment: ["frag", "flash", "smoke", "claymore"],
    breaching: ["sledgehammer", "karambit"]
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

test("Breaching is the fifth loadout slot and defaults to key 5", () => {
  const slots = section("    const loadoutSlots = [", "    const operatorRoster =");
  const context = {};
  vm.runInNewContext(`${slots}\nglobalThis.slots = loadoutSlots;`, context);
  assert.equal(context.slots[4].id, "breaching");
  assert.deepEqual([...context.slots[4].items.map((item) => item.id)], ["sledgehammer", "karambit"]);
  const binds = section("    const defaultKeybinds = {", "    const keybindLabels =");
  vm.runInNewContext(`${binds}\nglobalThis.binds = defaultKeybinds;`, context);
  assert.equal(context.binds.switchWeapon5, "5");
});

test("saved melee secondary selections migrate to the Breaching slot", () => {
  const migration = section(
    'if (["sledgehammer", "karambit"].includes(customLoadout.secondary)) {',
    "loadoutSlots.forEach((slot) => { if (!slot.items.some((item) => item.id === customLoadout[slot.id]");
  for (const melee of ["sledgehammer", "karambit"]) {
    const context = { customLoadout: { secondary: melee, breaching: "sledgehammer" } };
    vm.runInNewContext(migration, context);
    assert.equal(context.customLoadout.secondary, "p45");
    assert.equal(context.customLoadout.breaching, melee);
  }
});

test("Karambit GLB supplies its full detailed mesh and a reverse-grip orientation", () => {
  const sim = simulation(), parts = vm.runInNewContext("modelDefs.karambit.parts", sim);
  assert.ok(parts.length > 0);
  assert.equal(parts.every((part) => part.k === "mesh"), true);
  assert.equal(parts.reduce((count, part) => count + part.triangles.length, 0), 494);
  assert.deepEqual([...new Set(parts.map((part) => part.m))].sort(),
    ["karambitBlade", "karambitBrass", "karambitDark", "karambitEdge", "karambitGrip"]);
  const centerX = (role) => {
    const points = parts.filter((part) => part.m === role).flatMap((part) => part.triangles.flat());
    return points.reduce((sum, point) => sum + point[0] / points.length, 0);
  };
  assert.ok(centerX("karambitBlade") < 0, "Blade should point away from the hand in reverse grip");
  assert.ok(centerX("karambitGrip") > 0, "Grip and ring should remain on the hand side");
  assert.equal(sim.materials.karambitBrass, "#bd8f38");
});

test("karambit is held in reverse grip and swings up through the hit", () => {
  const context = { Math };
  vm.runInNewContext(section("      function meleeViewmodelPose(", "      function viewmodelQuads("), context);
  const pose = (start, now) => vm.runInNewContext(
    `meleeViewmodelPose({ item: { id: "karambit" }, swingStart: ${start} }, ${now})`, context);
  const idle = pose(-1, 0), impact = pose(0, .3);
  assert.ok(idle.ang > .9, "Karambit should rest in a steeper reverse-grip pose");
  assert.ok(impact.ang < 0, "Blade should rotate upward at the strike");
  assert.ok(impact.offY > idle.offY && impact.offZ > idle.offZ, "Strike should lift and extend the blade");
});

test("I starts a timed Karambit inspection flourish only while the knife is idle", () => {
  const poseSection = section("      function meleeViewmodelPose(", "      function viewmodelQuads(");
  const inspectSection = section("      function beginKarambitInspect(", "      function viewmodelQuads(");
  const context = { Math };
  vm.runInNewContext(`${poseSection}${inspectSection}`, context);
  const knife = { item: { id: "karambit" }, swingStart: -1, inspectStart: -1 };
  assert.equal(context.beginKarambitInspect(knife, 2), true);
  assert.equal(knife.inspectStart, 2);
  const idle = context.meleeViewmodelPose({ ...knife, inspectStart: -1 }, 2);
  const flourish = context.meleeViewmodelPose(knife, 2.85);
  assert.ok(flourish.ang > idle.ang + Math.PI, "Inspection should visibly spin the knife");
  assert.ok(flourish.offY > idle.offY, "Inspection should bring the knife up to view");
  assert.equal(context.beginKarambitInspect({ item: { id: "karambit" }, swingStart: 2 }, 3), false);
  assert.equal(context.beginKarambitInspect({ item: { id: "mk18" }, swingStart: -1 }, 3), false);
});

test("medkit uses its GLB mesh with separate animated lid geometry", () => {
  const sim = simulation(), parts = vm.runInNewContext("modelDefs.medkit.parts", sim);
  assert.ok(parts.length > 0);
  assert.ok(parts.every((part) => part.k === "mesh"));
  assert.ok(sim.medkitBodyParts.length > 0);
  assert.ok(sim.medkitLidParts.length > 0);
  assert.ok(parts.some((part) => part.m === "medkitRed"));
  assert.ok(parts.some((part) => part.m === "medkitWhite"));
  const quads = [];
  sim.worldItemQuads(quads, "medkit", { x: 0, y: 1.8, z: 0, yaw: 0, pitch: 0, activeSlot: "gadget" });
  assert.ok(quads.some((quad) => quad.color === sim.materials.medkitRed), "Medical cross should render in red");
});

test("equipped weapon keychains and skins appear on third-person weapon models", () => {
  const sim = simulation(), state = { x: 0, y: 1.8, z: 0, yaw: 0, pitch: 0, activeSlot: "primary" };
  const plain = [], customized = [];
  sim.worldItemQuads(plain, "mk18", state);
  sim.worldItemQuads(customized, "mk18", state, .28, "#f6df35", { keychain: "cougar-tag", skin: "test-skin", paintSkin: "circuit" });
  assert.ok(customized.length > plain.length, "Equipped keychain should add model geometry");
  assert.ok(customized.some((quad) => quad.color === "#d3ef59"), "Keychain color should render");
  assert.ok(customized.some((quad) => quad.skin === sim.testSkin), "Equipped weapon skin should render");
  assert.ok(customized.some((quad) => quad.skin?.id === "circuit" && quad.color === "#f6df35"), "Magazine uses the paint skin");
});

test("operator faces use the texture and hats are cosmetic geometry", () => {
  const sim = simulation(), state = { x: 0, y: 1.8, z: 0, yaw: 0, pitch: 0, droneState: true };
  const plain = [], cap = [];
  sim.operatorMeshQuads(plain, { operatorId: "custom", state }, "#ffffff");
  sim.operatorMeshQuads(cap, { operatorId: "custom", state: { ...state, hat: "cap" } }, "#ffffff");
  assert.ok(plain.some((quad) => quad.skin === sim.faceSkin && quad.uv.length === 4));
  assert.ok(cap.length > plain.length);
  assert.equal(plain.some((quad) => quad.color === "#302722" || quad.color === "#754f45"), false);
});

test("operator portrait is resized to a power-of-two texture before WebGL upload", () => {
  const drawn = [], canvas = { width: 0, height: 0,
    getContext: () => ({ drawImage: (...args) => drawn.push(args) }) };
  const context = {
    faceSkin: { id: "operator-face", img: null }, faceSkinPhoto: {},
    document: { createElement: () => canvas }, console, activeSection: "PLAY", inspectTarget: null
  };
  const loader = section("    faceSkinPhoto.onload = () => {", "    const usage = {};");
  vm.runInNewContext(`${loader}\nglobalThis.loadFace = faceSkinPhoto.onload;`, context);
  context.loadFace();
  assert.equal(canvas.width, 256);
  assert.equal(canvas.height, 256);
  assert.equal(context.faceSkin.img, canvas);
  assert.deepEqual(drawn[0].slice(1), [0, 0, 256, 256]);
  assert.equal(context.faceSkinPhoto.src, "assets/operator-face.png");
});

test("world textures use the camera transform while viewmodel textures remain camera-relative", () => {
  const uniforms = [], shaders = [];
  const gl = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, TEXTURE_2D: 3, RGBA: 4, UNSIGNED_BYTE: 5,
    TEXTURE_MIN_FILTER: 6, TEXTURE_MAG_FILTER: 7, LINEAR_MIPMAP_LINEAR: 8, LINEAR: 9,
    TEXTURE_WRAP_S: 10, TEXTURE_WRAP_T: 11, REPEAT: 12, ARRAY_BUFFER: 13, DYNAMIC_DRAW: 14, FLOAT: 15, TRIANGLES: 16,
    drawingBufferWidth: 800, drawingBufferHeight: 600, createProgram: () => ({}), createShader: () => ({}),
    shaderSource: (_shader, source) => shaders.push(source), compileShader() {}, attachShader() {}, linkProgram() {},
    createBuffer: () => ({}), createTexture: () => ({}), bindTexture() {}, texImage2D() {}, generateMipmap() {},
    texParameteri() {}, useProgram() {}, getUniformLocation: (_program, name) => name,
    uniform2f() {}, uniform3f: (name, ...values) => uniforms.push([name, ...values]),
    uniform4f: (name, ...values) => uniforms.push([name, ...values]), uniform1i() {},
    getAttribLocation: () => 0, bindBuffer() {}, bufferData() {}, enableVertexAttribArray() {},
    vertexAttribPointer() {}, drawArrays() {}, disableVertexAttribArray() {} };
  const context = { gl, Math, Float32Array, Map, viewScale: 1.8, renderCam: { x: 8, y: 2, z: 4 },
    cam: { yaw: Math.PI / 2, pitch: 0 }, LIGHT: [.35, .8, .5], prog: {} };
  vm.runInNewContext(section("      const skinTex = {}", "      // Translucent red wall"), context);
  const quad = { pts: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    uv: [[0, 0], [512, 0], [512, 512], [0, 512]], skin: { id: "test", img: {} } };
  context.drawSkinned([quad], true);
  assert.ok(shaders.some((source) => source.includes("vec3 d=p-cam") && source.includes("d.x*rot.x")));
  assert.deepEqual(uniforms.find((entry) => entry[0] === "cam"), ["cam", 8, 2, 4]);
  assert.ok(Math.abs(uniforms.find((entry) => entry[0] === "rot")[2] - 1) < 1e-10);
  uniforms.length = 0;
  context.drawSkinned([quad]);
  assert.deepEqual(uniforms.find((entry) => entry[0] === "cam"), ["cam", 0, 0, 0]);
  assert.deepEqual(uniforms.find((entry) => entry[0] === "rot"), ["rot", 1, 0, 1, 0]);
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
