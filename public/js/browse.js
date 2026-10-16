// Restaurants: search, Wonder/All filter, Open now, and a windowed grid of photo cards.
// Cards rise in as they scroll into view; tapping one carries its photo into the restaurant page.
import { $, $$, esc, initials, plural, store as ls } from "./dom.js";
import { state, rememberStores } from "./state.js";
import { api, withSession } from "./api.js";
import { animate, reveal, segmented, rise, fadeOut, reduced, cascade, enter, roll, finePointer, EASE } from "./motion.js";
import { icon } from "./icons.js";
import { openStore } from "./menu.js";
import { editAddress } from "./hero.js";

const grid = $("#storeGrid"), empty = $("#storeEmpty"), count = $("#restaurantCount"), search = $("#storeSearch");
const GRID_WINDOW = 48;   // cards per page; the rest stream in on scroll
let list = [], shown = 0, sentinel = null, filterSeg, holding = false;

/* ── formatting ───────────────────────────────────────────────────── */
export function fmtMiles(mi) {
  if (mi == null || !Number.isFinite(Number(mi))) return "";
  return Number(mi) < 0.1 ? "Under 0.1 mi" : `${Number(mi).toFixed(1)} mi`;
}
export function fmtTime(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return "";
  try { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(state.timeZone ? { timeZone: state.timeZone } : {}) }); }
  catch { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
}
/** "Opens 10:30 AM" / "Closed now" — or "" when the store is taking orders. */
export function statusText(r) {
  const s = String(r?.status || "").toUpperCase();
  if (!s || s === "OPEN") return "";
  const at = fmtTime(r.opening_time);
  if (s.includes("CLOSED")) return at ? `Closed · opens ${at}` : "Closed now";
  return at ? `Opens ${at}` : "Not open yet";
}
export const storeMeta = (r) => [r.cuisine, r.eta ? `${r.eta.min}–${r.eta.max} min` : "", fmtMiles(r.distance_mi)].filter(Boolean).join(" · ");
export function ratingHTML(r) {
  if (!r.rating) return "";
  return `<span class="rating"><svg class="i i-fill" aria-hidden="true"><use href="#i-star"/></svg>${Number(r.rating).toFixed(1)}${r.rating_count ? `<small>(${esc(r.rating_count)})</small>` : ""}</span>`;
}
export function logoHTML(r) {
  return r.logo ? `<img src="${esc(r.logo)}" alt="" loading="lazy" decoding="async" data-i="${esc(initials(r.name))}">` : `<span>${esc(initials(r.name))}</span>`;
}
export const emptyHTML = (glyph, title, body, extra = "") =>
  `<div class="empty-ico">${icon(glyph)}</div><h3>${title}</h3>${body ? `<p>${body}</p>` : ""}${extra ? `<div class="btn-row">${extra}</div>` : ""}`;

/* ── filters ──────────────────────────────────────────────────────── */
// "Open now" uses the same status the cards show: a store without a closed/opens-later badge is open.
export const isOpenNow = (r) => !statusText(r);
const inType = (r) => state.restaurantFilter === "all" || r.brand_category === "WONDER_HDR";
const passes = (r) => inType(r) && (!state.openOnly || isOpenNow(r));
function filtered(q = "") {
  const f = q.trim().toLowerCase();
  return state.restaurants.filter((r) => passes(r) && (!f || [r.name, r.brand_name, r.cuisine].some((x) => (x || "").toLowerCase().includes(f))));
}
function nextOpening() {
  let soonest = null;
  for (const r of state.restaurants) {
    if (isOpenNow(r) || !inType(r)) continue;
    const t = r.opening_time ? new Date(r.opening_time).getTime() : NaN;
    if (Number.isFinite(t) && t > Date.now() && (soonest === null || t < soonest)) soonest = t;
  }
  return soonest === null ? "" : fmtTime(new Date(soonest).toISOString());
}

/* ── cards ────────────────────────────────────────────────────────── */
function cardHTML(r) {
  const status = statusText(r);
  return `<button class="card rv${status ? " not-open" : ""}" type="button" data-rid="${esc(r.id)}" data-brand="${esc(r.brand_category || "WONDER_LOCAL")}" data-name="${esc(r.name)}">
    <div class="card-media">
      ${r.cover ? `<img class="card-cover" src="${esc(r.cover)}" alt="" loading="lazy" decoding="async">` : ""}
      ${status ? `<span class="card-status">${icon("clock")}<span>${esc(status)}</span></span>` : ""}
      <div class="card-logo">${logoHTML(r)}</div>
      <span class="card-glare" aria-hidden="true"></span>
    </div>
    <div class="card-body">
      <div class="card-top"><span class="card-name">${esc(r.name || "Restaurant")}</span>${ratingHTML(r)}</div>
      <div class="card-meta">${esc(storeMeta(r)) || (r.brand_name && r.brand_name !== r.name ? esc(r.brand_name) : "&nbsp;")}</div>
    </div>
  </button>`;
}

