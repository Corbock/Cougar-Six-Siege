(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GameMinimap = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  function create(canvas, bounds, colliders) {
    const ctx = canvas.getContext("2d");
    const background = document.createElement("canvas");
    background.width = canvas.width;
    background.height = canvas.height;
    const base = background.getContext("2d");
    const padding = 8;
    const scale = Math.min((canvas.width - 2 * padding) / (bounds.x1 - bounds.x0),
      (canvas.height - 2 * padding) / (bounds.z1 - bounds.z0));
    const left = (canvas.width - (bounds.x1 - bounds.x0) * scale) / 2;
    const top = (canvas.height - (bounds.z1 - bounds.z0) * scale) / 2;
    const project = (point) => [left + (bounds.x1 - point.x) * scale, top + (point.z - bounds.z0) * scale];
    base.fillStyle = "#141a18";
    base.fillRect(0, 0, canvas.width, canvas.height);
    base.fillStyle = "#555d56";
    base.fillRect(left, top, (bounds.x1 - bounds.x0) * scale, (bounds.z1 - bounds.z0) * scale);
    base.fillStyle = "#b4b8aa";
    colliders.forEach((box) => {
      if (box.y0 >= 1.5 || box.y1 <= .7) return;
      const x0 = Math.max(bounds.x0, box.x0), x1 = Math.min(bounds.x1, box.x1);
      const z0 = Math.max(bounds.z0, box.z0), z1 = Math.min(bounds.z1, box.z1);
      if (x1 <= x0 || z1 <= z0) return;
      const [x, z] = project({ x: x1, z: z0 });
      base.fillRect(x, z, Math.max(1, (x1 - x0) * scale), Math.max(1, (z1 - z0) * scale));
    });

    function marker(point, color, shape) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return;
      if (point.x < bounds.x0 || point.x > bounds.x1 || point.z < bounds.z0 || point.z > bounds.z1) return;
      const [x, z] = project(point);
      ctx.save();
      ctx.translate(x, z);
      ctx.fillStyle = color;
      ctx.strokeStyle = "#111713";
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (shape === "arrow") {
        ctx.rotate(Number.isFinite(point.yaw) ? point.yaw : 0);
        ctx.moveTo(0, 8); ctx.lineTo(-5, -6); ctx.lineTo(0, -3); ctx.lineTo(5, -6);
      } else if (shape === "objective") {
        ctx.moveTo(0, -7); ctx.lineTo(7, 0); ctx.lineTo(0, 7); ctx.lineTo(-7, 0);
      } else if (shape === "spawn") {
        ctx.rect(-5, -5, 10, 10);
      } else {
        ctx.arc(0, 0, shape === "drone" ? 4 : 5, 0, Math.PI * 2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    return {
      draw({ player, drone, spawn, teammates, objectives }) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(background, 0, 0);
        marker(spawn, "#64b6ff", "spawn");
        objectives.forEach((objective) => {
          if (objective.kind === "hostage" && !objective.alive) return;
          marker(objective, objective.armed ? "#ff7866" : "#ffd75b", "objective");
        });
        teammates.forEach((teammate) => marker(teammate, "#67d68c", "teammate"));
        marker(player, "#ffffff", "arrow");
        marker(drone, "#65e4ef", "drone");
      }
    };
  }
  return { create };
});
