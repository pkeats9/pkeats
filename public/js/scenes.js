// Checkout scenes: the moments while the server works.
//   prepare → a receipt prints line by line; its total spins until the real price lands and gets stamped.
//   pay     → your dishes drop one by one into the bag while a three-step tracker ticks forward; the bag becomes a check.
// Each scene returns { html, start(view), finish(result, view), fail() }. finish() plays the landing beat and resolves
// when the next view may take over. Reduced motion gets the same information without the movement.
import { $, $$, esc, money, cash, sleep } from "./dom.js";
import { state } from "./state.js";
import { animate, EASE, reduced, burst, ring, replaceIcon, drawOn, receive, bounce } from "./motion.js";
import { icon } from "./icons.js";

const PK_MARK = `<svg class="pk-mark" aria-hidden="true"><use href="#pk-mark"/></svg>`;

/* ── Getting your price: the receipt ─────────────────────────────── */
// What was in the cart: live state when we have it, else what the checkout draft remembered across a sign-in reload.
export function cartLines(draft = {}) {
  if (state.cart.length) return { lines: state.cart.slice(0, 5).map((l) => ({ n: l.name, q: l.quantity, p: l.price, img: l.image })), more: Math.max(0, state.cart.length - 5) };
  return { lines: draft.lines || [], more: draft.more || 0 };
}

export function receiptScene(draft = {}) {
  const cart = cartLines(draft);
  const lines = cart.lines.length
    ? cart.lines.map((l) => ({ name: `${l.q}× ${l.n}`, price: l.p ? money(l.p * l.q) : "" }))
    : [{ name: `${Number(draft.count) || 1} item${Number(draft.count) === 1 ? "" : "s"}`, price: "" }];
  const more = cart.more;
  const html = `<div class="scene receipt-scene" aria-hidden="true">
      <div class="printer"><span></span></div>
      <div class="paper-clip"><div class="paper">
        <div class="p-brand">${PK_MARK}<b>PK</b><span>Eats</span></div>
        <div class="p-store">${esc(draft.restaurant || state.store?.restaurant_name || "Your order")}</div>
        <div class="p-rule"></div>
        ${lines.map((l) => `<div class="p-line"><span>${esc(l.name)}</span><b>${esc(l.price)}</b></div>`).join("")}
        ${more ? `<div class="p-line p-more"><span>+ ${more} more</span><b></b></div>` : ""}
        <div class="p-rule"></div>
        <div class="p-line p-total"><span>Total</span><b class="p-amount num">$00.00</b></div>
        <div class="p-stamp">${icon("circle-check")}<span>Price confirmed</span></div>
      </div></div>
    </div>`;
  let spinTimer = 0;
  return {
    html,
    start(view) {
      const paper = $(".paper", view), amount = $(".p-amount", view);
      if (reduced.matches) { amount.textContent = "…"; return; }
      // it prints top to bottom: the paper feeds a line at a time (hold, then a short ease-out advance) and each new
      // line is revealed at the slot as it goes
      const rows = $$(".paper > :not(.p-stamp)", view), H = paper.offsetHeight;
      const cut = rows.map((r) => r.offsetTop + r.offsetHeight + 6).concat(H);
      const clip = (y) => `inset(0px 0px ${Math.max(0, H - y).toFixed(1)}px 0px)`;
      const frames = [{ clipPath: clip(0), transform: "translateY(-14px)", offset: 0 }];
      cut.forEach((y, i) => {
        const prev = i ? cut[i - 1] : 0;
        frames.push({ clipPath: clip(prev), transform: `translateY(${(-14 + 14 * i / cut.length).toFixed(2)}px)`, offset: (i + .38) / cut.length, easing: EASE.out });
        frames.push({ clipPath: clip(y), transform: `translateY(${(-14 + 14 * (i + 1) / cut.length).toFixed(2)}px)`, offset: (i + 1) / cut.length });
      });
      paper.style.transform = "none";
      animate(paper, frames, { duration: cut.length * 250, easing: "linear", fill: "forwards", key: "print" });
      // the total spins like a counter while the server works it out
      spinTimer = setInterval(() => { amount.textContent = `$${(Math.random() * 80 + 10).toFixed(2)}`; }, 85);
    },
    async finish(q, view) {
      clearInterval(spinTimer);
      if (!view?.isConnected) return;
      const amount = $(".p-amount", view), stamp = $(".p-stamp", view);
      amount.textContent = cash(q?.amountDueCents);
      stamp.classList.add("on");
      if (reduced.matches) return sleep(500);
      animate(amount, [{ transform: "scale(1.3)", filter: "blur(4px)", opacity: .2 }, { transform: "none", filter: "blur(0px)", opacity: 1 }], { duration: 520, easing: EASE.out });
      animate(stamp, [{ opacity: 0, transform: "scale(1.7) rotate(-16deg)" }, { opacity: 1, transform: "scale(1) rotate(-7deg)" }], { duration: 480, delay: 160, easing: "cubic-bezier(.34,1.56,.64,1)" });
      drawOn($("svg", stamp), { delay: 300, duration: 460 });
      setTimeout(() => stamp.isConnected && burst(stamp, { count: 10, spread: 40, size: 5, colors: ["#30d158", "#ffffff", "#7ee3a0"] }), 420);
      await sleep(1150);
    },
    fail() { clearInterval(spinTimer); },
  };
}

