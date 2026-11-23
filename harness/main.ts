// Phase 1 harness: renders sim state (M1.1) and turns touch into sim commands (M1.2).
// Throwaway: the sim lives in /core and never imports this. Fixed 10 Hz sim tick; the renderer
// interpolates between the last two states. Every player action is a GameInput queued for the next tick.
import { biome1 } from "../content/biome1";
import { RUN_A, RUN_B, type Script } from "../content/scenarios";
import type { FactoryNode } from "../core/factory";
import { applyCommands, makeGameCtx, newGame, spendable, step, type GameInput, type GameState } from "../core/game";
import type { TileXY } from "../core/placement";
import { createRenderer, type Overlay } from "./render";
import { buildOptions, costLabel, nodeAt, nodeName, proposeLink } from "./ui";

const MAP = "scrapyard_1";
const DT = 0.1; // seconds per sim tick (10 Hz)
const MAX_STEPS_PER_FRAME = 20; // after a long stall, skip ahead rather than spiral
const LONG_PRESS_MS = 450;

const ctx = makeGameCtx(biome1, MAP);
const map = biome1.maps.find((m) => m.id === MAP)!;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("game");
const renderer = createRenderer(canvas, ctx, map);

type Mode = "empty" | "A" | "B";
const SCRIPTS: Record<Mode, Script> = { empty: {}, A: RUN_A, B: RUN_B };

let mode: Mode = "empty";
let prev: GameState;
let cur: GameState;
let queued: GameInput[] = [];
let acc = 0;
let paused = false;
let speed = 1;
let overlay: Overlay = {};

function reset(next: Mode) {
  mode = next;
  cur = prev = newGame(biome1, MAP, 1);
  queued = [];
  acc = 0;
  paused = false;
  closeSheet();
  syncButtons();
}

function tick() {
  const input = [...(SCRIPTS[mode][cur.tick] ?? []), ...queued];
  queued = [];
  prev = cur;
  cur = step(cur, input, DT, ctx);
  if (cur.errors.length) toast(cur.errors.map((e) => e.replace(/^\w+: /, "")).join(" · "));
}

/** Queue a command for the next tick. While paused, apply it at once without advancing time. */
function send(input: GameInput) {
  if (!paused) {
    queued.push(input);
    return;
  }
  cur = prev = applyCommands(cur, [input], ctx);
  if (cur.errors.length) toast(cur.errors.map((e) => e.replace(/^\w+: /, "")).join(" · "));
}

/* ---------- toast ---------- */
const toastEl = $("toast");
let toastTimer = 0;
/** Swap content ids (iron_ingot) for display names (iron ingot) in sim messages. */
const humanize = (text: string) => text.replace(/\b[a-z]+(?:_[a-z0-9]+)+\b|\b[a-z]+\b/g, (w) => ctx.factory.items.get(w)?.name.toLowerCase() ?? w);
function toast(text: string) {
  toastEl.textContent = humanize(text);
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 2200);
}

/* ---------- bottom sheet ---------- */
const sheet = $("sheet");
const sheetTitle = $("sheetTitle");
const sheetOpts = $("sheetOpts");
$("sheetClose").onclick = () => closeSheet();

interface SheetItem { label: string; note?: string; disabled?: boolean; danger?: boolean; run: () => void }

function openSheet(title: string, items: SheetItem[], tile?: TileXY) {
  sheetTitle.textContent = title;
  sheetOpts.replaceChildren(
    ...items.map((it) => {
      const b = document.createElement("button");
      b.className = `opt${it.danger ? " danger" : ""}`;
      b.disabled = !!it.disabled;
      b.append(it.label);
      if (it.note) {
        const span = document.createElement("span");
        span.textContent = it.note;
        b.append(span);
      }
      b.onclick = () => {
        it.run();
        closeSheet();
      };
      return b;
    }),
  );
  sheet.classList.add("open");
  overlay = tile ? { tile } : {};
}

function closeSheet() {
  sheet.classList.remove("open");
  overlay = {};
}

function openBuildMenu(t: TileXY) {
  const opts = buildOptions(ctx, cur, t.x, t.y);
  if (!opts.length) {
    closeSheet();
    return;
  }
  openSheet(
    "Build",
    opts.map((o) => ({
      label: o.label,
      note: o.affordable ? costLabel(ctx, o.cost) : `${costLabel(ctx, o.cost)} · can't afford`,
      disabled: !o.affordable,
      run: () => send(o.input),
    })),
    t,
  );
}

function openNodeMenu(n: FactoryNode) {
  const byId = new Map(cur.factory.nodes.map((x) => [x.id, x]));
  const links = cur.factory.links.filter((l) => l.from === n.id || l.to === n.id);
  const items: SheetItem[] = [
    { label: "Remove", note: "no refund", danger: true, run: () => send({ type: "remove", nodeId: n.id }) },
    ...links.map((l) => {
      const other = byId.get(l.from === n.id ? l.to : l.from)!;
      const dir = l.from === n.id ? "→" : "←";
      const item = ctx.factory.items.get(l.itemId)?.name.toLowerCase() ?? l.itemId;
      return { label: `Unlink ${dir} ${nodeName(ctx, other)}`, note: `${item}, tier ${l.tier}`, run: () => send({ type: "unlink", linkId: l.id }) };
    }),
  ];
  openSheet(nodeName(ctx, n), items, n);
}

