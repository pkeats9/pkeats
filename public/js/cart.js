// The cart: the floating tinted bar, the cart sheet, the cart code and the code look-up.
import { $, $$, esc, money, priced, plural, announce, store as ls, initials } from "./dom.js";
import { state } from "./state.js";
import { api, withSession } from "./api.js";
import * as sheet from "./sheet.js";
import { animate, materialize, dematerialize, cancel, receive, roll, fly, bounce, drawOn, replaceIcon, rise, spinner, reduced, EASE, burst, ring, cascade } from "./motion.js";
import { icon } from "./icons.js";
import { toast } from "./toast.js";
import { onScreen } from "./nav.js";
import { syncMenuCounts } from "./menu.js";
import { logoHTML } from "./browse.js";
import { editAddress } from "./hero.js";
import { checkout } from "./account.js";

const bar = $("#cartbar");
export const cartCount = () => state.cart.reduce((a, l) => a + l.quantity, 0);
export const cartSubtotal = () => state.cart.reduce((a, l) => a + (priced(l.price) ? Number(l.price) : 0) * l.quantity, 0);

/* ── adding ───────────────────────────────────────────────────────── */
export function addToCart(it, qty, variationId, options, optLabel, { from } = {}) {
  const key = it.item_id + "|" + (variationId || "") + "|" + JSON.stringify(options || []);
  const existing = state.cart.find((l) => l.key === key);
  if (existing) existing.quantity += qty;
  else state.cart.push({
    key, item_id: it.item_id, name: it.name, price: priced(it.price) ? Number(it.price) : null, image: it.image || null,
    variation_id: variationId || null, category_id: it.category_id, category_name: it.category_name, type: it.type || "MENU_ITEM",
    quantity: qty, options: options || [], optLabel: optLabel || "",
  });
  syncCartBar();
  syncMenuCounts(it.item_id);
  announce(`Added ${it.name}. ${plural(cartCount(), "item")} in your cart.`);
  const land = () => { receive(bar); bounce($("#cartBagIco svg")); burst($("#cartBag"), { count: 8, spread: 30, size: 4, colors: ["#ffffff", "#c2b8ff", "#7ab8ff"] }); };
  if (from && it.image && !reduced.matches) fly(it.image, from, $("#cartBag")).then(land);
  else land();
}

/* ── the bar ──────────────────────────────────────────────────────── */
let shownCount = 0;
export function syncCartBar({ instant = false } = {}) {
  const n = cartCount(), show = n > 0 && state.screen !== "start";
  const visible = !bar.hidden;
  if (show && !visible) {
    bar.hidden = false;
    if (!instant) materialize(bar);
  } else if (!show && visible) {
    if (instant || reduced.matches) bar.hidden = true;
    else dematerialize(bar).then(() => { if (!(cartCount() > 0 && state.screen !== "start")) { bar.hidden = true; cancel(bar, "life"); } });
  }
  document.body.classList.toggle("has-cartbar", show);
  const total = cartSubtotal();
  roll($("#cartCount"), n, { up: n >= shownCount });
  const t = $("#cartTotal");
  if (priced(total)) roll(t, money(total), { up: n >= shownCount }); else t.textContent = "";
  shownCount = n;
  bar.setAttribute("aria-label", `View cart, ${plural(n, "item")}${priced(total) ? `, ${money(total)}` : ""}`);
}

/* ── where the food comes from (shown big so a wrong location can't slip through) ── */
// Loud when it's far: on pickup even a few miles matters, because you drive there.
export function storeLocHTML(info) {
  if (!info) return "";
  const mi = typeof info.distance_mi === "number" ? info.distance_mi : null;
  const pickup = state.dining === "PICKUP";
  const far = mi != null && mi >= (pickup ? 6 : 12);
  const kind = info.address_kind === "restaurant" || (!info.address_kind && info.brand_category !== "WONDER_HDR") ? "Made at this restaurant" : `Cooked at Wonder${info.hub_name ? " " + info.hub_name : ""}`;
  const line = info.address ? esc(info.address) : "Location not listed for this store — check before you order";
  return `<div class="loc${far ? " far" : ""}">${icon(far ? "alert" : "pin")}<div><b>${line}</b><small>${esc(kind)}${mi != null ? ` · ${mi.toFixed(1)} mi away` : ""}</small>${far ? `<small class="loc-warn">${mi.toFixed(1)} mi away${pickup ? " — you collect here." : "."} Wrong spot? The location follows the address you entered.</small>` : ""}</div></div>`;
}

