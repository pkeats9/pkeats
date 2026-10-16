// The floating top layer: back, address capsule, order status, account. Glass that responds to the pointer
// (the rim highlight follows it) and flexes when pressed.
import { $, $$, esc, initials, safeUrl } from "./dom.js";
import { state } from "./state.js";
import { onScreen } from "./nav.js";
import { animate, cancel, reduced, EASE } from "./motion.js";

const backBtn = $("#backBtn"), chip = $("#addrChip"), acct = $("#accountBtn"), statusBtn = $("#orderStatusBtn");

/* glass controls arrive by gathering light (scale + blur + brightness) and leave the same way, faster */
function present(el, show, { delay = 0, animate: anim = true, from = "scale(.82)" } = {}) {
  const visible = !el.hidden && el.dataset.leaving !== "1";
  if (show && !visible) {
    el.dataset.leaving = ""; el.hidden = false;
    if (anim && !reduced.matches) animate(el, [{ opacity: 0, transform: from, filter: "blur(8px) brightness(1.4)" }, { opacity: 1, transform: "none", filter: "blur(0px) brightness(1)" }], { duration: 640, delay, easing: EASE.smooth, key: "life" });
  } else if (!show && visible) {
    if (!anim || reduced.matches) { el.hidden = true; return; }
    el.dataset.leaving = "1";
    animate(el, [{ opacity: 1, transform: "none", filter: "blur(0px)" }, { opacity: 0, transform: "scale(.88)", filter: "blur(6px)" }], { duration: 200, fill: "forwards", key: "life" })
      .then(() => { if (el.dataset.leaving === "1") { el.hidden = true; el.dataset.leaving = ""; cancel(el, "life"); } });
  }
}

export function syncChrome({ animate: anim = true } = {}) {
  const s = state.screen;
  const kind = state.dining === "PICKUP" ? "Pickup" : "Delivery";
  const changed = $("#addrChipText").textContent !== (state.addressLabel || "") || $("#addrChipKind").textContent !== kind;
  $("#addrChipKind").textContent = kind;
  $("#addrChipText").textContent = state.addressLabel || "";
  present(backBtn, s !== "start", { animate: anim });
  present(chip, s !== "start" && !!state.addressLabel, { animate: anim, delay: 90, from: "translateY(-10px) scale(.9)" });
  if (changed && !chip.hidden && anim && !reduced.matches) animate($(".chip-text", chip), [{ opacity: 0, filter: "blur(4px)" }, { opacity: 1, filter: "blur(0px)" }], { duration: 420, delay: 120, key: "text" });
  backBtn.setAttribute("aria-label", s === "menu" ? "Back to restaurants" : "Back to start");
}
onScreen(() => syncChrome());

export function setAccount(me) {
  acct.classList.toggle("signed", !!me);
  if (me) {
    const avatar = safeUrl(me.user?.avatar || "");
    const pic = /^https:\/\/cdn\.discordapp\.com\//.test(avatar) ? `<img src="${esc(avatar)}" alt="" data-i="${esc(initials(me.user.name))}">` : esc(initials(me.user?.name));
    acct.innerHTML = `<span class="avatar" aria-hidden="true">${pic}</span><span class="cap-text acct-name">${esc((me.user?.name || "My account").split(" ")[0])}</span>`;
    acct.setAttribute("aria-label", `Your account, ${me.user?.name || ""}`);
  } else {
    acct.innerHTML = `<svg class="i" aria-hidden="true"><use href="#i-user"/></svg><span class="cap-text">Sign in</span>`;
    acct.setAttribute("aria-label", "Sign in");
  }
}

export function setOrderStatus(count) {
  statusBtn.hidden = !count;
  $("#orderStatusText", statusBtn).textContent = count > 1 ? `Order status (${count})` : "Order status";
  statusBtn.setAttribute("aria-label", count > 1 ? `Order status, ${count} orders in progress` : "Order status, 1 order in progress");
}

// The rim light follows a fine pointer across glass controls (no effect on touch).
export function wireSpecular() {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  let raf = 0, ev = null;
  document.addEventListener("pointermove", (e) => {
    ev = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const g = ev.target.closest?.(".glass");
      $$(".glass.lit").forEach((n) => { if (n !== g) { n.classList.remove("lit"); n.style.removeProperty("--lx"); n.style.removeProperty("--ly"); } });
      if (!g) return;
      const r = g.getBoundingClientRect();
      g.classList.add("lit");
      g.style.setProperty("--lx", `${((ev.clientX - r.left) / r.width * 100).toFixed(1)}%`);
      g.style.setProperty("--ly", `${((ev.clientY - r.top) / r.height * 100 - 60).toFixed(1)}%`);
    });
  }, { passive: true });
}
