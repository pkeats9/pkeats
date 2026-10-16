// The item sheet: variations and option groups with full Wonder fidelity (required/min/max, nested groups,
// prices in options). Choices update in place so the controls animate (radio dots spring in, steppers morph,
// "Required" turns into a drawn check, the price rolls) instead of the whole sheet re-rendering on every tap.
import { $, $$, esc, money, priced, priceHTML, announce } from "./dom.js";
import { state } from "./state.js";
import { api, withSession } from "./api.js";
import * as sheet from "./sheet.js";
import { animate, roll, drawOn, shake, rise, spinner, reduced, EASE, burst, cascade, enter } from "./motion.js";
import { icon } from "./icons.js";
import { findItem } from "./menu.js";
import { addToCart } from "./cart.js";
import { toast } from "./toast.js";

let ctx = null;
const narrowSheet = matchMedia("(max-width: 1068px)");

export function tapItem(id, row) {
  const it = findItem(id);
  if (!it) return;
  // An item with no price of its own is priced through its choices: it always goes through the sheet.
  if (it.customizable || !priced(it.base_price)) openItemSheet(it);
  else addToCart(it, 1, it.quick_add_variation_id || null, [], "", { from: row?.querySelector(".row-img") || row?.querySelector(".row-add") });
}

/* ── rules ────────────────────────────────────────────────────────── */
const groups = () => ctx.detail.groups || [];
function groupVisible(g) { return !g.parent_option_value_id || Object.values(ctx.picks).some((sel) => sel && sel[g.parent_option_value_id]); }
const groupCount = (gid) => Object.values(ctx.picks[gid] || {}).reduce((a, q) => a + q, 0);
const groupDone = (g) => !g.required || groupCount(g.id) >= (g.min || 1);
// "Choose a size" already reads as an instruction; "Protein" needs the verb.
const needLabel = (g) => /^(choose|select|pick|add|make|would|include)\b/i.test(g.name || "") ? g.name : `Choose ${String(g.name || "an option").toLowerCase()}`;
// Where the whole price lives in a required choice, show "$3.50"; everywhere else an option is an add-on, "+$0.75".
const optPrice = (g, v) => priced(v.price) ? `<span class="opt-price">${ctx.detail.prices_in_options && g.required ? "" : "+"}${money(v.price)}</span>` : "";

function unitPrice() {
  const d = ctx.detail, it = ctx.it;
  const variation = (d.variations || []).find((v) => v.id === ctx.variation);
  // Variation prices are absolute. A $0 "Regular" variation means the price is in the choices, so fall back to the
  // item's own base price (0 for those), never to the menu's display "from" price, which would double count the size.
  let price = priced(variation?.price) ? Number(variation.price) : priced(d.base_price) ? Number(d.base_price) : priced(it.base_price) ? Number(it.base_price) : 0;
  for (const g of groups()) {
    if (!groupVisible(g)) continue;
    for (const v of g.values) price += (Number(v.price) || 0) * (ctx.picks[g.id]?.[v.id] || 0);
  }
  return Math.round(price * 100) / 100;
}
function collectOptions() {
  const opts = [];
  for (const g of groups()) {
    if (!groupVisible(g)) continue;
    if (!groupDone(g)) return { error: needLabel(g), group: g.id };
    const values = Object.entries(ctx.picks[g.id] || {}).map(([vid, q]) => ({ option_value_id: vid, quantity: q }));
    if (values.length) opts.push({ option_id: g.id, option_values: values, parent_option_value_id: g.parent_option_value_id || null });
  }
  return { options: opts };
}
function optLabel() {
  const names = [], d = ctx.detail;
  if ((d.variations || []).length > 1) { const v = d.variations.find((x) => x.id === ctx.variation); if (v) names.push(v.name); }
  for (const g of groups()) {
    if (!groupVisible(g)) continue;
    for (const [vid, q] of Object.entries(ctx.picks[g.id] || {})) { const v = g.values.find((x) => x.id === vid); if (v) names.push(q > 1 ? `${q}× ${v.name}` : v.name); }
  }
  return names.join(", ");
}

