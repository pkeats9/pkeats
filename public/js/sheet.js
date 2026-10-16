// One sheet surface for every overlay. Opening rises it in (iOS sheet curve on phones, a soft materialise on
// larger screens); opening again while it is up swaps the content in place — the old view fades and softens out,
// the new one settles in, and the sheet's height morphs between them — so multi-step flows (cart → cart code →
// checkout → price → paid → tracking) feel like one continuous surface. Phones can drag it down to dismiss.
import { $, $$ } from "./dom.js";
import { animate, cancel, EASE, reduced } from "./motion.js";

const layer = $("#layer"), scrim = $("#scrim"), sheetEl = $("#sheet"), views = $("#sheetViews"), closeBtn = $("#sheetClose"), grip = $("#sheetGrip");
const BACKGROUND = ["#app", "#chrome", "#cartbar", ".skip"];
const phone = matchMedia("(max-width: 734px)");
let current = null, opener = null, closing = null, uid = 0;

export const el = sheetEl;
export const isOpen = (key) => !!current && !closing && (!key || current.key === key);
export const currentKey = () => (current && !closing ? current.key : null);
export const view = () => current?.el || null;

function setBackground(locked) {
  const de = document.documentElement;
  if (locked) {
    const bar = window.innerWidth - de.clientWidth;
    if (bar > 0) { document.body.style.paddingRight = `${bar}px`; $("#chrome").style.paddingRight = `calc(var(--side) + ${bar}px)`; }
    de.classList.add("locked");
  } else {
    de.classList.remove("locked");
    document.body.style.paddingRight = ""; $("#chrome").style.paddingRight = "";
  }
  BACKGROUND.forEach((s) => { const n = $(s); if (n) n.inert = locked; });
}

function makeView(v) {
  const sec = document.createElement("section");
  sec.className = `sheet-view${v.className ? " " + v.className : ""}`;
  sec.dataset.key = v.key;
  if (v.html != null) sec.innerHTML = v.html;
  return sec;
}

function applyOptions(v) {
  sheetEl.classList.toggle("wide", !!v.wide);
  closeBtn.classList.toggle("on-media", !!v.closeOnMedia);
  closeBtn.hidden = v.closable === false;
}

function label(view, v) {
  const h = view.querySelector("h1, h2, h3");
  if (h) { h.id ||= `sheet-h-${++uid}`; sheetEl.setAttribute("aria-labelledby", h.id); sheetEl.removeAttribute("aria-label"); }
  else { sheetEl.removeAttribute("aria-labelledby"); sheetEl.setAttribute("aria-label", v.label || "Details"); }
}

function focusInto(view, focus) {
  requestAnimationFrame(() => {
    const target = typeof focus === "string" ? view.querySelector(focus) : null;
    (target || sheetEl).focus({ preventScroll: true });
  });
}

/** Show a view. Returns the view element (already in the DOM) so callers can wire it. */
export function open(v) {
  if (closing) finishClose(true);
  const view = makeView(v);
  return current ? swap(v, view) : present(v, view);
}

function present(v, view) {
  opener = document.activeElement;
  views.replaceChildren(view);
  current = { ...v, el: view };
  applyOptions(v);
  layer.hidden = false;
  setBackground(true);
  v.render?.(view);
  label(view, v);
  const onPhone = phone.matches;
  animate(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: EASE.out, key: "fade" });
  animate(sheetEl, onPhone
    ? [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }]
    : [{ opacity: 0, transform: "translateY(18px) scale(.96)", filter: "blur(4px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }],
  { duration: onPhone ? 500 : 460, easing: onPhone ? EASE.sheet : EASE.out, key: "move" });
  focusInto(view, v.focus);
  return view;
}

