// Organization types for registration. Each type gets the service modules
// (nav sections) that fit how that business actually works.
export const ORG_TYPES = [
  {
    key: "hotel",
    label: "Hotel / Guest House",
    icon: "🏨",
    tagline: "Rooms, bookings, guest folios and billing.",
    modules: ["dashboard", "hotels", "customers", "debts", "expenses", "messages", "reports", "staff", "activity", "settings"],
  },
  {
    key: "restaurant",
    label: "Restaurant / Eatery",
    icon: "🍽️",
    tagline: "Fast sales, menu items and customer debts.",
    modules: ["dashboard", "sales", "products", "customers", "debts", "expenses", "messages", "reports", "staff", "activity", "settings"],
  },
  {
    key: "retail",
    label: "Provision Store / Retail Shop",
    icon: "🏪",
    tagline: "Sales, stock, suppliers and debts.",
    modules: ["dashboard", "sales", "products", "suppliers", "import", "customers", "debts", "expenses", "messages", "reports", "staff", "activity", "settings"],
  },
  {
    key: "pharmacy",
    label: "Pharmacy / Chemist",
    icon: "💊",
    tagline: "Stock control, sales and customer records.",
    modules: ["dashboard", "sales", "products", "suppliers", "import", "customers", "debts", "expenses", "messages", "reports", "staff", "activity", "settings"],
  },
  {
    key: "supermarket",
    label: "Supermarket / Mini-mart",
    icon: "🛒",
    tagline: "High-volume sales with full stock tracking.",
    modules: ["dashboard", "sales", "products", "suppliers", "import", "customers", "debts", "expenses", "messages", "reports", "staff", "activity", "settings"],
  },
  {
    key: "electronics",
    label: "Phones / Electronics",
    icon: "📱",
    tagline: "Unit sales, stock and supplier tracking.",
    modules: ["dashboard", "sales", "products", "suppliers", "import", "customers", "debts", "expenses", "messages", "reports", "staff", "activity", "settings"],
  },
  {
    key: "fashion",
    label: "Fashion / Tailoring",
    icon: "👗",
    tagline: "Products, custom jobs and client debts.",
    modules: ["dashboard", "sales", "products", "services", "customers", "debts", "expenses", "messages", "reports", "staff", "activity", "settings"],
  },
  {
    key: "salon",
    label: "Salon / Barbershop / Spa",
    icon: "💈",
    tagline: "Services, walk-in sales and client records.",
    modules: ["dashboard", "sales", "services", "products", "customers", "debts", "expenses", "messages", "reports", "staff", "activity", "settings"],
  },
  {
    key: "artisan",
    label: "Artisan / Repairs / Services",
    icon: "🛠️",
    tagline: "Jobs, service charges and client debts.",
    modules: ["dashboard", "sales", "services", "customers", "suppliers", "debts", "expenses", "messages", "reports", "staff", "activity", "settings"],
  },
  {
    key: "other",
    label: "Other Business",
    icon: "🏢",
    tagline: "The full KopaBook toolkit, everything on.",
    modules: ["dashboard", "sales", "services", "products", "suppliers", "import", "customers", "hotels", "debts", "expenses", "messages", "reports", "staff", "activity", "settings"],
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
  { label: "Insights", modules: ["messages", "reports", "activity"] },
  { label: "Setup", modules: ["staff", "settings"] },
];

// Staff roles offered per organization type. Partners are co-owners everywhere.
export const STAFF_ROLES = {
  hotel: [
    { key: "partner", label: "Partner", desc: "Co-owner with full access. Cannot remove the owner." },
    { key: "hotel_manager", label: "Hotel manager", desc: "Runs rooms, rates, bookings, folios and payments." },
    { key: "receptionist", label: "Receptionist", desc: "Reservations, check-in/out, charges and payments." },
    { key: "housekeeper", label: "Housekeeper", desc: "Room board and room status updates." },
  ],
  default: [
    { key: "partner", label: "Partner", desc: "Co-owner with full access. Cannot remove the owner." },
    { key: "manager", label: "Manager", desc: "Manages products, stock, customers, debts and expenses." },
    { key: "attendant", label: "Attendant", desc: "Records sales and works their area." },
  ],
};

export function staffRolesFor(businessType) {
  return STAFF_ROLES[businessType] || STAFF_ROLES.default;
}

// Worldwide support: currencies, timezones and countries offered at signup
// and in Settings. Africa/Lagos is the default for Nigerian businesses.
export const WORLD_CURRENCIES = [
  ["NGN", "Nigerian Naira"], ["GHS", "Ghanaian Cedi"], ["KES", "Kenyan Shilling"],
  ["ZAR", "South African Rand"], ["UGX", "Ugandan Shilling"], ["TZS", "Tanzanian Shilling"],
  ["RWF", "Rwandan Franc"], ["XOF", "West African CFA Franc"], ["XAF", "Central African CFA Franc"],
  ["EGP", "Egyptian Pound"], ["MAD", "Moroccan Dirham"], ["USD", "US Dollar"], ["EUR", "Euro"],
  ["GBP", "British Pound"], ["CAD", "Canadian Dollar"], ["AUD", "Australian Dollar"],
  ["INR", "Indian Rupee"], ["PKR", "Pakistani Rupee"], ["BDT", "Bangladeshi Taka"],
  ["PHP", "Philippine Peso"], ["AED", "UAE Dirham"], ["SAR", "Saudi Riyal"], ["QAR", "Qatari Riyal"],
  ["CNY", "Chinese Yuan"], ["JPY", "Japanese Yen"],
];

export const WORLD_TIMEZONES = [
  "Africa/Lagos", "Africa/Accra", "Africa/Nairobi", "Africa/Johannesburg", "Africa/Cairo",
  "Europe/London", "Europe/Paris", "America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "America/Toronto", "America/Sao_Paulo", "Asia/Dubai", "Asia/Riyadh",
  "Asia/Kolkata", "Asia/Dhaka", "Asia/Singapore", "Asia/Manila", "Asia/Jakarta",
  "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland", "UTC",
];

export const COUNTRIES = [
  "Nigeria", "Ghana", "Kenya", "South Africa", "Uganda", "Tanzania", "Rwanda",
  "Cameroon", "Egypt", "United Kingdom", "United States", "Canada", "Ireland",
  "UAE", "Saudi Arabia", "Qatar", "India", "Pakistan", "Bangladesh", "Philippines",
  "Indonesia", "Malaysia", "Singapore", "Australia", "Germany", "France", "Netherlands",
  "Brazil", "Other",
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
