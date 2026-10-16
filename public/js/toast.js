// HUD toast: a thick-glass capsule that materialises under the top bar. Routine successes don't toast;
// this is for things worth saying (copied, reconnecting, limits, errors).
import { $ } from "./dom.js";
import { animate, EASE } from "./motion.js";
import { icon } from "./icons.js";

const t = $("#toast");
let timer = 0, version = 0;

export function toast(message, { glyph, duration = 2800 } = {}) {
  const v = ++version;
  const text = document.createElement("span");
  text.textContent = message;
  t.replaceChildren();
  if (glyph) t.insertAdjacentHTML("afterbegin", icon(glyph));
  t.append(text);
  if (t.hidden) {
    t.hidden = false;
    animate(t, [{ opacity: 0, transform: "translateY(-8px) scale(.94)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }],
      { duration: 460, easing: EASE.smooth, key: "life" });
  } else {
    animate(t, [{ transform: "scale(.97)" }, { transform: "none" }], { duration: 260, easing: EASE.out, key: "life" });
  }
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await animate(t, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-6px) scale(.97)", filter: "blur(4px)" }], { duration: 220, fill: "forwards", key: "life" });
    if (v === version) { t.hidden = true; t.getAnimations().forEach((a) => a.cancel()); }
  }, duration);
}