// Windowed render: a 1,000+ store list never puts thousands of nodes in the DOM; more stream in near the end.
function paintMore() {
  const next = list.slice(shown, shown + GRID_WINDOW);
  if (!next.length) return;
  grid.insertAdjacentHTML("beforeend", next.map(cardHTML).join(""));
  shown += next.length;
  if (!holding) reveal(grid);
  arm();
}
function arm() {
  sentinel?.disconnect(); sentinel = null;
  if (shown >= list.length) return;
  const cards = grid.children, anchor = cards[Math.max(0, cards.length - 8)];
  if (!anchor) return;
  sentinel = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) paintMore(); }, { rootMargin: "900px 0px" });
  sentinel.observe(anchor);
}
const onScreenRect = (r) => r.bottom > -40 && r.top < innerHeight + 40;
/* Lists that change don't flash: cards that stay glide to their new places (FLIP), the ones leaving fade
   down where they were, and newcomers rise in. */
function paint(next, { flip = false } = {}) {
  const before = new Map();
  if (flip && !reduced.matches && !grid.hidden) {
    for (const c of grid.children) { const r = c.getBoundingClientRect(); if (onScreenRect(r)) before.set(c.dataset.rid, { r, node: c }); }
  }
  sentinel?.disconnect(); sentinel = null;
  list = next; shown = 0; grid.innerHTML = "";
  paintMore();
  if (!before.size) return;
  let k = 0;
  for (const c of [...grid.children]) {
    const now = c.getBoundingClientRect();
    if (!onScreenRect(now)) continue;
    const was = before.get(c.dataset.rid);
    if (was) {
      before.delete(c.dataset.rid);
      enter(c, { variant: "soft", duration: 1 });            // already visible: no entrance
      const dx = was.r.left - now.left, dy = was.r.top - now.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) animate(c, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 620, easing: EASE.smooth, key: "flip" });
    } else enter(c, { variant: "card", delay: 120 + Math.min(k++, 10) * 40, duration: 620 });
  }
  // ghosts: the cards that left fade and sink where they stood
  for (const { r, node } of before.values()) {
    const g = node.cloneNode(true);
    g.classList.add("ghost"); g.removeAttribute("data-rid");
    Object.assign(g.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    document.body.append(g);
    animate(g, [{ opacity: 1, transform: "none", filter: "blur(0px)" }, { opacity: 0, transform: "scale(.9)", filter: "blur(6px)" }], { duration: 300, fill: "forwards", essential: true }).finally(() => g.remove());
  }
}
const showEmpty = (html) => { grid.hidden = true; grid.innerHTML = ""; list = []; shown = 0; empty.hidden = false; empty.innerHTML = html; rise(empty, { y: 8, duration: 360 }); };

/* ── render ───────────────────────────────────────────────────────── */
export function reset() {
  search.value = ""; syncClear(search);
  sentinel?.disconnect(); sentinel = null; list = []; shown = 0; grid.innerHTML = "";
}

// Say what is HIDDEN, not just what is shown: the Wonder-only filter hides every partner restaurant.
function countText(q, out) {
  const typed = state.restaurants.filter(inType);
  const closedHidden = state.openOnly && !q.trim() ? typed.filter((r) => !isOpenNow(r)).length : 0;
  const hidden = state.restaurants.length - typed.length;
  const more = hidden > 0 && state.restaurantFilter === "wonder" && !q.trim() ? ` · ${hidden.toLocaleString()} more under All restaurants` : "";
  const loading = !state.allLoaded && state.restaurants.length ? " · loading more" : "";
  return `${out.length.toLocaleString()} ${state.openOnly ? "open " : ""}${state.restaurantFilter === "wonder" ? "Wonder " : ""}restaurant${out.length === 1 ? "" : "s"}${q.trim() ? " found" : ""}${closedHidden ? ` · ${closedHidden} closed hidden` : ""}${more}${loading}`;
}