/* ── markup ───────────────────────────────────────────────────────── */
function shellHTML(it) {
  return `<div class="sv-scroll item-scroll${it.image ? "" : " no-photo"}">
    <div class="item-aside">
      ${it.image ? `<div class="item-photo" data-drag><img src="${esc(it.image)}" alt="" decoding="async"></div>` : ""}
      <div class="item-text">
        <h2 class="item-name">${esc(it.name)}</h2>
        <p class="item-price" id="itemPrice">${priceHTML(it.price, it.price_from)}</p>
        ${it.description ? `<p class="item-desc">${esc(it.description)}</p>` : ""}
      </div>
    </div>
    <div class="item-groups" id="itemGroups"><p class="sheet-note">${spinner()}Loading options…</p></div>
  </div>
  <div class="sv-foot item-foot">
    <div class="qty" id="itemQty" role="group" aria-label="Quantity">
      <button type="button" data-q="-1" aria-label="One less" disabled>${icon("minus")}</button><span class="qty-n" id="itemQtyN" aria-live="polite">1</span><button type="button" data-q="1" aria-label="One more">${icon("plus")}</button>
    </div>
    <button class="btn btn-primary add-btn" type="button" id="itemAdd" disabled><span class="add-fill" aria-hidden="true"></span><span class="btn-label" id="itemAddLabel">Add to cart</span></button>
  </div>`;
}

function groupsHTML() {
  const d = ctx.detail;
  let html = "";
  if ((d.variations || []).length > 1) {
    html += `<div class="opt-group" data-group="__var"><div class="opt-head"><h4>Choose one</h4><span class="req done">${icon("check")}<span>Required</span></span></div>
      <div class="list" role="radiogroup" aria-label="Choose one">${d.variations.map((v) => `<button type="button" class="opt" role="radio" aria-checked="false" data-var="${esc(v.id)}"><span class="radio" aria-hidden="true"></span><span class="opt-name">${esc(v.name || "Option")}</span>${priced(v.price) ? `<span class="opt-price">${money(v.price)}</span>` : ""}</button>`).join("")}</div></div>`;
  }
  for (const g of groups()) {
    if (!groupVisible(g)) continue;
    const hint = g.single ? "Choose one" : g.max && g.max < 90 ? `Up to ${g.max}` : "Choose any";
    const sub = g.required && !g.single && g.max && g.max < 90 ? `<p class="opt-sub">${g.min > 1 ? `Choose ${g.min}` : "Choose at least 1"}${g.max > (g.min || 1) ? `, up to ${g.max}` : ""}</p>` : "";
    html += `<div class="opt-group" data-group="${esc(g.id)}">
      <div class="opt-head"><h4 id="g-${esc(g.id)}">${esc(g.name)}</h4>${g.required ? `<span class="req" data-req>${icon("check")}<span>Required</span></span>` : `<span class="opt-hint">${hint}</span>`}</div>${sub}
      <div class="list" role="${g.single ? "radiogroup" : "group"}" aria-labelledby="g-${esc(g.id)}">${g.values.map((v) => g.single
        ? `<button type="button" class="opt" role="radio" aria-checked="false" data-g="${esc(g.id)}" data-v="${esc(v.id)}" data-single="1"><span class="radio" aria-hidden="true"></span><span class="opt-name">${esc(v.name)}</span>${optPrice(g, v)}</button>`
        : `<div class="opt multi" data-g="${esc(g.id)}" data-v="${esc(v.id)}"><span class="opt-name">${esc(v.name)}</span>${optPrice(g, v)}<span class="mstep"><button type="button" class="m-minus" data-step="-1" aria-label="Remove ${esc(v.name)}" disabled tabindex="-1">${icon("minus")}</button><b class="num" aria-hidden="true">0</b><button type="button" data-step="1" aria-label="Add ${esc(v.name)}">${icon("plus")}</button></span></div>`).join("")}</div></div>`;
  }
  return html || `<p class="sheet-note">No choices to make. Just add it.</p>`;
}

/* ── state → UI ───────────────────────────────────────────────────── */
let visibleKey = "";
function render(animateIn = false) {
  const host = $("#itemGroups");
  if (!host) return;
  visibleKey = groups().filter(groupVisible).map((g) => g.id).join("|");
  const focusKey = document.activeElement?.closest?.("#itemGroups .opt")?.dataset;
  host.innerHTML = groupsHTML();
  sync(true);
  if (animateIn && !reduced.matches) cascade($$(".opt-group, .sheet-note", host), { variant: "rise", step: 70, max: 8, duration: 620 });
  if (focusKey) $$(".opt", host).find((n) => n.dataset.var === focusKey.var && n.dataset.g === focusKey.g && n.dataset.v === focusKey.v)?.focus({ preventScroll: true });
}

