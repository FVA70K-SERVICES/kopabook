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
    { key: "accountant", label: "Accountant", desc: "Expenses, reports and profit. No sales or stock changes." },
    { key: "cashier", label: "Cashier", desc: "Records sales and takes payments. Discounts within their limit." },
    { key: "storekeeper", label: "Storekeeper", desc: "Products and stock control. No sales or expenses." },
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
  ["EGP", "Egyptian Pound"], ["MAD", "Moroccan Dirham"], ["DZD", "Algerian Dinar"],
  ["TND", "Tunisian Dinar"], ["ETB", "Ethiopian Birr"], ["ZWL", "Zimbabwean Dollar"],
  ["BWP", "Botswana Pula"], ["NAD", "Namibian Dollar"], ["MZN", "Mozambican Metical"],
  ["ZMW", "Zambian Kwacha"], ["MWK", "Malawian Kwacha"], ["AOA", "Angolan Kwanza"],
  ["CDF", "Congolese Franc"], ["SDG", "Sudanese Pound"], ["LYD", "Libyan Dinar"],
  ["USD", "US Dollar"], ["EUR", "Euro"], ["GBP", "British Pound"], ["CAD", "Canadian Dollar"],
  ["AUD", "Australian Dollar"], ["NZD", "New Zealand Dollar"], ["CHF", "Swiss Franc"],
  ["SEK", "Swedish Krona"], ["NOK", "Norwegian Krone"], ["DKK", "Danish Krone"],
  ["PLN", "Polish Zloty"], ["CZK", "Czech Koruna"], ["HUF", "Hungarian Forint"],
  ["RON", "Romanian Leu"], ["BGN", "Bulgarian Lev"], ["HRK", "Croatian Kuna"],
  ["INR", "Indian Rupee"], ["PKR", "Pakistani Rupee"], ["BDT", "Bangladeshi Taka"],
  ["LKR", "Sri Lankan Rupee"], ["NPR", "Nepalese Rupee"], ["PHP", "Philippine Peso"],
  ["IDR", "Indonesian Rupiah"], ["MYR", "Malaysian Ringgit"], ["SGD", "Singapore Dollar"],
  ["THB", "Thai Baht"], ["VND", "Vietnamese Dong"], ["KRW", "South Korean Won"],
  ["CNY", "Chinese Yuan"], ["JPY", "Japanese Yen"], ["TWD", "Taiwan Dollar"],
  ["HKD", "Hong Kong Dollar"], ["AED", "UAE Dirham"], ["SAR", "Saudi Riyal"],
  ["QAR", "Qatari Riyal"], ["KWD", "Kuwaiti Dinar"], ["BHD", "Bahraini Dinar"],
  ["OMR", "Omani Rial"], ["JOD", "Jordanian Dinar"], ["ILS", "Israeli Shekel"],
  ["TRY", "Turkish Lira"], ["IRR", "Iranian Rial"], ["IQD", "Iraqi Dinar"],
  ["BRL", "Brazilian Real"], ["MXN", "Mexican Peso"], ["ARS", "Argentine Peso"],
  ["CLP", "Chilean Peso"], ["COP", "Colombian Peso"], ["PEN", "Peruvian Sol"],
  ["XCD", "East Caribbean Dollar"], ["JMD", "Jamaican Dollar"], ["TTD", "Trinidad Dollar"],
];

