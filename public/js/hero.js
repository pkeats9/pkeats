// Start screen: the living food wall, the order form (delivery/pickup, address with suggestions), the live status
// line, the full-screen "finding the good stuff" sequence, and the small delights (welcome back, the fortune cookie).
import { $, $$, esc, cash, store, sleep } from "./dom.js";
import { state, rememberStores } from "./state.js";
import { api } from "./api.js";
import { animate, cancel, EASE, shake, spinner, wiggle, rise, segmented, reduced, bounce, drawOn, roll, onScroll, finePointer, burst } from "./motion.js";
import { icon } from "./icons.js";
import { toast } from "./toast.js";
import { go, onScreen } from "./nav.js";
import * as browse from "./browse.js";
import { syncCartBar, openLookup } from "./cart.js";
import { syncChrome } from "./chrome.js";

const IMG = "https://wonder-image.wonder.com/image/origin/product/";
// Wonder's own dish photography (studio shots, ~50 KB each), arranged so colours alternate down every column.
const WALL = [
  ["a3728cf2-22c2-4b27-993e-e04e7d5b460c", "01a0b04f-7d86-7a41-b1a5-653378e7376d", "5bca5c8c-bd5b-49c5-aadf-c5a4a3bb54ac", "50f50bde-70f0-42cc-b74c-49c64df90fa9",
    "01a0ce68-8c0c-7606-b5b7-3dc73532f697", "f9377a09-19a5-44ee-935b-7d8cebb0d820", "01a1180b-438b-7b22-912e-2374c1ee6090", "ae26d2f7-b7c9-488a-b29a-7e98a18c492b"],
  ["01a0b04d-c9cf-7249-a801-211f2ae99bc9", "019fae3a-b8aa-7120-b273-35c6f46396ee", "5de8143a-e2a1-4a54-97d7-14fd6f1a25b7", "dee6a845-c529-4521-b8e8-10ed109252a2",
    "01a0b01e-32ef-7b9b-b746-5b3fd22dead7", "651a1f42-05aa-4265-9e68-b573fda5083d", "4bc1814a-5486-40d6-bf7e-421ee91702dc", "5f5299a2-16c6-4e10-87c7-29b528e7ff85"],
  ["03a79eb2-6bb0-4216-ad04-07bab01c24f5", "01a0b011-f9de-7c9f-99d8-e4e609d17fce", "be3848e3-609d-418d-9e26-8f96af42f28f", "84c617f7-2ecf-4e3f-9dff-d18be49d5ed4",
    "01a0b011-4013-7ead-94fe-278dfbaf05c2", "5614b977-7b88-4eb1-aa92-77c42c5c4edd", "e742915a-acf6-43b4-8013-9c9c0a9efc51", "01a0b039-5332-7918-abf6-d9196fe7ee93"],
];
const ALL_DISHES = WALL.flat();
const DURATIONS = [96, 122, 108];

const form = $("#orderForm"), input = $("#addrInput"), pill = $("#addrPill"), sug = $("#addrSuggest");
const findBtns = [$("#findBtn"), $("#findBtnSm")];
let seg, busy = false;

const tiles = (ids, lazyFrom = Infinity) => [...ids, ...ids].map((id, i) =>
  `<div class="wall-tile"><img src="${IMG}${id}.jpg" alt="" decoding="async" fetchpriority="low"${i >= lazyFrom ? ' loading="lazy"' : ""}></div>`).join("");
function wireImages(root, onFirst) {
  let n = 0;
  $$("img", root).forEach((img, i) => {
    const done = () => { img.classList.add("loaded"); if (++n === 4) onFirst?.(); };
    if (img.complete && img.naturalWidth) done(); else img.addEventListener("load", done, { once: true });
    img.addEventListener("error", () => { if (!img.dataset.retried) { img.dataset.retried = "1"; img.src = `${IMG}${ALL_DISHES[(i * 7 + 3) % ALL_DISHES.length]}.jpg`; } });
  });
}