/* ── the cart sheet ───────────────────────────────────────────────── */
function lineHTML(l) {
  return `<div class="line" data-key="${esc(l.key)}">
    ${l.image ? `<img class="line-img" src="${esc(l.image)}" alt="" loading="lazy">` : `<span class="line-ph">${icon("utensils")}</span>`}
    <div class="line-main">
      <div class="line-name">${esc(l.name)}</div>
      ${l.optLabel ? `<div class="line-opt">${esc(l.optLabel)}</div>` : ""}
      ${priced(l.price) ? `<div class="line-price" data-price>${money(l.price * l.quantity)}</div>` : ""}
    </div>
    <div class="qty sm" role="group" aria-label="Quantity of ${esc(l.name)}">
      <button type="button" data-d="-1" data-ico="${l.quantity > 1 ? "minus" : "trash"}" aria-label="${l.quantity > 1 ? "One less" : "Remove"}"><span class="ico">${icon(l.quantity > 1 ? "minus" : "trash")}</span></button><span class="qty-n" data-q>${l.quantity}</span><button type="button" data-d="1" aria-label="One more">${icon("plus")}</button>
    </div>
  </div>`;
}
function sumHTML() {
  const sub = cartSubtotal(), min = Number(state.config?.minimumTotalCents) || 0;
  return `<div class="sum-row"><span>Estimated subtotal</span><b data-sub>${priced(sub) ? money(sub) : "—"}</b></div>
    <p class="fine">Final prices, taxes and fees are confirmed when ordering.</p>
    ${min && sub * 100 < min ? `<p class="fine warn">PK Eats has a ${money(min / 100)} minimum total.</p>` : ""}`;
}
function cartHTML() {
  const info = state.store?.info || state.stores.get(state.store?.restaurant_id) || {};
  if (!state.cart.length) {
    return `<div class="sv-scroll"><div class="sheet-head"><h2>Your cart</h2></div><div class="empty" style="padding:24px 0 8px"><div class="empty-ico">${icon("bag")}</div><h3>Your cart is empty</h3><p>Add something from the menu to get a cart code.</p></div></div>
      <div class="sv-foot"><button class="btn btn-secondary btn-block" type="button" data-act="keep">Keep browsing</button></div>`;
  }
  return `<div class="sv-scroll">
      <div class="sheet-head"><h2>Your cart</h2></div>
      ${state.store ? `<div class="cart-store"><span class="cart-store-logo">${logoHTML({ ...info, name: state.store.restaurant_name })}</span><b>${esc(state.store.restaurant_name || "")}</b><button class="btn btn-plain" type="button" data-act="address">Change address</button></div>${storeLocHTML(info)}` : ""}
      <div class="lines">${state.cart.map(lineHTML).join("")}</div>
      <div class="sum" id="cartSum">${sumHTML()}</div>
    </div>
    <div class="sv-foot btn-stack">
      <button class="btn btn-primary btn-block" type="button" id="getCode"><span class="btn-label">Continue to checkout</span></button>
      <button class="btn btn-plain" type="button" data-act="keep">Keep browsing</button>
    </div>`;
}
export function openCart() {
  const view = sheet.open({ key: "cart", html: cartHTML(), label: "Your cart" });
  wireCart(view);
  if (!reduced.matches) cascade(view.querySelectorAll(".cart-store, .loc, .line, .sum"), { variant: "rise", step: 55, delay: 120, duration: 620 });
}
function wireCart(view) {
  view.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "keep") return sheet.close();
    if (act === "address") return editAddress();
    if (e.target.closest("#getCode")) return getCode(e.target.closest("#getCode"));
    const b = e.target.closest("[data-d]");
    if (b) changeQty(view, b);
  });
}
function changeQty(view, btn) {
  const row = btn.closest(".line"), line = state.cart.find((l) => l.key === row.dataset.key);
  if (!line) return;
  const d = Number(btn.dataset.d);
  line.quantity += d;
  syncCartBar(); syncMenuCounts();
  if (line.quantity <= 0) {
    state.cart.splice(state.cart.indexOf(line), 1);
    if (!state.cart.length) { wireCart(sheet.open({ key: "cart", html: cartHTML(), label: "Your cart" })); return; }
    // the row folds away; the sheet follows its height on its own
    const h = row.offsetHeight;
    row.inert = true;
    animate(row, [{ opacity: 1, height: `${h}px`, paddingTop: "14px", paddingBottom: "14px" }, { opacity: 0, height: "0px", paddingTop: "0px", paddingBottom: "0px" }],
      { duration: 300, easing: EASE.out, fill: "forwards" }).then(() => { row.remove(); $(".lines .line [data-d]", view)?.focus({ preventScroll: true }); });
  } else {
    roll($("[data-q]", row), line.quantity, { up: d > 0 });
    const price = $("[data-price]", row);
    if (price) roll(price, money(line.price * line.quantity), { up: d > 0 });
    const minus = $('[data-d="-1"]', row), want = line.quantity > 1 ? "minus" : "trash";
    if (minus.dataset.ico !== want) { minus.dataset.ico = want; replaceIcon($(".ico", minus), icon(want)); minus.setAttribute("aria-label", line.quantity > 1 ? "One less" : "Remove"); }
  }
  const sum = $("#cartSum", view);
  if (sum) {
    const b = $("[data-sub]", sum), sub = cartSubtotal();
    roll(b, priced(sub) ? money(sub) : "—", { up: d > 0 });
    const min = Number(state.config?.minimumTotalCents) || 0, warn = $(".fine.warn", sum);
    if (min && sub * 100 < min && !warn) sheet.morph(() => sum.insertAdjacentHTML("beforeend", `<p class="fine warn">PK Eats has a ${money(min / 100)} minimum total.</p>`));
    else if (!(min && sub * 100 < min) && warn) sheet.morph(() => warn.remove());
  }
}

