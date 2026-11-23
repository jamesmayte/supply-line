// Phase 1 harness: renders sim state (M1.1), turns touch into sim commands (M1.2), run loop UI (M1.3).
// Throwaway: the sim lives in /core and never imports this. Fixed 10 Hz sim tick; the renderer
// interpolates between the last two states. Every player action is a GameInput queued for the next tick.
import { biome1 } from "../content/biome1";
import { RUN_A, RUN_B, type Script } from "../content/scenarios";
import { adviseCards, bestCard, findBottleneck } from "../core/analysis";
import { towerOf, type FactoryNode } from "../core/factory";
import { applyCommands, earlyStartBonus, makeGameCtx, newGame, pickTarget, refundOf, spendable, starsFor, step, upgradeCost, type GameInput, type GameState } from "../core/game";
import { positionAt, tileCentre } from "../core/path";
import type { TileXY } from "../core/placement";
import { createRenderer, effectAlive, ENEMY_STYLE_OF, STATUS_BADGE, type Effect, type Overlay } from "./render";
import { buildOptions, cardNote, costLabel, inspect, nodeAt, nodeName, proposeLink, waveReport, type WaveStats } from "./ui";

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
/** Shots per tower over the last few seconds, for the inspect sheet's measured fire rate. */
let shotHistory: { tick: number; shots: Map<number, number> }[] = [];
/** Cosmetic effects derived from consecutive states (tracers, pops, core hits). */
let effects: Effect[] = [];
/** Numbers for the current / last wave's report. */
let waveStats: WaveStats | null = null;
let lastWave: WaveStats | null = null;

/** Ammo items made so far (assemblers whose recipe makes an ammo item). */
function ammoProduced(s: GameState): number {
  return s.factory.nodes.reduce((a, n) => {
    const r = n.recipeId ? ctx.factory.recipes.get(n.recipeId) : undefined;
    const out = r ? ctx.factory.items.get(r.outputs[0]!.itemId) : undefined;
    return out?.kind === "ammo" ? a + n.produced : a;
  }, 0);
}
const totalShots = (s: GameState) => s.factory.nodes.reduce((a, n) => a + (n.shots ?? 0), 0);
const HISTORY_TICKS = 50; // 5 s

function reset(next: Mode) {
  mode = next;
  cur = prev = newGame(biome1, MAP, 1);
  queued = [];
  acc = 0;
  paused = false;
  shotHistory = [];
  effects = [];
  waveStats = lastWave = null;
  moving = null;
  closeSheet();
  syncButtons();
}

function tick() {
  const input = [...(SCRIPTS[mode][cur.tick] ?? []), ...queued];
  queued = [];
  prev = cur;
  cur = step(cur, input, DT, ctx);
  reportOutcome(cur);
  shotHistory.push({ tick: cur.tick, shots: new Map(cur.factory.nodes.filter((n) => n.towerId).map((n) => [n.id, n.shots ?? 0])) });
  deriveEffects(prev, cur);
  trackWave(prev, cur);
  if (shotHistory.length > HISTORY_TICKS + 1) shotHistory.shift();
}

/** Tracers, hit flashes, death pops and core hits, worked out by comparing two states. Cosmetic only. */
function deriveEffects(a: GameState, b: GameState) {
  const now = performance.now() / 1000;
  const before = new Map(a.factory.nodes.map((n) => [n.id, n]));
  for (const n of b.factory.nodes) {
    const tower = towerOf(ctx.factory, n);
    const fired = (n.shots ?? 0) - (before.get(n.id)?.shots ?? 0);
    if (!tower || fired <= 0) continue;
    const target = pickTarget(ctx, a.enemies, n, tower) ?? pickTarget(ctx, b.enemies, n, tower);
    if (!target) continue;
    const to = positionAt(ctx.path, target.d);
    effects.push({ kind: "tracer", from: tileCentre(n.x, n.y), to, t: now }, { kind: "hit", at: to, t: now });
  }
  const alive = new Set(b.enemies.map((e) => e.id));
  const leaks = b.leaked - a.leaked;
  for (const e of a.enemies) {
    if (alive.has(e.id)) continue;
    const def = ctx.enemies.get(e.enemyId)!;
    if (leaks > 0 && e.d + def.speed * DT >= ctx.path.length - 1e-6) continue; // reached the core
    const st = ENEMY_STYLE_OF(e.enemyId);
    effects.push({ kind: "pop", at: positionAt(ctx.path, e.d), r: st.r, colour: st.colour, t: now });
  }
  if (b.coreHp < a.coreHp) effects.push({ kind: "coreHit", t: now });
}

