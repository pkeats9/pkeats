// Account, wallet, checkout, payment and live tracking — the same server contract as the original site.js
// (/api/site/* jobs with idempotency keys, CSRF, sign-in round trips, resumable pending jobs), presented as views
// in the one sheet so the whole checkout reads as a single surface that morphs from step to step.
import { $, $$, esc, cash, fmtDate as date, plain, safeUrl, store as ls, initials, announce } from "./dom.js";
import { state } from "./state.js";
import { site } from "./api.js";
import * as sheet from "./sheet.js";
import { spinner, drawOn, countTo, rise, animate, replaceIcon, segmented, shake, reduced, EASE, burst, ring, cascade } from "./motion.js";
import { icon, logo } from "./icons.js";
import { toast } from "./toast.js";
import { setAccount, setOrderStatus } from "./chrome.js";
import { applyFulfillment, setLive, editAddress } from "./hero.js";
import { clearCart } from "./cart.js";
import { receiptScene, packScene } from "./scenes.js";

let me = null, config = {}, busy = false, accountTab = "wallet", pollTimer = 0, trackTimer = 0, holdTimer = 0;
let shownBalance = null, shownProgress = {}, lastDraft = null, landedFrom = "";
const api = (path, options) => site.call(path, options);

/* ── view helpers ─────────────────────────────────────────────────── */
const panel = (html, opts = {}) => sheet.open({ key: "account", html, ...opts });
const closePanel = () => sheet.close();
const foot = (inner, cls = "btn-stack") => `<div class="sv-foot ${cls}">${inner}</div>`;
const head = (eyebrow, title, sub = "") => `<div class="sheet-head">${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ""}<h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div>`;

function message(text, title = "Couldn’t finish that") {
  const v = panel(`<div class="sv-scroll">${head("PK Eats", esc(title))}<div class="msg">${esc(plain(text))}</div></div>${foot(`<button class="btn btn-primary btn-block" type="button" data-act="account">Open my account</button>`)}`);
  $('[data-act="account"]', v).onclick = () => account();
}

const ALLERGEN_NOTE = `<p class="note">Food allergy? Menu and allergen details come from the restaurant and may be incomplete. Check with the restaurant before ordering. <a href="/terms#food" target="_blank" rel="noopener">Learn more</a></p>`;
/* One checkbox covers the Terms, the age rule and the allergen notice. Shown until the account accepts the current terms. */
function termsBox() {
  if (!me || me.terms?.accepted) return "";
  return `<label class="agree"><input type="checkbox" id="pkAgree" required><span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a>. I am 18 or older, or 13 to 17 with a parent or guardian's permission. I understand allergen information comes from the restaurant and may be incomplete, so I will check with the restaurant about any food allergy.</span></label>`;
}
async function acceptTerms() {
  if (!me || me.terms?.accepted) return;
  if (!$("#pkAgree")?.checked) { const e = new Error("Check the box to agree to the Terms, age requirement and allergen notice."); e.agree = true; throw e; }
  const r = await api("/api/site/terms", { method: "POST", body: JSON.stringify({ agree: true, version: me.terms.version }) });
  me.terms = { version: r.version, accepted: true };
}
/* A missing tick stays on the same screen instead of replacing it with an error. */
function agreeError(e) {
  if (!e.agree) return false;
  const box = $(".agree");
  box?.classList.add("error"); shake(box); box?.querySelector("input")?.focus();
  box?.scrollIntoView({ block: "center", behavior: reduced.matches ? "auto" : "smooth" });
  announce(e.message);
  return true;
}
document.addEventListener("change", (e) => { if (e.target.id === "pkAgree") e.target.closest(".agree")?.classList.remove("error"); });

/* ── who's signed in ──────────────────────────────────────────────── */
// Placed orders from the last few hours that tracking hasn't shown as finished: the "Order status" capsule.
const ACTIVE_ORDER_MS = 3 * 60 * 60 * 1000, finishedOrders = new Set();
const activeOrders = () => (me?.payments || []).filter((p) => p.purpose === "order" && (p.order_status === "placed" || safeUrl(p.tracking_url)) &&
  p.status !== "canceled" && !finishedOrders.has(p.payment_code) && Date.now() - new Date(p.created_at).getTime() < ACTIVE_ORDER_MS);
const updateOrderNav = () => setOrderStatus(activeOrders().length);

async function loadMe() {
  try { me = await api("/api/site/me"); site.csrf = me.csrf; }
  catch (e) { if (e.status === 401) { me = null; site.csrf = ""; } else throw e; }
  finally { state.me = me; setAccount(me); updateOrderNav(); }
  return me;
}

function login() {
  const ready = config.signIn || {};
  panel(`<div class="sv-scroll">${head("Your PK Eats account", "Sign in to order.", "Your balance, orders and tracking, all in one place.")}
      <div class="btn-stack">
        <a class="provider provider-google${ready.google ? "" : " is-off"}" href="/auth/google"${ready.google ? "" : ' aria-disabled="true"'}>${logo("google")}Continue with Google</a>
        <a class="provider provider-discord${ready.discord ? "" : " is-off"}" href="/auth/discord"${ready.discord ? "" : ' aria-disabled="true"'}>${logo("discord")}Continue with Discord</a>
      </div>
      <p class="note">Already order in the PK Eats Discord? Continue with Discord to keep the same balance.</p>
    </div>`, { label: "Sign in" });
}

