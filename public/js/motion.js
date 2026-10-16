// The motion system. Calm by default: ease-out or critically damped, short travel, ≤4px blur, no overshoot,
// exits faster than entrances. Every effect is interruptible (a newer one cancels the older on the same element)
// and degrades to a brief opacity change (or nothing) under Reduce Motion.

export const reduced = matchMedia("(prefers-reduced-motion: reduce)");

export const EASE = {
  out: "cubic-bezier(.22, 1, .36, 1)",           // ease-out-quint: the default for entrances
  sheet: "cubic-bezier(.32, .72, 0, 1)",          // iOS sheet curve
  io: "cubic-bezier(.45, 0, .55, 1)",             // on-screen moves
  ui: "cubic-bezier(.28, .11, .32, 1)",           // apple.com colour/background fades
  // SwiftUI .smooth (critically damped) sampled to linear()
  smooth: "linear(0, 0.1144, 0.3208, 0.5164, 0.6711, 0.7831, 0.8601, 0.9113, 0.9445, 0.9656, 0.9789, 0.9871, 0.9922, 0.9953, 0.9972, 0.9983, 1)",
};

const running = new WeakMap();

/** el.animate with per-element channels: a new animation on the same channel cancels the previous one. */
export function animate(el, frames, opts = {}) {
  if (!el || !el.animate) return Promise.resolve(true);
  const key = opts.key || "main";
  let channels = running.get(el);
  if (!channels) running.set(el, (channels = new Map()));
  channels.get(key)?.cancel();
  let kf = frames, duration = opts.duration ?? 300, easing = opts.easing ?? EASE.out, delay = opts.delay ?? 0;
  if (reduced.matches && !opts.essential) {
    // keep the feedback, drop the movement: an opacity-only version, or nothing
    const op = frames.map((f) => ("opacity" in f ? { opacity: f.opacity } : null));
    if (op.every(Boolean)) { kf = op; duration = Math.min(duration, 160); easing = "linear"; delay = 0; }
    else return Promise.resolve(true);
  }
  const fill = opts.fill ?? "backwards";
  const a = el.animate(kf, { duration, easing, delay, fill });
  channels.set(key, a);
  // An animation that holds its end state ("forwards") stays registered after it finishes, so the next animation on
  // the channel — or cancel() — can still clear it. Dropping it would leave its end state (e.g. opacity 0) stuck on
  // the element underneath every later animation.
  return a.finished.then(() => true, () => false).finally(() => { if (channels.get(key) === a && fill !== "forwards" && fill !== "both") channels.delete(key); });
}
export function cancel(el, key) {
  const ch = el && running.get(el);
  if (!ch) return;
  if (key) { ch.get(key)?.cancel(); ch.delete(key); } else { ch.forEach((a) => a.cancel()); ch.clear(); }
}

export const rise = (el, { y = 10, blur = 0, duration = 420, delay = 0, key } = {}) =>
  animate(el, [
    { opacity: 0, transform: `translateY(${y}px)`, ...(blur ? { filter: `blur(${blur}px)` } : {}) },
    { opacity: 1, transform: "none", ...(blur ? { filter: "blur(0px)" } : {}) },
  ], { duration, delay, key });

export const fadeOut = (el, { duration = 160, y = 0, key } = {}) =>
  animate(el, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateY(${y}px)` }], { duration, fill: "forwards", key });

/** Glass appears by gathering light: scale + blur + brightness, never a plain fade. */
export const materialize = (el, { duration = 560, delay = 0 } = {}) =>
  animate(el, [
    { opacity: 0, transform: "translateY(10px) scale(.94)", filter: "blur(6px) brightness(1.25)" },
    { opacity: 1, transform: "none", filter: "blur(0px) brightness(1)" },
  ], { duration, delay, easing: EASE.smooth, key: "life" });
export const dematerialize = (el, { duration = 220 } = {}) =>
  animate(el, [
    { opacity: 1, transform: "none", filter: "blur(0px)" },
    { opacity: 0, transform: "translateY(6px) scale(.96)", filter: "blur(4px)" },
  ], { duration, fill: "forwards", key: "life" });

/** A receiving pulse for glass (it flexes up and brightens, then settles). */
export const receive = (el) =>
  animate(el, [{ transform: "scale(1)", filter: "brightness(1)" }, { transform: "scale(1.035)", filter: "brightness(1.14)", offset: .32 }, { transform: "scale(1)", filter: "brightness(1)" }],
    { duration: 520, easing: EASE.out, key: "pulse" });

/** "No": a small sideways shake (±4px). */
export const shake = (el) =>
  animate(el, [{ transform: "translateX(0)" }, { transform: "translateX(-4px)", offset: .2 }, { transform: "translateX(4px)", offset: .45 }, { transform: "translateX(-2px)", offset: .7 }, { transform: "translateX(0)" }],
    { duration: 420, easing: EASE.out, key: "shake" });

/** Rolling number/text change: the old value slides out, the new one slides in (up when increasing). */
export function roll(el, next, { up = true } = {}) {
  next = String(next);
  const cur = el.dataset.v ?? el.textContent;
  if (cur === next) return;
  el.dataset.v = next;
  if (reduced.matches || !el.isConnected || !el.getClientRects().length) { el.textContent = next; return; }
  el.classList.add("roll");
  const a = document.createElement("span"); a.textContent = cur;
  const b = document.createElement("span"); b.textContent = next;
  el.replaceChildren(a, b);
  const d = up ? 1 : -1;
  animate(a, [{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${-75 * d}%)`, opacity: 0 }], { duration: 220, fill: "forwards" });
  animate(b, [{ transform: `translateY(${75 * d}%)`, opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 420, easing: EASE.smooth })
    .then(() => { if (el.dataset.v === next) { el.textContent = next; el.classList.remove("roll"); } });
}

