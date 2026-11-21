// Phase 1 harness, M1.1: renders sim state. Throwaway: the sim lives in /core and never imports this.
// Fixed 10 Hz sim tick; the renderer interpolates between the last two states.
// Input until M1.2: demo scripts (the M0.6 interlock builds) plus Start wave / Pause / speed buttons.
import { biome1 } from "../content/biome1";
import { RUN_A, RUN_B, type Script } from "../content/scenarios";
import { makeGameCtx, newGame, step, type GameInput, type GameState } from "../core/game";
import { createRenderer } from "./render";

const MAP = "scrapyard_1";
const DT = 0.1; // seconds per sim tick (10 Hz)
const MAX_STEPS_PER_FRAME = 20; // after a long stall, skip ahead rather than spiral

const ctx = makeGameCtx(biome1, MAP);
const map = biome1.maps.find((m) => m.id === MAP)!;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("game");
const renderer = createRenderer(canvas, ctx, map);

let demo: "A" | "B" = "B";
let script: Script = RUN_B;
let prev: GameState;
let cur: GameState;
let queued: GameInput[] = [];
let acc = 0;
let paused = false;
let speed = 1;

function reset(which: "A" | "B") {
  demo = which;
  script = which === "A" ? RUN_A : RUN_B;
  cur = prev = newGame(biome1, MAP, 1);
  queued = [];
  acc = 0;
  paused = false;
  syncButtons();
}

function tick() {
  const input = [...(script[cur.tick] ?? []), ...queued];
  queued = [];
  prev = cur;
  cur = step(cur, input, DT, ctx);
  if (cur.errors.length) console.warn(`tick ${cur.tick}:`, cur.errors.join("; "));
}

/* ---------- HUD ---------- */
const hud = { wave: $("wave"), core: $("core"), ingots: $("ingots"), kills: $("kills"), next: $("next") };
const banner = $("banner");
const buttons = {
  A: $<HTMLButtonElement>("demoA"),
  B: $<HTMLButtonElement>("demoB"),
  start: $<HTMLButtonElement>("start"),
  pause: $<HTMLButtonElement>("pause"),
  speed: $<HTMLButtonElement>("speed"),
};

function waveSummary(index: number): string {
  const wave = map.waves[index];
  if (!wave) return "";
  const counts = new Map<string, number>();
  for (const g of wave.groups) counts.set(g.enemyId, (counts.get(g.enemyId) ?? 0) + g.count);
  return [...counts].map(([id, n]) => `${n} ${biome1.enemies.find((e) => e.id === id)?.name.toLowerCase() ?? id}`).join(", ");
}

function syncHud() {
  const total = map.waves.length;
  hud.wave.textContent = `${Math.min(cur.waveIndex + 1, total)}/${total}`;
  hud.core.textContent = String(Math.ceil(cur.coreHp));
  hud.ingots.textContent = String(Math.floor((cur.stock.iron_ingot ?? 0) + 1e-9));
  hud.kills.textContent = String(cur.kills);
  hud.next.textContent =
    cur.phase === "build" ? `Next: ${waveSummary(cur.waveIndex)}` : cur.phase === "wave" ? `Now: ${waveSummary(cur.waveIndex)}` : "";
  buttons.start.disabled = cur.phase !== "build" || queued.some((q) => q.type === "startWave");
  const over = cur.phase === "won" || cur.phase === "lost";
  banner.style.display = over ? "flex" : "none";
  banner.textContent = cur.phase === "won" ? "Won" : cur.phase === "lost" ? "Core destroyed" : "";
  banner.style.color = cur.phase === "won" ? "#7fd48a" : "#e0574a";
}

function syncButtons() {
  buttons.A.classList.toggle("on", demo === "A");
  buttons.B.classList.toggle("on", demo === "B");
  buttons.pause.textContent = paused ? "Play" : "Pause";
  buttons.pause.classList.toggle("on", paused);
  buttons.speed.textContent = `${speed}×`;
}

buttons.A.onclick = () => reset("A");
buttons.B.onclick = () => reset("B");
buttons.start.onclick = () => {
  if (cur.phase === "build") queued.push({ type: "startWave" });
};
buttons.pause.onclick = () => {
  paused = !paused;
  syncButtons();
};
buttons.speed.onclick = () => {
  speed = speed === 1 ? 2 : 1;
  syncButtons();
};

// CLAUDE.md invariant 5: no idle/offline simulation. Backgrounded = paused; we don't catch up on return.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    paused = true;
    syncButtons();
  }
});

/* ---------- loop ---------- */
let last = performance.now();
function frame(now: number) {
  const real = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (!paused) {
    acc += real * speed;
    let n = 0;
    while (acc >= DT && n++ < MAX_STEPS_PER_FRAME) {
      tick();
      acc -= DT;
    }
    if (n >= MAX_STEPS_PER_FRAME) acc = 0;
  }
  renderer.draw(prev, cur, paused ? 1 : acc / DT, now / 1000);
  syncHud();
  requestAnimationFrame(frame);
}

window.addEventListener("resize", () => renderer.resize());
reset("B");
requestAnimationFrame(frame);

// Debug handle for poking at state from the console.
(window as unknown as { sl: unknown }).sl = { get state() { return cur; }, ctx };