const NOTICES = {
  signed_in: ["You're signed in.", "Welcome to PK Eats"],
  linked: ["Discord is linked. Your account now uses the same balance as the PK Eats Discord.", "Discord linked"],
  cancelled: ["Sign-in was cancelled.", "Sign-in cancelled"],
  failed: ["Sign-in didn't work. Please try again.", "Sign-in failed"],
  expired: ["That sign-in took too long or was opened in another browser. Please try again.", "Sign-in expired"],
  unverified: ["That Google account's email isn't verified yet.", "Email not verified"],
  unavailable: ["That sign-in option isn't set up yet.", "Sign-in unavailable"],
  already_linked: ["A different Discord account is already linked to your account.", "Already linked"],
  discord_taken: ["That Discord account is already linked to another PK Eats account.", "Discord already in use"],
  web_wallet_in_use: ["Your website balance has been used, so it can't be swapped for your Discord balance. Contact PK Eats support to combine them.", "Can't link Discord"],
};
/* The result of a Google or Discord sign-in arrives as #notice=… */
async function noticeFromRedirect() {
  const code = new URLSearchParams(location.hash.slice(1)).get("notice");
  if (!code) return false;
  history.replaceState(history.state, "", location.pathname);
  await loadMe();
  const after = ls.get("pkAfterSignIn"); ls.remove("pkAfterSignIn");
  if (me && code === "signed_in" && after === "/admin") { location.replace("/admin"); return true; }
  if (me && (code === "signed_in" || code === "linked")) {
    try { await run("sync", {}, { quiet: true }); } catch {}
    const draft = checkoutDraft();
    if (draft && code === "signed_in") await resumeCheckout(draft);
    else {
      if (code === "linked") accountTab = "wallet";
      accountView();
      toast(code === "linked" ? "Discord linked · one balance everywhere" : `Welcome, ${(me.user?.name || "").split(" ")[0] || "back"}`, { glyph: "circle-check" });
    }
    return true;
  }
  const [text, title] = NOTICES[code] || NOTICES.failed;
  if (me) message(text, title);
  else { login(); const v = sheet.view(); v?.querySelector(".sheet-head")?.insertAdjacentHTML("afterend", `<div class="msg bad" role="alert">${esc(text)}</div>`); }
  return true;
}
async function ensureLogin() { await loadMe(); if (me) return true; login(); return false; }

/* ── jobs: the server does the work, we poll; a reload resumes the same job ── */
const TITLES = { sync: "Refreshing your account", prepare: "Getting your price", pay: "Placing your order", deposit: "Getting your deposit ready",
  checkDeposit: "Checking your payment", cancel: "Canceling your checkout", track: "Checking your order" };
const GLYPH = { sync: "refresh-cw", prepare: "receipt", pay: "bag", deposit: "wallet", checkDeposit: "wallet", cancel: "x", track: "navigation" };
let scene = null;
/** The progress view: the receipt while pricing, the bag while paying, a live ring for everything else. */
function progress(action, ctx = {}) {
  scene?.fail?.();
  const sc = action === "prepare" ? receiptScene(ctx.draft || checkoutDraft() || {}) : action === "pay" ? packScene(ctx.draft || lastDraft || {}) : null;
  const visual = sc ? sc.html : action === "track"
    ? `<div class="radar sm" aria-hidden="true"><i></i><i></i><i></i><span class="radar-core">${icon("navigation")}</span></div>`
    : `<div class="act-ring" aria-hidden="true"><svg viewBox="0 0 80 80"><circle class="track" cx="40" cy="40" r="35"/><circle class="arc" cx="40" cy="40" r="35"/></svg><span>${icon(GLYPH[action] || "clock")}</span></div>`;
  const v = panel(`<div class="sv-scroll"><div class="progress-view${sc ? " has-scene" : ""}">${visual}<h2>${TITLES[action] || "Working on it"}</h2><p role="status">${action === "pay"
    ? "Your balance payment is being processed. Please wait for the result before placing another order."
    : "This can take a moment. You can leave this window open while we finish."}</p></div></div>`, { label: TITLES[action] });
  scene = sc ? { ...sc, view: v } : null;
  sc?.start(v);
  return scene;
}
async function finishJob(id) {
  const started = Date.now();
  while (Date.now() - started < 240000) {
    const j = await api(`/api/site/jobs/${encodeURIComponent(id)}`);
    if (["done", "failed", "review"].includes(j.status)) {
      ls.remove("pkPendingJob");
      if (j.status === "failed" || j.result?.error) throw new Error(j.result?.error || "This request needs review.");
      await loadMe(); return j.result || {};
    }
    await new Promise((r) => setTimeout(r, 1600));
  }
  throw new Error("This request is still processing. Open your account to check its status before placing another order.");
}
async function run(action, payload = {}, { quiet = false, ctx } = {}) {
  if (busy) throw new Error("Your previous request is still processing.");
  busy = true;
  const sc = quiet ? null : progress(action, ctx);
  try {
    const idempotency = crypto.randomUUID();
    ls.set("pkPendingJob", JSON.stringify({ key: idempotency, action, payload, userId: me.user.id }));
    const j = await api("/api/site/jobs", { method: "POST", body: JSON.stringify({ action, payload }), headers: { "Content-Type": "application/json", "X-CSRF-Token": site.csrf, "Idempotency-Key": idempotency } });
    ls.set("pkPendingJob", JSON.stringify({ id: j.id, action, userId: me.user.id }));
    const result = await finishJob(j.id);
    if (sc) { await sc.finish(result, sc.view); landedFrom = action; }   // let the scene land before the next view takes over
    return result;
  } catch (e) {
    sc?.fail?.();
    if (e.status && e.status < 500) ls.remove("pkPendingJob");
    throw e;
  } finally { busy = false; }
}