function swap(v, view) {
  const old = current.el;
  const fromH = sheetEl.getBoundingClientRect().height;
  current.onLeave?.();
  $$(".sheet-view", views).forEach((n) => { if (n !== old) n.remove(); });   // drop any half-finished swap
  old.classList.add("leaving"); old.inert = true; old.setAttribute("aria-hidden", "true");
  Object.assign(old.style, { position: "absolute", inset: "0 0 auto 0" });
  views.append(view);
  current = { ...v, el: view };
  applyOptions(v);
  v.render?.(view);
  label(view, v);
  const toH = sheetEl.getBoundingClientRect().height;
  if (reduced.matches) old.remove();
  else {
    animate(old, [{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(2px)" }], { duration: 150, fill: "forwards", key: "swap" }).then(() => old.remove());
    animate(view, [{ opacity: 0, transform: "translateY(8px)", filter: "blur(2px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }], { duration: 360, delay: 60, key: "swap" });
    if (Math.abs(toH - fromH) > 1) animate(sheetEl, [{ height: `${fromH}px` }, { height: `${toH}px` }], { duration: 440, easing: EASE.out, key: "height" });
  }
  focusInto(view, v.focus);
  return view;
}

/** An alert-style question in the sheet. Resolves true for the main action, false for cancel/dismiss. */
export function ask({ title, body = "", ok = "OK", cancel = "Cancel", destructive = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (answered) return; answered = true; resolve(v); };
    const view = open({
      key: "ask", label: title,
      html: `<div class="sv-scroll"><div class="sheet-head"><h2>${title}</h2>${body ? `<p>${body}</p>` : ""}</div></div>
        <div class="sv-foot btn-stack"><button class="btn ${destructive ? "btn-secondary" : "btn-primary"} btn-block" type="button" data-ok>${ok}</button><button class="btn btn-plain" type="button" data-cancel>${cancel}</button></div>`,
      onClose: () => done(false),
      focus: "[data-ok]",
    });
    view.querySelector("[data-ok]").onclick = () => { done(true); close(); };
    view.querySelector("[data-cancel]").onclick = () => { done(false); close(); };
  });
}

/** Animate the sheet's height across a DOM change inside the current view (tabs, inline results). */
export function morph(change) {
  const from = sheetEl.getBoundingClientRect().height;
  change();
  const to = sheetEl.getBoundingClientRect().height;
  if (!reduced.matches && Math.abs(to - from) > 1) animate(sheetEl, [{ height: `${from}px` }, { height: `${to}px` }], { duration: 420, easing: EASE.out, key: "height" });
}

/** Re-render the current view's contents in place (no swap animation) — for live refreshes. */
export function refresh(html) {
  if (!current) return null;
  current.el.innerHTML = html;
  return current.el;
}

function finishClose(silent = false) {
  const v = current;
  layer.hidden = true;
  views.replaceChildren();
  [sheetEl, scrim].forEach((n) => { cancel(n); n.getAnimations().forEach((a) => a.cancel()); });
  sheetEl.style.transform = ""; scrim.style.opacity = "";
  setBackground(false);
  current = null; closing = null;
  v?.onLeave?.(); v?.onClose?.();
  if (!silent && opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
  opener = null;
}

/** Dismiss the sheet (animated). fromY lets a drag hand over its position. */
export function close({ fromY = 0 } = {}) {
  if (!current) return Promise.resolve();
  if (closing) return closing;
  const onPhone = phone.matches;
  closing = Promise.all([
    animate(sheetEl, onPhone
      ? [{ transform: `translateY(${fromY}px)` }, { transform: "translateY(100%)" }]
      : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(8px) scale(.98)", filter: "blur(2px)" }],
    { duration: onPhone ? 340 : 200, easing: onPhone ? EASE.sheet : EASE.out, fill: "forwards", key: "move" }),
    animate(scrim, [{ opacity: Number(scrim.style.opacity || 1) }, { opacity: 0 }], { duration: onPhone ? 320 : 220, fill: "forwards", key: "fade" }),
  ]).then(() => { if (closing) finishClose(); });
  return closing;
}

/* ── wiring: close button, scrim, Escape, focus trap, drag-to-dismiss ── */
closeBtn.addEventListener("click", () => close());
scrim.addEventListener("click", () => { if (current?.dismissible !== false) close(); });
document.addEventListener("keydown", (e) => {
  if (!current || closing) return;
  if (e.key === "Escape") { if (current.dismissible !== false) { e.preventDefault(); close(); } return; }
  if (e.key !== "Tab") return;
  const f = $$('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]', sheetEl)
    .filter((n) => n.getClientRects().length && !n.closest(".leaving") && !n.closest("[hidden]"));
  if (!f.length) { e.preventDefault(); return; }
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === sheetEl)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// Drag down from the grabber (or any [data-drag] area, e.g. the dish photo) to dismiss on phones.
function startDrag(e, target = e.currentTarget) {
  if (!phone.matches || !current || current.dismissible === false || e.button > 0) return;
  const y0 = e.clientY, h = sheetEl.offsetHeight;
  let dy = 0, lastY = y0, lastT = performance.now(), vel = 0;
  cancel(sheetEl, "move");
  target.setPointerCapture?.(e.pointerId);
  const move = (ev) => {
    dy = ev.clientY - y0;
    const now = performance.now();
    vel = (ev.clientY - lastY) / Math.max(1, now - lastT); lastY = ev.clientY; lastT = now;
    const y = dy > 0 ? dy : -8 * (Math.log(-dy / 8 + 1));      // rubber band upward
    sheetEl.style.transform = `translateY(${y}px)`;
    scrim.style.opacity = String(Math.max(.2, 1 - Math.max(0, dy) / h));
  };
  const up = () => {
    target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up);
    if (dy > h * .25 || vel > .4) { close({ fromY: Math.max(0, dy) }); sheetEl.style.transform = ""; return; }
    const from = sheetEl.style.transform || "translateY(0)";
    sheetEl.style.transform = "";
    animate(sheetEl, [{ transform: from }, { transform: "translateY(0)" }], { duration: 460, easing: EASE.smooth, key: "move" });
    animate(scrim, [{ opacity: Number(scrim.style.opacity || 1) }, { opacity: 1 }], { duration: 300, key: "fade" });
    scrim.style.opacity = "";
  };
  target.addEventListener("pointermove", move); target.addEventListener("pointerup", up); target.addEventListener("pointercancel", up);
}
grip.addEventListener("pointerdown", startDrag);
views.addEventListener("pointerdown", (e) => { const zone = e.target.closest("[data-drag]"); if (zone) startDrag(e, zone); });