/** Count what happens during a wave for the between-wave report. */
function trackWave(a: GameState, b: GameState) {
  if (a.phase !== "wave" && b.phase === "wave")
    waveStats = { kills: -a.kills, leaked: -a.leaked, shots: -totalShots(a), ammoMade: -ammoProduced(a), towerTicks: 0, emptyTicks: 0 };
  if (!waveStats) return;
  if (b.enemies.length)
    for (const n of b.factory.nodes)
      if (n.towerId) {
        waveStats.towerTicks++;
        if (n.status === "starved") waveStats.emptyTicks++;
      }
  if (b.phase !== "wave") {
    lastWave = {
      ...waveStats,
      kills: waveStats.kills + b.kills,
      leaked: waveStats.leaked + b.leaked,
      shots: waveStats.shots + totalShots(b),
      ammoMade: waveStats.ammoMade + ammoProduced(b),
    };
    waveStats = null;
  }
}

/** Measured shots/s of a tower over the history window (undefined until there's history). */
function firingRate(id: number): number | undefined {
  const first = shotHistory[0], last = shotHistory.at(-1);
  if (!first || !last || last.tick === first.tick) return undefined;
  return ((last.shots.get(id) ?? 0) - (first.shots.get(id) ?? 0)) / ((last.tick - first.tick) * DT);
}

/** Queue a command for the next tick. While paused, apply it at once without advancing time. */
function send(input: GameInput) {
  if (!paused) {
    queued.push(input);
    return;
  }
  cur = prev = applyCommands(cur, [input], ctx);
  reportOutcome(cur);
}

/* ---------- toast ---------- */
const toastEl = $("toast");
let toastTimer = 0;
/** Swap content ids (iron_ingot) for display names (iron ingot) in sim messages. */
const humanize = (text: string) => text.replace(/\b[a-z]+(?:_[a-z0-9]+)+\b|\b[a-z]+\b/g, (w) => ctx.factory.items.get(w)?.name.toLowerCase() ?? w);
function toast(text: string, ms = 2200) {
  toastEl.textContent = humanize(text);
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), ms);
}

/** After any commands: errors, or links a move had to drop. */
function reportOutcome(s: GameState) {
  if (s.errors.length) toast(s.errors.map((e) => e.replace(/^\w+: /, "")).join(" · "));
  else if (s.dropped.length) toast(`Moved. ${s.dropped.length} link${s.dropped.length > 1 ? "s" : ""} couldn't re-route and ${s.dropped.length > 1 ? "were" : "was"} removed`, 3500);
}

/* ---------- bottom sheet ---------- */
const sheet = $("sheet");
const sheetTitle = $("sheetTitle");
const sheetOpts = $("sheetOpts");
const sheetLines = $("sheetLines");
const sheetExtra = $("sheetExtra");
const sheetProblem = $("sheetProblem");
const sheetCloseBtn = $<HTMLButtonElement>("sheetClose");
sheetCloseBtn.onclick = () => closeSheet();

interface SheetItem { label: string; note?: string; note2?: string; best?: string; disabled?: boolean; danger?: boolean; card?: boolean; run: () => void }
type SheetKind = "build" | "node" | "inspect" | "cards" | "help";
let sheetKind: SheetKind | null = null;
let inspecting: number | null = null;

function openSheet(title: string, items: SheetItem[], tile?: TileXY, kind: SheetKind = "build") {
  sheetKind = kind;
  sheetTitle.textContent = title;
  sheet.classList.toggle("cards", kind === "cards");
  sheetCloseBtn.style.display = kind === "cards" ? "none" : ""; // a card must be picked
  sheetLines.replaceChildren();
  sheetExtra.replaceChildren();
  sheetProblem.style.display = "none";
  sheetOpts.replaceChildren(
    ...items.map((it) => {
      const b = document.createElement("button");
      b.className = `opt${it.danger ? " danger" : ""}${it.card ? " card" : ""}`;
      b.disabled = !!it.disabled;
      b.append(it.label);
      for (const text of [it.note, it.note2]) {
        if (!text) continue;
        const span = document.createElement("span");
        span.textContent = text;
        b.append(span);
      }
      if (it.best) {
        b.classList.add("recommended");
        const tag = document.createElement("span");
        tag.className = "best";
        tag.textContent = it.best;
        b.append(tag);
      }
      b.onclick = () => {
        closeSheet(); // first, so an action may open another sheet
        it.run();
      };
      return b;
    }),
  );
  sheet.classList.add("open");
  overlay = tile ? { tile } : {};
}

function closeSheet() {
  sheet.classList.remove("open");
  sheetKind = null;
  inspecting = null;
  overlay = {};
}