/* ── checkout ─────────────────────────────────────────────────────── */
function checkoutDraft() {
  const d = ls.json("pkCheckoutDraft");
  return d && /^[A-Z0-9]{6}$/.test(d.code) && Date.now() - d.savedAt < 2 * 3600000 ? d : null;
}
/** From the cart code: save the draft (it survives a sign-in round trip), then continue. */
export async function checkout(draft) {
  ls.set("pkCheckoutDraft", JSON.stringify({ ...draft, savedAt: Date.now() }));
  await resumeCheckout(checkoutDraft() || draft);
}
async function resumeCheckout(draft) {
  if (!(await ensureLogin())) return;
  lastDraft = draft;
  const { code, fulfillment } = draft, delivery = fulfillment === "delivery";
  const v = panel(`<div class="sv-scroll">${head(`${delivery ? "Delivery" : "Pickup"} order`, "One last look.", `${esc(draft.restaurant)} · ${Number(draft.count) || 0} item${Number(draft.count) === 1 ? "" : "s"}`)}
      <form class="form" id="pkCheckoutForm" novalidate>
        ${delivery ? `<div class="field"><label class="field-label" for="pkDeliveryAddress">Delivery address, including apartment or unit</label><input class="input" id="pkDeliveryAddress" value="${esc(draft.address)}" autocomplete="street-address" required></div>
          <div class="field"><span class="field-label" id="tipLabel">Driver tip</span>
            <div class="amount-chips" role="group" aria-labelledby="tipLabel">${[0, 2, 3, 5].map((t) => `<button type="button" data-tip="${t}" aria-pressed="${t === 0}">$${t}</button>`).join("")}</div>
            <input class="input num" id="pkDriverTip" type="number" min="0" max="50" step="0.01" value="0" inputmode="decimal" aria-labelledby="tipLabel"></div>
          <div class="field"><label class="field-label" for="pkDeliveryNotes">Delivery instructions</label><textarea class="input" id="pkDeliveryNotes" maxlength="500" placeholder="Apartment, gate code, or drop-off instructions"></textarea></div>`
        : `<div class="loc">${icon("store")}<div><b>Pick up at</b><small>${esc(draft.pickupAddress || "Check the restaurant address in the menu before continuing.")}</small></div></div>`}
        <p class="note" style="margin-top:0">We’ll confirm your exact total before charging your balance.</p>
        ${ALLERGEN_NOTE}${termsBox()}
      </form>
    </div>${foot(`<button class="btn btn-primary btn-block" type="submit" form="pkCheckoutForm"><span class="btn-label">Get my price</span></button>`)}`, { label: "Checkout" });
  const tip = $("#pkDriverTip", v);
  $$("[data-tip]", v).forEach((b) => b.addEventListener("click", () => { tip.value = b.dataset.tip; $$("[data-tip]", v).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }));
  tip?.addEventListener("input", () => $$("[data-tip]", v).forEach((x) => x.setAttribute("aria-pressed", String(Number(x.dataset.tip) === Number(tip.value)))));
  $("#pkCheckoutForm", v).onsubmit = async (e) => {
    e.preventDefault();
    const addr = $("#pkDeliveryAddress", v);
    if (addr && !addr.value.trim()) { shake(addr); addr.focus(); return; }
    const payload = { cartCode: code, fulfillment, address: addr?.value || "", tip: Number(tip?.value || 0), deliveryNotes: $("#pkDeliveryNotes", v)?.value || "" };
    try { await acceptTerms(); quoteView(await run("prepare", payload, { ctx: { draft } })); }
    catch (err) { if (!agreeError(err)) message(err.message); }
  };
}

