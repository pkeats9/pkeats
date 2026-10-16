# PK Eats — storefront

The pkeats.com ordering site, rebuilt in Apple's design language with a full motion system: dark photo-led stage,
Liquid Glass only in the floating chrome, system SF type, one blue action per screen, and the original PK Eats logo.
Every screen of the original flow is here: address → restaurants → menu → item options → cart → cart code →
sign-in → checkout → price → pay → order placed → live tracking, plus wallet, deposits, orders and cart-code look-up.

It speaks the **same API contract** as the current site (`/api/start`, `/api/menu`, `/api/item`, `/api/cart`,
`/api/lookup`, `/api/site/*` jobs with idempotency keys and CSRF, `/auth/*` sign-in round trips), so it drops onto the
existing PK Eats server without backend changes.

## Run it

Node 20+, nothing to install.

```bash
npm run dev:mock      # real restaurants + menus from pkeats.com, account side simulated (safe: no real orders or money)
npm run dev:offline   # no network at all: recorded restaurants/menus from dev/fixtures + simulated account
npm run dev           # proxies everything to pkeats.com, including the real account (be careful)
```

Then open http://localhost:5173.

- In mock/offline mode "Continue with Google/Discord" signs you straight in as a demo user (balance $42.50), and
  checkout, payment, deposits and tracking all run against an in-memory simulation. `GET /__mock/reset` starts it over.
- Offline extras: an address containing "nowhere" shows the out-of-range state; one containing "fail" shows an error.
- The dev server sends production's exact Content-Security-Policy, so anything that would break on pkeats.com breaks here first.

## Deploy

Copy `public/` into the server's static root. New files: `index.html`, `app.css`, `js/*.js`, `icon.svg`, `legal.css`
(restyles the existing Terms/Privacy pages; `terms.html` and `privacy.html` are the same text for local preview).
The old `builder.js`, `site.js`, `alive.js`, `flight.js` and their CSS can stay for `/admin`. Bump the `?v=` query on
`app.css` / `js/main.js` in `index.html` when you ship changes.

Kept for continuity: the `pkPendingJob`, `pkCheckoutDraft`, `pkAfterSignIn`, `pkOpenOnly` and `yonderVisited`
localStorage keys, and the `#notice=…` / `#signin=…` sign-in hashes. CSP-compatible: no inline scripts, no third-party
scripts or fonts, images only from Wonder's CDN.

## How it's built

Plain HTML/CSS and ES modules, no build step.

| File | What it does |
|---|---|
| `js/motion.js` | The motion system: interruptible WAAPI channels, entrances/cascades, number rolls and count-ups, the dish flight into the bag, sparks and rings, shared-element clones, SF Symbols-style icon effects (bounce, draw-on, magic replace) |
| `js/nav.js` | Screen router. Hand-built transitions (the old screen softens away, the new one rises in, a restaurant's photo flies into its page as a clone under the glass chrome), real Back/Forward history |
| `js/sheet.js` | One sheet for every overlay: rises in (iOS sheet curve on phones), morphs its height and content between steps, drag-to-dismiss, focus trap |
| `js/hero.js` | Start screen: the food wall (parallax with pointer and scroll), the address combobox, the full-screen "finding the good stuff" sequence |
| `js/browse.js` | Restaurants: windowed grid for 1,400+ stores, FLIP on filter/search, 3D tilt + glare, cascades |
| `js/menu.js` | Restaurant page: hero parallax, sticky glass category capsule with scrollspy, live in-cart badges |
| `js/item.js` | Options sheet: full Wonder option rules; choices update in place so controls animate; the Add button fills as required choices are made |
| `js/cart.js` | Cart bar, cart sheet, cart code moment, code look-up |
| `js/account.js` | Sign-in, wallet, deposits, checkout, quote with live price hold, payment, tracking (port of the original `site.js`) |
| `js/scenes.js` | Checkout scenes: the receipt that prints while pricing, the bag that packs your dishes while paying |
| `dev/` | Zero-dependency dev server, account simulation, recorded fixtures |
| `tools/icons.mjs` | Regenerates `js/icons.js` and the sprite from the real SVGs in `assets/` (Lucide icons, theSVG brand marks) |

Motion respects Reduce Motion everywhere (feedback stays, travel/scale/blur/loops go). Only `transform`, `opacity`,
`filter` and `clip-path` animate, except the one-off shared-element flight.
