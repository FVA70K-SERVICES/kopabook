// FVA Bot Business Memory - per-site knowledge base for orders, bookings, and planning
// Each business website gets its own memory: products, services, hours, prices, FAQs

export const DEFAULT_MEMORY = {
  businessName: 'FVA70K Services',
  botName: 'FVA Bot',
  currency: 'NGN',
  // Business hours
  hours: {
    monday: '9:00 AM - 6:00 PM',
    tuesday: '9:00 AM - 6:00 PM',
    wednesday: '9:00 AM - 6:00 PM',
    thursday: '9:00 AM - 6:00 PM',
    friday: '9:00 AM - 6:00 PM',
    saturday: '10:00 AM - 4:00 PM',
    sunday: 'Closed'
  },
  // Products for ordering (empty = ordering disabled)
  products: [],
  // Services for booking (empty = booking disabled)
  services: [],
  // Custom FAQs
  faqs: [],
  // Order settings
  ordering: {
    enabled: false,
    deliveryFee: 0,
    freeDeliveryAbove: 0,
    orderVia: 'whatsapp', // whatsapp | chat
    whatsappNumber: ''
  },
  // Booking settings
  booking: {
    enabled: false,
    slotDuration: 30, // minutes
    advanceDays: 14,
    bufferMinutes: 0
  }
};

// Example: restaurant memory
export const EXAMPLE_RESTAURANT = {
  businessName: 'Mama Put Kitchen',
  botName: 'Kitchen Bot',
  currency: 'NGN',
  hours: {
    monday: '8:00 AM - 10:00 PM',
    tuesday: '8:00 AM - 10:00 PM',
    wednesday: '8:00 AM - 10:00 PM',
    thursday: '8:00 AM - 10:00 PM',
    friday: '8:00 AM - 11:00 PM',
    saturday: '8:00 AM - 11:00 PM',
    sunday: '12:00 PM - 10:00 PM'
  },
  products: [
    { id: 'jollof', name: 'Jollof Rice + Chicken', price: 2500, category: 'Main', description: 'Party-style jollof with grilled chicken' },
    { id: 'fried', name: 'Fried Rice + Turkey', price: 3000, category: 'Main', description: 'Chinese-style fried rice with turkey' },
    { id: 'egusi', name: 'Egusi Soup + Pounded Yam', price: 3500, category: 'Soup', description: 'Rich egusi with assorted meat' },
    { id: 'pepper', name: 'Pepper Soup (Goat Meat)', price: 2000, category: 'Soup', description: 'Spicy goat meat pepper soup' },
    { id: 'zobo', name: 'Zobo Drink', price: 500, category: 'Drinks', description: 'Chilled hibiscus drink' },
  ],
  services: [],
  faqs: [
    { q: 'Do you deliver?', a: 'Yes! We deliver within the city. Delivery is free for orders above NGN 5,000.' },
    { q: 'What are your hours?', a: 'We are open Monday-Saturday 8AM-10PM (11PM on weekends) and Sunday 12PM-10PM.' },
  ],
  ordering: { enabled: true, deliveryFee: 1000, freeDeliveryAbove: 5000, orderVia: 'whatsapp', whatsappNumber: '2348012345678' },
  booking: { enabled: false }
};

// Example: salon memory
export const EXAMPLE_SALON = {
  businessName: 'Glamour Salon',
  botName: 'Glam Bot',
  currency: 'NGN',
  hours: {
    monday: '9:00 AM - 7:00 PM',
    tuesday: '9:00 AM - 7:00 PM',
    wednesday: '9:00 AM - 7:00 PM',
    thursday: '9:00 AM - 7:00 PM',
    friday: '9:00 AM - 8:00 PM',
    saturday: '8:00 AM - 8:00 PM',
    sunday: 'Closed'
  },
  products: [],
  services: [
    { id: 'braids', name: 'Box Braids', price: 15000, duration: 180, description: 'Full head box braids, any length' },
    { id: 'wig', name: 'Wig Installation', price: 8000, duration: 60, description: 'Frontal wig install with styling' },
    { id: 'pedicure', name: 'Pedicure + Manicure', price: 7000, duration: 90, description: 'Full nail care treatment' },
    { id: 'makeup', name: 'Bridal Makeup', price: 25000, duration: 120, description: 'Full bridal glam with lashes' },
  ],
  faqs: [
    { q: 'Do I need an appointment?', a: 'Walk-ins are welcome but appointments get priority. I can book one for you right now!' },
  ],
  ordering: { enabled: false },
  booking: { enabled: true, slotDuration: 30, advanceDays: 14 }
};

export function formatPrice(amount, currency = 'NGN') {
  return `${currency} ${Number(amount).toLocaleString()}`;
}

export function getBusinessHours(memory) {
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  return days.map((d, i) => `${labels[i]}: ${memory.hours[d] || 'Closed'}`).join('\n');
}

export function findProduct(memory, query) {
  const q = query.toLowerCase();
  return memory.products.filter(p =>
    p.name.toLowerCase().includes(q) ||
    (p.category && p.category.toLowerCase().includes(q)) ||
    (p.description && p.description.toLowerCase().includes(q))
  );
}

export function findService(memory, query) {
  const q = query.toLowerCase();
  return memory.services.filter(s =>
    s.name.toLowerCase().includes(q) ||
    (s.description && s.description.toLowerCase().includes(q))
  );
}

export function findFaq(memory, query) {
  const q = query.toLowerCase();
  return memory.faqs.find(f =>
    f.q.toLowerCase().includes(q) || q.includes(f.q.toLowerCase().split(' ').slice(0, 3).join(' '))
  );
}
