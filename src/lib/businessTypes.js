// Organization types for registration. Each type gets the service modules
// (nav sections) that fit how that business actually works.
export const ORG_TYPES = [
  {
    key: "hotel",
    label: "Hotel / Guest House",
    icon: "🏨",
    tagline: "Rooms, bookings, guest folios and billing.",
    modules: ["dashboard", "hotels", "customers", "debts", "expenses", "messages", "reports", "staff", "settings"],
  },
  {
    key: "restaurant",
    label: "Restaurant / Eatery",
    icon: "🍽️",
    tagline: "Fast sales, menu items and customer debts.",
    modules: ["dashboard", "sales", "products", "customers", "debts", "expenses", "messages", "reports", "staff", "settings"],
  },
  {
    key: "retail",
    label: "Provision Store / Retail Shop",
    icon: "🏪",
    tagline: "Sales, stock, suppliers and debts.",
    modules: ["dashboard", "sales", "products", "suppliers", "import", "customers", "debts", "expenses", "messages", "reports", "staff", "settings"],
  },
  {
    key: "pharmacy",
    label: "Pharmacy / Chemist",
    icon: "💊",
    tagline: "Stock control, sales and customer records.",
    modules: ["dashboard", "sales", "products", "suppliers", "import", "customers", "debts", "expenses", "messages", "reports", "staff", "settings"],
  },
  {
    key: "supermarket",
    label: "Supermarket / Mini-mart",
    icon: "🛒",
    tagline: "High-volume sales with full stock tracking.",
    modules: ["dashboard", "sales", "products", "suppliers", "import", "customers", "debts", "expenses", "messages", "reports", "staff", "settings"],
  },
  {
    key: "electronics",
    label: "Phones / Electronics",
    icon: "📱",
    tagline: "Unit sales, stock and supplier tracking.",
    modules: ["dashboard", "sales", "products", "suppliers", "import", "customers", "debts", "expenses", "messages", "reports", "staff", "settings"],
  },
  {
    key: "fashion",
    label: "Fashion / Tailoring",
    icon: "👗",
    tagline: "Products, custom jobs and client debts.",
    modules: ["dashboard", "sales", "products", "services", "customers", "debts", "expenses", "messages", "reports", "staff", "settings"],
  },
  {
    key: "salon",
    label: "Salon / Barbershop / Spa",
    icon: "💈",
    tagline: "Services, walk-in sales and client records.",
    modules: ["dashboard", "sales", "services", "products", "customers", "debts", "expenses", "messages", "reports", "staff", "settings"],
  },
  {
    key: "artisan",
    label: "Artisan / Repairs / Services",
    icon: "🛠️",
    tagline: "Jobs, service charges and client debts.",
    modules: ["dashboard", "sales", "services", "customers", "suppliers", "debts", "expenses", "messages", "reports", "staff", "settings"],
  },
  {
    key: "other",
    label: "Other Business",
    icon: "🏢",
    tagline: "The full KopaBook toolkit, everything on.",
    modules: ["dashboard", "sales", "services", "products", "suppliers", "import", "customers", "hotels", "debts", "expenses", "messages", "reports", "staff", "settings"],
  },
];

export function orgTypeFor(key) {
  return ORG_TYPES.find((t) => t.key === key) || ORG_TYPES.find((t) => t.key === "other");
}

// Sidebar grouping: section label -> module keys in display order.
export const NAV_GROUPS = [
  { label: null, modules: ["dashboard"] },
  { label: "Sales", modules: ["sales", "products", "services"] },
  { label: "Customers", modules: ["customers", "debts"] },
  { label: "Stock", modules: ["suppliers", "import", "expenses"] },
  { label: "Hotels", modules: ["hotels"] },
  { label: "Insights", modules: ["messages", "reports"] },
  { label: "Setup", modules: ["staff", "settings"] },
];

// Mobile bottom-bar priority: most-used modules first per business.
export const MOBILE_PRIORITY = [
  "dashboard", "sales", "hotels", "products", "services", "customers",
  "debts", "expenses", "messages", "reports", "suppliers", "import",
  "staff", "settings",
];

// Nav path -> module key used above.
export const NAV_MODULES = {
  "/app/dashboard": "dashboard",
  "/app/sales": "sales",
  "/app/services": "services",
  "/app/products": "products",
  "/app/suppliers": "suppliers",
  "/app/import": "import",
  "/app/expenses": "expenses",
  "/app/customers": "customers",
  "/app/hotels": "hotels",
  "/app/debts": "debts",
  "/app/messages": "messages",
  "/app/reports": "reports",
  "/app/staff": "staff",
  "/app/settings": "settings",
};