/** Count a number toward a value (ease-out-expo), tabular figures keep it from jittering. */
export function countTo(el, to, { from, format = (v) => String(Math.round(v)), duration = 1100 } = {}) {
  const start = from ?? (Number.isFinite(Number(el.dataset.n)) ? Number(el.dataset.n) : 0);
  el.dataset.n = to;
  cancelAnimationFrame(el._countRaf);
  if (reduced.matches || start === to) { el.textContent = format(to); return; }
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / duration);
    el.textContent = format(p < 1 ? start + (to - start) * (1 - Math.pow(2, -10 * p)) : to);
    if (p < 1) el._countRaf = requestAnimationFrame(tick);
  };
  el._countRaf = requestAnimationFrame(tick);
}

/** The dish flies into the bag: a copy of the photo arcs from its source into the target and shrinks into it. */
export function fly(src, fromEl, toEl) {
  if (reduced.matches || !src || !fromEl || !toEl) return Promise.resolve();
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  if (!a.width || !b.width) return Promise.resolve();
  const s = Math.max(44, Math.min(a.width, a.height, 160));
  const img = new Image();
  img.src = src; img.alt = ""; img.className = "flyer"; img.setAttribute("aria-hidden", "true");
  Object.assign(img.style, { left: `${a.left + a.width / 2 - s / 2}px`, top: `${a.top + a.height / 2 - s / 2}px`, width: `${s}px`, height: `${s}px` });
  document.body.append(img);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const cx = dx * .3, cy = Math.min(0, dy) - Math.min(150, 56 + Math.abs(dx) * .18);
  const end = 30 / s, N = 20, frames = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    const x = 2 * u * t * cx + t * t * dx, y = 2 * u * t * cy + t * t * dy;
    frames.push({ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(1 - (1 - end) * t).toFixed(3)})`,
      borderRadius: t < .5 ? `${18 + 64 * t}%` : "50%", opacity: t > .88 ? +(1 - (t - .88) / .12 * .9).toFixed(3) : 1, offset: t });
  }
  return animate(img, frames, { duration: 680, easing: EASE.io, fill: "forwards", essential: true }).finally(() => img.remove());
}

/* ── SF Symbols-style effects on inline SVG icons ─────────────────── */
const layers = (svg) => [...svg.querySelectorAll("path, line, polyline, polygon, circle, ellipse, rect")];
function prep(n, origin = "50% 50%") { n.style.transformBox = "fill-box"; n.style.transformOrigin = origin; return n; }

export function bounce(svg, { down = false } = {}) {
  if (!svg) return Promise.resolve();
  prep(svg, down ? "50% 0%" : "50% 100%");
  const d = down ? 1 : -1;
  return animate(svg, [{ transform: "translateY(0) scale(1)" }, { transform: "scale(.86)", offset: .28 }, { transform: `translateY(${-d * 2.5}px) scale(1.04)`, offset: .62 }, { transform: "translateY(0) scale(1)" }],
    { duration: 480, easing: EASE.out, key: "symbol" });
}
export function wiggle(svg) {
  if (!svg) return Promise.resolve();
  prep(svg, "50% 50%");
  return animate(svg, [0, -11, 9, -6, 3, 0].map((r) => ({ transform: `rotate(${r}deg)` })), { duration: 620, easing: "ease-out", key: "symbol" });
}
/** Strokes trace themselves on (success marks). */
export function drawOn(svg, { duration = 560, stagger = 110, delay = 0 } = {}) {
  if (!svg) return Promise.resolve();
  return Promise.all(layers(svg).map((p, i) => {
    let L = 100; try { L = Math.ceil(p.getTotalLength()) + 1; } catch {}
    return animate(p, [{ strokeDasharray: L, strokeDashoffset: L }, { strokeDasharray: L, strokeDashoffset: 0 }], { duration, delay: delay + i * stagger, easing: EASE.out, key: "draw" });
  }));
}
/** Magic replace: the old symbol shrinks and blurs away while the new one grows into the same box. */
export function replaceIcon(host, nextHTML) {
  const old = host.querySelector("svg");
  const t = document.createElement("template"); t.innerHTML = String(nextHTML).trim();
  const neu = t.content.firstElementChild;
  if (!old || reduced.matches) { host.replaceChildren(neu); return Promise.resolve(); }
  host.style.display = "inline-grid";
  [old, neu].forEach((s) => { s.style.gridArea = "1 / 1"; prep(s); });
  host.append(neu);
  animate(old, [{ transform: "scale(1)", opacity: 1, filter: "blur(0px)" }, { transform: "scale(.55)", opacity: 0, filter: "blur(2px)" }], { duration: 170, fill: "forwards" }).then(() => old.remove());
  return animate(neu, [{ transform: "scale(.55)", opacity: 0, filter: "blur(2px)" }, { transform: "scale(1)", opacity: 1, filter: "blur(0px)" }], { duration: 320, delay: 70, easing: EASE.smooth });
}

/* ── page transitions ─────────────────────────────────────────────── */
export const canVT = typeof document.startViewTransition === "function";
/** Run a DOM update inside a View Transition when possible; resolves once the new state is live. */
export async function transition(update) {
  if (!canVT || reduced.matches || document.visibilityState !== "visible") { await update(); return null; }
  const vt = document.startViewTransition(update);
  vt.ready.catch(() => {});
  vt.finished.catch(() => {});
  try { await vt.updateCallbackDone; } catch (e) { console.warn("view transition update failed", e); }
  return vt;
}

/* ── reveals: things rise in as they scroll into view (rows stagger 45ms, max 10) ───────────────
   .rv hides an element until it's revealed; the WAAPI entrance fills backwards over its delay, so dropping the
   class at the start never flashes, and the element is handed straight back to its own CSS transitions. */
const ENTRANCES = {
  rise: [{ opacity: 0, transform: "translateY(18px)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }],
  card: [{ opacity: 0, transform: "translateY(26px) scale(.94)", filter: "blur(10px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }],
  soft: [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
};
export function enter(el, { variant = "rise", delay = 0, duration = 700, easing = EASE.out } = {}) {
  io?.unobserve(el);
  el.classList.remove("rv");
  if (reduced.matches) return Promise.resolve(true);
  return animate(el, ENTRANCES[variant] || ENTRANCES.rise, { duration, delay, easing, key: "enter" });
}
let io = null;
export function reveal(root = document) {
  if (reduced.matches || !("IntersectionObserver" in window)) { root.querySelectorAll(".rv").forEach((n) => n.classList.remove("rv")); return; }
  io ||= new IntersectionObserver((entries) => {
    const hits = entries.filter((e) => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
    hits.forEach((e, i) => {
      io.unobserve(e.target);
      if (!e.target.classList.contains("rv")) return;
      enter(e.target, { variant: e.target.dataset.enter || "rise", delay: Math.min(i, 10) * 45 + (Number(e.target.dataset.delay) || 0) });
      e.target.dispatchEvent(new CustomEvent("revealed"));
    });
  }, { rootMargin: "0px 0px -4% 0px" });
  root.querySelectorAll(".rv").forEach((n) => io.observe(n));
}
/** A bigger cascade for a whole screen arriving (cards after the search, rows after a menu loads). */
export function cascade(els, { variant = "card", step = 55, max = 12, duration = 760, delay = 0 } = {}) {
  [...els].forEach((n, i) => { if (io) io.unobserve(n); enter(n, { variant, delay: delay + Math.min(i, max) * step, duration }); });
}

/* ── particles: a small burst of light when something good happens ─────────────────────────────── */
export function burst(el, { count = 10, colors = ["#ffffff", "#c2b8ff", "#a99cf5", "#30d158"], spread = 46, size = 6 } = {}) {
  if (reduced.matches || !el?.getBoundingClientRect) return;
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    p.className = "spark";
    const a = (i / count) * Math.PI * 2 + Math.random() * .5, d = spread * (.65 + Math.random() * .55), s = size * (.6 + Math.random() * .7);
    Object.assign(p.style, { left: `${cx - s / 2}px`, top: `${cy - s / 2}px`, width: `${s}px`, height: `${s}px`, background: colors[i % colors.length] });
    document.body.append(p);
    p.animate([{ transform: "translate(0,0) scale(1)", opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(.2)`, opacity: 0 }],
      { duration: 620 + Math.random() * 240, easing: EASE.out, fill: "forwards" }).finished.finally(() => p.remove());
  }
}
/** Expanding rings from an element (success, live pings). */
export function ring(el, { color = "rgba(48,209,88,.55)", count = 2, size = 1.9 } = {}) {
  if (reduced.matches || !el?.getBoundingClientRect) return;
  const r = el.getBoundingClientRect();
  for (let i = 0; i < count; i++) {
    const o = document.createElement("i");
    o.className = "ring-fx";
    Object.assign(o.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderColor: color });
    document.body.append(o);
    o.animate([{ transform: "scale(1)", opacity: .9 }, { transform: `scale(${size})`, opacity: 0 }], { duration: 900, delay: i * 180, easing: EASE.out, fill: "both" }).finished.finally(() => o.remove());
  }
}

