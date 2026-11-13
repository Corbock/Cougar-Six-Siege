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

test("each unique match victory grants and saves exactly one Armory Pack", () => {
  const context = {};
  const award = section("    function awardMatchPack(matchId) {", "    packOpenButton.addEventListener");
  vm.runInNewContext(`
    let packs = 0;
    const rewardedMatches = new Set();
    let saves = 0, renders = 0, notices = 0;
    const saveArmory = () => saves++;
    const renderArmory = () => renders++;
    const showToast = () => notices++;
    ${award}
    globalThis.award = awardMatchPack;
    globalThis.state = () => ({ packs, rewarded: [...rewardedMatches], saves, renders, notices });
  `, context);

  context.award("match-1");
  context.award("match-1");
  context.award("match-2");
  context.award("");

  assert.deepEqual({ ...context.state(), rewarded: [...context.state().rewarded] }, {
    packs: 2, rewarded: ["match-1", "match-2"], saves: 2, renders: 2, notices: 2
  });
});

test("pack reward pool excludes only camos already unlocked from packs", () => {
  const context = {
    packPairs: ["mk18:night-digital", "mk18:ember", "operator:night-digital", "vector:night-digital"],
    skins: [{ id: "night-digital" }, { id: "ember" }],
    ownedWraps: new Set(["mk18:night-digital", "vector:night-digital"]),
    skinUnlockKey: (weaponId, skinId) => `${weaponId}:${skinId}`,
    playerPaintUnlockKey: (skinId) => `operator:${skinId}`,
    skinUnlocked: (skin, weaponId) => context.ownedWraps.has(weaponId === "operator" ?
      context.playerPaintUnlockKey(skin.id) : context.skinUnlockKey(weaponId, skin.id))
  };
  const pool = section("    function packRewardPool() {", "    function openArmoryPack()");
  vm.runInNewContext(`${pool}\nglobalThis.getPool = packRewardPool;`, context);
  assert.deepEqual([...context.getPool()], ["mk18:ember", "operator:night-digital"]);
});

test("packs include every paint, finish, and keychain reward but exclude factory defaults", () => {
  const context = {
    packWeapons: [{ id: "mk18" }],
    skins: [{ id: "digital" }],
    paintColors: [{ id: "standard", free: true }, { id: "blue" }],
    finishes: [{ id: "blackout", free: true }, { id: "desert" }],
    keychains: [{ id: "none" }, { id: "tag" }]
  };
  const pairs = section("    const skinUnlockKey =", "    let armorySave =");
  vm.runInNewContext(`${pairs}\nglobalThis.pairs = packPairs;`, context);
  assert.deepEqual([...context.pairs], [
    "mk18:digital", "operator:digital", "paint:blue", "finish:desert", "keychain:tag", "weapon:karambit"
  ]);
});

test("1,000 packs are granted once to existing and new Armory saves", () => {
  const initialization = section("    let armorySave =", "    const karambitUnlocked =");
  const save = section("    function saveArmory() {", "    function renderArmory()");
  let stored = JSON.stringify({ packs: 2, wraps: [], rewardedMatches: [], starterPackGranted: true });
  const createArmory = () => {
    const context = {
      packPairs: ["weapon:karambit"], customLoadout: { secondary: "p45" }, loadout: { secondary: "p45" },
      localStorage: { getItem: () => stored, setItem: (_key, value) => { stored = value; } },
      console, showToast() {}
    };
    vm.runInNewContext(`${initialization}\n${save}
      if (thousandPacksJustGranted) saveArmory();
      globalThis.state = () => ({ packs, thousandPacksJustGranted });`, context);
    return context;
  };
  const firstLoad = createArmory();
  assert.deepEqual({ ...firstLoad.state() }, { packs: 1002, thousandPacksJustGranted: true });
  assert.equal(JSON.parse(stored).thousandPacksGranted, true);
  const secondLoad = createArmory();
  assert.deepEqual({ ...secondLoad.state() }, { packs: 1002, thousandPacksJustGranted: false });
  stored = "{}";
  const newSave = createArmory();
  assert.deepEqual({ ...newSave.state() }, { packs: 1000, thousandPacksJustGranted: true });
});