/** Tap a building: live stats, plus the first problem upstream in plain words. */
function openInspect(n: FactoryNode) {
  const items: SheetItem[] = [];
  const b = n.towerId ? undefined : ctx.factory.buildings.get(n.buildingId);
  const lvl = n.level ?? 1;
  const next = b?.upgrades[lvl - 1];
  if (b && next) {
    const cost = upgradeCost(ctx, n);
    const free = cur.upgradeTokens > 0;
    const affordable = free || cost.every((c) => spendable(cur, ctx, c.itemId) >= c.qty - 1e-9);
    items.push({
      label: `Upgrade to tier ${lvl + 1}`,
      note: `×${fmtX(next.speed)} speed · ${free ? `free (${cur.upgradeTokens} token${cur.upgradeTokens > 1 ? "s" : ""})` : costLabel(ctx, cost)}`,
      disabled: !affordable,
      run: () => send({ type: "upgrade", nodeId: n.id }),
    });
  }
  items.push({
    label: "Move",
    note: cur.phase === "wave" ? "only between waves" : "then tap the new spot",
    disabled: cur.phase === "wave",
    run: () => startMove(n),
  });
  items.push({ label: "Remove / unlink…", note: "or hold the building", run: () => openNodeMenu(n) });
  openSheet("", items, n, "inspect");
  inspecting = n.id;
  refreshInspect();
}

const fmtX = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, ""));

/* ---------- move: pick a building, then tap where it goes ---------- */
let moving: FactoryNode | null = null;
function startMove(n: FactoryNode) {
  moving = n;
  overlay = { tile: n };
  toast(`Moving ${nodeName(ctx, n)}: tap an empty tile (tap it again to cancel)`, 4000);
}
function finishMove(t: TileXY) {
  const n = moving!;
  moving = null;
  overlay = {};
  if (t.x === n.x && t.y === n.y) return toast("Move cancelled");
  toast(`Moved ${nodeName(ctx, n)}`); // replaced by the reason if the sim refuses it
  send({ type: "move", nodeId: n.id, x: t.x, y: t.y });
}

function refreshInspect() {
  const n = cur.factory.nodes.find((x) => x.id === inspecting);
  if (!n) return closeSheet();
  const info = inspect(ctx, cur, n, n.towerId ? firingRate(n.id) : undefined);
  sheetTitle.textContent = info.title;
  sheetLines.replaceChildren(
    ...info.lines.flatMap((l) => {
      const a = document.createElement("span");
      a.textContent = l.label;
      const b = document.createElement("b");
      b.textContent = l.value;
      if (l.tone) b.className = l.tone;
      return [a, b];
    }),
  );
  sheetProblem.style.display = info.problem ? "block" : "none";
  sheetProblem.textContent = info.problem ? humanize(info.problem) : "";
}

/** After a wave: what happened, what's holding ammo back, and what each card would do for this factory. */
function openCardPick() {
  const offer = cur.cardOffer ?? [];
  const bottleneck = findBottleneck(cur.factory, ctx.factory);
  const advice = adviseCards(cur, ctx, offer);
  const best = bestCard(advice);
  openSheet(
    `Wave ${cur.waveIndex} cleared: pick a card`,
    offer.map((id) => {
      const c = ctx.cards.get(id)!;
      const a = advice.find((x) => x.cardId === id)!;
      return { label: c.name, note: c.text, note2: cardNote(a, ctx, cur), best: id === best ? "Best for you" : undefined, card: true, run: () => send({ type: "pickCard", cardId: id }) };
    }),
    undefined,
    "cards",
  );
  if (lastWave) {
    const r = waveReport(ctx, lastWave, bottleneck);
    const box = document.createElement("div");
    box.className = "report";
    for (const l of r.lines) {
      const a = document.createElement("span");
      a.textContent = l.label;
      const b = document.createElement("b");
      b.textContent = l.value;
      if (l.tone) b.className = l.tone;
      box.append(a, b);
    }
    const tip = document.createElement("div");
    tip.className = "wide";
    tip.textContent = humanize(r.advice);
    box.append(tip);
    sheetExtra.replaceChildren(box);
  }
}