export function render(q = "", { flip = false, hold = false } = {}) {
  holding = hold;
  $("#browseTitle").textContent = state.dining === "PICKUP" ? "Pickup near you" : "Restaurants near you";
  $("#browseTools").hidden = !state.restaurants.length;
  filterSeg?.select($(`[data-filter="${state.restaurantFilter}"]`, $("#filterSeg")), false);
  $("#openNowToggle").setAttribute("aria-checked", String(state.openOnly));
  const out = filtered(q), typed = state.restaurants.filter(inType);
  count.textContent = countText(q, out);
  if (!state.restaurants.length) {
    count.textContent = "";
    return showEmpty(emptyHTML("utensils", "No restaurants available", "Try another address or check back a little later.", '<button class="btn btn-secondary" type="button" data-act="address">Try another address</button>'));
  }
  empty.hidden = true; grid.hidden = false;
  if (!out.length && state.openOnly && !q.trim() && typed.length) {
    const at = nextOpening();
    return showEmpty(emptyHTML("clock", "Nothing’s open right now",
      at ? `The first kitchen here opens at ${esc(at)}. You can still build a cart now and order once it opens.` : "Every restaurant here is closed at the moment. You can still build a cart now and order once one opens.",
      '<button class="btn btn-secondary" type="button" data-act="show-closed">Show closed restaurants</button>'));
  }
  if (!out.length) {
    return showEmpty(emptyHTML("search-x", q.trim() ? "No match" : "No Wonder restaurants here",
      q.trim() ? `Nothing in this filter matches “${esc(q.trim())}”.` : "You can still explore the other restaurants serving this address.",
      state.restaurantFilter === "wonder" ? '<button class="btn btn-secondary" type="button" data-act="show-all">Show all restaurants</button>' : ""));
  }
  paint(out, { flip });
}

/** After the finding sequence: the header settles and the first screenful of cards cascades in. */
export function arrive() {
  holding = false;
  const head = $$(".screen-head > *", $("#screenBrowse"));
  head.forEach((n, i) => enter(n, { variant: "rise", delay: i * 70, duration: 760 }));
  const cards = [...grid.children], visible = cards.filter((c) => onScreenRect(c.getBoundingClientRect()));
  cascade(visible, { variant: "card", step: 60, delay: 140, duration: 820 });
  reveal(grid);
  if (!empty.hidden) rise(empty, { y: 12, blur: 6, duration: 600 });
}

export function notServed(msg) {
  state.restaurants = [];
  $("#browseTools").hidden = true;
  $("#browseTitle").textContent = "Not in range yet";
  count.textContent = "";
  showEmpty(emptyHTML("pin-off", "Wonder doesn’t deliver here",
    esc(msg || "Wonder doesn’t cover this address yet. Try another address that’s in range."),
    '<button class="btn btn-primary" type="button" data-act="address">Try another address</button>'));
}

/* Load Wonder's WHOLE store list for the address (not the ~100 the browse endpoint curates). It begins with the same
   curated stores in the same order, so the cards already on screen stay put and the rest simply extend the grid. */
export async function loadAll() {
  const addr = state.addressQuery, dining = state.dining;
  try {
    const d = await withSession((s) => api(`/api/allstores?sid=${s}`));
    if (addr !== state.addressQuery || dining !== state.dining) return;
    const all = rememberStores(d.restaurants);
    if (all.length > state.restaurants.length) state.restaurants = all;
  } catch { /* keep the curated list */ }
  if (addr !== state.addressQuery || dining !== state.dining) return;
  state.allLoaded = true;
  if (state.screen !== "browse" && state.screen !== "menu") return;
  const q = search.value.trim();
  if (q) return onSearch(q);
  const next = filtered("");
  const same = shown > 0 && next.slice(0, shown).every((r, i) => list[i]?.id === r.id);
  if (same) { list = next; arm(); roll(count, countText("", next)); }   // extend in place: no repaint, no jump
  else render("", { flip: true });
}