test("Karambit is hidden until unlocked and can drop at a rare 2% rate", () => {
  const helpers = section("    const karambitUnlocked =", "    const paintSkinUnlocked =");
  const context = {
    karambitRewardKey: "weapon:karambit", ownedWraps: new Set(),
    customLoadout: { secondary: "karambit" }, loadout: { secondary: "karambit" }
  };
  vm.runInNewContext(`${helpers}
    globalThis.visible = loadoutItemsFor;
    globalThis.isUnlocked = karambitUnlocked;`, context);
  assert.equal(context.isUnlocked(), false);
  assert.deepEqual([...context.visible({ items: [{ id: "p45" }, { id: "karambit" }] })].map(({ id }) => id), ["p45"]);
  assert.equal(context.customLoadout.secondary, "p45");
  context.ownedWraps.add("weapon:karambit");
  assert.equal(context.isUnlocked(), true);
  assert.deepEqual([...context.visible({ items: [{ id: "p45" }, { id: "karambit" }] })].map(({ id }) => id), ["p45", "karambit"]);

  const chooser = section("    function choosePackReward(pool) {", "    function playPackSound(");
  const rolls = [0.019, 0.02, 0, 0.5];
  const chooserContext = {
    karambitRewardKey: "weapon:karambit", Math: { random: () => rolls.shift(), floor: Math.floor }
  };
  vm.runInNewContext(`${chooser}\nglobalThis.choose = choosePackReward;`, chooserContext);
  assert.equal(chooserContext.choose(["mk18:ember", "weapon:karambit"]), "weapon:karambit");
  assert.equal(chooserContext.choose(["mk18:ember", "weapon:karambit"]), "mk18:ember");
  assert.equal(chooserContext.choose(["weapon:karambit"]), "weapon:karambit");
});

test("unowned camos stay hidden until a pack unlocks them for that weapon", () => {
  const context = {
    skins: [{ id: "night-digital" }, { id: "ember" }],
    ownedWraps: new Set(),
    skinUnlockKey: (weaponId, skinId) => `${weaponId}:${skinId}`
  };
  const helpers = section("    const skinUnlocked =", "    const weaponName =");
  vm.runInNewContext(`${helpers}\nglobalThis.available = unlockedWeaponSkins;`, context);
  assert.deepEqual([...context.available("mk18")], []);

  context.ownedWraps.add("mk18:ember");
  assert.deepEqual([...context.available("mk18")].map((skin) => skin.id), ["ember"]);
  assert.deepEqual([...context.available("vector")], []);
});

test("operator camos, paint colors, finishes, and keychains require pack unlocks", () => {
  const context = {
    skins: [{ id: "circuit" }],
    paintColors: [{ id: "standard", free: true }, { id: "blue" }],
    finishes: [{ id: "blackout", free: true }, { id: "desert" }],
    keychains: [{ id: "none" }, { id: "tag" }],
    ownedWraps: new Set(),
    playerPaintUnlockKey: (skinId) => `operator:${skinId}`,
    skinUnlockKey: (weaponId, skinId) => `${weaponId}:${skinId}`,
    appearance: { paintSkin: "none" },
    savedPaintSkin: "none"
  };
  const helpers = section("    const paintSkinUnlocked =", "    const unlockedWeaponSkins =");
  vm.runInNewContext(`${helpers}
    globalThis.isOwned = paintSkinUnlocked;
    globalThis.availablePaint = () => paintColors.filter(paintColorUnlocked);
    globalThis.availableFinishes = () => finishes.filter(finishUnlocked);
    globalThis.availableKeychains = () => keychains.filter(keychainUnlocked);`, context);
  assert.equal(context.isOwned(context.skins[0]), false);
  assert.deepEqual([...context.availablePaint().map(({ id }) => id)], ["standard"]);
  assert.deepEqual([...context.availableFinishes().map(({ id }) => id)], ["blackout"]);
  assert.deepEqual([...context.availableKeychains().map(({ id }) => id)], ["none"]);
  context.ownedWraps.add("operator:circuit");
  context.ownedWraps.add("paint:blue");
  context.ownedWraps.add("finish:desert");
  context.ownedWraps.add("keychain:tag");
  assert.equal(context.isOwned(context.skins[0]), true);
  assert.deepEqual([...context.availablePaint().map(({ id }) => id)], ["standard", "blue"]);
  assert.deepEqual([...context.availableFinishes().map(({ id }) => id)], ["blackout", "desert"]);
  assert.deepEqual([...context.availableKeychains().map(({ id }) => id)], ["none", "tag"]);
});