/* ── shared-element flights: a fixed clone travels between two rects under the chrome ─────────── */
export function cloneAt(src, rect, { radius = "18px", className = "" } = {}) {
  const c = document.createElement("div");
  c.className = `flight${className ? " " + className : ""}`;
  Object.assign(c.style, { left: "0px", top: "0px", width: `${rect.width}px`, height: `${rect.height}px`, transform: `translate(${rect.left}px, ${rect.top}px)`, borderRadius: radius });
  if (src) c.innerHTML = `<img src="${String(src).replace(/"/g, "&quot;")}" alt="">`;
  document.body.append(c);
  return c;
}
export function flyClone(c, to, { radius = "28px", duration = 620, easing = EASE.sheet } = {}) {
  const from = { x: parseFloat(c.style.transform.split("(")[1]) || 0, y: parseFloat(c.style.transform.split(",")[1]) || 0, w: parseFloat(c.style.width), h: parseFloat(c.style.height), r: c.style.borderRadius };
  if (reduced.matches) return Promise.resolve();
  return animate(c, [
    { transform: `translate(${from.x}px, ${from.y}px)`, width: `${from.w}px`, height: `${from.h}px`, borderRadius: from.r },
    { transform: `translate(${to.left}px, ${to.top}px)`, width: `${to.width}px`, height: `${to.height}px`, borderRadius: radius },
  ], { duration, easing, fill: "forwards", essential: true });
}