function quoteView(q) {
  ls.remove("pkCheckoutDraft");
  clearInterval(holdTimer);
  const balance = me?.snapshot?.balanceCents;
  const expired = Date.now() >= new Date(q.expiresAt).getTime();
  const short = balance != null && balance < q.amountDueCents;
  const v = panel(`<div class="sv-scroll">${head(`${q.fulfillment === "delivery" ? "Delivery" : "Pickup"} checkout`, esc(q.restaurant || "Your order"), q.address ? esc(q.address) : "")}
      <div class="list">${(q.items || []).map((i) => `<div class="list-row"><span class="num" style="color:var(--label-2);min-width:28px">${Number(i.quantity) || 1}×</span><span>${esc(i.name || i.menu_item_name || "Food item")}</span></div>`).join("")}</div>
      <div class="total-row"><span>Your total</span><b>${cash(q.amountDueCents)}</b></div>
      <div class="list kv" style="margin-top:8px"><div class="list-row"><span>Available balance</span><b class="num">${balance == null ? "Refresh needed" : cash(balance)}</b></div></div>
      <p class="note" data-hold>${expired ? "This checkout has expired. Cancel it and prepare a fresh checkout." : `Price held for <b class="num" data-left></b>. Your balance is charged when you confirm.`}</p>
      ${short ? '<div class="msg warn" style="margin-top:14px">Add funds to cover your order, then return here to pay.</div>' : ""}
      ${ALLERGEN_NOTE}${termsBox()}
    </div>${foot(`<button class="btn btn-primary btn-block" type="button" id="pkPay" ${expired || balance == null || short ? "disabled" : ""}><span class="btn-label">Pay ${cash(q.amountDueCents)} with balance</span></button>
      <div class="btn-row"><button class="btn btn-secondary" type="button" id="pkQuoteFunds">Add funds</button><button class="btn btn-secondary" type="button" id="pkCancelQuote">Cancel checkout</button></div>`)}`,
  { label: "Your price", onLeave: () => clearInterval(holdTimer) });
  // a live hold countdown (the server holds the price for 15 minutes)
  const left = $("[data-left]", v);
  if (left) {
    const tick = () => {
      const ms = new Date(q.expiresAt).getTime() - Date.now();
      if (ms <= 0) { clearInterval(holdTimer); if (sheet.view() === v) quoteView(q); return; }
      left.textContent = `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
    };
    tick(); holdTimer = setInterval(tick, 1000);
  }
  $("#pkPay", v).onclick = async () => { try { await acceptTerms(); paymentResult(await run("pay", { paymentCode: q.paymentCode }, { ctx: { draft: lastDraft || {} } })); } catch (e) { if (!agreeError(e)) message(e.message); } };
  $("#pkQuoteFunds", v).onclick = depositForm;
  $("#pkCancelQuote", v).onclick = async () => { try { await run("cancel", { paymentCode: q.paymentCode }); await account(false); } catch (e) { message(e.message); } };
}

// Wonder's internal order id (a UUID) means nothing to customers; only the short counter code (L929956) is shown.
const shownOrderNumber = (n) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(String(n || "")) ? "" : String(n || ""));

function paymentResult(r) {
  if (r.orderStatus !== "placed" && !r.orderNumber) return message(r.message || "Check your account for the latest order status.", r.refunded ? "This order failed" : r.held ? "Your order is being checked" : "Order update");
  clearCart();
  const no = shownOrderNumber(r.orderNumber);
  const v = panel(`<div class="sv-scroll"><div class="result-view">
      <div class="done-mark" data-mark>${icon("check")}</div>
      <p class="eyebrow">Order placed</p>
      <h2 class="t-title">Your meal is confirmed.</h2>
      ${no ? `<p class="order-no">${esc(no)}</p>` : ""}
      <p class="muted" style="margin-top:${no ? 0 : 10}px">Your order is confirmed${no ? ` as ${esc(no)}` : ""}. Your balance was charged once.</p>
    </div></div>${foot(`<button class="btn btn-primary btn-block" type="button" id="pkTrackSuccess">Track my order</button><button class="btn btn-plain" type="button" id="pkSuccessAccount">View my orders</button>`)}`, { label: "Order placed" });
  const mark = $("[data-mark]", v);
  const fromBag = landedFrom === "pay"; landedFrom = "";    // the bag already turned into this check: keep it on screen
  const flapHost = $(".order-no", v);
  if (flapHost && !reduced.matches) {
    flapHost.innerHTML = [...no].map((ch) => `<span class="flap">${esc(ch)}</span>`).join("");
    $$(".flap", flapHost).forEach((f, i) => animate(f, [{ transform: "rotateX(-95deg)", opacity: 0 }, { transform: "rotateX(0deg)", opacity: 1 }], { duration: 620, delay: 560 + i * 70, easing: EASE.out }));
  }
  if (!reduced.matches) {
    if (!fromBag) {
      animate(mark, [{ transform: "scale(.4) rotate(-20deg)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 640, delay: 120, easing: "cubic-bezier(.34,1.56,.64,1)" });
      drawOn($("svg", mark), { delay: 360, duration: 600 });
      setTimeout(() => { ring(mark, { count: 3, size: 2.4 }); burst(mark, { count: 22, spread: 96, size: 8 }); }, 460);
    } else setTimeout(() => ring(mark, { count: 2, size: 2 }), 200);
    cascade(v.querySelectorAll(".result-view > :not([data-mark]), .sv-foot > *"), { variant: "rise", step: 55, delay: fromBag ? 40 : 160, duration: 600 });
  }
  $("#pkTrackSuccess", v).onclick = () => trackOrder(r.paymentCode);
  $("#pkSuccessAccount", v).onclick = () => { accountTab = "orders"; account(false); };
}

/* ── live tracking ────────────────────────────────────────────────── */
/* Tracking comes straight from Yonder; if this server has no Yonder key yet, the bot answers instead. */
async function liveTrack(paymentCode, quiet = false) {
  try { return await api("/api/site/track", { method: "POST", body: JSON.stringify({ paymentCode }) }); }
  catch (e) {
    if (e.code !== "YONDER_NOT_CONFIGURED") throw e;
    if (quiet) {
      const j = await api("/api/site/jobs", { method: "POST", body: JSON.stringify({ action: "track", payload: { paymentCode } }), headers: { "Idempotency-Key": crypto.randomUUID() } });
      return finishJob(j.id);
    }
    return run("track", { paymentCode });
  }
}
async function trackOrder(paymentCode) {
  if (busy) return message("Your previous request is still processing.", "Tracking update");
  progress("track");
  try { trackingView(await liveTrack(paymentCode)); } catch (e) { message(e.message, "Tracking update"); }
}
// Yonder's status words ("PICKED_UP", "out_for_delivery") read as plain English.
const statusWords = (value) => { const t = String(value || "").replace(/[_-]+/g, " ").trim().toLowerCase(); return t ? t[0].toUpperCase() + t.slice(1) : "Order placed"; };
const TRACK_EVERY_MS = 30000;
const mapsLink = (address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
const telLink = (phone) => (/^\+?\d{7,15}$/.test(String(phone || "")) ? `tel:${phone}` : "");
// Yonder sends the ETA either as words ("20 minutes") or as a timestamp; a timestamp reads as a clock time.
function etaParts(eta) {
  const at = /^\d{4}-\d{2}-\d{2}T/.test(String(eta || "")) ? new Date(eta) : null;
  const ok = at && !isNaN(at);
  return { at: ok ? at.getTime() : "", when: ok ? (at.toDateString() === new Date().toDateString() ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : date(at)) : String(eta || "") };
}
const isDone = (r) => /delivered|picked up by you|completed|fulfilled|canceled|cancelled/i.test(String(r.status || "")) || (r.fulfillment === "pickup" && /picked up|collected/i.test(String(r.status || "")));

function trackingHTML(r) {
  r = { ...r, orderNumber: shownOrderNumber(r.orderNumber) };
  const pickup = r.fulfillment === "pickup", st = r.store || {}, courier = r.courier || {}, steps = r.steps || [], items = r.items || [];
  const whereName = st.name || r.restaurant || "the restaurant";
  const counter = pickup && r.orderNumber ? `<div class="counter"><small>Show at the counter</small><div class="big">${esc(r.orderNumber)}</div><small>Order number</small>${r.customerName ? `<hr><small>Name on the order</small><strong>${esc(r.customerName)}</strong>` : ""}<p>Give your order number${r.customerName ? " and name" : ""} at the ${esc(whereName)} counter to collect it.</p></div>` : "";
  const eta = r.eta ? etaParts(r.eta) : null;
  const done = steps.filter((s) => s.done).length + (steps.some((s) => s.current && !s.done) ? .5 : 0);
  const status = `<div class="track-status" data-tracking="${esc(r.paymentCode)}" data-eta-at="${eta?.at || ""}">
      <p class="eyebrow">Current status</p>
      <h3 role="status">${esc(statusWords(r.status))}</h3>
      ${eta ? `<div class="track-eta"><b>${esc(eta.when)}</b><span>${pickup ? "estimated ready time" : "estimated arrival"}</span></div>` : ""}
      ${!counter && r.orderNumber ? `<p class="muted" style="margin-top:8px">Order ${esc(r.orderNumber)}</p>` : ""}
      ${steps.length ? `<div class="track-bar" aria-hidden="true"><i data-p="${(done / steps.length).toFixed(3)}" style="--p:${shownProgress[r.paymentCode] ?? 0}"></i></div>` : ""}
    </div>`;
  const prog = steps.length ? `<h3 class="section-h">Progress</h3><ol class="steps-v">${steps.map((s) => `<li class="${s.done ? "done" : ""}${s.current ? " current" : ""}"><span class="pt" aria-hidden="true"></span><div><b>${esc(s.label)}</b>${s.at ? `<small>${esc(date(s.at))}</small>` : ""}${s.detail ? `<small>${esc(s.detail)}</small>` : ""}</div></li>`).join("")}</ol>` : "";
  const rows = [];
  if (pickup && (st.address || st.name)) rows.push(`<a class="list-row" ${st.address ? `href="${esc(mapsLink(st.address))}" target="_blank" rel="noopener"` : ""}>${icon("pin")}<span><b>Collect at ${esc(whereName)}</b>${st.address ? `<small>${esc(st.address)}</small>` : ""}</span>${st.address ? `<span class="end">${icon("external")}</span>` : ""}</a>`);
  if (!pickup && r.deliveryAddress) rows.push(`<div class="list-row">${icon("pin")}<span><b>Delivering to</b><small>${esc(r.deliveryAddress)}</small></span></div>`);
  if (!pickup && courier.name) rows.push(`<${telLink(courier.phone) ? `a href="${esc(telLink(courier.phone))}"` : "div"} class="list-row">${icon("bike")}<span><b>${esc(courier.name)} is your courier</b>${courier.vehicle ? `<small>${esc(courier.vehicle)}</small>` : ""}</span></${telLink(courier.phone) ? "a" : "div"}>`);
  if (telLink(st.phone)) rows.push(`<a class="list-row" href="${esc(telLink(st.phone))}">${icon("phone")}<span><b>Call ${esc(whereName)}</b></span></a>`);
  const loc = rows.length ? `<h3 class="section-h">${pickup ? "Pickup location" : "Delivery"}</h3><div class="list">${rows.join("")}</div>` : "";
  const order = items.length ? `<h3 class="section-h">Your order</h3><div class="list">${items.map((it) => `<div class="list-row"><span class="num" style="color:var(--label-2);min-width:28px">${esc(it.quantity)}×</span><span><b style="font-weight:400">${esc(it.name)}</b>${it.detail ? `<small>${esc(it.detail)}</small>` : ""}</span></div>`).join("")}</div>` : "";
  const details = r.orderNumber && (counter || steps.length) ? `<h3 class="section-h">Details</h3><div class="list"><div class="list-row">${icon("ticket")}<span><b>Order details</b><small>#${esc(r.orderNumber)}${r.placedAt ? ` · ${esc(date(r.placedAt))}` : ""}</small></span></div></div>` : "";
  const finished = isDone(r);
  const meta = `<p class="track-meta">${finished ? icon("circle-check") : `<span class="dot" aria-hidden="true"></span>`}<span>Last checked ${esc(date(r.checkedAt || Date.now()))}.${finished ? "" : " Updates by itself every 30 seconds."}</span></p>`;
  const directions = pickup && st.address ? `<a class="btn btn-primary btn-block" href="${esc(mapsLink(st.address))}" target="_blank" rel="noopener">Directions</a>` : "";
  const live = safeUrl(r.trackingUrl) ? `<a class="btn btn-secondary" href="${esc(safeUrl(r.trackingUrl))}" target="_blank" rel="noopener">Open live tracking</a>` : "";
  return `<div class="sv-scroll">${head("Live order tracking", esc(r.restaurant || st.name || "Your order"))}${counter}${status}${prog}${loc}${order}${details}${meta}</div>
    ${foot(`${directions}<div class="btn-row">${live || ""}<button class="btn ${directions ? "btn-secondary" : "btn-primary"}" type="button" data-act="refresh"${live ? "" : ' style="grid-column:1/-1"'}>Refresh now</button></div><button class="btn btn-plain" type="button" data-act="orders">Back to my orders</button>`)}`;
}
function settleBar(v, code) {
  const bar = $(".track-bar i", v);
  if (!bar) return;
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.setProperty("--p", bar.dataset.p); shownProgress[code] = bar.dataset.p; }));
}
function trackingView(r, { inPlace = false } = {}) {
  clearTimeout(trackTimer);
  if (isDone(r)) { finishedOrders.add(r.paymentCode); updateOrderNav(); }
  let v;
  if (inPlace && trackingOpen(r.paymentCode)) {
    const scroller = $(".sv-scroll", sheet.view()), top = scroller?.scrollTop || 0;
    v = sheet.refresh(trackingHTML(r));
    const s2 = $(".sv-scroll", v); if (s2) s2.scrollTop = top;
  } else {
    v = panel(trackingHTML(r), { label: "Order tracking", onLeave: () => clearTimeout(trackTimer) });
    if (!reduced.matches) cascade(v.querySelectorAll(".sv-scroll > *"), { variant: "rise", step: 55, delay: 60, duration: 640, max: 10 });
  }
  settleBar(v, r.paymentCode);
  v.onclick = (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "refresh") trackOrder(r.paymentCode);
    else if (act === "orders") { clearTimeout(trackTimer); accountTab = "orders"; account(false); }
  };
  if (!isDone(r)) trackTimer = setTimeout(() => refreshTracking(r.paymentCode), TRACK_EVERY_MS);
}
const trackingOpen = (code) => sheet.currentKey() === "account" && $(".track-status", sheet.view() || document.createElement("i"))?.dataset.tracking === code;
/* A quiet refresh: no spinner, and only while this order's tracking is still on screen. */
async function refreshTracking(code) {
  if (!trackingOpen(code) || document.hidden) {
    if (trackingOpen(code)) trackTimer = setTimeout(() => refreshTracking(code), TRACK_EVERY_MS);
    return;
  }
  if (busy) { trackTimer = setTimeout(() => refreshTracking(code), TRACK_EVERY_MS); return; }
  busy = true;
  try { const r = await liveTrack(code, true); if (trackingOpen(code)) { busy = false; trackingView(r, { inPlace: true }); } }
  catch { if (trackingOpen(code)) trackTimer = setTimeout(() => refreshTracking(code), TRACK_EVERY_MS); }
  finally { busy = false; }
}