/* Search the whole catalog: an instant local match paints first, then the server search fills in the rest. */
let searchTimer = 0, searchSeq = 0;
function showList(next, text, emptyMsg) {
  count.textContent = text;
  if (!next.length) return showEmpty(emptyHTML("search-x", "No match", esc(emptyMsg)));
  empty.hidden = true; grid.hidden = false;
  paint(next, { flip: true });
}
export function onSearch(raw) {
  const q = (raw || "").trim();
  clearTimeout(searchTimer);
  if (!q) { ++searchSeq; return render("", { flip: true }); }
  const local = filtered(q);
  if (local.length) showList(local, `${local.length} result${local.length === 1 ? "" : "s"} for “${q}”`, "");
  if (q.length < 2) { if (!local.length) showList([], `No match for “${q}”`, `Nothing matches “${q}” at this address.`); return; }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const d = await withSession((s) => api(`/api/search?sid=${s}&q=${encodeURIComponent(q)}`));
      if (seq !== searchSeq || search.value.trim() !== q) return;
      const found = rememberStores(d.restaurants), results = found.filter(passes);
      const closed = state.openOnly ? found.filter((r) => !isOpenNow(r) && inType(r)).length : 0;
      if (results.length >= local.length) {
        const plus = (d.total || 0) > found.length && state.restaurantFilter === "all" && !state.openOnly ? "+" : "";
        showList(results, `${results.length}${plus} ${state.openOnly ? "open " : ""}result${results.length === 1 ? "" : "s"} for “${q}”${closed ? ` · ${closed} closed hidden` : ""}`,
          closed ? `Nothing open matches “${q}” right now. Turn off Open now to see closed restaurants.` : `Nothing matches “${q}” at this address.`);
      }
    } catch {
      if (!local.length && seq === searchSeq) showList([], `No match for “${q}”`, `Nothing matches “${q}” at this address.`);
    }
  }, 220);
}

function setFilter(f) {
  state.restaurantFilter = f === "all" ? "all" : "wonder";
  const q = search.value.trim();
  q ? onSearch(q) : render("", { flip: true });
}
// Remembered on this device, so a late-night visit opens straight onto what's open.
function setOpenOnly(on) {
  state.openOnly = !!on;
  ls.set("pkOpenOnly", state.openOnly ? "1" : "0");
  $("#openNowToggle").setAttribute("aria-checked", String(state.openOnly));
  const q = search.value.trim();
  q ? onSearch(q) : render("", { flip: true });
}

export function syncClear(input) {
  const btn = $(`[data-clear="${input.id}"]`);
  if (btn) btn.hidden = !input.value;
}

/** The card for a store, if it's on screen (used to fly the photo back on the way out of a menu). */
export const cardFor = (rid) => grid.querySelector(`.card[data-rid="${CSS.escape(rid)}"]`);

/* cards lean toward the pointer with a soft glare (fine pointers only) */
function wireTilt() {
  if (!finePointer.matches || reduced.matches) return;
  let active = null, raf = 0, ev = null;
  const reset = (card) => { if (!card) return; card.classList.remove("tilt"); const m = $(".card-media", card); ["--rx", "--ry", "--gx", "--gy", "--tx", "--ty"].forEach((v) => m.style.removeProperty(v)); };
  const tick = () => {
    raf = 0;
    const card = ev.target.closest?.(".card");
    if (card !== active) { reset(active); active = card; }
    if (!card) return;
    const m = $(".card-media", card), r = m.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width, py = (ev.clientY - r.top) / r.height;
    if (py > 1.35 || px < -.05 || px > 1.05) return reset(card);
    card.classList.add("tilt");
    m.style.setProperty("--rx", `${((.5 - Math.min(py, 1)) * 9).toFixed(2)}deg`);
    m.style.setProperty("--ry", `${((px - .5) * 11).toFixed(2)}deg`);
    m.style.setProperty("--gx", `${(px * 100).toFixed(1)}%`);
    m.style.setProperty("--gy", `${(Math.min(py, 1) * 100).toFixed(1)}%`);
    m.style.setProperty("--tx", `${((.5 - px) * 10).toFixed(1)}px`);
    m.style.setProperty("--ty", `${((.5 - Math.min(py, 1)) * 8).toFixed(1)}px`);
  };
  grid.addEventListener("pointermove", (e) => { ev = e; if (!raf) raf = requestAnimationFrame(tick); });
  grid.addEventListener("pointerleave", () => { reset(active); active = null; });
}

export function initBrowse() {
  wireTilt();
  state.openOnly = ls.get("pkOpenOnly") === "1";
  filterSeg = segmented($("#filterSeg"), { onChange: (b) => setFilter(b.dataset.filter) });
  $("#openNowToggle").addEventListener("click", () => setOpenOnly(!state.openOnly));
  search.addEventListener("input", () => { syncClear(search); onSearch(search.value); });
  grid.addEventListener("click", (e) => {
    const c = e.target.closest(".card");
    if (c) openStore(c.dataset.rid, { name: c.dataset.name, brand: c.dataset.brand, card: c });
  });
  empty.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "address") editAddress();
    else if (act === "show-closed") setOpenOnly(false);
    else if (act === "show-all") setFilter("all");
  });
  $$("[data-clear]").forEach((b) => b.addEventListener("click", () => {
    const input = $(`#${b.dataset.clear}`);
    input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); input.focus();
  }));
}
