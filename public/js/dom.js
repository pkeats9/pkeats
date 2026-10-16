// Small DOM + formatting helpers shared by every module.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Wonder returns dollar amounts in menus, variations and add-ons.
export const money = (dollars) => (dollars == null || !Number.isFinite(Number(dollars)) ? "" : "$" + Number(dollars).toFixed(2));
// PK Eats wallet amounts are cents.
export const cash = (cents) => "$" + (Number(cents || 0) / 100).toFixed(2);
// A price the customer can actually pay: zero or missing is never printed (size-priced items say "from $X").
export const priced = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
export function priceHTML(price, from) {
  if (!priced(price)) return "";
  return from ? `<span class="from">from</span> ${money(price)}` : money(price);
}

export const fmtDate = (value) => new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const plain = (text) => String(text || "").replace(/\*\*|`|^#\s/gm, "").replace(/<@\d+>/g, "your account");
export const safeUrl = (value) => { try { const u = new URL(value); return u.protocol === "https:" ? u.href : ""; } catch { return ""; } };
export const initials = (name) => (name || "?").replace(/[^a-zA-Z0-9 ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "PK";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Parse an HTML string into a single element. */
export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Announce to screen readers without a visual toast. */
export function announce(text) {
  const a = $("#announcer");
  if (!a) return;
  a.textContent = "";
  requestAnimationFrame(() => (a.textContent = text));
}

export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
  json(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } },
};