/* ── cart code ────────────────────────────────────────────────────── */
async function getCode(btn) {
  if (!state.cart.length || btn.disabled) return;
  btn.disabled = true; btn.classList.add("loading"); btn.insertAdjacentHTML("beforeend", spinner());
  try {
    const items = state.cart.map((l) => ({ item_id: l.item_id, name: l.name, category_id: l.category_id, category_name: l.category_name,
      variation_id: l.variation_id, quantity: l.quantity, options: l.options, type: l.type, note: null }));
    const info = state.store?.info || state.stores.get(state.store?.restaurant_id) || {};
    const storePayload = { restaurant_id: state.store.restaurant_id, restaurant_name: state.store.restaurant_name, brand_category: state.store.brand_category,
      // the physical store address, so the order preview can show WHERE it's coming from
      address: info.address || null, address_kind: info.address_kind || null };
    const d = await withSession((s) => api(`/api/cart?sid=${s}`, { method: "POST", body: JSON.stringify({ store: storePayload, items }) }));
    ls.set("yonderVisited", "1");
    showCode(d, info);
  } catch (e) {
    toast(e.message || "Couldn’t make a Wonder cart", { glyph: "alert" });
    btn.disabled = false; btn.classList.remove("loading"); btn.querySelector(".spinner")?.remove();
  }
}