/* ── the wall: drifts slowly, leans toward the pointer, and parts as you scroll ── */
const narrow = matchMedia("(max-width: 1068px)");
let cols = [];
function buildWall() {
  const wall = $("#wall");
  const sets = narrow.matches ? WALL.slice(0, 2) : WALL;
  wall.classList.remove("ready");
  wall.innerHTML = sets.map((ids, c) => `<div class="wall-col"><div class="wall-track" style="--dur:${DURATIONS[c]}s">${tiles(ids, ids.length)}</div></div>`).join("");
  cols = $$(".wall-col", wall);
  wireImages(wall, () => wall.classList.add("ready"));
  setTimeout(() => wall.classList.add("ready"), 1400);
}
function wireWall() {
  buildWall();
  narrow.addEventListener("change", buildWall);
  const wall = $("#wall");
  let visible = true;
  const sync = () => wall.classList.toggle("paused", !visible || document.hidden || state.screen !== "start");
  if ("IntersectionObserver" in window) new IntersectionObserver((e) => { visible = e[0].isIntersecting; sync(); }).observe($("#hero"));
  document.addEventListener("visibilitychange", sync);
  onScreen(sync);
  if (reduced.matches) return;
  // depth: each column answers the pointer and the scroll a little differently
  const PTR = [16, 30, 22], SCR = [-.10, .07, -.16];
  let px = 0, py = 0, tx = 0, ty = 0, sy = 0, raf = 0;
  const paint = () => {
    raf = 0;
    px += (tx - px) * .07; py += (ty - py) * .07;
    cols.forEach((c, i) => {
      if (narrow.matches) c.style.translate = `${(i % 2 ? 1 : -1) * Math.min(sy, 900) * .12}px 0px`;
      else c.style.translate = `${(px * PTR[i]).toFixed(2)}px ${(py * PTR[i] + Math.min(sy, 1200) * SCR[i]).toFixed(2)}px`;
    });
    if (Math.abs(tx - px) > .002 || Math.abs(ty - py) > .002) raf = requestAnimationFrame(paint);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(paint); };
  if (finePointer.matches) addEventListener("pointermove", (e) => { if (state.screen !== "start") return; tx = e.clientX / innerWidth - .5; ty = e.clientY / innerHeight - .5; kick(); }, { passive: true });
  onScroll((y) => { if (state.screen !== "start") return; sy = y; kick(); });
}

/* ── order type ───────────────────────────────────────────────────── */
function setDining(dining) {
  state.dining = dining;
  const note = $("#pickupNote"), was = !note.hidden;
  note.hidden = dining !== "PICKUP";
  if (!note.hidden && !was) rise(note, { y: 6, blur: 2, duration: 360 });
  input.placeholder = dining === "PICKUP" ? "Enter your address to find stores" : "Enter your delivery address";
  input.setAttribute("aria-label", dining === "PICKUP" ? "Your address" : "Delivery address");
}
/** Config can restrict ordering to pickup or delivery only. */
export function applyFulfillment(config) {
  const only = ["pickup", "delivery"].includes(config?.fulfillment) ? config.fulfillment.toUpperCase() : null;
  $$(".seg-opt", $("#diningSeg")).forEach((b) => { b.disabled = busy || (!!only && b.dataset.dining !== only); });
  if (only && state.dining !== only && state.screen === "start") {
    seg.select($(`[data-dining="${only}"]`, $("#diningSeg")), false);
    setDining(only);
  }
}

/** The live availability line under the form. */
export function setLive(config, failed = false) {
  const dot = $("#liveLine .dot"), text = $("#liveText");
  const next = failed ? ["dot off", "Check back shortly for ordering availability"]
    : !config.online ? ["dot warn", "Ordering is reconnecting · browse while you wait"]
    : !config.open ? ["dot off", "Ordering is closed right now · check back soon"]
    : ["dot live", `Ordering open${config.minimumTotalCents ? ` · ${cash(config.minimumTotalCents)} minimum` : ""}`];
  if (text.textContent === next[1]) return;
  dot.className = next[0];
  text.textContent = next[1];
  rise($("#liveLine"), { y: 4, duration: 420, key: "live" });
}

