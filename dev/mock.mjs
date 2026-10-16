// Simulated account side of PK Eats for local work (sign-in, wallet, deposits, checkout, payment, tracking, cart codes)
// plus offline copies of the builder API (restaurants, menus, items) from dev/fixtures. In-memory; resets on restart.
// Response shapes mirror what the production front-end reads, so every screen and panel can be exercised safely.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function createMock({ root, offline, latency = 1, fulfillment = "both" }) {
  const fx = (p) => JSON.parse(fs.readFileSync(path.join(root, "dev/fixtures", p), "utf8"));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms * latency));
  const code = (n = 6, prefix = "") => prefix + Array.from(crypto.randomBytes(n), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("").slice(0, n - prefix.length);
  const now = () => new Date().toISOString();
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

  const config = { ...fx("config.json"), fulfillment: fulfillment === "both" ? null : fulfillment };
  const start = offline ? fx("start.json") : null;
  const all = offline ? fx("allstores.json") : null;
  const menus = offline ? Object.fromEntries(fs.readdirSync(path.join(root, "dev/fixtures/menus")).map((f) => [f.replace(".json", ""), fx(`menus/${f}`)])) : {};
  const items = offline ? Object.fromEntries(fs.readdirSync(path.join(root, "dev/fixtures/items")).map((f) => [f.replace(".json", ""), fx(`items/${f}`)])) : {};
  const searches = offline ? fx("search.json") : {};

  /* ── account state ─────────────────────────────────────────────── */
  const fresh = () => ({
    signedIn: false,
    user: { id: "u_demo", name: "Jordan Lee", discordLinked: false, canLinkDiscord: true },
    terms: { version: "2026-10-09", accepted: false },
    balanceCents: 4250,
    snapshotAt: ago(3),
    history: [
      { description: "Deposit · Venmo", created_at: ago(60 * 26), type: "credit", amount_cents: 5000 },
      { description: "Order · Burger Baby Chelsea", created_at: ago(60 * 25), type: "debit", amount_cents: -2150 },
      { description: "Refund credit · missing side", created_at: ago(60 * 24), type: "credit", amount_cents: 400 },
    ],
    deposits: [{ provider: "venmo", payment_code: "DPK4M2", status: "credited", amount_due_cents: 5000 }],
    payments: [
      { payment_code: "PK7Q2M", purpose: "order", status: "paid", order_status: "placed", fulfillment: "pickup", amount_due_cents: 2150,
        created_at: ago(60 * 25), wonderful_order_number: "L928410", tracking_url: null, restaurant: "Burger Baby Chelsea" },
    ],
    quotes: [],
    carts: new Map(),   // code -> { store, items, fulfillment }
    jobs: new Map(),
    keys: new Map(),    // idempotency key -> job id
    placedAt: new Map(), // paymentCode -> ms
  });
  let db = fresh();
  const me = () => ({
    user: db.user, csrf: "mock-csrf", admin: false, terms: db.terms,
    snapshot: { balanceCents: db.balanceCents, history: db.history.slice().reverse(), deposits: db.deposits.slice().reverse() },
    snapshotAt: db.snapshotAt, payments: db.payments.slice().reverse(), quotes: db.quotes,
  });

  const JOB_MS = { sync: 900, prepare: 2600, pay: 3200, deposit: 1100, checkDeposit: 1500, cancel: 800, track: 1200 };
  function runJob(job) {
    const p = job.payload || {};
    switch (job.action) {
      case "sync": db.snapshotAt = now(); return {};
      case "prepare": {
        const cart = db.carts.get(String(p.cartCode || "").toUpperCase());
        const lines = cart?.items || [{ name: "Demo item", quantity: 1, price: 12.5 }];
        const sub = Math.round(lines.reduce((a, l) => a + (Number(l.price) || 9.5) * (l.quantity || 1), 0) * 100);
        const fees = Math.round(sub * 0.08875) + (p.fulfillment === "delivery" ? 399 : 0) + Math.round((Number(p.tip) || 0) * 100);
        const paymentCode = code(6, "P");
        const quote = { paymentCode, restaurant: cart?.store?.restaurant_name || "Pizza Mato Chelsea", fulfillment: p.fulfillment || "pickup",
          items: lines.map((l) => ({ name: l.name, quantity: l.quantity || 1 })), address: p.fulfillment === "delivery" ? p.address : cart?.store?.address || "128 West 23rd Street, New York, NY 10011",
          amountDueCents: sub + fees, expiresAt: new Date(Date.now() + 15 * 60000).toISOString() };
        db.quotes.push(quote);
        db.payments.push({ payment_code: paymentCode, purpose: "order", status: "pending", order_status: "not_started", fulfillment: quote.fulfillment,
          amount_due_cents: quote.amountDueCents, created_at: now(), restaurant: quote.restaurant });
        return quote;
      }
      case "pay": {
        const pay = db.payments.find((x) => x.payment_code === p.paymentCode);
        if (!pay) return { error: "That checkout has expired. Prepare a fresh one." };
        if (db.balanceCents < pay.amount_due_cents) return { error: "Your balance doesn't cover this order yet. Add funds, then try again." };
        db.balanceCents -= pay.amount_due_cents;
        Object.assign(pay, { status: "paid", order_status: "placed", wonderful_order_number: "L" + (929956 + db.payments.length), tracking_url: null });
        db.history.push({ description: `Order · ${pay.restaurant}`, created_at: now(), type: "debit", amount_cents: -pay.amount_due_cents });
        db.placedAt.set(pay.payment_code, Date.now());
        return { orderStatus: "placed", orderNumber: pay.wonderful_order_number, paymentCode: pay.payment_code };
      }
      case "deposit": {
        const dep = { provider: p.provider, payment_code: code(6, "D"), status: "pending", amount_due_cents: Number(p.amountCents) || 2000 };
        db.deposits.push(dep);
        const destination = { venmo: "@PKEats-Demo", paypal: "payments@pkeats.example", zelle: "zelle@pkeats.example" }[p.provider] || "demo";
        return { provider: p.provider, amountCents: dep.amount_due_cents, destination, paymentCode: dep.payment_code, ticketUrl: null };
      }
      case "checkDeposit": {
        const dep = db.deposits.find((x) => x.payment_code === p.paymentCode);
        if (!dep) return { error: "We couldn't find that deposit code." };
        if (dep.status !== "credited") {
          dep.status = "credited"; db.balanceCents += dep.amount_due_cents;
          db.history.push({ description: `Deposit · ${dep.provider[0].toUpperCase() + dep.provider.slice(1)}`, created_at: now(), type: "credit", amount_cents: dep.amount_due_cents });
        }
        return { message: `Your $${(dep.amount_due_cents / 100).toFixed(2)} deposit is in your balance.` };
      }
      case "cancel": {
        const pay = db.payments.find((x) => x.payment_code === p.paymentCode);
        if (pay) pay.status = "canceled";
        db.quotes = db.quotes.filter((q) => q.paymentCode !== p.paymentCode);
        return {};
      }
      case "track": return tracking(p.paymentCode);
    }
    return { error: "Unknown action." };
  }

  // Tracking advances with time since payment: ~40 s per stage so the live refresh is visible while testing.
  function tracking(paymentCode) {
    const pay = db.payments.find((x) => x.payment_code === paymentCode) || db.payments[0];
    const pickup = pay?.fulfillment !== "delivery";
    const t0 = db.placedAt.get(pay?.payment_code) || Date.now() - 6 * 60000;
    const stage = Math.min(pickup ? 3 : 4, Math.floor((Date.now() - t0) / 40000));
    const labels = pickup ? ["Order placed", "Being prepared", "Ready for pickup", "Picked up"] : ["Order placed", "Being prepared", "Picked up by courier", "Out for delivery", "Delivered"];
    const statuses = pickup ? ["placed", "preparing", "ready_for_pickup", "picked_up"] : ["placed", "preparing", "picked_up_by_courier", "out_for_delivery", "delivered"];
    const steps = labels.map((label, i) => ({ label, done: i < stage || (i === stage && i === labels.length - 1), current: i === stage, at: i <= stage ? new Date(t0 + i * 40000).toISOString() : null }));
    return {
      paymentCode: pay?.payment_code, restaurant: pay?.restaurant || "Pizza Mato Chelsea", fulfillment: pickup ? "pickup" : "delivery",
      status: statuses[stage], eta: new Date(t0 + 18 * 60000).toISOString(), orderNumber: pay?.wonderful_order_number || "L929956",
      customerName: "Jordan L.", placedAt: new Date(t0).toISOString(), checkedAt: now(), steps,
      store: { name: pay?.restaurant || "Pizza Mato Chelsea", address: "128 West 23rd Street, New York, NY 10011", phone: "+12125550134" },
      courier: pickup ? {} : { name: "Sam", vehicle: "E-bike", phone: "+12125550188" },
      deliveryAddress: pickup ? null : "350 5th Ave, New York, NY 10118",
      items: (db.quotes.find((q) => q.paymentCode === pay?.payment_code)?.items || [{ name: "Ranch Hand Pizza", quantity: 1 }]).map((i) => ({ quantity: i.quantity, name: i.name })),
      trackingUrl: null,
    };
  }

  /* ── http helpers ──────────────────────────────────────────────── */
  const send = (res, status, obj, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }); res.end(JSON.stringify(obj)); return true; };
  const body = (req) => new Promise((resolve) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch { resolve({}); } }); });
  const needAuth = (res) => (db.signedIn ? false : send(res, 401, { error: "Sign in to continue." }));
  const storeById = (rid) => all?.restaurants.find((r) => r.id === rid) || start?.restaurants.find((r) => r.id === rid);

  async function handle(req, res, url) {
    const p = url.pathname, q = url.searchParams;

    /* dev only: start every test from the same account state */
    if (p === "/__mock/reset") { db = fresh(); return send(res, 200, { ok: true }); }

    /* sign-in round trips (production goes to Google/Discord and back with #notice=…) */
    if (p === "/auth/google" || p === "/auth/discord") { db.signedIn = true; res.writeHead(302, { Location: "/#notice=signed_in" }); res.end(); return true; }
    if (p === "/auth/discord/link") { db.user.discordLinked = true; db.user.canLinkDiscord = false; res.writeHead(302, { Location: "/#notice=linked" }); res.end(); return true; }

    if (p === "/api/site/config") return send(res, 200, config);
    if (p === "/api/site/me") { await sleep(120); return needAuth(res) || send(res, 200, me()); }
    if (p === "/api/site/terms" && req.method === "POST") { if (needAuth(res)) return true; db.terms.accepted = true; return send(res, 200, { version: db.terms.version, accepted: true }); }
    if (p === "/api/site/signout" && req.method === "POST") { db.signedIn = false; return send(res, 200, { ok: true }); }
    if (p === "/api/site/signin" && req.method === "POST") { await body(req); db.signedIn = true; return send(res, 200, { ok: true }); }
    if (p === "/api/site/track" && req.method === "POST") { if (needAuth(res)) return true; const b = await body(req); await sleep(500); return send(res, 200, tracking(b.paymentCode)); }
    if (p === "/api/site/jobs" && req.method === "POST") {
      if (needAuth(res)) return true;
      const b = await body(req); const key = req.headers["idempotency-key"];
      if (key && db.keys.has(key)) return send(res, 200, { id: db.keys.get(key) });
      const job = { id: "job_" + crypto.randomUUID().slice(0, 8), action: b.action, payload: b.payload, doneAt: Date.now() + (JOB_MS[b.action] || 1000) * latency, result: null };
      db.jobs.set(job.id, job); if (key) db.keys.set(key, job.id);
      return send(res, 200, { id: job.id, status: "running" });
    }
    const jm = p.match(/^\/api\/site\/jobs\/([\w-]+)$/);
    if (jm) {
      const job = db.jobs.get(jm[1]);
      if (!job) return send(res, 404, { error: "That request has expired." });
      if (Date.now() < job.doneAt) return send(res, 200, { id: job.id, status: "running" });
      if (!job.result) job.result = runJob(job);
      return send(res, 200, { id: job.id, status: job.result.error ? "failed" : "done", result: job.result });
    }

    /* cart codes: never created on the real system while mocking */
    if (p === "/api/cart" && req.method === "POST") {
      const b = await body(req); await sleep(900);
      const c = code(6); db.carts.set(c, { store: b.store, items: (b.items || []).map((i) => ({ ...i })) });
      return send(res, 200, { code: c, store: b.store?.restaurant_name || "Restaurant", count: (b.items || []).reduce((n, i) => n + (i.quantity || 1), 0) });
    }
    if (p === "/api/lookup") {
      await sleep(600);
      const c = String(q.get("code") || "").toUpperCase(); const cart = db.carts.get(c);
      if (!cart && c !== "7KQ4M2") return send(res, 404, { error: "We couldn't find that cart code. Check it and try again." });
      const items = cart ? cart.items : [{ name: "Ranch Hand Pizza", quantity: 1 }, { name: "6-Piece Garlic Knots", quantity: 2 }];
      return send(res, 200, { restaurant: cart?.store?.restaurant_name || "Pizza Mato Chelsea", fulfillment: "PICKUP", address: { address_name: "350 5th Ave, New York, NY 10118" },
        count: items.reduce((n, i) => n + (i.quantity || 1), 0), items: items.map((i) => ({ quantity: i.quantity, menu_item_name: i.name })) });
    }

    if (!offline) return false;

    /* ── offline builder API ───────────────────────────────────── */
    if (p === "/api/autocomplete") {
      await sleep(120);
      const s = String(q.get("q") || "").trim();
      const base = ["350 5th Ave, New York, NY, USA", "350 5th Avenue, Brooklyn, NY, USA", "100 W 23rd St, New York, NY, USA", "1 Main St, Brooklyn, NY, USA", "128 W 23rd St, New York, NY, USA"];
      const preds = base.filter((a) => a.toLowerCase().includes(s.toLowerCase().slice(0, 3))).concat(base).slice(0, 5)
        .map((d) => ({ description: d, main: d.split(",")[0], secondary: d.split(",").slice(1).join(",").trim() }));
      return send(res, 200, { predictions: preds });
    }
    if (p === "/api/start" && req.method === "POST") {
      const b = await body(req); await sleep(1400);
      if (/nowhere|mars/i.test(b.address || "")) return send(res, 422, { error: "Wonder doesn't cover this address yet. Try another address that's in range.", code: "ADDRESS_NOT_SERVED" });
      if (/fail/i.test(b.address || "")) return send(res, 500, { error: "We couldn't reach Wonder just now. Please try again." });
      return send(res, 200, { ...start, sid: "offline-" + crypto.randomUUID().slice(0, 6), dining: b.dining || "PICKUP" });
    }
    if (p === "/api/allstores") { await sleep(2600); return send(res, 200, all); }
    if (p === "/api/search") {
      await sleep(260);
      const s = String(q.get("q") || "").toLowerCase();
      const hit = searches[s] || (() => { const r = all.restaurants.filter((x) => [x.name, x.brand_name, x.cuisine].some((v) => (v || "").toLowerCase().includes(s))); return { restaurants: r.slice(0, 25), total: r.length, page: 1, page_size: 25 }; })();
      return send(res, 200, hit);
    }
    if (p === "/api/menu") {
      await sleep(700);
      const rid = q.get("rid"); if (menus[rid]) return send(res, 200, menus[rid]);
      const s = storeById(rid) || {}; const tpl = Object.values(menus)[Math.abs([...String(rid)].reduce((a, c) => a + c.charCodeAt(0), 0)) % Object.keys(menus).length];
      return send(res, 200, { ...tpl, restaurant_id: rid, restaurant_name: s.name || tpl.restaurant_name, logo: s.logo || null, cover: s.cover || tpl.cover,
        address: s.address || tpl.address, address_kind: s.brand_category === "WONDER_HDR" ? "hub" : "restaurant", hub_name: s.hub_name || tpl.hub_name,
        distance_mi: s.distance_mi ?? tpl.distance_mi, rating: s.rating ?? tpl.rating, rating_count: s.rating_count ?? tpl.rating_count,
        short_description: s.short_description || tpl.short_description, brand_category: s.brand_category || tpl.brand_category, status: s.status || "OPEN", opening_time: s.opening_time || null });
    }
    if (p === "/api/item") {
      await sleep(420);
      const it = items[q.get("iid")];
      if (it?.error) return send(res, 404, it);
      if (it) return send(res, 200, it);
      for (const m of Object.values(menus)) {
        const x = m.items.find((i) => i.item_id === q.get("iid"));
        if (x) return send(res, 200, { item_id: x.item_id, name: x.name, description: x.description, brand_category: m.brand_category, base_price: x.base_price, from_price: x.price, prices_in_options: false, variations: [], groups: [] });
      }
      return send(res, 404, { error: "menu item not found", code: "NOT_FOUND" });
    }
    return false;
  }

  return { handle };
}
