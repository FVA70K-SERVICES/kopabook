// FVA Bot booking flow - appointment scheduling through chat
import { formatPrice, findService } from './business-memory.js';
import { canUseFeature } from './plans.js';

const bookingSessions = new Map();

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function handleBookingMessage(message, memory, sessionId, planId = 'free') {
  const lower = message.toLowerCase().trim();

  if (!memory.booking?.enabled) return null;
  if (!canUseFeature(planId, 'booking')) {
    return {
      answer: 'Online booking is available on FVAChat Growth and above. You can also call the business directly to book!',
      quickReplies: ['Talk to human'],
      isBookingFlow: false
    };
  }

  let booking = bookingSessions.get(sessionId) || { state: 'idle' };

  // Start booking
  if (/\b(book|appointment|schedule|reserve)\b/.test(lower) && booking.state === 'idle') {
    return showServices(memory, booking, sessionId);
  }

  // Service selection
  if (booking.state === 'selecting_service') {
    const matches = findService(memory, lower);
    if (matches.length === 1) {
      booking.service = matches[0];
      booking.state = 'selecting_date';
      bookingSessions.set(sessionId, booking);
      return showDates(memory, booking);
    }
    if (matches.length > 1) {
      let answer = 'Which service?\n';
      matches.forEach((s, i) => { answer += `${i+1}. ${s.name} - ${formatPrice(s.price, memory.currency)} (${s.duration}min)\n`; });
      return { answer, quickReplies: matches.slice(0,3).map(s => s.name), isBookingFlow: true };
    }
    // Try number selection
    const num = parseInt(lower);
    if (num && memory.services[num-1]) {
      booking.service = memory.services[num-1];
      booking.state = 'selecting_date';
      bookingSessions.set(sessionId, booking);
      return showDates(memory, booking);
    }
    return { answer: 'Please pick a service from the list, or type the number.', quickReplies: memory.services.slice(0,3).map(s => s.name), isBookingFlow: true };
  }

  // Date selection
  if (booking.state === 'selecting_date') {
    const dateMatch = parseDateInput(lower);
    if (dateMatch) {
      booking.date = dateMatch;
      booking.state = 'selecting_time';
      bookingSessions.set(sessionId, booking);
      return showTimes(memory, booking);
    }
    return { answer: 'Please pick a date (e.g. "tomorrow", "Friday", or "25").', quickReplies: ['Tomorrow', 'Saturday'], isBookingFlow: true };
  }

  // Time selection
  if (booking.state === 'selecting_time') {
    const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]);
      const min = parseInt(timeMatch[2] || '0');
      const ampm = timeMatch[3];
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      booking.time = `${hour.toString().padStart(2,'0')}:${min.toString().padStart(2,'0')}`;
      booking.state = 'confirming';
      bookingSessions.set(sessionId, booking);
      return confirmBooking(memory, booking);
    }
    return { answer: 'What time? (e.g. "2pm" or "14:30")', isBookingFlow: true };
  }

  // Confirmation
  if (booking.state === 'confirming') {
    if (/\b(yes|confirm|correct|ok)\b/.test(lower)) {
      const confirmed = finalizeBooking(memory, booking, sessionId);
      bookingSessions.delete(sessionId);
      return confirmed;
    }
    if (/\b(no|cancel|change)\b/.test(lower)) {
      bookingSessions.delete(sessionId);
      return { answer: 'Booking cancelled. Type "book" to start over.', quickReplies: ['Book appointment'], isBookingFlow: true };
    }
    return { answer: 'Please confirm: is this correct? (yes/no)', isBookingFlow: true };
  }

  // Cancel
  if (/\b(cancel booking|stop)\b/.test(lower)) {
    bookingSessions.delete(sessionId);
    return { answer: 'Booking cancelled.', isBookingFlow: true };
  }

  return null;
}

function showServices(memory, booking, sessionId) {
  if (!memory.services.length) {
    return { answer: 'No bookable services right now.', isBookingFlow: true };
  }
  booking.state = 'selecting_service';
  bookingSessions.set(sessionId, booking);

  let answer = 'What would you like to book?\n\n';
  memory.services.forEach((s, i) => {
    answer += `${i+1}. ${s.name} - ${formatPrice(s.price, memory.currency)} (${s.duration} min)\n`;
    if (s.description) answer += `   ${s.description}\n`;
  });
  answer += '\nReply with the number or name.';

  return { answer, quickReplies: memory.services.slice(0,3).map(s => s.name), isBookingFlow: true };
}

function showDates(memory, booking) {
  const dates = getAvailableDates(memory.booking.advanceDays || 14);
  let answer = `Great choice: ${booking.service.name} (${formatPrice(booking.service.price, memory.currency)})\n\nPick a date:\n`;
  dates.slice(0, 7).forEach((d, i) => {
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
    answer += `• ${label}\n`;
  });
  return { answer, quickReplies: ['Today', 'Tomorrow', DAYS[(new Date().getDay()+2)%7]], isBookingFlow: true };
}

function showTimes(memory, booking) {
  // Generate slots based on business hours (simplified: 9am-5pm)
  const slots = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'];
  const dateStr = formatDate(booking.date);
  let answer = `Available times for ${dateStr}:\n\n`;
  slots.forEach(s => { answer += `• ${s}\n`; });
  answer += '\nWhat time works for you?';
  return { answer, quickReplies: slots.slice(0, 4), isBookingFlow: true };
}

function confirmBooking(memory, booking) {
  const dateStr = formatDate(booking.date);
  return {
    answer: `Please confirm your booking:\n\n📋 ${booking.service.name}\n📅 ${dateStr}\n🕐 ${booking.time}\n💰 ${formatPrice(booking.service.price, memory.currency)}\n\nIs this correct? (yes/no)`,
    quickReplies: ['Yes, confirm', 'No, cancel'],
    isBookingFlow: true
  };
}

function finalizeBooking(memory, booking, sessionId) {
  const dateStr = formatDate(booking.date);
  const ref = 'BK' + Date.now().toString(36).toUpperCase().slice(-6);
  return {
    answer: `✅ Booking confirmed!\n\n📋 ${booking.service.name}\n📅 ${dateStr}\n🕐 ${booking.time}\n💰 ${formatPrice(booking.service.price, memory.currency)}\n🔖 Reference: ${ref}\n\nThe business will contact you to confirm. See you then!`,
    quickReplies: [],
    isBookingFlow: true,
    bookingConfirmed: true,
    bookingRef: ref
  };
}

function getAvailableDates(days) {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    if (d.getDay() !== 0) dates.push(d); // Skip Sundays (customize per business)
  }
  return dates;
}

function formatDate(d) {
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function parseDateInput(lower) {
  const today = new Date();
  if (lower.includes('today')) return today;
  if (lower.includes('tomorrow')) {
    const d = new Date(today); d.setDate(d.getDate() + 1); return d;
  }
  for (let i = 0; i < 7; i++) {
    if (lower.includes(DAYS[i].toLowerCase())) {
      const d = new Date(today);
      const diff = (i - today.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return d;
    }
  }
  const numMatch = lower.match(/\b(\d{1,2})\b/);
  if (numMatch) {
    const day = parseInt(numMatch[1]);
    if (day >= 1 && day <= 31) {
      const d = new Date(today.getFullYear(), today.getMonth(), day);
      if (d < today) d.setMonth(d.getMonth() + 1);
      return d;
    }
  }
  return null;
}