function showCode(d, info) {
  const code = String(d.code || "");
  const view = sheet.open({
    key: "code", label: "Your cart is ready",
    html: `<div class="sv-scroll">
        <div class="done-mark" id="codeMark">${icon("check")}</div>
        <div class="sheet-head" style="margin-bottom:18px"><h2>Your cart is ready</h2><p>${esc(d.store || state.store?.restaurant_name || "")} · ${plural(Number(d.count) || cartCount(), "item")}</p></div>
        ${storeLocHTML(info)}
        <button class="code-box" type="button" id="codeBox" aria-label="Cart code ${esc(code.split("").join(" "))}. Tap to copy.">
          <span class="code-chars" aria-hidden="true">${code.split("").map((c) => `<span>${esc(c)}</span>`).join("")}</span>
          <span class="code-hint"><span class="ico">${icon("copy")}</span><span data-hint>Tap to copy your Wonder cart code</span></span>
        </button>
        <p class="note">Review your price and pay with your balance. Nothing is charged until you confirm.</p>
      </div>
      <div class="sv-foot btn-stack">
        <button class="btn btn-primary btn-block" type="button" id="checkoutContinue">Review checkout</button>
        <button class="btn btn-plain" type="button" data-act="done">Done</button>
      </div>`,
  });
  // the success moment: the mark gathers in, the check draws itself, the code's characters roll up one by one
  const mark = $("#codeMark", view);
  if (!reduced.matches) {
    animate(mark, [{ transform: "scale(.4) rotate(-20deg)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 620, delay: 120, easing: "cubic-bezier(.34,1.56,.64,1)" });
    drawOn($("svg", mark), { delay: 340, duration: 560 });
    setTimeout(() => { ring(mark, { count: 3, size: 2.2 }); burst(mark, { count: 16, spread: 78, size: 7 }); }, 420);
    $$(".code-chars span", view).forEach((s, i) => animate(s, [{ opacity: 0, transform: "translateY(12px)", filter: "blur(4px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }],
      { duration: 520, delay: 380 + i * 55, easing: EASE.out }));
  }
  let copiedTimer = 0;
  $("#codeBox", view).addEventListener("click", async () => {
    const hint = $("[data-hint]", view), ico = $(".code-hint .ico", view);
    try {
      await navigator.clipboard.writeText(code);
      replaceIcon(ico, icon("check")); hint.textContent = "Copied to clipboard"; announce("Cart code copied");
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { if (!hint.isConnected) return; replaceIcon(ico, icon("copy")); hint.textContent = "Tap to copy your Wonder cart code"; }, 2400);
    } catch { toast(`Your code: ${code}`); }
  });
  $("#checkoutContinue", view).addEventListener("click", () => {
    const info2 = state.store?.info || {};
    checkout({ code, fulfillment: state.dining.toLowerCase(), restaurant: state.store?.restaurant_name || "Your cart", count: cartCount(),
      address: state.addressLabel, pickupAddress: info2.address,
      // remembered so the receipt and the bag can show your food even after a sign-in round trip
      lines: state.cart.slice(0, 5).map((l) => ({ n: l.name, q: l.quantity, p: l.price, img: l.image })), more: Math.max(0, state.cart.length - 5) });
  });
  $('[data-act="done"]', view).addEventListener("click", () => sheet.close());
}

/* ── look up a cart code ──────────────────────────────────────────── */
export function openLookup() {
  const view = sheet.open({
    key: "lookup", focus: "#lookupInput",
    html: `<div class="sv-scroll">
      <div class="sheet-head"><h2>Look up a cart code</h2><p>Paste any code to pull its restaurant, address and items.</p></div>
      <form class="form" id="lookupForm" novalidate>
        <input class="input" id="lookupInput" aria-label="Cart code" type="text" placeholder="e.g. 7KQ4M2" enterkeyhint="search" autocapitalize="characters" autocomplete="off" spellcheck="false" style="font-family:var(--sf-mono);letter-spacing:.12em;text-transform:uppercase">
        <button class="btn btn-primary btn-block" type="submit" id="lookupGo"><span class="btn-label">Pull the cart</span></button>
      </form>
      <div id="lookupResult"></div>
    </div>`,
  });
  $("#lookupForm", view).addEventListener("submit", (e) => { e.preventDefault(); doLookup(view); });
}
async function doLookup(view) {
  const input = $("#lookupInput", view), code = input.value.trim().toUpperCase();
  if (!code) { toast("Paste a code first"); input.focus(); return; }
  const btn = $("#lookupGo", view), box = $("#lookupResult", view);
  if (btn.disabled) return;
  btn.disabled = true; btn.classList.add("loading"); btn.insertAdjacentHTML("beforeend", spinner());
  try {
    const d = await api("/api/lookup?code=" + encodeURIComponent(code));
    const a = d.address || {};
    const addr = a.address_name || a._clean_address || [a.address_short_name, a.city, a.state, a.zip_code].filter(Boolean).join(", ") || "Not included in this lookup";
    sheet.morph(() => {
      box.innerHTML = `<div class="list kv">
          <div class="list-row"><span>Restaurant</span><b>${esc(d.restaurant || "Name wasn’t saved with this code")}</b></div>
          <div class="list-row"><span>Type</span><b class="cap">${esc((d.fulfillment || "DELIVERY").toLowerCase())}</b></div>
          <div class="list-row"><span>Address</span><b>${esc(addr)}</b></div>
          <div class="list-row"><span>Items</span><b class="num">${esc(d.count)}</b></div>
        </div>
        <h3 class="section-h">Items</h3>
        <div class="list">${(d.items || []).map((i) => `<div class="list-row"><span class="num" style="color:var(--label-2);min-width:28px">${esc(i.quantity || 1)}×</span><span>${esc(i.menu_item_name || i.menu_item_id)}</span></div>`).join("")}</div>`;
    });
    rise(box, { y: 8, duration: 380 });
  } catch (e) {
    sheet.morph(() => { box.innerHTML = `<div class="msg bad" style="margin-top:16px">${esc(e.message || "Couldn’t find that code")}</div>`; });
    rise(box, { y: 6, duration: 320 });
  } finally { btn.disabled = false; btn.classList.remove("loading"); btn.querySelector(".spinner")?.remove(); }
}

/** After a successful order the cart has done its job. */
export function clearCart() {
  state.cart = [];
  syncCartBar(); syncMenuCounts();
}

export function initCart() {
  $("#cartBagIco").innerHTML = icon("bag");
  bar.addEventListener("click", openCart);
  onScreen(() => syncCartBar({ instant: true }));
}