export const WORLD_TIMEZONES = [
  "Africa/Lagos", "Africa/Accra", "Africa/Abidjan", "Africa/Dakar", "Africa/Bamako",
  "Africa/Conakry", "Africa/Freetown", "Africa/Monrovia", "Africa/Banjul", "Africa/Bissau",
  "Africa/Nouakchott", "Africa/Casablanca", "Africa/Algiers", "Africa/Tunis", "Africa/Tripoli",
  "Africa/Cairo", "Africa/Khartoum", "Africa/Nairobi", "Africa/Kampala", "Africa/Dar_es_Salaam",
  "Africa/Kigali", "Africa/Bujumbura", "Africa/Addis_Ababa", "Africa/Mogadishu", "Africa/Djibouti",
  "Africa/Johannesburg", "Africa/Windhoek", "Africa/Gaborone", "Africa/Lusaka", "Africa/Harare",
  "Africa/Maputo", "Africa/Blantyre", "Africa/Luanda", "Africa/Kinshasa", "Africa/Lubumbashi",
  "Africa/Brazzaville", "Africa/Douala", "Africa/Yaounde", "Africa/Ndjamena", "Africa/Bangui",
  "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin",
  "Europe/Amsterdam", "Europe/Brussels", "Europe/Madrid", "Europe/Rome", "Europe/Zurich",
  "Europe/Stockholm", "Europe/Oslo", "Europe/Copenhagen", "Europe/Helsinki", "Europe/Warsaw",
  "Europe/Prague", "Europe/Budapest", "Europe/Bucharest", "Europe/Sofia", "Europe/Athens",
  "Europe/Istanbul", "Europe/Moscow", "Europe/Kiev",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Anchorage", "Pacific/Honolulu", "America/Toronto", "America/Vancouver",
  "America/Mexico_City", "America/Jamaica", "America/Havana", "America/Bogota",
  "America/Lima", "America/Santiago", "America/Buenos_Aires", "America/Sao_Paulo",
  "America/Caracas", "America/Port_of_Spain", "America/Barbados",
  "Asia/Dubai", "Asia/Riyadh", "Asia/Qatar", "Asia/Kuwait", "Asia/Bahrain",
  "Asia/Muscat", "Asia/Amman", "Asia/Jerusalem", "Asia/Beirut", "Asia/Damascus",
  "Asia/Baghdad", "Asia/Tehran", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka",
  "Asia/Colombo", "Asia/Kathmandu", "Asia/Bangkok", "Asia/Jakarta", "Asia/Singapore",
  "Asia/Kuala_Lumpur", "Asia/Manila", "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Taipei",
  "Asia/Seoul", "Asia/Tokyo",
  "Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane", "Australia/Perth",
  "Pacific/Auckland", "Pacific/Fiji", "Pacific/Port_Moresby",
  "UTC",
];

export const COUNTRIES = [
  "Nigeria", "Ghana", "Kenya", "South Africa", "Uganda", "Tanzania", "Rwanda",
  "Ethiopia", "Egypt", "Morocco", "Algeria", "Tunisia", "Senegal", "Ivory Coast",
  "Cameroon", "DR Congo", "Angola", "Mozambique", "Zambia", "Zimbabwe", "Botswana",
  "Namibia", "Malawi", "Mali", "Burkina Faso", "Niger", "Chad", "Sudan", "Somalia",
  "Sierra Leone", "Liberia", "Guinea", "Benin", "Togo", "Gambia", "Mauritania",
  "United Kingdom", "Ireland", "Germany", "France", "Netherlands", "Belgium",
  "Spain", "Portugal", "Italy", "Switzerland", "Sweden", "Norway", "Denmark",
  "Finland", "Poland", "Austria", "Greece", "Turkey", "Ukraine", "Russia",
  "United States", "Canada", "Mexico", "Brazil", "Argentina", "Chile", "Colombia",
  "Peru", "Venezuela", "Jamaica", "Trinidad and Tobago", "Barbados",
  "UAE", "Saudi Arabia", "Qatar", "Kuwait", "Oman", "Bahrain", "Jordan",
  "Lebanon", "Israel", "Iraq", "Iran",
  "India", "Pakistan", "Bangladesh", "Sri Lanka", "Nepal",
  "China", "Japan", "South Korea", "Taiwan", "Hong Kong", "Singapore",
  "Malaysia", "Indonesia", "Philippines", "Thailand", "Vietnam",
  "Australia", "New Zealand", "Fiji", "Papua New Guinea",
  "Other",
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
  "/app/activity": "activity",
  "/app/settings": "settings",
};

// Modules each staff role may see. Owners and partners see everything.
// Everyone else sees only their role's workspace.
export const ROLE_MODULES = {
  owner: null,
  partner: null,
  // Everyone keeps the staff page for their own shift clock; management
  // sections inside it are owner/partner only.
  manager: ["dashboard", "sales", "services", "products", "suppliers", "import", "expenses", "customers", "hotels", "debts", "messages", "reports", "staff"],
  accountant: ["dashboard", "expenses", "reports", "customers", "messages", "staff"],
  cashier: ["dashboard", "sales", "services", "products", "customers", "debts", "messages", "staff"],
  storekeeper: ["dashboard", "products", "suppliers", "import", "messages", "staff"],
  attendant: ["dashboard", "sales", "services", "products", "customers", "debts", "messages", "staff"],
  hotel_manager: ["dashboard", "hotels", "customers", "debts", "expenses", "messages", "reports", "staff"],
  receptionist: ["dashboard", "hotels", "customers", "messages", "staff"],
  housekeeper: ["dashboard", "hotels", "staff"],
};

export function modulesForRole(role) {
  if (!(role in ROLE_MODULES)) return ROLE_MODULES.attendant;
  return ROLE_MODULES[role]; // null = all modules
}
