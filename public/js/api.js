// API clients. Same endpoints, payloads and error handling as the production front-end, so this UI drops onto the
// existing PK Eats server unchanged.
import { state, rememberStores } from "./state.js";
import { toast } from "./toast.js";

/* ── builder API (/api/start, /api/menu, /api/item, /api/cart, …) ── */
export async function api(path, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), path === "/api/start" ? 120000 : 60000);
  try {
    const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts, signal: controller.signal });
    let data;
    try { data = await r.json(); } catch {
      const e = new Error("The server didn’t finish responding. Please try again."); e.status = r.status; throw e;
    }
    if (!r.ok) { const e = new Error(data.error || "We couldn’t complete that request. Please try again."); e.code = data.code; e.status = r.status; throw e; }
    return data;
  } catch (e) {
    if (controller.signal.aborted) throw new Error("This is taking too long. Please try again in a moment.");
    if (e instanceof TypeError) throw new Error("The connection was interrupted. Please try again.");
    throw e;
  } finally { clearTimeout(timer); }
}

/* Sessions expire after 30 idle minutes. On an expired session (440) quietly mint a new one for the same address
   and retry once, so a long browse never loses the cart. */
let remintPromise = null;
function remint() {
  if (!remintPromise) {
    toast("Reconnecting to Wonder…");
    remintPromise = api("/api/start", { method: "POST", body: JSON.stringify({ address: state.addressQuery, dining: state.dining }) })
      .then((d) => { state.sid = d.sid; state.timeZone = d.time_zone || state.timeZone; rememberStores(d.restaurants); })
      .finally(() => { remintPromise = null; });
  }
  return remintPromise;
}
export async function withSession(call) {
  try { return await call(encodeURIComponent(state.sid || "")); }
  catch (e) {
    if (e.status !== 440 || !state.addressQuery) throw e;
    await remint();
    return call(encodeURIComponent(state.sid));
  }
}

/* ── site API (/api/site/*): account, wallet, jobs, tracking ── */
export const site = {
  csrf: "",
  async call(path, options = {}) {
    let response;
    try {
      response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(this.csrf ? { "X-CSRF-Token": this.csrf } : {}), ...(options.headers || {}) } });
    } catch { throw new Error("The connection was interrupted. Please try again."); }
    let d;
    try { d = await response.json(); } catch { d = {}; if (!response.ok) d.error = "The server didn’t finish responding. Please try again."; }
    if (!response.ok) { const e = new Error(d.error || "Could not complete the request."); e.status = response.status; e.code = d.code; throw e; }
    return d;
  },
};
