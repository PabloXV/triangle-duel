// The backdrop: a dark wall (docs/visual-language.md §10). A gradient in
// screen space; faint brick courses and spray speckle locked to the world.

import type { CameraView } from "../camera";
import { INK, WALL, withAlpha } from "../theme";
import { fillTexture } from "./texture";

const COURSE = 1.32; // brick course height, m
const BRICK = 2.8; // brick width, m

/** `scale` = screen pixels per meter (for 2 px brick lines at any zoom). */
export function drawWall(ctx: CanvasRenderingContext2D, cam: CameraView, scale: number) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
  g.addColorStop(0, WALL.top);
  g.addColorStop(1, WALL.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();

  const x0 = cam.center.x - cam.width;
  const x1 = cam.center.x + cam.width;
  const y0 = cam.center.y - cam.height;
  const y1 = cam.center.y + cam.height;
  ctx.save();
  ctx.lineWidth = 2 / scale;
  ctx.strokeStyle = withAlpha(INK, 0.14);
  ctx.beginPath();
  for (let y = Math.floor(y0 / COURSE) * COURSE; y < y1; y += COURSE) {
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.stroke();
  ctx.strokeStyle = withAlpha(INK, 0.1);
  ctx.beginPath();
  for (let y = Math.floor(y0 / COURSE) * COURSE; y < y1; y += COURSE) {
    const offset = Math.round(y / COURSE) % 2 ? 0 : BRICK / 2;
    for (let x = Math.floor((x0 - offset) / BRICK) * BRICK + offset; x < x1; x += BRICK) {
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + COURSE);
    }
  }
  ctx.stroke();
  ctx.restore();

  const world = ctx.getTransform();
  fillTexture(ctx, "speckLight", world, 0.45);
  fillTexture(ctx, "speckDark", world, 0.55);
}
