// Placeholder harness: draws map 1 from content so the Pages deploy has something real to show.
// Replaced in M1.1 by a renderer that reads sim state.
import { biome1 } from "../content/biome1";

const map = biome1.maps[0]!;
const colours: Record<string, string> = {
  ".": "#23262c", "#": "#3a3d44", S: "#6b4f2a", P: "#8a6a3a", B: "#b08a4a", X: "#c0453a",
  I: "#5f7d99", C: "#2b2b2b", U: "#b0703a", Y: "#7a5fb0",
};

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const dpr = window.devicePixelRatio || 1;
const cssW = Math.min(window.innerWidth, 480);
const tile = cssW / map.width;
canvas.style.height = `${tile * map.rows.length}px`;
canvas.width = cssW * dpr;
canvas.height = tile * map.rows.length * dpr;
ctx.scale(dpr, dpr);

map.rows.forEach((row, y) =>
  [...row].forEach((ch, x) => {
    ctx.fillStyle = colours[ch] ?? "#ff00ff";
    ctx.fillRect(x * tile + 1, y * tile + 1, tile - 2, tile - 2);
  }),
);