/* ── address suggestions (combobox) ───────────────────────────────── */
let acTimer = 0, acRequest = 0, active = -1;
const acCache = new Map();
const focused = (q) => input.value.trim() === q && state.screen === "start" && !input.readOnly && document.activeElement === input;
function openSuggest(preds) {
  if (!preds?.length) return closeSuggest();
  active = -1;
  sug.innerHTML = preds.map((p, i) => `<div class="sug-item" role="option" id="sug-${i}" aria-selected="false" data-v="${esc(p.description)}" style="--i:${i}">${icon("pin")}<span class="sug-txt"><b>${esc(p.main || p.description)}</b>${p.secondary ? `<small>${esc(p.secondary)}</small>` : ""}</span></div>`).join("");
  const wasHidden = sug.hidden;
  sug.hidden = false;
  input.setAttribute("aria-expanded", "true");
  if (wasHidden && !reduced.matches) {
    animate(sug, [{ opacity: 0, transform: "translateY(-6px) scale(.97)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }], { duration: 320, easing: EASE.out, key: "pop" });
    $$(".sug-item", sug).forEach((n, i) => animate(n, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 360, delay: 40 + i * 35, key: "in" }));
  }
}
function closeSuggest() {
  if (sug.hidden) return;
  input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant");
  animate(sug, [{ opacity: 1 }, { opacity: 0, transform: "translateY(-4px) scale(.98)", filter: "blur(3px)" }], { duration: 140, fill: "forwards", key: "pop" })
    .then(() => { if (input.getAttribute("aria-expanded") === "false") { sug.hidden = true; cancel(sug, "pop"); } });
}
function highlight(i) {
  const items = $$(".sug-item", sug);
  if (!items.length) return;
  active = (i + items.length) % items.length;
  items.forEach((n, j) => n.setAttribute("aria-selected", String(j === active)));
  input.setAttribute("aria-activedescendant", items[active].id);
}
function choose(item) { input.value = item.dataset.v; closeSuggest(); input.focus(); bounce($("svg", pill)); }

function wireAddress() {
  input.addEventListener("input", () => {
    pill.classList.remove("error"); $("#startErr").hidden = true;
    const request = ++acRequest, q = input.value.trim();
    clearTimeout(acTimer);
    if (q.length < 3) return closeSuggest();
    const cached = acCache.get(q.toLowerCase());
    if (cached) return openSuggest(cached);
    acTimer = setTimeout(async () => {
      try {
        const d = await api("/api/autocomplete?q=" + encodeURIComponent(q));
        const preds = d.predictions || [];
        acCache.set(q.toLowerCase(), preds);
        if (request !== acRequest || !focused(q)) return;
        openSuggest(preds);
      } catch { if (request === acRequest) closeSuggest(); }
    }, 140);
  });
  input.addEventListener("keydown", (e) => {
    const open = !sug.hidden;
    if (e.key === "ArrowDown" && open) { e.preventDefault(); highlight(active + 1); }
    else if (e.key === "ArrowUp" && open) { e.preventDefault(); highlight(active - 1); }
    else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); closeSuggest(); }
    else if (e.key === "Enter" && open && active >= 0) { e.preventDefault(); choose($$(".sug-item", sug)[active]); }
  });
  input.addEventListener("focus", () => bounce($("svg", pill)));
  sug.addEventListener("mousedown", (e) => { const item = e.target.closest(".sug-item"); if (item) { e.preventDefault(); choose(item); } });
  input.addEventListener("blur", () => setTimeout(closeSuggest, 140));
}