/* ── wallet: add funds ────────────────────────────────────────────── */
const PROVIDER_LOGO = { venmo: "venmo", paypal: "paypal", zelle: "zelle" };
const PROVIDER_NAME = { venmo: "Venmo", paypal: "PayPal", zelle: "Zelle" };
function depositForm() {
  if (!me) return login();
  const linked = me.user.discordLinked !== false;
  const providers = (config.providers || []).filter((p) => linked || p.id !== "zelle");
  const min = (config.depositMinimumCents || 100) / 100, max = (config.depositMaximumCents || 100000) / 100;
  const v = panel(`<div class="sv-scroll">${head("Your PK Eats wallet", "Add funds.", linked ? "Deposits go into the same balance you use in Discord." : "Deposits go into your PK Eats balance.")}
      <form class="form" id="pkDepositForm" novalidate>
        <div class="field"><label class="field-label" for="pkDepositAmount">Amount</label>
          <div class="amount-chips" role="group" aria-label="Quick amounts">${[10, 20, 50, 100].filter((a) => a >= min && a <= max).map((a) => `<button type="button" data-amt="${a}" aria-pressed="false">$${a}</button>`).join("")}</div>
          <input class="input num" id="pkDepositAmount" type="number" step="0.01" min="${min}" max="${max}" placeholder="20.00" inputmode="decimal" required></div>
        <div class="field"><span class="field-label" id="pmLabel">Payment method</span>
          <div class="methods" role="radiogroup" aria-labelledby="pmLabel">${providers.map((p, i) => `<button type="button" class="method" role="radio" aria-checked="${i === 0}" data-provider="${esc(p.id)}">${logo(PROVIDER_LOGO[p.id] || "")}<span>${esc(p.name)}</span></button>`).join("")}</div></div>
        <p class="note" style="margin-top:0">Venmo payments are added automatically once they arrive. PayPal is checked when you press the check button after paying.${linked ? " Zelle requires owner approval." : ""}</p>
        ${termsBox()}
      </form>
    </div>${foot(`<button class="btn btn-primary btn-block" type="submit" form="pkDepositForm" ${!providers.length ? "disabled" : ""}>Get payment instructions</button>`)}`, { label: "Add funds" });
  const amount = $("#pkDepositAmount", v);
  $$("[data-amt]", v).forEach((b) => b.addEventListener("click", () => { amount.value = b.dataset.amt; $$("[data-amt]", v).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }));
  amount.addEventListener("input", () => $$("[data-amt]", v).forEach((x) => x.setAttribute("aria-pressed", String(Number(x.dataset.amt) === Number(amount.value)))));
  const methods = $$(".method", v);
  methods.forEach((m) => m.addEventListener("click", () => methods.forEach((x) => x.setAttribute("aria-checked", String(x === m)))));
  $("#pkDepositForm", v).onsubmit = async (e) => {
    e.preventDefault();
    const n = Number(amount.value);
    if (!(n >= min && n <= max)) { shake(amount); amount.focus(); return toast(`Enter an amount from $${min} to $${max.toLocaleString()}`); }
    const provider = methods.find((m) => m.getAttribute("aria-checked") === "true")?.dataset.provider;
    try { await acceptTerms(); depositView(await run("deposit", { provider, amountCents: Math.round(n * 100) })); }
    catch (err) { if (!agreeError(err)) message(err.message); }
  };
}
function depositView(d) {
  const method = d.provider === "paypal" ? "PayPal" : d.provider === "venmo" ? "Venmo" : "Zelle";
  const ticket = safeUrl(d.ticketUrl);
  const v = panel(`<div class="sv-scroll">${head(`Add funds with ${method}`, `Send ${cash(d.amountCents)}.`)}
      <div class="list kv"><div class="list-row" style="display:block"><small>Send payment to</small><div class="dest">${esc(d.destination)}</div></div></div>
      <p class="note">Put this exact code in your payment note:</p>
      <div class="pay-code" aria-label="Payment code ${esc(String(d.paymentCode).split("").join(" "))}">${esc(d.paymentCode)}</div>
      <button class="btn btn-secondary" type="button" id="pkCopyDeposit"><span class="ico">${icon("copy")}</span><span data-copy>Copy payment code</span></button>
      <p class="note">${d.provider === "zelle" ? "The owner will approve your payment before funds are added." : "Your receipt is checked automatically. You can also check it below after paying."} Unpaid codes expire after 15 minutes.</p>
      ${ticket ? `<a class="link-btn" href="${esc(ticket)}" target="_blank" rel="noopener noreferrer">Open private verification ticket${icon("external", "chev")}</a>` : ""}
    </div>${foot(`<button class="btn btn-primary btn-block" type="button" id="pkCheckDeposit">${d.provider === "zelle" ? "Check approval status" : "I paid — check deposit"}</button><button class="btn btn-plain" type="button" id="pkDepositAccount">Back to my account</button>`)}`, { label: "Send payment" });
  $("#pkCopyDeposit", v).onclick = () => navigator.clipboard.writeText(d.paymentCode).then(() => { replaceIcon($("#pkCopyDeposit .ico", v), icon("check")); $("[data-copy]", v).textContent = "Copied"; }, () => toast(`Your code: ${d.paymentCode}`));
  $("#pkCheckDeposit", v).onclick = async () => { try { const r = await run("checkDeposit", { paymentCode: d.paymentCode }); message(r.message || "Your account has been refreshed.", "Deposit update"); } catch (e) { message(e.message); } };
  $("#pkDepositAccount", v).onclick = () => account();
}