/* ── scroll + pointer drivers (rAF-batched) ────────────────────────────────────────────────────── */
const scrollFns = new Set();
let scrollRaf = 0;
export function onScroll(fn) {
  scrollFns.add(fn);
  if (scrollFns.size === 1) addEventListener("scroll", () => { if (!scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; scrollFns.forEach((f) => f(scrollY)); }); }, { passive: true });
  fn(scrollY);
  return () => scrollFns.delete(fn);
}
export const finePointer = matchMedia("(hover: hover) and (pointer: fine)");

/** Apple's 8-bar activity indicator. */
export const spinner = (cls = "") => `<span class="spinner${cls ? " " + cls : ""}" aria-hidden="true">${"<i></i>".repeat(8)}</span>`;

/** iOS 26 capsule segmented control: the thumb glides to the selection; arrow keys move it. */
export function segmented(seg, { onChange } = {}) {
  const opts = () => [...seg.querySelectorAll(".seg-opt")];
  const thumb = seg.querySelector(".seg-thumb");
  const place = (anim = true) => {
    const on = opts().find((o) => o.getAttribute("aria-checked") === "true") || opts()[0];
    if (!on || !on.offsetWidth || !thumb) return;
    if (!anim) seg.classList.add("no-anim");
    thumb.style.setProperty("--w", `${on.offsetWidth}px`);
    thumb.style.setProperty("--x", `${on.offsetLeft}px`);
    opts().forEach((o) => (o.tabIndex = o === on ? 0 : -1));
    if (!anim) requestAnimationFrame(() => requestAnimationFrame(() => seg.classList.remove("no-anim")));
  };
  const select = (btn, fire = true) => {
    if (!btn || btn.disabled) return;
    const changed = btn.getAttribute("aria-checked") !== "true";
    opts().forEach((o) => o.setAttribute("aria-checked", String(o === btn)));
    place();
    if (fire && changed) onChange?.(btn);
  };
  seg.addEventListener("click", (e) => select(e.target.closest(".seg-opt")));
  seg.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const list = opts().filter((o) => !o.disabled), i = list.indexOf(document.activeElement);
    const next = list[(i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + list.length) % list.length];
    select(next); next?.focus();
  });
  if ("ResizeObserver" in window) new ResizeObserver(() => place(false)).observe(seg);
  place(false);
  return { select, place, value: () => opts().find((o) => o.getAttribute("aria-checked") === "true") };
}
