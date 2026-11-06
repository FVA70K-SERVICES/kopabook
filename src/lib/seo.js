// Per-route SEO meta for the public pages of KopaBook.
// Each public route gets its own title, description and canonical so
// crawlers see ten distinct pages instead of ten copies of the home
// shell. Titles and descriptions are grounded in the copy already on
// each page in src/pages/Marketing.jsx and src/pages/Legal.jsx.
// App and auth routes are deliberately absent: they must never get
// public SEO meta, and robots.txt already disallows them.

export const SITE_URL = "https://kopabook.com";

export const ROUTE_SEO = {
  "/": {
    title: "KopaBook - Free Sales, Stock and Debt Tracking for Businesses Everywhere",
    description: "KopaBook is the free sales, stock and debt record book for businesses everywhere. Track sales, expenses, inventory and customer debts from your phone.",
    canonical: "https://kopabook.com/",
  },
  "/features": {
    title: "Features | KopaBook",
    description: "Every tool in the real KopaBook app, explained plainly: sales recording, stock, customers and debts, expenses, receipts, staff roles, projects and more.",
    canonical: "https://kopabook.com/features",
  },
  "/pricing": {
    title: "Pricing | KopaBook",
    description: "Start free. Upgrade when your business grows. Prices in Nigerian naira, from NGN 0 free forever to NGN 1,000, NGN 5,000 and NGN 10,000 per month.",
    canonical: "https://kopabook.com/pricing",
  },
  "/about": {
    title: "About | KopaBook",
    description: "KopaBook is a simple, free record keeper for local businesses everywhere: shops, hotels, restaurants, salons, pharmacies and artisans.",
    canonical: "https://kopabook.com/about",
  },
  "/faq": {
    title: "FAQ | KopaBook",
    description: "Everything merchants ask about KopaBook, in one place: what it is, whether it is really free, which businesses it fits, and how debts, stock and staff work.",
    canonical: "https://kopabook.com/faq",
  },
  "/download": {
    title: "Download KopaBook | KopaBook",
    description: "Put KopaBook on your phone or computer and open your shop records in one tap. Android app, Windows app, or add it to your iPhone home screen from Safari.",
    canonical: "https://kopabook.com/download",
  },
  "/terms": {
    title: "Terms of Service | KopaBook",
    description: "The terms of service for KopaBook, the record-keeping service by FVA70K Services: plans and billing, fair use, data ownership, acceptable use and governing law.",
    canonical: "https://kopabook.com/terms",
  },
  "/privacy": {
    title: "Privacy Policy | KopaBook",
    description: "How FVA70K Services collects, uses and protects your data in KopaBook, under the Nigeria Data Protection Act 2023. Your business data is never sold.",
    canonical: "https://kopabook.com/privacy",
  },
  "/refund": {
    title: "Refund Policy | KopaBook",
    description: "KopaBook refund policy: yearly plans carry a seven-day full refund, monthly charges are non-refundable once applied, and duplicate charges are corrected or refunded.",
    canonical: "https://kopabook.com/refund",
  },
  "/hotels": {
    title: "KopaBook for Hotels | KopaBook",
    description: "Rooms, bookings, guest folios and billing in one simple app your front desk learns in an afternoon. Built for hotels, guest houses and lodges everywhere.",
    canonical: "https://kopabook.com/hotels",
  },
};

// Routes that render real screens but must never get public SEO meta:
// the signed-in app, the auth pages, and the public invite and
// registration entry points. Unknown paths are not in this list, so
// they fall through to the not-found title below.
const NON_PUBLIC_PATHS = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/waitlist",
  "/hotels/register",
]);

function isNonPublicPath(path) {
  if (NON_PUBLIC_PATHS.has(path)) return true;
  if (path === "/app" || path.startsWith("/app/")) return true;
  return false;
}

function upsertMetaDescription(content) {
  let tag = document.querySelector('meta[name="description"]');
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", "description");
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function upsertCanonical(href) {
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

// Apply the SEO meta for one pathname. Known public routes get their
// own title, description and canonical. App and auth routes are left
// alone. Any other path is an unknown route, so it gets the not-found
// title and the canonical is left untouched.
export function applyRouteSeo(path) {
  if (typeof document === "undefined") return;
  const meta = ROUTE_SEO[path];
  if (meta) {
    document.title = meta.title;
    upsertMetaDescription(meta.description);
    upsertCanonical(meta.canonical);
    return;
  }
  if (isNonPublicPath(path)) return;
  document.title = "Page not found | KopaBook";
}
