// Boot: wire every screen, the chrome and the account layer. History is real: Back/Forward move between
// start → restaurants → menu with the same transitions as the on-screen buttons.
import { $ } from "./dom.js";
import { state } from "./state.js";
import { go, onScreen } from "./nav.js";
import { syncChrome, wireSpecular } from "./chrome.js";
import { initHero, editAddress } from "./hero.js";
import { initBrowse } from "./browse.js";
import { initMenu, backToBrowse } from "./menu.js";
import { initCart } from "./cart.js";
import { initAccount } from "./account.js";
import { reveal } from "./motion.js";
import * as sheet from "./sheet.js";

document.documentElement.classList.add("js");

initHero();
initBrowse();
initMenu();
initCart();
syncChrome({ animate: false });
wireSpecular();
reveal();

/* ── history ──────────────────────────────────────────────────────── */
const DEPTH = { start: 0, browse: 1, menu: 2 };
let fromPop = false;
history.replaceState({ pk: "start", depth: 0 }, "");
onScreen((name, from) => {
  if (fromPop || name === from) return;
  if (DEPTH[name] > DEPTH[from]) history.pushState({ pk: name, depth: DEPTH[name] }, "");
  else history.replaceState({ pk: name, depth: DEPTH[name] }, "");
});
addEventListener("popstate", async (e) => {
  const target = e.state?.pk;
  if (!target || target === state.screen) return;
  if (sheet.isOpen()) await sheet.close();
  // a screen we no longer have data for (e.g. after a reload) falls back to the start
  const ok = target === "start" || (target === "browse" && state.sid) || (target === "menu" && state.menu);
  fromPop = true;
  try {
    if (!ok) await go("start");
    else if (target === "browse" && state.screen === "menu") await backToBrowse();
    else await go(target);
  } finally { fromPop = false; }
});

/* back button: walk history when we pushed it, otherwise step back directly */
$("#backBtn").addEventListener("click", () => {
  if ((history.state?.depth || 0) > 0) history.back();
  else if (state.screen === "menu") backToBrowse();
  else go("start");
});
$("#homeLink").addEventListener("click", (e) => { e.preventDefault(); if (state.screen !== "start") go("start"); else window.scrollTo({ top: 0, behavior: "smooth" }); });
$("#addrChip").addEventListener("click", () => editAddress());

// Photos develop in as they arrive instead of popping (load doesn't bubble, so listen in the capture phase).
document.addEventListener("load", (event) => { if (event.target instanceof HTMLImageElement) event.target.classList.add("loaded"); }, true);

// Images that fail fall back to initials (logos) or simply disappear (dish photos) — delegated, CSP-safe.
document.addEventListener("error", (event) => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || img.closest("#wall") || img.classList.contains("flyer")) return;
  if (img.dataset.i) { const s = document.createElement("span"); s.textContent = img.dataset.i; img.replaceWith(s); }
  else { img.closest(".row")?.classList.remove("has-img"); img.remove(); }
}, true);

initAccount();
