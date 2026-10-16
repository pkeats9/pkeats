// A restaurant's page. Its photo travels from the card into the hero (and back on the way out); the menu
// settles in under a sticky glass category capsule whose indicator glides with the scroll.
import { $, $$, esc, priceHTML, priced, initials } from "./dom.js";
import { state } from "./state.js";
import { api, withSession } from "./api.js";
import { animate, reveal, rise, reduced, replaceIcon, bounce, cascade, enter, onScroll, burst } from "./motion.js";
import { icon } from "./icons.js";
import { go } from "./nav.js";
import { statusText, storeMeta, ratingHTML, emptyHTML, cardFor, syncClear } from "./browse.js";
import { tapItem } from "./item.js";
import { syncCartBar } from "./cart.js";
import { toast } from "./toast.js";
import { editAddress } from "./hero.js";
import { ask } from "./sheet.js";

const body = $("#menuBody"), nav = $("#catNav"), search = $("#itemSearch");
let menuRequest = 0, spy = null, spyLock = 0, slowTimer = 0;

const decoded = (img) => (img?.decode ? Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 160))]) : Promise.resolve());
const where = (s) => s.address_kind === "restaurant" || (!s.address_kind && s.brand_category !== "WONDER_HDR") ? "Made at this restaurant" : `Cooked at Wonder${s.hub_name ? " " + s.hub_name : ""}`;

/* ── header: whatever we know paints instantly; the menu call fills in the rest ── */
function paintHeader(s) {
  const cover = $("#menuCover"), url = s.cover || "";
  if (cover.dataset.src !== url) {
    cover.dataset.src = url;
    cover.innerHTML = url ? `<img src="${esc(url)}" alt="" decoding="async">` : "";
  }
  const logo = $("#menuLogo");
  if (logo.dataset.src !== (s.logo || "") || !logo.innerHTML) {
    logo.dataset.src = s.logo || "";
    logo.innerHTML = s.logo ? `<img src="${esc(s.logo)}" alt="" decoding="async" data-i="${esc(initials(s.name))}">` : esc(initials(s.name));
  }
  $("#menuName").textContent = s.name || "Menu";
  $("#menuMeta").innerHTML = [ratingHTML(s), esc(storeMeta(s))].filter(Boolean).join('<span class="sep-dot" aria-hidden="true"></span>');
  const desc = $("#menuDesc");
  desc.textContent = s.short_description || ""; desc.hidden = !s.short_description;
  const addr = $("#menuAddr");
  if (s.address) { addr.innerHTML = `${icon("pin")}<span><b>${esc(s.address)}</b><small>${esc(where(s))}${s.distance_mi != null ? ` · ${Number(s.distance_mi).toFixed(1)} mi away` : ""}</small></span>`; addr.hidden = false; }
  else addr.hidden = true;
  const st = statusText(s), status = $("#menuStatus");
  status.innerHTML = st ? `${icon("clock")}<span>${esc(st)}. You can still build a cart now.</span>` : "";
  status.hidden = !st;
}

function skeleton() {
  clearTimeout(slowTimer);
  nav.hidden = true; nav.innerHTML = "";
  body.classList.remove("slow");
  body.innerHTML = `<div aria-hidden="true"><span class="sk sk-cat"></span><div class="rows">${Array.from({ length: 6 }, () =>
    '<div class="sk-row"><div class="sk-lines"><span class="sk" style="width:62%;height:18px"></span><span class="sk" style="width:92%;height:12px"></span><span class="sk" style="width:74%;height:12px"></span><span class="sk" style="width:22%;height:14px;margin-top:14px"></span></div><span class="sk sk-pic"></span></div>').join("")}</div></div>`;
  slowTimer = setTimeout(() => body.classList.add("slow"), 400);   // only pulse if it's actually slow
}

/** Ask before a new store clears the cart (a cart belongs to one store). */
async function confirmSwitch(name) {
  const n = state.cart.reduce((a, l) => a + l.quantity, 0);
  return ask({
    title: "Start a new cart?",
    body: `Your cart from ${esc(state.store?.restaurant_name || "another restaurant")} (${n} item${n === 1 ? "" : "s"}) will be cleared. A cart belongs to one restaurant.`,
    ok: `Switch to ${esc(name || "this restaurant")}`, cancel: "Keep my cart",
  });
}

