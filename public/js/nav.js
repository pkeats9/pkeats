// Screen router: start → browse → menu, with hand-built transitions (no View Transitions: they crossfade the
// fixed glass chrome and drop its blur, which reads as a flicker). The outgoing screen softens away, the incoming one
// rises in, and shared elements (a restaurant's photo and logo) fly as real clones *under* the chrome, so the glass
// keeps its live blur and never dims. Scroll position is remembered per screen.
import { $ } from "./dom.js";
import { state } from "./state.js";
import { animate, cancel, cloneAt, flyClone, reduced, EASE } from "./motion.js";
import * as sheet from "./sheet.js";

const screens = { start: $("#screenStart"), browse: $("#screenBrowse"), menu: $("#screenMenu") };
const ORDER = { start: 0, browse: 1, menu: 2 };
const memo = {};
const listeners = new Set();
let queue = Promise.resolve();

export const onScreen = (fn) => listeners.add(fn);
export const screenEl = (name) => screens[name];
export const savedScroll = (name) => memo[name] || 0;

/**
 * go(name, opts)
 *  during():  render the new screen (runs after the swap, before it animates in; may be async)
 *  shared:    [{ from: () => Element, to: () => Element, src, radius: [from, to] }] — elements that fly between screens
 *  instant:   swap without the out/in choreography (something else is covering the screen)
 *  after():   once everything has landed
 */
export function go(name, opts = {}) {
  queue = queue.then(() => run(name, opts), () => run(name, opts));
  return queue;
}

async function run(name, { during, after, shared = [], instant = false, focus = true, keepScroll = false } = {}) {
  if (sheet.isOpen()) await sheet.close();
  const from = state.screen, same = from === name;
  const oldEl = screens[from], newEl = screens[name];
  memo[from] = window.scrollY;
  const back = ORDER[name] < ORDER[from];
  const motion = !instant && !reduced.matches && !same;

  // shared elements lift off first: a clone takes the element's place and the original hides
  const flights = [];
  if (motion) for (const s of shared) {
    const fromEl = s.from?.();
    const r = fromEl?.getBoundingClientRect();
    if (!r || !r.width || r.bottom < 0 || r.top > innerHeight) continue;
    const clone = cloneAt(s.src, r, { radius: s.radius?.[0] || "18px", className: s.className || "" });
    fromEl.style.visibility = "hidden";
    // it lifts toward you while the rest of the screen falls away
    animate(clone, [{ scale: "1" }, { scale: "1.045" }], { duration: 300, easing: EASE.out, fill: "forwards", key: "lift" });
    flights.push({ s, clone, fromEl });
  }

  // 1. the old screen softens away (the chosen card stays put above it)
  if (motion) {
    await animate(oldEl, [{ opacity: 1, transform: "none", filter: "blur(0px)" }, { opacity: 0, transform: `translateY(${back ? 12 : -12}px) scale(.985)`, filter: "blur(6px)" }],
      { duration: 240, easing: EASE.out, fill: "forwards", key: "screen" });
  }

  // 2. swap
  for (const [k, s] of Object.entries(screens)) s.hidden = k !== name;
  cancel(oldEl, "screen");
  oldEl.getAnimations().forEach((a) => a.cancel());       // belt and braces: nothing may linger on a hidden screen
  flights.forEach((f) => (f.fromEl.style.visibility = ""));
  state.screen = name;
  document.body.dataset.screen = name;
  listeners.forEach((fn) => fn(name, from));
  if (!keepScroll && !same) window.scrollTo({ top: back ? memo[name] || 0 : 0, left: 0, behavior: "instant" });
  await during?.();

  // 3. the new screen rises in while the shared elements land on their new homes
  const landings = flights.map(async (f) => {
    const target = f.s.to?.();
    const r = target?.getBoundingClientRect();
    if (!r || !r.width) { await animate(f.clone, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards", key: "fade" }); f.clone.remove(); return; }
    target.style.visibility = "hidden";
    animate(f.clone, [{ scale: "1.045" }, { scale: "1" }], { duration: f.s.duration || 640, easing: EASE.sheet, fill: "forwards", key: "lift" });
    await flyClone(f.clone, r, { radius: f.s.radius?.[1] || "28px", duration: f.s.duration || 640 });
    target.style.visibility = "";
    // its own channel: reusing the flight's would cancel the held landing spot and snap the clone back to its start
    await animate(f.clone, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards", key: "fade" });
    f.clone.remove();
  });
  if (motion) animate(newEl, [{ opacity: 0, transform: `translateY(${back ? -12 : 18}px)`, filter: "blur(8px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }],
    { duration: 560, easing: EASE.out, key: "screen" });
  await Promise.all(landings);
  after?.();
  if (focus && !same) $("h1", newEl)?.focus({ preventScroll: true });
}