function sync(initial = false) {
  const host = $("#itemGroups");
  if (!host) return;
  if (!initial && groups().filter(groupVisible).map((g) => g.id).join("|") !== visibleKey) return render(); // nested groups appeared/disappeared
  $$(".opt[data-var]", host).forEach((b) => { const on = ctx.variation === b.dataset.var; b.classList.toggle("sel", on); b.setAttribute("aria-checked", String(on)); b.tabIndex = on || !ctx.variation ? 0 : -1; });
  $$(".opt[data-single]", host).forEach((b) => { const on = !!ctx.picks[b.dataset.g]?.[b.dataset.v]; b.classList.toggle("sel", on); b.setAttribute("aria-checked", String(on)); });
  $$(".opt.multi", host).forEach((row) => {
    const q = ctx.picks[row.dataset.g]?.[row.dataset.v] || 0;
    const step = $(".mstep", row), minus = $(".m-minus", row), n = $("b", row);
    step.classList.toggle("has", q > 0); row.classList.toggle("sel", q > 0);
    minus.disabled = !q; minus.tabIndex = q ? 0 : -1;
    if (initial) { n.textContent = String(q); n.dataset.v = String(q); } else roll(n, q, { up: q >= Number(n.dataset.v || 0) });
  });
  $$(".opt-group[data-group]", host).forEach((box) => {
    const badge = $("[data-req]", box);
    if (!badge) return;
    const g = groups().find((x) => x.id === box.dataset.group), done = g ? groupDone(g) : true;
    const was = badge.classList.contains("done");
    badge.classList.toggle("done", done);
    if (done && !was && !initial) { drawOn($("svg", badge), { duration: 460 }); burst(badge, { count: 8, spread: 28, size: 4, colors: ["#30d158", "#ffffff", "#7ee3a0"] }); }
  });
  updateButton();
}

