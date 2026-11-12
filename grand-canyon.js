(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GrandCanyon = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  const scale = .6;
  const point = (x, z) => ({ x: (x - 280) * scale, z: (z - 150) * scale });
  const bounds = { x0: point(0, 0).x, x1: point(510, 331).x, z0: point(0, 0).z, z1: point(510, 331).z };
  const sites = {
    a101: { ...point(14, 88), y: 0 },
    northBath: { ...point(160, 58), y: 0 },
    cafeteria: { ...point(152, 300), y: 0 }
  };
  const spawns = {
    1: [25, 32, 39, 46, 53].map((x) => ({ ...point(x, 153), y: 1.8, yaw: Math.PI / 2 })),
    2: [501, 494, 487, 480, 473].map((x) => ({ ...point(x, 153), y: 1.8, yaw: -Math.PI / 2 }))
  };
  const rooms = [
    { name: "B104", x0: 40, x1: 80, z0: 0, z1: 29, door: "south", doorAt: 59 },
    { name: "B105", x0: 80, x1: 108, z0: 0, z1: 29, door: "south", doorAt: 86 },
    { name: "B106", x0: 108, x1: 137, z0: 0, z1: 29, door: "south", doorAt: 114 },
    { name: "B107", x0: 137, x1: 170, z0: 0, z1: 29, door: "south", doorAt: 143 },
    { name: "A104", x0: 57, x1: 80, z0: 38, z1: 77, door: "south", doorAt: 61 },
    { name: "A106", x0: 80, x1: 108, z0: 38, z1: 77, door: "south", doorAt: 88 },
    { name: "A108", x0: 108, x1: 139, z0: 38, z1: 77, door: "south", doorAt: 115 },
    { name: "BATHROOM", x0: 139, x1: 170, z0: 38, z1: 77, door: "north", doors: [147, 164], bathroom: true },
    { name: "A103", x0: 57, x1: 80, z0: 88, z1: 116, door: "north", doorAt: 64 },
    { name: "A105", x0: 80, x1: 108, z0: 88, z1: 116, door: "north", doorAt: 92 },
    { name: "A107", x0: 108, x1: 137, z0: 88, z1: 116, door: "north", doorAt: 120 },
    { name: "A109", x0: 137, x1: 170, z0: 88, z1: 116, door: "north", doorAt: 144 },
    { name: "B112", x0: 337, x1: 369, z0: 0, z1: 29, door: "south", doorAt: 341 },
    { name: "B114", x0: 369, x1: 402, z0: 0, z1: 29, door: "south", doorAt: 396 },
    { name: "B116", x0: 416, x1: 447, z0: 0, z1: 29, door: "south", doorAt: 420 },
    { name: "B111", x0: 337, x1: 369, z0: 38, z1: 67, door: "north", doorAt: 341 },
    { name: "B113", x0: 369, x1: 402, z0: 38, z1: 67, door: "east", doorAt: 43 },
    { name: "B115", x0: 416, x1: 447, z0: 38, z1: 67, door: "north", doorAt: 420 },
    { name: "A116", x0: 337, x1: 369, z0: 67, z1: 99, door: "south", doorAt: 341 },
    { name: "A118", x0: 369, x1: 402, z0: 67, z1: 99, door: "south", doorAt: 396 },
    { name: "A115", x0: 337, x1: 369, z0: 108, z1: 138, door: "north", doorAt: 341 },
    { name: "A117", x0: 369, x1: 402, z0: 108, z1: 138, door: "north", doorAt: 396 },
    { name: "A120", x0: 416, x1: 445, z0: 67, z1: 99, door: "south", doorAt: 420 },
    { name: "A122", x0: 445, x1: 475, z0: 67, z1: 99, door: "south", doorAt: 449 },
    { name: "A119", x0: 416, x1: 447, z0: 108, z1: 138, door: "north", doorAt: 420 },
    { name: "A121", x0: 447, x1: 477, z0: 108, z1: 138, door: "north", doorAt: 451 },
    { name: "A101", x0: 0, x1: 28, z0: 68, z1: 116, door: "east", doorAt: 80 },
    { name: "A102", x0: 0, x1: 28, z0: 37, z1: 68, door: "east", doorAt: 44 },
    { name: "BATHROOM", x0: 108, x1: 135, z0: 177, z1: 207, door: "south", doors: [113, 125], bathroom: true },
    { name: "CAFETERIA", x0: 30, x1: 184, z0: 225, z1: 331, door: "north", doorAt: 140, cafeteria: true }
  ];
  const doorHalf = (room) => room.cafeteria ? 2.5 : 1.75;
  const cafeteriaBarricades = [
    { x: 57, z: 300, along: "x", length: 4.5 },
    { x: 91, z: 300, along: "z", length: 4.5, corner: [1, 1] },
    { x: 125, z: 300, along: "x", length: 4.5 },
    { x: 160, z: 290, along: "z", length: 4.5 }
  ];
  const cover = [
    { x: 110, z: 146, along: "z", length: 3.2 },
    { x: 155, z: 157, along: "z", length: 3.2 },
    { x: 215, z: 146, along: "z", length: 3.2 },
    { x: 255, z: 157, along: "z", length: 3.2 },
    { x: 315, z: 146, along: "z", length: 3.2 },
    { x: 355, z: 157, along: "z", length: 3.2 },
    { x: 415, z: 146, along: "z", length: 3.2 },
    { x: 455, z: 157, along: "z", length: 3.2 },
    { x: 100, z: 33.5, along: "z", length: 2.4 },
    { x: 360, z: 33.5, along: "z", length: 2.4 },
    { x: 115, z: 83, along: "z", length: 2.4 },
    { x: 380, z: 103.5, along: "z", length: 2.4 },
    { x: 65, z: 292, along: "x", length: 3.2 },
    { x: 105, z: 292, along: "x", length: 3.2 },
    { x: 140, z: 305, along: "x", length: 3.2 },
    { x: 180, z: 146, along: "z", length: 3.2, shape: "L" },
    { x: 295, z: 157, along: "z", length: 3.2, shape: "L" },
    { x: 390, z: 146, along: "z", length: 3.2, shape: "L" },
    { x: 75, z: 304, along: "x", length: 3.2, shape: "U" },
    { x: 112, z: 304, along: "x", length: 3.2, shape: "L" },
    { x: 155, z: 305, along: "x", length: 3.2, shape: "U" }
  ].flatMap(({ x, z, along, length, shape }) => {
    const center = point(x, z);
    const panel = (ax, n, a, width) => ({
      ax, ta: ax === 0 ? 2 : 0, n, a0: a - width / 2, a1: a + width / 2, y0: 0, y1: 2.2
    });
    const ax = along === "x" ? 2 : 0;
    const n = ax === 0 ? center.x : center.z, a = ax === 0 ? center.z : center.x;
    const panels = [panel(ax, n, a, length)];
    if (shape) {
      const leg = 1.8;
      panels.push(panel(ax === 0 ? 2 : 0, a - length / 2, n + leg / 2, leg));
      if (shape === "U") panels.push(panel(ax === 0 ? 2 : 0, a + length / 2, n + leg / 2, leg));
    }
    return panels;
  });
  const openings = rooms.flatMap((room) => {
    const east = room.door === "east", ax = east ? 0 : 2, ta = east ? 2 : 0;
    const middle = room.doorAt ?? (east ? (room.z0 + room.z1) / 2 : (room.x0 + room.x1) / 2);
    return (room.doors ?? [middle]).map((at) => {
      const center = east ? point(room.x1, at) : point(at, room.door === "north" ? room.z0 : room.z1);
      const n = ax === 0 ? center.x : center.z, along = ta === 0 ? center.x : center.z;
      return { ax, ta, n, a0: along - doorHalf(room) * scale, a1: along + doorHalf(room) * scale, y0: 0, y1: 2.6 };
    });
  });
  function findOpening(origin, direction, maxDistance, clearance) {
    let best = null, nearest = maxDistance;
    for (const opening of openings) {
      const component = direction[opening.ax];
      if (Math.abs(component) < 1e-8) continue;
      const distance = (opening.n - origin[opening.ax]) / component;
      if (distance < .4 || distance > nearest) continue;
      const along = origin[opening.ta] + direction[opening.ta] * distance;
      const height = origin[1] + direction[1] * distance;
      if (along <= opening.a0 || along >= opening.a1 || height <= opening.y0 || height >= opening.y1) continue;
      if (clearance(origin, direction, distance) < distance - .01) continue;
      nearest = distance;
      best = { ...opening };
    }
    return best;
  }
  function build(box, quad, flat, glassBox, poster) {
    const p = point, wall = "@canyon-wood-panels", trim = "#7a3034";
    const rect = (x0, x1, y0, y1, z0, z1, color, side = color, noCollide = false) => {
      const a = p(x0, z0), b = p(x1, z1);
      box(a.x, b.x, y0, y1, a.z, b.z, color, side, noCollide);
    };
    const surface = (x0, x1, z0, z1, y, color) => {
      const a = p(x0, z0), b = p(x1, z1);
      quad(flat, [[a.x, y, a.z], [b.x, y, a.z], [b.x, y, b.z], [a.x, y, b.z]], color);
    };
    const prop = (anchorX, anchorZ, x0, x1, y0, y1, z0, z1, color, side = color, noCollide = false) =>
      rect(anchorX + (x0 - anchorX) / 2, anchorX + (x1 - anchorX) / 2, y0, y1,
        anchorZ + (z0 - anchorZ) / 2, anchorZ + (z1 - anchorZ) / 2, color, side, noCollide);
    const facade = (x0, x1, z0, z1, mainHall) => {
      const bands = mainHall ? [[0, 4.1, "@canyon-beige-brick"]] : [
        [0, 1.15, "@canyon-white-brick*#ed3034"],
        [1.15, 1.65, "@canyon-white-brick*#1b1b1b"],
        [1.65, 4.1, "@canyon-white-brick"]
      ];
      bands.forEach(([y0, y1, material]) => rect(x0, x1, y0, y1, z0, z1, material, material, true));
    };
    surface(0, 510, 0, 331, 0, "#b8b3a9");
    for (let x = 0; x < 510; x += 8) for (let z = 0; z < 331; z += 8) {
      surface(x, Math.min(x + 7.85, 510), z, Math.min(z + 7.85, 331), .012, (Math.floor(x / 8) + Math.floor(z / 8)) % 2 ? "#c9c7bc" : "#bdbbb2");
    }
    rect(0, 510, 4.1, 4.3, 0, 331, "@canyon-ceiling-tiles");
    rect(-1, 0, 0, 4.1, 0, 331, wall);
    rect(510, 511, 0, 4.1, 0, 331, wall);
    rect(0, 510, 0, 4.1, -1, 0, wall);
    rect(0, 510, 0, 4.1, 331, 332, wall);
    [
      [0, 28, 0, 29], [40, 57, 38, 77], [40, 57, 88, 116],
      [40, 170, 116, 138], [188, 329, 0, 29], [188, 329, 38, 77],
      [188, 329, 88, 138], [477, 510, 108, 138],
      [45, 105, 166, 220], [108, 135, 164, 175], [148, 185, 164, 224],
      [185, 510, 164, 331], [447, 510, 0, 67], [475, 505, 67, 103]
    ].forEach(([x0, x1, z0, z1]) => {
      rect(x0, x1, 0, 4.1, z0, z1, wall);
      facade(x0, x1, z0 - .02, z0, z0 === 164 || z0 === 166);
      facade(x0, x1, z1, z1 + .02, z1 === 138);
      facade(x0 - .02, x0, z0, z1, false);
      facade(x1, x1 + .02, z0, z1, false);
    });
    [
      [215, 77, 1], [253, 77, 1], [304, 77, 1], [210, 88, -1],
      [247, 88, -1], [290, 88, -1], [313, 138, 1], [80, 166, -1],
      [493, 138, 1], [478, 103, 1]
    ].forEach(([x, z, side]) => {
      rect(x - 1.5, x + 1.5, .05, 2.45, z + side * .05, z + side * .15, "#493d39", "#493d39", true);
      rect(x - 1.75, x + 1.75, 1.15, 1.32, z + side * .155, z + side * .215, "#b63a3a", "#b63a3a", true);
      rect(x + .9, x + 1.1, 1.0, 1.15, z + side * .22, z + side * .25, "#d0c8b7", "#d0c8b7", true);
    });

    const glyphs = {
      A: ["010", "101", "111", "101", "101"], B: ["110", "101", "110", "101", "110"],
      0: ["111", "101", "101", "101", "111"], 1: ["010", "110", "010", "010", "111"],
      2: ["110", "001", "111", "100", "111"], 3: ["110", "001", "011", "001", "110"],
      4: ["101", "101", "111", "001", "001"], 5: ["111", "100", "110", "001", "110"],
      6: ["011", "100", "111", "101", "111"], 7: ["111", "001", "010", "010", "010"],
      8: ["111", "101", "111", "101", "111"], 9: ["111", "101", "111", "001", "110"]
    };
    function roomSign(room, middle) {
      if (!/^[AB]\d+$/.test(room.name) || room.door === "east") return;
      const z = room.door === "south" ? room.z1 + .25 : room.z0 - .25;
      const width = room.name.length * 1.05;
      rect(middle - width / 2 - .5, middle + width / 2 + .5, 2.65, 3.16, z - .12, z + .12, "#69262c", "#69262c", true);
      [...room.name].forEach((letter, n) => glyphs[letter].forEach((row, r) => [...row].forEach((bit, c) => {
        const offset = n * 1.05 + c * .25;
        const x = room.door === "south" ? middle + width / 2 - offset - .2 : middle - width / 2 + offset;
        if (bit === "1") rect(x, x + .2, 3.04 - r * .075, 3.10 - r * .075, z - .2, z + .2, "#f5f2e5", "#f5f2e5", true);
      })));
    }
    rooms.forEach((room) => {
      const { x0, x1, z0, z1, door } = room;
      const roomWall = room.cafeteria ? "@canyon-beige-brick" : wall;
      const middle = room.doorAt ?? (door === "east" ? (z0 + z1) / 2 : (x0 + x1) / 2);
      const half = doorHalf(room);
      const openings = room.doors ?? [middle];
      const horizontal = (z, hasDoor) => {
        const segment = (a, b) => {
          rect(a, b, 0, 4.1, z - .35, z + .35, roomWall);
          if (!room.cafeteria && (hasDoor || [29, 38, 77, 88, 99, 108, 138].includes(z))) {
            const face = z + (z === z0 ? -.35 : .35);
            facade(a, b, face - .01, face + .01, z === 138);
          }
        };
        if (!hasDoor) return segment(x0, x1);
        let edge = x0;
        openings.forEach((at) => {
          segment(edge, at - half);
          rect(at - half, at + half, 2.6, 4.1, z - .35, z + .35, trim);
          edge = at + half;
        });
        segment(edge, x1);
      };
      const vertical = (x, hasDoor) => {
        if (room.cafeteria && x === x0 && glassBox) {
          const a = p(x - .35, z0), b = p(x + .35, z1);
          glassBox(a.x, b.x, 0, 4.1, a.z, b.z);
          return;
        }
        const segment = (a, b) => {
          rect(x - .35, x + .35, 0, 4.1, a, b, roomWall);
          if (!room.cafeteria && (hasDoor || [57, 170, 337, 402, 416, 477].includes(x))) {
            const face = x + (x === x0 ? -.35 : .35);
            facade(face - .01, face + .01, a, b, false);
          }
        };
        if (!hasDoor) return segment(z0, z1);
        segment(z0, middle - half);
        segment(middle + half, z1);
        rect(x - .35, x + .35, 2.6, 4.1, middle - half, middle + half, trim);
      };
      horizontal(z0, door === "north"); horizontal(z1, door === "south");
      vertical(x0, door === "west"); vertical(x1, door === "east");
      roomSign(room, middle);
      if (room.bathroom) {
        for (let x = x0 + 1; x < x1 - 1; x += 4) for (let z = z0 + 1; z < z1 - 1; z += 4) {
          surface(x, Math.min(x + 3.9, x1 - 1), z, Math.min(z + 3.9, z1 - 1), .03, (Math.floor(x / 4) + Math.floor(z / 4)) % 2 ? "#d9dde0" : "#9aa2a8");
        }
        const stallZ = door === "north" ? z1 - 7 : z0 + 1;
        for (let x = x0 + 3; x < x1 - 4; x += 6) {
          prop(x, stallZ, x, x + 3, 0, .45, stallZ, stallZ + 3, "#f3f2ec", "#cfcfcf");
          prop(x, stallZ, x, x + .35, .15, 1.9, stallZ, stallZ + 5, "#7d848b");
          prop(x, stallZ, x + 2.4, x + 2.8, .15, 1.75, stallZ + 4.5, stallZ + 5, "#6b4a2f", "#6b4a2f", true);
        }
        prop(x0, z1 - 10, x0 + 1, x0 + 3, .7, .9, z1 - 10, z1 - 4, "#f3f2ec");
        prop(x0, z1 - 10, x0 + .5, x0 + .8, 1.3, 2.3, z1 - 10, z1 - 4, "#cfe6f0", "#cfe6f0", true);
      } else if (room.cafeteria) {
        for (const x of [49, 73, 97, 121, 157]) for (const z of [242, 260, 278, 316]) {
          const center = p(x, z), cx = center.x, cz = center.z;
          box(cx - 1.8, cx + 1.8, .72, .84, cz - .6, cz + .6, "@wood-boards");
          for (const dx of [-1.4, 1.4]) for (const dz of [-.4, .4]) {
            box(cx + dx - .09, cx + dx + .09, 0, .72, cz + dz - .09, cz + dz + .09, "#555d60");
          }
          for (const dx of [-1.2, 0, 1.2]) for (const side of [-1, 1]) {
            const sx = cx + dx, sz = cz + side * 1.15;
            box(sx - .35, sx + .35, .42, .52, sz - .32, sz + .32, "#7d3434");
            box(sx - .35, sx + .35, .52, 1.05, sz + side * .25 - .05, sz + side * .25 + .05, "#7d3434");
            for (const lx of [-.25, .25]) for (const lz of [-.22, .22])
              box(sx + lx - .04, sx + lx + .04, 0, .42, sz + lz - .04, sz + lz + .04, "#555d60");
          }
        }
      } else {
        const depth = z1 - z0, width = x1 - x0;
        if (depth > 20 && width > 20 && room.name !== "A101") {
          const back = door === "north" || door === "east" ? z1 - 8 : z0 + 3;
          prop(x0 + 3, back, x0 + 3, x0 + 10, .7, .85, back, back + 4, "#9d7654");
          prop(x1 - 3, back, x1 - 10, x1 - 3, .7, .85, back, back + 4, "#9d7654");
          prop(x0 + 3, back, x0 + 3, x0 + 4, 0, .7, back, back + 4, "#555d60");
          prop(x1 - 3, back, x1 - 4, x1 - 3, 0, .7, back, back + 4, "#555d60");
          if (door === "east") {
            prop(x0, (z0 + z1) / 2, x0 + .8, x0 + 1.4, 1.2, 2.7, z0 + 4, z1 - 4, "#e1e4dc", "#e1e4dc", true);
          } else {
            const boardZ = door === "north" ? z1 - .7 : z0 + .4;
            prop((x0 + x1) / 2, boardZ, x0 + 4, x1 - 4, 1.2, 2.7, boardZ, boardZ + .3, "#e1e4dc", "#e1e4dc", true);
          }
        }
      }
    });
    [
      ...[54, 92, 130, 195, 230, 270, 300, 350, 385, 432, 466].map((x) => [x, 138.36, 140]),
      ...[220, 270, 320, 365, 405, 450, 480].map((x) => [x, 162.35, 163.99])
    ].forEach(([x, z0, z1]) => rect(x - .8, x + .8, 0, 4.1, z0, z1, "@canyon-red-brick"));
    for (let x = 20; x < 500; x += 18) {
      prop(x, 151, x, x + 9, 4.02, 4.08, 148, 154, "#f7f5e6", "#f7f5e6", true);
    }
    for (let x = 192; x < 320; x += 10) {
      prop(x, 138, x, x + 8, .15, 2.05, 138, 139, "#7d3035", "#7d3035", true);
      prop(x, 138, x + 1, x + 7, 1.55, 1.6, 139, 139.15, "#d6c6ab", "#d6c6ab", true);
    }
    if (poster) {
      const ratios = [451 / 679, 656 / 304, 515 / 388, 449 / 420, 668 / 409];
      [205, 250, 295, 340, 385].forEach((x, i) => {
        const center = p(x, 164);
        poster(i + 1, center.x, center.z - .015, 1.5 * ratios[i], 1.5);
      });
      for (const [x, z, side] of [
        ...[225, 275, 325, 370, 415, 445, 475, 500].map((x) => [x, 164, -1]),
        [205, 77, 1], [275, 77, 1], [225, 88, -1], [285, 88, -1]
      ]) {
        const center = p(x, z);
        poster(2, center.x, center.z + side * .025, 1.5 * ratios[1], 1.5);
      }
    }
  }
  return { point, scale, bounds, sites, spawns, rooms, openings, cafeteriaBarricades, cover, findOpening, barrier: 0, build };
});