/* ── the account ──────────────────────────────────────────────────── */
function avatarHTML(user) {
  const a = safeUrl(user?.avatar || "");
  return /^https:\/\/cdn\.discordapp\.com\//.test(a) ? `<img src="${esc(a)}" alt="" data-i="${esc(initials(user.name))}">` : esc(initials(user?.name));
}
function orderCards(list) {
  const quotes = me.quotes || [];
  const pending = (p) => p.purpose === "order" && p.status === "pending" && p.order_status === "not_started" && Date.now() - new Date(p.created_at).getTime() < 15 * 60000;
  return list.map((p) => {
    const quote = quotes.find((q) => q.paymentCode === p.payment_code), tracking = safeUrl(p.tracking_url);
    const status = p.order_status === "placed" ? "placed" : p.status === "canceled" ? "canceled" : p.order_status === "review" ? "being checked" : p.status === "paid" ? "processing" : "awaiting payment";
    const tone = status === "placed" ? "ok" : status === "canceled" ? "" : status === "awaiting payment" ? "warn" : "live";
    return `<div class="order-card"><div class="oc-top"><h3>${esc(quote?.restaurant || p.restaurant || p.wonderful_order_number || "PK Eats order")}</h3><span class="pill ${tone}">${esc(status)}</span></div>
      <div class="oc-meta"><span class="cap">${esc(p.fulfillment)} · ${esc(date(p.created_at))}</span><b>${cash(p.amount_due_cents)}</b></div>
      <div class="oc-actions">${tracking || p.order_status === "placed" ? `<button class="btn btn-secondary" type="button" data-track="${esc(p.payment_code)}">Track order</button>` : ""}${pending(p) && quote ? `<button class="btn btn-primary" type="button" data-quote="${esc(p.payment_code)}">Continue checkout</button>` : ""}${p.status === "pending" && p.order_status === "not_started" ? `<button class="btn btn-plain" type="button" data-cancel="${esc(p.payment_code)}">Cancel unpaid checkout</button>` : ""}</div></div>`;
  }).join("");
}
function walletHTML() {
  const snap = me.snapshot, payments = me.payments || [];
  const open = payments.filter((p) => p.purpose === "order" && p.status === "pending" && p.order_status === "not_started" && Date.now() - new Date(p.created_at).getTime() < 15 * 60000);
  const deposits = snap?.deposits || [], history = snap?.history || [];
  return `<p class="eyebrow">Available balance</p>
    <div class="balance" data-balance>${snap ? cash(shownBalance ?? snap.balanceCents) : "—"}</div>
    <p class="note" style="margin:0 0 18px" data-synced>${me.snapshotAt ? `Last checked ${esc(date(me.snapshotAt))}` : "Refresh to load your current balance."}</p>
    <button class="btn btn-primary btn-block" type="button" data-act="funds">Add funds</button>
    ${me.user.canLinkDiscord ? `<div class="link-card"><h3>Order in our Discord too?</h3><p>Link Discord to use one balance on the website and in the PK Eats Discord. You can only link before using your website balance.</p><a class="btn btn-discord" href="/auth/discord/link">${logo("discord")}Link Discord</a></div>` : ""}
    ${open.length ? `<h3 class="section-h">Your open checkout</h3>${orderCards(open)}` : ""}
    ${deposits.length ? `<h3 class="section-h">Recent deposits</h3><div class="list ledger">${deposits.map((d) => `<div class="list-row"><span>${esc(PROVIDER_NAME[d.provider] || d.provider)} · <span class="num">${esc(d.payment_code)}</span><small class="cap">${esc(d.status)}</small></span><span class="end"><span class="amt">${cash(d.amount_due_cents)}</span>${!["credited", "canceled", "expired"].includes(d.status) ? `<br><button class="btn btn-plain" type="button" data-deposit="${esc(d.payment_code)}" style="padding:0;min-height:32px">Check deposit</button>` : ""}</span></div>`).join("")}</div>` : ""}
    <h3 class="section-h">Recent activity</h3>
    ${history.length ? `<div class="list ledger">${history.map((t) => `<div class="list-row"><span>${esc(t.description || "Wallet transaction")}<small>${esc(date(t.created_at))}</small></span><span class="end amt${t.type === "credit" ? " pos" : ""}">${t.type === "credit" ? "+" : "−"}${cash(Math.abs(t.amount_cents))}</span></div>`).join("")}</div>` : '<p class="muted">No wallet activity yet.</p>'}`;
}
function ordersHTML() {
  const orders = (me.payments || []).filter((p) => p.purpose === "order");
  return `<p class="muted" style="margin-bottom:14px">${me.user.discordLinked === false ? "Your orders appear here." : "Your website and Discord orders appear here."}</p>
    ${orders.length ? orderCards(orders) : `<div class="order-card"><h3>Your next meal is waiting.</h3><p class="muted">Start with your address, then choose your favorites.</p><div class="oc-actions"><button class="btn btn-primary" type="button" data-act="start">Find food</button></div></div>`}`;
}
function accountHTML() {
  return `<div class="sv-scroll">
      <div class="acct-head"><span class="acct-avatar" aria-hidden="true">${avatarHTML(me.user)}</span><div><h2>${esc(me.user.name)}</h2><p>${me.user.discordLinked === false ? "PK Eats account" : "PK Eats · Discord linked"}</p></div></div>
      <div class="seg tabs" id="acctTabs" role="radiogroup" aria-label="Account section">
        <button class="seg-opt" type="button" role="radio" data-tab="wallet" aria-checked="${accountTab === "wallet"}">Wallet</button>
        <button class="seg-opt" type="button" role="radio" data-tab="orders" aria-checked="${accountTab === "orders"}">Orders</button>
        <span class="seg-thumb" aria-hidden="true"></span>
      </div>
      <div id="acctPane">${accountTab === "wallet" ? walletHTML() : ordersHTML()}</div>
      <div class="acct-actions"><button class="btn btn-plain" type="button" data-act="refresh">Refresh account</button><button class="btn btn-plain" type="button" data-act="signout">Sign out</button>${me.admin ? '<a class="btn btn-plain" href="/admin">Admin panel</a>' : ""}</div>
    </div>`;
}
function animateBalance(v) {
  const el = $("[data-balance]", v), cents = me.snapshot?.balanceCents;
  if (!el || cents == null) return;
  countTo(el, cents, { from: shownBalance ?? 0, format: (c) => cash(Math.round(c)), duration: shownBalance == null ? 1300 : 900 });
  shownBalance = cents;
}
function accountView({ inPlace = false } = {}) {
  let v;
  if (inPlace && sheet.currentKey() === "account" && sheet.view()?.querySelector("#acctPane")) {
    const scroller = $(".sv-scroll", sheet.view()), top = scroller?.scrollTop || 0;
    v = sheet.refresh(accountHTML());
    const s2 = $(".sv-scroll", v); if (s2) s2.scrollTop = top;
  } else {
    v = panel(accountHTML(), { label: "Your account" });
    if (!reduced.matches) cascade(v.querySelectorAll(".acct-head, #acctTabs, #acctPane > *, .acct-actions"), { variant: "rise", step: 45, delay: 80, duration: 640, max: 14 });
  }
  segmented($("#acctTabs", v), { onChange: (b) => {
    accountTab = b.dataset.tab;
    const pane = $("#acctPane", v);
    sheet.morph(() => { pane.innerHTML = accountTab === "wallet" ? walletHTML() : ordersHTML(); });
    rise(pane, { y: 6, duration: 320, key: "pane" });
    if (accountTab === "wallet") animateBalance(v);
  } });
  if (accountTab === "wallet") animateBalance(v);
  v.onclick = async (e) => {
    const t = e.target.closest("[data-act], [data-track], [data-quote], [data-cancel], [data-deposit]");
    if (!t) return;
    if (t.dataset.track) return trackOrder(t.dataset.track);
    if (t.dataset.quote) {
      const q = (me.quotes || []).find((x) => x.paymentCode === t.dataset.quote), p = (me.payments || []).find((x) => x.payment_code === t.dataset.quote);
      return quoteView({ ...q, amountDueCents: p.amount_due_cents });
    }
    if (t.dataset.cancel) { try { await run("cancel", { paymentCode: t.dataset.cancel }); await account(false); } catch (err) { message(err.message); } return; }
    if (t.dataset.deposit) { try { const r = await run("checkDeposit", { paymentCode: t.dataset.deposit }); message(r.message, "Deposit update"); } catch (err) { message(err.message); } return; }
    const act = t.dataset.act;
    if (act === "funds") depositForm();
    else if (act === "refresh") account();
    else if (act === "start") { closePanel(); editAddress(); }
    else if (act === "signout") {
      try { await api("/api/site/signout", { method: "POST", body: "{}" }); me = null; state.me = null; site.csrf = ""; shownBalance = null; setAccount(null); updateOrderNav(); closePanel(); toast("Signed out"); }
      catch (err) { message(err.message); }
    }
  };
  return v;
}
/** Open the account: it shows at once with what we know, then refreshes quietly and updates in place. */
async function account(refresh = true) {
  if (!me) { if (!(await ensureLogin())) return; }
  accountView();
  if (!refresh) return;
  const synced = $("[data-synced]", sheet.view());
  if (synced) synced.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px">${spinner()}Refreshing your balance…</span>`;
  try { await run("sync", {}, { quiet: true }); if (sheet.currentKey() === "account" && sheet.view()?.querySelector("#acctPane")) accountView({ inPlace: true }); }
  catch (e) {
    if (sheet.currentKey() === "account" && sheet.view()?.querySelector("#acctPane")) { accountView({ inPlace: true }); const n = $("[data-synced]", sheet.view()); if (n) n.textContent = e.message; }
  }
}