function updateButton() {
  const btn = $("#itemAdd"), label = $("#itemAddLabel");
  if (!btn || !ctx) return;
  const price = unitPrice(), pending = groups().filter((g) => groupVisible(g) && !groupDone(g));
  const required = groups().filter((g) => groupVisible(g) && g.required).length;
  const mode = pending.length ? "pending" : "ready";
  btn.classList.toggle("pending", mode === "pending");
  btn.style.setProperty("--p", mode === "ready" ? "1" : String(Math.max(.06, (required - pending.length) / Math.max(1, required))));
  if (label.dataset.mode === "pending" && mode === "ready" && !reduced.matches) {
    btn.classList.remove("lit"); void btn.offsetWidth; btn.classList.add("lit");
    animate(btn, [{ transform: "scale(1)" }, { transform: "scale(1.035)", offset: .4 }, { transform: "scale(1)" }], { duration: 480, key: "ready" });
  }
  const total = priced(price) ? money(price * ctx.qty) : "";
  if (mode === "pending") {
    const text = needLabel(pending[0]);
    if (label.dataset.mode !== "pending" || label.dataset.text !== text) swapLabel(label, esc(text));
    label.dataset.text = text;
  } else if (label.dataset.mode !== "ready") {
    swapLabel(label, `Add to cart${total ? ` · <span class="price-roll">${total}</span>` : ""}`);
  } else {
    const p = $(".price-roll", label);
    if (p && total) roll(p, total, { up: price * ctx.qty >= Number(label.dataset.amount || 0) });
    else if (!p && total) swapLabel(label, `Add to cart · <span class="price-roll">${total}</span>`);
  }
  label.dataset.mode = mode; label.dataset.amount = String(price * ctx.qty);
  // the header price follows the configuration once choices are loaded
  if (ctx.loaded && priced(price)) { const hp = $("#itemPrice"); if (hp && hp.dataset.amount !== String(price)) { hp.dataset.amount = String(price); hp.textContent = money(price); } }
}
function swapLabel(label, html) {
  if (reduced.matches || !label.textContent.trim()) { label.innerHTML = html; return; }
  animate(label, [{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(2px)" }], { duration: 110, fill: "forwards", key: "swap" }).then(() => {
    label.innerHTML = html;
    animate(label, [{ opacity: 0, filter: "blur(2px)", transform: "translateY(3px)" }, { opacity: 1, filter: "blur(0px)", transform: "none" }], { duration: 260, key: "swap" });
  });
}

/* ── the sheet ────────────────────────────────────────────────────── */
async function openItemSheet(it) {
  const context = ctx = { it, detail: { variations: [], groups: [] }, qty: 1, variation: it.quick_add_variation_id || null, picks: {}, loaded: false };
  const view = sheet.open({
    key: "item", wide: true, closeOnMedia: !!it.image && narrowSheet.matches,
    html: shellHTML(it),
    onClose: () => { if (ctx === context) ctx = null; },
  });
  wire(view);
  try {
    const d = await withSession((s) => api(`/api/item?sid=${s}&rid=${encodeURIComponent(state.store.restaurant_id)}&iid=${encodeURIComponent(it.item_id)}&brand=${encodeURIComponent(state.store.brand_category || "WONDER_LOCAL")}`));
    if (ctx !== context) return;
    ctx.detail = d; ctx.loaded = true;
    const dv = (d.variations || []).find((v) => v.default) || (d.variations || [])[0];
    if (dv) ctx.variation = dv.id;
    for (const g of d.groups || []) {
      const defs = g.values.filter((v) => v.default);
      if (defs.length) { ctx.picks[g.id] = {}; (g.single ? defs.slice(0, 1) : defs).forEach((v) => (ctx.picks[g.id][v.id] = 1)); }
    }
    if (!priced(it.price) && priced(d.from_price)) $("#itemPrice").innerHTML = priceHTML(d.from_price, true);
    render(true);
    $("#itemAdd").disabled = false;
  } catch {
    if (ctx !== context) return;
    $("#itemGroups").innerHTML = `<p class="sheet-note">${icon("alert")}Couldn’t load the choices for this item. Close this panel and try it again.</p>`;
  }
}

function wire(view) {
  const host = $("#itemGroups", view);
  host.addEventListener("click", (e) => {
    if (!ctx?.loaded) return;
    const stepBtn = e.target.closest("[data-step]");
    if (stepBtn) {
      const row = stepBtn.closest(".opt"), gid = row.dataset.g, vid = row.dataset.v, g = groups().find((x) => x.id === gid);
      const step = Number(stepBtn.dataset.step);
      ctx.picks[gid] ||= {};
      if (step > 0 && g?.max && g.max < 90 && groupCount(gid) >= g.max) { shake($(".opt-head", row.closest(".opt-group"))); return toast(`You can choose up to ${g.max}`); }
      const q = (ctx.picks[gid][vid] || 0) + step;
      if (q <= 0) delete ctx.picks[gid][vid]; else ctx.picks[gid][vid] = q;
      return sync();
    }
    const opt = e.target.closest(".opt");
    if (!opt || opt.classList.contains("multi")) return;
    if (opt.dataset.var) ctx.variation = opt.dataset.var;
    else if (opt.dataset.single) {
      const g = groups().find((x) => x.id === opt.dataset.g);
      // an optional single choice can be tapped again to clear it
      if (g && !g.required && ctx.picks[g.id]?.[opt.dataset.v]) delete ctx.picks[g.id];
      else ctx.picks[opt.dataset.g] = { [opt.dataset.v]: 1 };
    }
    sync();
  });
  // arrow keys move within a radio group
  host.addEventListener("keydown", (e) => {
    const opt = e.target.closest?.('.opt[role="radio"]');
    if (!opt || !["ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const list = $$('.opt[role="radio"]', opt.parentElement), i = list.indexOf(opt);
    list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
  });
  $("#itemQty", view).addEventListener("click", (e) => {
    const b = e.target.closest("[data-q]");
    if (!b || !ctx) return;
    const before = ctx.qty;
    ctx.qty = Math.min(99, Math.max(1, ctx.qty + Number(b.dataset.q)));
    if (ctx.qty === before) return;
    roll($("#itemQtyN"), ctx.qty, { up: ctx.qty > before });
    $('[data-q="-1"]', view).disabled = ctx.qty <= 1;
    updateButton();
  });
  $("#itemAdd", view).addEventListener("click", () => {
    if (!ctx?.loaded) return;
    const res = collectOptions();
    if (res.error) {
      const box = $(`.opt-group[data-group="${CSS.escape(res.group)}"]`, view);
      if (box) {
        box.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "center" });
        box.classList.remove("flag"); void box.offsetWidth; box.classList.add("flag");
      }
      announce(res.error);
      return;
    }
    const { it } = ctx;
    const photo = $(".item-photo img", view);
    burst($("#itemAdd", view), { count: 12, spread: 54 });
    addToCart({ ...it, price: unitPrice() }, ctx.qty, ctx.variation, res.options, optLabel(), { from: photo });
    sheet.close();
  });
}