/* ---------- touch: tap = build menu, drag node→node = link, long-press node = remove/unlink ---------- */
interface Gesture { id: number; start: TileXY; node?: FactoryNode; dragging: boolean; longPressed: boolean; timer: number }
let gesture: Gesture | null = null;

canvas.addEventListener("pointerdown", (e) => {
  if (gesture) return; // one finger at a time
  const t = renderer.tileAt(e.clientX, e.clientY);
  if (!t) return;
  canvas.setPointerCapture(e.pointerId);
  const node = nodeAt(cur, t.x, t.y);
  const g: Gesture = { id: e.pointerId, start: t, node, dragging: false, longPressed: false, timer: 0 };
  if (node)
    g.timer = window.setTimeout(() => {
      if (!g.dragging && gesture === g) {
        g.longPressed = true;
        navigator.vibrate?.(15);
        openNodeMenu(node);
      }
    }, LONG_PRESS_MS);
  gesture = g;
});

canvas.addEventListener("pointermove", (e) => {
  const g = gesture;
  if (!g || e.pointerId !== g.id || !g.node || g.longPressed) return;
  const t = renderer.tileAt(e.clientX, e.clientY);
  if (!g.dragging && t && (t.x !== g.start.x || t.y !== g.start.y)) {
    g.dragging = true;
    clearTimeout(g.timer);
    closeSheet();
  }
  if (!g.dragging) return;
  const target = t ? nodeAt(cur, t.x, t.y) : undefined;
  const end = renderer.pointAt(e.clientX, e.clientY);
  if (target && target.id !== g.node.id) {
    const p = proposeLink(ctx, cur, g.node, target);
    overlay = { drag: { route: p.route, ok: p.ok, end } };
  } else overlay = { drag: { route: [g.start, ...(t ? [t] : [])], ok: false, end } };
});

function endGesture(e: PointerEvent, cancelled: boolean) {
  const g = gesture;
  if (!g || e.pointerId !== g.id) return;
  gesture = null;
  clearTimeout(g.timer);
  if (cancelled || g.longPressed) return;
  const t = renderer.tileAt(e.clientX, e.clientY);
  if (g.dragging) {
    overlay = {};
    const target = t ? nodeAt(cur, t.x, t.y) : undefined;
    if (!target || target.id === g.node!.id) return;
    const p = proposeLink(ctx, cur, g.node!, target);
    if (p.ok) send(p.input);
    else toast(`Can't link: ${p.reason}`);
    return;
  }
  // a tap
  if (g.node) {
    toast(`${nodeName(ctx, g.node)}: drag to another building to link, hold to remove`);
    return;
  }
  if (sheet.classList.contains("open")) closeSheet();
  else openBuildMenu(g.start);
}
canvas.addEventListener("pointerup", (e) => endGesture(e, false));
canvas.addEventListener("pointercancel", (e) => endGesture(e, true));
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

/* ---------- HUD ---------- */
const hud = { wave: $("wave"), core: $("core"), ingots: $("ingots"), kills: $("kills"), next: $("next") };
const banner = $("banner");
const buttons = {
  empty: $<HTMLButtonElement>("demoEmpty"),
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
  hud.ingots.textContent = String(Math.floor(spendable(cur, ctx, "iron_ingot") + 1e-9)); // stockpile + hubs
  hud.kills.textContent = String(cur.kills);
  hud.next.textContent =
    cur.phase === "build" ? `Next: ${waveSummary(cur.waveIndex)}` : cur.phase === "wave" ? `Now: ${waveSummary(cur.waveIndex)}` : "";
  buttons.start.disabled = cur.phase !== "build" || queued.some((q) => q.type === "startWave");
  banner.style.display = cur.phase === "won" || cur.phase === "lost" ? "flex" : "none";
  banner.textContent = cur.phase === "won" ? "Won" : cur.phase === "lost" ? "Core destroyed" : "";
  banner.style.color = cur.phase === "won" ? "#7fd48a" : "#e0574a";
}

function syncButtons() {
  buttons.empty.classList.toggle("on", mode === "empty");
  buttons.A.classList.toggle("on", mode === "A");
  buttons.B.classList.toggle("on", mode === "B");
  buttons.pause.textContent = paused ? "Play" : "Pause";
  buttons.pause.classList.toggle("on", paused);
  buttons.speed.textContent = `${speed}×`;
}

buttons.empty.onclick = () => reset("empty");
buttons.A.onclick = () => reset("A");
buttons.B.onclick = () => reset("B");
buttons.start.onclick = () => {
  if (cur.phase === "build") send({ type: "startWave" });
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
  renderer.draw(prev, cur, paused ? 1 : acc / DT, now / 1000, overlay);
  syncHud();
  requestAnimationFrame(frame);
}

window.addEventListener("resize", () => renderer.resize());
reset("empty");
requestAnimationFrame(frame);

// Debug handle for poking at state from the console.
(window as unknown as { sl: unknown }).sl = { get state() { return cur; }, ctx, send };