/** "?" button (and first visit): how to play + what the symbols mean. */
function openHelp() {
  openSheet("How to play", [], undefined, "help");
  const steps = document.createElement("ol");
  steps.className = "howto";
  for (const t of [
    "Tap an empty tile to build. Extractors go on ore (blue = iron, dark = coal).",
    "Drag from one building to another to link them: ore → Smelter → Assembler → Gunner.",
    "Smelters and Assemblers need power: a Generator (P) fed with coal, within 3 tiles.",
    "Gunners only shoot while they have bullets. Tap any building to see what it's doing and what's holding it back.",
    "Start wave when ready. After each wave, pick a card: the report tells you which one helps most.",
  ]) {
    const li = document.createElement("li");
    li.textContent = t;
    steps.append(li);
  }
  const legend = document.createElement("div");
  legend.className = "legend";
  for (const st of Object.values(STATUS_BADGE)) {
    const i = document.createElement("i");
    i.textContent = st.symbol;
    i.style.background = st.colour;
    const t = document.createElement("span");
    t.textContent = st.label;
    legend.append(i, t);
  }
  const key = (symbol: string, colour: string, text: string) => {
    const k = document.createElement("span");
    k.className = "key";
    k.textContent = symbol;
    k.style.color = colour;
    const t = document.createElement("span");
    t.textContent = text;
    legend.append(k, t);
  };
  const ring = document.createElement("span");
  ring.className = "key";
  ring.innerHTML = '<span style="display:inline-block;width:16px;height:16px;border-radius:50%;border:3px solid #f2c14e;box-sizing:border-box"></span>';
  const ringText = document.createElement("span");
  ringText.textContent = "Gunner ring and number: rounds in the magazine. Flashing red = empty, it can't shoot.";
  legend.append(ring, ringText);
  key("•••", "#f2c14e", "Moving dots on a link: items flowing. More dots, faster = more per second.");
  sheetExtra.replaceChildren(steps, legend);
}
$("help").onclick = () => (sheetKind === "help" ? closeSheet() : openHelp());

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
    {
      label: "Remove",
      note: refundOf(cur, ctx, n).length ? `refund ${costLabel(ctx, refundOf(cur, ctx, n).map((c) => ({ ...c, qty: Math.floor(c.qty + 1e-9) })))}` : "free",
      danger: true,
      run: () => send({ type: "remove", nodeId: n.id }),
    },
    ...links.map((l) => {
      const other = byId.get(l.from === n.id ? l.to : l.from)!;
      const dir = l.from === n.id ? "→" : "←";
      const item = ctx.factory.items.get(l.itemId)?.name.toLowerCase() ?? l.itemId;
      return { label: `Unlink ${dir} ${nodeName(ctx, other)}`, note: `${item}, tier ${l.tier}`, run: () => send({ type: "unlink", linkId: l.id }) };
    }),
  ];
  openSheet(nodeName(ctx, n), items, n, "node");
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
  if (moving) {
    finishMove(g.start);
    return;
  }
  if (g.node) {
    openInspect(g.node);
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
const result = { el: $("result"), title: $("resultTitle"), stars: $("resultStars"), text: $("resultText") };
$("restart").onclick = () => reset(mode);
let lastInspectRefresh = 0;
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
  const pending = queued.some((q) => q.type === "startWave");
  buttons.start.disabled = cur.phase !== "build" || pending || !!cur.cardOffer;
  const bonus = cur.phase === "build" ? earlyStartBonus(cur, ctx).qty : 0;
  buttons.start.textContent = bonus > 0 ? `Start wave +${bonus}` : "Start wave";

  // a card must be picked before the next wave
  const picking = queued.some((q) => q.type === "pickCard"); // tapped, applied on the next tick
  if (cur.cardOffer && cur.phase === "build" && sheetKind !== "cards" && !picking) openCardPick();

  const over = cur.phase === "won" || cur.phase === "lost";
  result.el.classList.toggle("show", over);
  if (over) {
    const stars = starsFor(cur, ctx, map.coreHp);
    result.title.textContent = cur.phase === "won" ? "Map cleared" : "Core destroyed";
    result.title.style.color = cur.phase === "won" ? "#7fd48a" : "#e0574a";
    result.stars.textContent = cur.phase === "won" ? "★".repeat(stars) + "☆".repeat(3 - stars) : "";
    const cleared = cur.phase === "won" ? map.waves.length : cur.waveIndex;
    result.text.textContent = `Waves cleared ${cleared}/${map.waves.length} · kills ${cur.kills} · core ${Math.ceil(cur.coreHp)}/${map.coreHp}`;
  }
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
  const t = now / 1000;
  effects = effects.filter((e) => effectAlive(e, t));
  renderer.draw(prev, cur, paused ? 1 : acc / DT, t, overlay, effects);
  syncHud();
  if (sheetKind === "inspect" && now - lastInspectRefresh > 400) {
    lastInspectRefresh = now;
    refreshInspect();
  }
  requestAnimationFrame(frame);
}

window.addEventListener("resize", () => renderer.resize());
reset("empty");
try {
  if (!localStorage.getItem("sl.seenHelp")) {
    openHelp();
    localStorage.setItem("sl.seenHelp", "1");
  }
} catch {
  /* storage unavailable: just don't auto-open */
}
requestAnimationFrame(frame);

// Debug handle for poking at state from the console.
(window as unknown as { sl: unknown }).sl = { get state() { return cur; }, get effects() { return effects; }, ctx, send };
