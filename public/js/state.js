// One shared state object for the ordering flow (same fields the original builder kept).
export const state = {
  // builder session
  sid: null, dining: "DELIVERY", addressLabel: "", addressQuery: "", timeZone: null,
  restaurants: [], restaurantFilter: "all", openOnly: false, allLoaded: false,
  stores: new Map(),      // every store seen (browse, full list, search) by id
  store: null,            // { restaurant_id, restaurant_name, brand_category, info }
  menu: null,
  // cart lines: { key, item_id, name, price, image, variation_id, category_id, category_name, type, quantity, options, optLabel }
  cart: [],
  screen: "start",
  // site
  config: {},
  me: null,
};

// Keep the richest copy of every store we have seen, whichever list it came from.
export function rememberStores(list) {
  for (const r of list || []) {
    if (!r?.id) continue;
    const prev = state.stores.get(r.id);
    const merged = { ...(prev || {}) };
    for (const [k, v] of Object.entries(r)) if (v != null && v !== "") merged[k] = v;
    state.stores.set(r.id, merged);
  }
  return (list || []).filter((r) => r?.id).map((r) => state.stores.get(r.id));
}
