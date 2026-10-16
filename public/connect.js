/* KopaBook Connect v1
 * Drop this on any website to read your KopaBook business data (read-only).
 *
 *   <script src="https://kopabook.com/connect.js"></script>
 *   <script>
 *     const kb = KopaBook.connect("kbk_live_YOUR_KEY");
 *     const { products } = await kb.products();   // live products + stock
 *     const { dashboard } = await kb.dashboard(); // today's sales, debts, low stock
 *   </script>
 *
 * Get your key in KopaBook: Settings > Developer API > Connect a website.
 * Keys are read-only and only see one business. Keep your key server-side
 * when you can; the /products and /business endpoints are safe for
 * browser use (they expose no customer or money details).
 */
(function (global) {
  "use strict";

  const BASE = "https://kopabook.com/api/v1";

  function client(key) {
    if (!key || !/^kbk_live_/.test(key)) {
      throw new Error("KopaBook: pass your API key, e.g. KopaBook.connect(\"kbk_live_...\")");
    }

    async function get(resource, params) {
      const url = new URL(BASE + "/" + resource);
      if (params) {
        for (const k of Object.keys(params)) url.searchParams.set(k, params[k]);
      }
      const res = await fetch(url.toString(), {
        headers: { "Authorization": "Bearer " + key },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        const err = new Error(data.message || ("KopaBook request failed (" + res.status + ")"));
        err.code = data.error || "request-failed";
        throw err;
      }
      return data;
    }

    return {
      key: key,
      business: () => get("business"),
      dashboard: () => get("dashboard"),
      products: (opts) => get("products", opts), // { limit, offset }
      sales: (opts) => get("sales", opts),       // { limit, offset }
      debts: () => get("debts"),
      expenses: (opts) => get("expenses", opts), // { limit, offset }
    };
  }

  global.KopaBook = global.KopaBook || {};
  global.KopaBook.connect = client;
  global.KopaBook.version = "1.0.0";
})(typeof window !== "undefined" ? window : this);