/* ── open a store ─────────────────────────────────────────────────── */
export async function openStore(rid, { name, brand, card } = {}) {
  if (state.cart.length && state.store?.restaurant_id !== rid) {
    if (!(await confirmSwitch(name))) return;
    state.cart = [];
    syncCartBar();
  }
  const request = ++menuRequest;
  state.menu = null;
  search.value = ""; syncClear(search);
  const known = state.stores.get(rid) || { id: rid, name, brand_category: brand };
  state.store = { restaurant_id: rid, restaurant_name: known.name || name, brand_category: brand || known.brand_category, info: known };
  const media = card?.querySelector(".card-media"), logo = card?.querySelector(".card-logo");
  const phone = matchMedia("(max-width: 734px)").matches;
  await go("menu", {
    shared: card ? [
      { from: () => media, to: () => $("#menuCover"), src: known.cover, radius: ["18px", phone ? "0px" : "28px"], duration: 680 },
      ...(known.logo ? [{ from: () => logo, to: () => $("#menuLogo"), src: known.logo, radius: ["50%", "50%"], className: "flight-logo", duration: 700 }] : []),
    ] : [],
    during: () => {
      paintHeader({ ...known, name: known.name || name });
      skeleton();
      introHeader();
    },
  });
  if (request !== menuRequest) return;
  body.setAttribute("aria-busy", "true");
  search.disabled = true;
  try {
    const m = await withSession((s) => api(`/api/menu?sid=${s}&rid=${encodeURIComponent(rid)}`));
    if (request !== menuRequest) return;
    state.menu = m;
    if (m.time_zone) state.timeZone = m.time_zone;
    state.store.restaurant_name = m.restaurant_name || state.store.restaurant_name;
    state.store.brand_category = m.brand_category || state.store.brand_category;
    // the menu is the authority on address / rating / status; keep it for the cart too (the card's photo stays)
    const merged = { ...known, name: state.store.restaurant_name };
    for (const k of ["address", "address_kind", "hub_name", "distance_mi", "logo", "rating", "rating_count", "short_description"]) if (m[k] != null && m[k] !== "") merged[k] = m[k];
    if (!merged.cover && m.cover) merged.cover = m.cover;
    if (m.status) merged.status = m.status;
    state.stores.set(rid, merged);
    state.store.info = merged;
    paintHeader(merged);
    renderMenu("", { first: true });
  } catch (e) {
    if (request !== menuRequest) return;
    if (e.status === 440) { toast(e.message); return go("start"); }
    const message = e.code === "UPSTREAM_BLOCKED" ? "Wonder couldn’t share this menu right now. Give it a moment, then try again."
      : e.code === "UPSTREAM_RATE_LIMITED" ? "Wonder is busy right now. Please wait a moment before trying again."
      : "We couldn’t load the menu. Check your connection and try again.";
    clearTimeout(slowTimer);
    body.innerHTML = `<div class="empty" role="status">${emptyHTML("utensils", "Let’s try that again", message,
      '<button class="btn btn-primary" type="button" data-act="retry">Retry menu</button><button class="btn btn-secondary" type="button" data-act="browse">Back to restaurants</button>')}</div>`;
    rise(body.firstElementChild, { y: 8, duration: 360 });
    body.querySelector('[data-act="retry"]').onclick = (ev) => { ev.currentTarget.disabled = true; openStore(rid, { name, brand }); };
    body.querySelector('[data-act="browse"]').onclick = () => backToBrowse();
  } finally {
    if (request === menuRequest) { body.removeAttribute("aria-busy"); search.disabled = !state.menu; }
  }
}

/** Back to the list; the photo flies back into its card when that card is on screen. */
export function backToBrowse() {
  const rid = state.store?.restaurant_id, info = state.store?.info || {};
  const phone = matchMedia("(max-width: 734px)").matches;
  const cover = $("#menuCover").dataset.src;
  return go("browse", {
    shared: cover ? [{
      from: () => $("#menuCover"),
      to: () => { const c = rid ? cardFor(rid) : null; const r = c?.getBoundingClientRect(); return r && r.bottom > 0 && r.top < innerHeight ? c.querySelector(".card-media") : null; },
      src: cover, radius: [phone ? "0px" : "28px", "18px"], duration: 600,
    }] : [],
  });
}