/* ── config + boot ────────────────────────────────────────────────── */
async function updateConfig() {
  try {
    config = await api("/api/site/config");
    state.config = config; window.pkConfig = config;
    applyFulfillment(config); setLive(config);
  } catch { setLive({}, true); }
}
async function signinFromLink() {
  const signin = new URLSearchParams(location.hash.slice(1)).get("signin");
  if (!signin) return false;
  history.replaceState(history.state, "", location.pathname);
  try {
    if (busy) throw new Error("A request is still processing. Wait for its result, then open your sign-in link again.");
    await api("/api/site/signin", { method: "POST", body: JSON.stringify({ token: signin }) });
    await loadMe(); await run("sync"); const draft = checkoutDraft(); if (draft) await resumeCheckout(draft); else accountView();
  } catch (e) { message(e.message, "Sign-in link unavailable"); }
  return true;
}

export async function initAccount() {
  $("#accountBtn").addEventListener("click", () => (me ? account() : login()));
  // one order in progress opens its tracking; several open the Orders tab
  $("#orderStatusBtn").addEventListener("click", () => { const a = activeOrders(); if (a.length === 1) trackOrder(a[0].payment_code); else { accountTab = "orders"; account(false); } });
  addEventListener("hashchange", () => signinFromLink());
  await updateConfig();
  if (!(await signinFromLink()) && !(await noticeFromRedirect().catch((e) => { message(e.message, "Sign-in"); return true; }))) {
    try {
      await loadMe();
      const saved = ls.json("pkPendingJob");
      if (saved && me && saved.userId === me.user.id) {
        busy = true; const sc = progress(saved.action);
        if (!saved.id && saved.key) {
          const j = await api("/api/site/jobs", { method: "POST", body: JSON.stringify({ action: saved.action, payload: saved.payload }), headers: { "Content-Type": "application/json", "X-CSRF-Token": site.csrf, "Idempotency-Key": saved.key } });
          saved.id = j.id; ls.set("pkPendingJob", JSON.stringify(saved));
        }
        const r = await finishJob(saved.id); if (sc) await sc.finish(r, sc.view); busy = false;
        if (saved.action === "prepare") quoteView(r); else if (saved.action === "deposit") depositView(r); else if (saved.action === "pay") paymentResult(r); else if (saved.action === "track") trackingView(r); else accountView();
      } else if (me && checkoutDraft()) await resumeCheckout(checkoutDraft());
    } catch (e) { busy = false; message(e.message, "Request update"); }
  }
  pollTimer = setInterval(updateConfig, 30000);
  addEventListener("pagehide", () => clearInterval(pollTimer));
}