/* ── finding the good stuff: a full-screen moment while restaurants load ───────────────────────────
   A circle opens out of the Find food button onto a dimmed, faster food wall with a radar pin, rolling status
   and a creeping progress bar. When the restaurants are in (and their first photos are already decoded), it
   dissolves while the cards cascade in underneath and the address lands in the top bar. */
const STEPS = ["Checking kitchens nearby…", "Pulling up menus…", "Sorting by what’s open…", "Plating it up…", "Almost there…"];
function finding(address, origin) {
  const el = document.createElement("div");
  el.className = "finding";
  const sets = narrow.matches ? [WALL[0], WALL[1], WALL[2]] : [WALL[0], WALL[1], WALL[2], [...WALL[1]].reverse(), [...WALL[0]].reverse(), [...WALL[2]].reverse()];
  el.innerHTML = `<div class="finding-wall" aria-hidden="true">${sets.map((ids, c) => `<div class="wall-col"><div class="wall-track" style="--dur:${[46, 58, 52, 62, 50, 56][c]}s">${tiles(ids)}</div></div>`).join("")}</div>
    <div class="finding-center">
      <div class="radar" aria-hidden="true"><i></i><i></i><i></i><span class="radar-core">${icon("pin")}</span></div>
      <h2 class="finding-title">Finding the good stuff</h2>
      <p class="finding-addr">${icon("navigation")}<span>${esc(address)}</span></p>
      <p class="finding-step" role="status" aria-live="polite"><span>${STEPS[0]}</span></p>
      <div class="finding-bar" aria-hidden="true"><i></i></div>
    </div>`;
  document.body.append(el);
  wireImages(el);
  const r = origin?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : innerWidth / 2, y = r ? r.top + r.height / 2 : innerHeight / 2;
  const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 40;
  el.animate([{ clipPath: `circle(0px at ${x}px ${y}px)` }, { clipPath: `circle(${R}px at ${x}px ${y}px)` }], { duration: 820, easing: EASE.io, fill: "both" });
  animate($(".finding-wall", el), [{ transform: "scale(1.18)", filter: "blur(14px) brightness(.4)" }, { transform: "scale(1)", filter: "blur(0px) brightness(1)" }], { duration: 1300, easing: EASE.out });
  $$(".finding-center > *", el).forEach((n, i) => animate(n, [{ opacity: 0, transform: "translateY(16px)", filter: "blur(8px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }], { duration: 720, delay: 320 + i * 90 }));
  const bar = $(".finding-bar i", el);
  const creep = bar.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(.88)" }], { duration: 9000, easing: "cubic-bezier(.12,.7,.2,1)", fill: "forwards" });
  let step = 0;
  const stepEl = $(".finding-step span", el);
  const ticker = setInterval(() => { step = Math.min(step + 1, STEPS.length - 1); roll(stepEl, STEPS[step]); }, 1500);
  const done = () => { clearInterval(ticker); };
  return {
    async exit(underneath) {
      done();
      creep.pause();
      await animate(bar, [{ transform: getComputedStyle(bar).transform }, { transform: "scaleX(1)" }], { duration: 260, easing: EASE.out, fill: "forwards", essential: true });
      burst($(".radar-core", el), { count: 12, spread: 60 });
      $$(".finding-center > *", el).forEach((n, i) => animate(n, [{ opacity: 1, transform: "none", filter: "blur(0px)" }, { opacity: 0, transform: "translateY(-18px)", filter: "blur(8px)" }], { duration: 360, delay: i * 30, fill: "forwards" }));
      underneath?.();
      animate($(".finding-wall", el), [{ transform: "scale(1)", filter: "blur(0px)" }, { transform: "scale(1.08)", filter: "blur(12px)" }], { duration: 760, fill: "forwards", essential: true });
      await animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 640, delay: 120, easing: EASE.out, fill: "forwards", essential: true });
      el.remove();
    },
    async cancel() {
      done();
      await animate(el, [{ clipPath: `circle(${R}px at ${x}px ${y}px)` }, { clipPath: `circle(0px at ${x}px ${y}px)` }], { duration: 520, easing: EASE.io, fill: "forwards", essential: true });
      el.remove();
    },
  };
}
// decode the first restaurant photos while the sequence plays, so the cards arrive complete
const preload = (urls, ms) => Promise.race([Promise.all(urls.map((u) => new Promise((res) => { const i = new Image(); i.onload = i.onerror = res; i.src = u; if (i.decode) i.decode().then(res, res); }))), sleep(ms)]);

/* ── find food ────────────────────────────────────────────────────── */
let statusTimers = [];
function setLoading(on, { quiet = false } = {}) {
  findBtns.forEach((b) => {
    b.disabled = on; b.classList.toggle("loading", on);
    b.toggleAttribute("aria-busy", on);
    b.querySelector(".spinner")?.remove();
    if (on) b.insertAdjacentHTML("beforeend", spinner());
  });
  input.readOnly = on;
  const status = $("#startStatus");
  statusTimers.forEach(clearTimeout); statusTimers = [];
  if (on && !quiet) {
    const say = (text) => { status.textContent = text; status.hidden = false; rise(status, { y: 6, duration: 360, key: "say" }); };
    say("Finding the good stuff near you…");
    statusTimers.push(setTimeout(() => say("Checking which kitchens are open…"), 5000));
    statusTimers.push(setTimeout(() => say("Big neighborhoods take a moment. Almost there…"), 13000));
  } else status.hidden = true;
  applyFulfillment(state.config);
}
function showError(text) {
  const err = $("#startErr");
  err.textContent = text; err.hidden = false;
  pill.classList.add("error");
  rise(err, { y: 6, duration: 320 });
  shake(pill);
}
const visibleFind = () => findBtns.find((b) => b.offsetParent !== null) || findBtns[0];

async function start(e) {
  e?.preventDefault();
  if (busy) return;
  const address = input.value.trim();
  $("#startErr").hidden = true; pill.classList.remove("error");
  if (!address) { showError("Type an address to start."); input.focus(); return; }
  closeSuggest();
  busy = true;
  const fx = reduced.matches ? null : finding(address, visibleFind());
  setLoading(true, { quiet: !!fx });
  const t0 = performance.now();
  try {
    const d = await api("/api/start", { method: "POST", body: JSON.stringify({ address, dining: state.dining }) });
    state.cart = []; state.store = null; state.menu = null;
    state.sid = d.sid; state.dining = d.dining || state.dining; state.addressLabel = d.address_label || address;
    state.addressQuery = address; state.timeZone = d.time_zone || null;
    state.stores = new Map();
    state.restaurants = rememberStores(d.restaurants);
    state.allLoaded = false;
    store.set("yonderVisited", "1");
    if (fx) {
      await Promise.all([preload(state.restaurants.slice(0, 8).map((r) => r.cover).filter(Boolean), 1400), sleep(Math.max(0, 1700 - (performance.now() - t0)))]);
      browse.reset(); syncCartBar();
      await go("browse", { instant: true, during: () => browse.render("", { hold: true }) });
      await fx.exit(() => browse.arrive());
    } else {
      browse.reset(); syncCartBar();
      await go("browse", { during: () => browse.render() });
    }
    browse.loadAll();
  } catch (err) {
    if (err.code === "ADDRESS_NOT_SERVED") {
      state.addressLabel = ""; state.addressQuery = address;
      if (fx) { await go("browse", { instant: true, during: () => browse.notServed(err.message) }); await fx.exit(); }
      else await go("browse", { during: () => browse.notServed(err.message) });
    } else { await fx?.cancel(); showError(err.message || "Couldn’t start. Try again."); }
  } finally { busy = false; setLoading(false); }
}

/** Back to the start screen with the address ready to edit. */
export function editAddress() {
  go("start").then(() => { input.focus(); input.select(); });
}

/* ── small delights ───────────────────────────────────────────────── */
const FORTUNES = ["Your next great decision probably comes with fries.", "A little treat is a perfectly good plan.", "Someone out there also thinks the sides are the main event.",
  "You bring the appetite. We saved you a seat.", "Your fortune: good food, comfy clothes, zero dishes."];
function wireDelights() {
  if (store.get("yonderVisited")) $("#welcome").textContent = "Welcome back.";
  let n = 0;
  $("#fortuneCookie").addEventListener("click", (e) => {
    const f = $("#fortune");
    f.textContent = FORTUNES[n++ % FORTUNES.length]; f.hidden = false;
    rise(f, { y: 6, blur: 2, duration: 380, key: "say" });
    wiggle($("#fortuneCookie svg"));
    burst(e.currentTarget, { count: 8, spread: 34, size: 5, colors: ["#ffd600", "#ff9230", "#ffffff"] });
  });
  let secret = "";
  document.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, textarea, select, [contenteditable]") || e.key.length !== 1) return;
    secret = (secret + e.key.toLowerCase()).slice(-6);
    if (secret === "hungry") { toast("Certified snack enthusiast. Welcome to the club.", { glyph: "cookie" }); burst($("#toast"), { count: 14, spread: 70 }); }
  });
  // the intro plays once; it doesn't replay when you come back to this screen
  setTimeout(() => $("#hero").classList.add("played"), 2600);
}