/* the header's pieces settle in one after another while the photo is still landing */
function introHeader() {
  if (reduced.matches) return;
  const parts = [$("#menuLogo"), $("#menuName"), $("#menuMeta"), $("#menuDesc"), $("#menuAddr"), $("#menuStatus"), $("#menuChangeAddr"), $(".menu-search")].filter((n) => n && !n.hidden);
  parts.forEach((n, i) => animate(n, [{ opacity: 0, transform: "translateY(16px)", filter: "blur(8px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }],
    { duration: 760, delay: 140 + i * 60, key: "intro" }));
}

/* ── menu body ────────────────────────────────────────────────────── */
function rowHTML(it, rv) {
  const inCart = state.cart.filter((l) => l.item_id === it.item_id).reduce((a, l) => a + l.quantity, 0);
  const price = priceHTML(it.price, it.price_from);
  return `<button class="row${it.image ? " has-img" : ""}${rv ? " rv" : ""}" type="button" data-id="${esc(it.item_id)}" aria-label="${esc(it.name)}${price ? ", " + esc(String(it.price_from ? "from " : "") + "$" + Number(it.price).toFixed(2)) : ""}${inCart ? `, ${inCart} in cart` : ""}">
    <div class="row-main">
      <div class="row-name">${esc(it.name)}</div>
      ${it.description ? `<div class="row-desc">${esc(it.description)}</div>` : ""}
      <div class="row-foot">${price ? `<span class="row-price">${price}</span>` : ""}${it.customizable ? '<span class="tag">Customizable</span>' : ""}</div>
    </div>
    <div class="row-media">
      ${it.image ? `<img class="row-img" src="${esc(it.image)}" alt="" loading="lazy" decoding="async">` : ""}
      <span class="row-add${inCart ? " in-cart" : ""}" aria-hidden="true">${inCart ? inCart : icon("plus")}</span>
    </div>
  </button>`;
}

export function renderMenu(filter = "", { first = false } = {}) {
  if (!state.menu) return;
  clearTimeout(slowTimer); body.classList.remove("slow");
  const f = filter.trim().toLowerCase();
  const items = (state.menu.items || []).filter((it) => !f || (it.name || "").toLowerCase().includes(f) || (it.description || "").toLowerCase().includes(f));
  spy?.disconnect(); spy = null;
  if (!items.length) {
    nav.hidden = true; nav.innerHTML = "";
    body.innerHTML = `<div class="empty">${f ? emptyHTML("search-x", "Nothing here", `No items match “${esc(filter.trim())}”.`) : emptyHTML("utensils", "No menu right now", "This restaurant isn’t showing any items at the moment. Try again later.")}</div>`;
    return;
  }
  const cats = [], byCat = {};
  for (const it of items) { const c = (it.category_name || "Menu").trim(); if (!byCat[c]) { byCat[c] = []; cats.push(c); } byCat[c].push(it); }
  body.innerHTML = cats.map((c, i) => `<section class="cat" id="cat-${i}" aria-labelledby="cat-h-${i}"><h2 class="cat-title${first ? " rv" : ""}" id="cat-h-${i}">${esc(c)}<small>${byCat[c].length}</small></h2>
    <div class="rows">${byCat[c].map((it) => rowHTML(it, first)).join("")}</div></section>`).join("");
  if (first) {
    const rows = $$(".row", body), visible = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.top < innerHeight && b.bottom > 0; });
    $$(".cat-title", body).forEach((t) => { const b = t.getBoundingClientRect(); if (b.top < innerHeight) enter(t, { variant: "rise", duration: 700 }); });
    cascade(visible, { variant: "card", step: 55, duration: 780 });
    reveal(body);
  } else rise(body, { y: 8, blur: 4, duration: 360, key: "list" });
  if (cats.length > 1) {
    nav.innerHTML = `<span class="catnav-ind no-anim" aria-hidden="true"></span>` + cats.map((c, i) => `<button type="button" data-cat="${i}"${i === 0 ? ' aria-current="true"' : ""}>${esc(c)}</button>`).join("");
    const wasHidden = nav.hidden;
    nav.hidden = false;
    requestAnimationFrame(() => { setActiveCat(0, { instant: true }); });
    if (wasHidden && first && !reduced.matches) {
      animate(nav, [{ opacity: 0, transform: "translateY(10px) scale(.96)", filter: "blur(8px) brightness(1.3)" }, { opacity: 1, transform: "none", filter: "blur(0px) brightness(1)" }], { duration: 640, delay: 100, key: "nav" });
      $$("button", nav).slice(0, 12).forEach((b, i) => animate(b, [{ opacity: 0, transform: "translateX(14px)" }, { opacity: 1, transform: "none" }], { duration: 520, delay: 220 + i * 40, key: "chip" }));
    }
    spy = new IntersectionObserver((entries) => {
      if (performance.now() < spyLock) return;
      const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (hit) setActiveCat(+hit.target.id.slice(4));
    }, { rootMargin: `-${Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--chrome-h")) || 64) + 90}px 0px -62% 0px` });
    $$(".cat", body).forEach((s) => spy.observe(s));
  } else { nav.hidden = true; nav.innerHTML = ""; }
}