test("opening a pack stages the reveal and displays the unlocked camo preview", () => {
  const timers = [];
  const fields = {
    "#pack-reward-type": { textContent: "" },
    "#pack-reward-name": { textContent: "" },
    "#pack-reward-detail": { textContent: "" }
  };
  const reward = { hidden: true };
  const context = {
    packs: 1, packOpening: false, packPairs: ["mk18:tiger-stripe"],
    packWeapons: [{ id: "mk18" }], skins: [{ id: "tiger-stripe", name: "Tiger Stripe", src: "assets/skin-tiger-stripe.jpg" }],
    ownedWraps: new Set(), usage: {}, hitsWith: () => 0, skinUnlockKey: (weapon, skin) => `${weapon}:${skin}`,
    skinUnlocked: () => false, weaponName: () => "MK18", packRewardPool: () => ["mk18:tiger-stripe"], choosePackReward: (pool) => pool[0],
    packReward: reward, packRewardSwatch: { style: {}, firstElementChild: { textContent: "" } },
    packStage: { className: "" }, packStageState: { textContent: "" }, packStatusText: "",
    saveArmory() {}, renderArmory() {}, playPackSound() {},
    packOpenButton: { disabled: false, textContent: "" },
    document: { querySelector: (selector) => fields[selector] },
    window: { AudioContext: null, matchMedia: () => ({ matches: false }) },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
    Math
  };
  const open = section("    function openArmoryPack() {", "    function awardMatchPack(matchId) {");
  vm.runInNewContext(`${open}\nglobalThis.open = openArmoryPack;`, context);

  context.open();
  assert.equal(context.packs, 0);
  assert.equal(context.packStage.className, "pack-stage opening");
  assert.equal(context.packStageState.textContent, "GRIP THE SEAL");
  assert.equal(context.packOpening, true);
  assert.equal(timers.at(-1).delay, 2250);

  timers.at(-1).callback();
  assert.equal(context.packStage.className, "pack-stage revealed");
  assert.equal(context.packStageState.textContent, "REVEALED");
  assert.equal(context.packOpening, false);
  assert.equal(reward.hidden, false);
  assert.equal(fields["#pack-reward-name"].textContent, "Tiger Stripe");
  assert.equal(context.packRewardSwatch.style.backgroundImage, 'url("assets/skin-tiger-stripe.jpg")');
  assert.equal(context.packRewardSwatch.firstElementChild.textContent, "WEAPON CAMO");

  context.packs = 1;
  context.window.matchMedia = () => ({ matches: true });
  timers.length = 0;
  context.open();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 80);
  timers[0].callback();
  assert.equal(context.packOpening, false);
});

test("the Armory pack is a foil sachet with a tear-strip reveal, not a chest", () => {
  assert.match(html, /class="pack-wrapper"/);
  assert.match(html, /class="pack-sachet"/);
  assert.match(html, /class="pack-tear-strip"/);
  assert.match(html, /@keyframes pack-tear/);
  assert.match(html, /RIP OPEN PACK/);
  assert.doesNotMatch(html, /pack-crate-(?:lid|front|latch)/);
});

test("a rare Karambit pack reveal unlocks the weapon with a distinct rare presentation", () => {
  const timers = [], fields = {
    "#pack-reward-type": { textContent: "" },
    "#pack-reward-name": { textContent: "" },
    "#pack-reward-detail": { textContent: "" }
  };
  const reward = { hidden: true };
  const context = {
    packs: 1, packOpening: false, packPairs: ["weapon:karambit"], packWeapons: [],
    loadoutSlots: [{ id: "secondary", items: [{ id: "karambit", name: "Karambit" }] }],
    ownedWraps: new Set(), packRewardPool: () => ["weapon:karambit"], choosePackReward: (pool) => pool[0],
    packReward: reward, packRewardSwatch: { style: {}, firstElementChild: { textContent: "" } },
    packStage: { className: "" }, packStageState: { textContent: "" }, packStatusText: "",
    packOpenButton: { disabled: false, textContent: "" }, saveArmory() {}, renderArmory() {}, playPackSound() {},
    document: { querySelector: (selector) => fields[selector] },
    window: { AudioContext: null, matchMedia: () => ({ matches: true }) },
    setTimeout: (callback, delay) => timers.push({ callback, delay }), Math
  };
  const open = section("    function openArmoryPack() {", "    function awardMatchPack(matchId) {");
  vm.runInNewContext(`${open}\nglobalThis.open = openArmoryPack;`, context);
  context.open();
  timers[0].callback();
  assert.ok(context.ownedWraps.has("weapon:karambit"));
  assert.equal(fields["#pack-reward-name"].textContent, "Karambit");
  assert.match(context.packStage.className, /rare/);
  assert.equal(context.packRewardSwatch.firstElementChild.textContent, "RARE // KARAMBIT");
});