/* the primary button leans toward the pointer and catches the light */
function magnetic(el, strength = .22) {
  if (!finePointer.matches || reduced.matches) return;
  el.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    el.style.translate = `${((e.clientX - r.left - r.width / 2) * strength).toFixed(1)}px ${((e.clientY - r.top - r.height / 2) * strength).toFixed(1)}px`;
  });
  el.addEventListener("pointerleave", () => { el.style.translate = ""; });
}

/* how it works: each step's icon draws itself and its number counts up as it arrives */
function wireSteps() {
  const glyphs = ["pin", "utensils", "wallet", "navigation"];
  $$(".step").forEach((s, i) => {
    s.insertAdjacentHTML("afterbegin", `<span class="step-ico">${icon(glyphs[i])}</span>`);
    s.addEventListener("revealed", () => {
      drawOn($(".step-ico svg", s), { delay: 160 + i * 60, duration: 760, stagger: 140 });
      const n = $(".step-n", s);
      animate(n, [{ opacity: 0, transform: "translateY(60%)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }], { duration: 900, delay: 120 + i * 60, easing: EASE.out });
    }, { once: true });
  });
}

/* the top bar's logo steps aside while the hero's big logo is on screen, and slides in once it scrolls away */
function wireLogoTuck() {
  const lockup = $(".lockup"), mark = $("#homeLink");
  if (!lockup || !("IntersectionObserver" in window)) return;
  let inView = true;
  const sync = () => mark.classList.toggle("tucked", state.screen === "start" && inView);
  const top = Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--chrome-h")) || 64);
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; sync(); }, { rootMargin: `-${top}px 0px 0px 0px` }).observe(lockup);
  onScreen(sync);
  sync();
}

export function initHero() {
  wireLogoTuck();
  seg = segmented($("#diningSeg"), { onChange: (b) => { setDining(b.dataset.dining); bounce($("svg", b)); } });
  $$("#diningSeg .seg-opt").forEach((b) => b.insertAdjacentHTML("afterbegin", icon(b.dataset.dining === "PICKUP" ? "store" : "bike")));
  seg.place(false);
  setDining($('[aria-checked="true"]', $("#diningSeg")).dataset.dining);
  form.addEventListener("submit", start);
  wireAddress();
  wireWall();
  wireDelights();
  wireSteps();
  magnetic($("#findBtn"));
  $("#lookupOpen").addEventListener("click", () => openLookup());
  if (reduced.matches) $("#hero").classList.add("played");
}