function setActiveCat(i, { instant = false } = {}) {
  const btns = $$("button", nav), on = btns[i];
  if (!on) return;
  btns.forEach((b) => (b === on ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current")));
  const ind = $(".catnav-ind", nav);
  if (ind) {
    ind.classList.toggle("no-anim", instant);
    ind.style.setProperty("--w", `${on.offsetWidth}px`);
    ind.style.setProperty("--x", `${on.offsetLeft}px`);
    if (instant) requestAnimationFrame(() => requestAnimationFrame(() => ind.classList.remove("no-anim")));
  }
  const left = on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2;
  nav.scrollTo({ left: Math.max(0, left), behavior: instant || reduced.matches ? "auto" : "smooth" });
}

export const findItem = (id) => (state.menu?.items || []).find((x) => x.item_id === id);

/** Keep the + / count badges in step with the cart; the item just added gets a little bounce. */
export function syncMenuCounts(addedId) {
  $$("#menuBody .row").forEach((row) => {
    const n = state.cart.filter((l) => l.item_id === row.dataset.id).reduce((a, l) => a + l.quantity, 0);
    const badge = $(".row-add", row);
    const was = badge.classList.contains("in-cart") ? badge.textContent : "";
    if (String(n || "") === was) return;
    badge.classList.toggle("in-cart", n > 0);
    if (row.dataset.id === addedId && !reduced.matches) {
      if (n && !was) { badge.textContent = String(n); animate(badge, [{ transform: "scale(.4) rotate(-90deg)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 520, easing: "cubic-bezier(.34,1.56,.64,1)", key: "badge" }); burst(badge, { count: 9, spread: 30, size: 5 }); }
      else if (n) { badge.textContent = String(n); animate(badge, [{ transform: "scale(1)" }, { transform: "scale(1.28)", offset: .3 }, { transform: "scale(1)" }], { duration: 420, key: "badge" }); burst(badge, { count: 7, spread: 26, size: 4 }); }
      else replaceIcon(badge, icon("plus"));
    } else badge.innerHTML = n ? String(n) : icon("plus");
  });
}

/* the hero photo drifts slower than the page (and swells a touch on phones) */
function wireParallax() {
  if (reduced.matches) return;
  onScroll((y) => {
    if (state.screen !== "menu") return;
    const img = $("#menuCover img");
    if (!img) return;
    const phone = innerWidth <= 734, t = Math.min(y, 700);
    img.style.translate = `0 ${(t * (phone ? .38 : .12)).toFixed(1)}px`;
    img.style.scale = String(1 + t * (phone ? .00035 : .00012));
  });
}

export function initMenu() {
  wireParallax();
  body.addEventListener("click", (e) => { const row = e.target.closest(".row"); if (row) tapItem(row.dataset.id, row); });
  nav.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-cat]");
    if (!b) return;
    spyLock = performance.now() + 900;
    $("#cat-" + b.dataset.cat)?.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "start" });
    setActiveCat(+b.dataset.cat);
  });
  search.addEventListener("input", () => { syncClear(search); renderMenu(search.value); });
  $("#menuChangeAddr").addEventListener("click", () => editAddress());
  // pinned state for the category capsule (the scroll edge grows under it)
  const topPx = () => Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--chrome-h")) || 64);
  new IntersectionObserver(([e]) => document.body.classList.toggle("tools-stuck", !e.isIntersecting && e.boundingClientRect.top < 200),
    { rootMargin: `-${topPx()}px 0px 0px 0px` }).observe($("#toolsSentinel"));
  addEventListener("resize", () => { const on = $("button[aria-current]", nav); if (on) setActiveCat(+on.dataset.cat, { instant: true }); }, { passive: true });
}