/* ── Placing your order: packing the bag ─────────────────────────── */
export function packScene(draft = {}) {
  const pics = cartLines(draft).lines.filter((l) => l.img).map((l) => l.img).slice(0, 5);
  const items = pics.length ? pics : [null, null, null];
  const n = items.length, R = 138;
  // the dishes wait in a gentle arc above the bag
  const pos = items.map((_, i) => {
    const a = ((n === 1 ? 0 : -62 + (124 * i) / (n - 1)) * Math.PI) / 180;
    return { x: Math.round(Math.sin(a) * R), y: Math.round(-Math.cos(a) * R * .78) };
  });
  const html = `<div class="scene pack-scene" aria-hidden="true">
      <div class="pack-stage">
        ${items.map((src, i) => `<span class="pack-item" style="transform:translate(${pos[i].x}px, ${pos[i].y}px)">${src ? `<img src="${esc(src)}" alt="">` : icon("utensils")}</span>`).join("")}
        <div class="pack-bag"><span class="pack-glow"></span><span class="pack-ico">${icon("bag")}</span></div>
      </div>
      <ol class="pack-steps">
        <li class="on"><span class="pk-dot">${icon("check")}</span><span>Paying with balance</span></li>
        <li><span class="pk-dot">${icon("check")}</span><span>Sending to the kitchen</span></li>
        <li><span class="pk-dot">${icon("check")}</span><span>Confirming your order</span></li>
      </ol>
    </div>`;
  let timers = [];
  const stepTo = (view, k) => {
    $$(".pack-steps li", view).forEach((li, i) => {
      const was = li.classList.contains("done");
      li.classList.toggle("done", i < k); li.classList.toggle("on", i === k);
      if (i < k && !was && !reduced.matches) drawOn($(".pk-dot svg", li), { duration: 380 });
    });
  };
  return {
    html,
    start(view) {
      if (reduced.matches) return;
      const bag = $(".pack-bag", view), its = $$(".pack-item", view);
      animate(bag, [{ transform: "scale(.6)", opacity: 0, filter: "blur(10px)" }, { transform: "none", opacity: 1, filter: "blur(0px)" }], { duration: 640, easing: EASE.smooth });
      its.forEach((el, i) => {
        const p = pos[i], base = `translate(${p.x}px, ${p.y}px)`;
        animate(el, [{ opacity: 0, transform: `${base} scale(.4)`, filter: "blur(6px)" }, { opacity: 1, transform: `${base} scale(1)`, filter: "blur(0px)" }],
          { duration: 560, delay: 180 + i * 90, easing: EASE.out, key: "move" });
        // one by one, each dish lifts and drops into the bag
        timers.push(setTimeout(() => {
          if (!el.isConnected) return;
          animate(el, [
            { transform: `${base} scale(1)`, opacity: 1 },
            { transform: `translate(${Math.round(p.x * .55)}px, ${p.y - 30}px) scale(.86)`, opacity: 1, offset: .42 },
            { transform: "translate(0px, 0px) scale(.16)", opacity: 0 },
          ], { duration: 640, easing: EASE.io, fill: "forwards", key: "move" }).then(() => { receive(bag); bounce($(".pack-ico svg", view)); });
        }, 950 + i * 430));
      });
      timers.push(setTimeout(() => stepTo(view, 1), 1350));
      timers.push(setTimeout(() => stepTo(view, 2), 950 + its.length * 430 + 450));
    },
    async finish(result, view) {
      timers.forEach(clearTimeout); timers = [];
      if (!view?.isConnected) return;
      stepTo(view, 3);
      $$(".pack-item", view).forEach((el) => { el.getAnimations().forEach((a) => a.cancel()); el.style.opacity = "0"; });
      const bag = $(".pack-bag", view);
      bag.classList.add("done");
      if (reduced.matches) return sleep(400);
      replaceIcon($(".pack-ico", view), icon("check"));
      animate(bag, [{ transform: "scale(1)" }, { transform: "scale(1.12)", offset: .35 }, { transform: "scale(1)" }], { duration: 560, easing: EASE.out });
      setTimeout(() => { if (bag.isConnected) { ring(bag, { count: 3, size: 2.1 }); burst(bag, { count: 18, spread: 86, size: 7 }); } }, 160);
      await sleep(1000);
    },
    fail() { timers.forEach(clearTimeout); timers = []; },
  };
}
