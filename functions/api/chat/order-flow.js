// FVA Bot order-taking flow
import { formatPrice, findProduct } from './business-memory.js';
import { canUseFeature } from './plans.js';

// Order states per session (in-memory; use D1/KV in production)
const orderSessions = new Map();

export function handleOrderMessage(message, memory, sessionId, planId = 'free') {
  const lower = message.toLowerCase().trim();

  // Check if ordering is enabled and allowed by plan
  if (!memory.ordering?.enabled) {
    return null; // Not an ordering business
  }
  if (!canUseFeature(planId, 'ordering')) {
    return {
      answer: `Order taking is available on FVAChat Starter and above. Ask the business owner about upgrading! Meanwhile, you can order via WhatsApp.`,
      quickReplies: ['Talk to human'],
      isOrderFlow: false
    };
  }

  let order = orderSessions.get(sessionId) || { items: [], state: 'browsing' };

  // Commands
  if (/^(menu|show menu|what.*sell|products)/.test(lower)) {
    return showMenu(memory, order, sessionId);
  }
  if (/^(cart|my order|checkout|view cart)/.test(lower)) {
    return showCart(memory, order, sessionId);
  }
  if (/^(clear|cancel order|start over)/.test(lower)) {
    orderSessions.delete(sessionId);
    return { answer: 'Order cleared. What would you like to order?', quickReplies: ['Show menu'], isOrderFlow: true };
  }
  if (/^checkout|place order|confirm order/.test(lower) && order.items.length > 0) {
    return checkoutOrder(memory, order, sessionId);
  }
  if (/^add (.+)/.test(lower)) {
    const query = lower.replace(/^add /, '');
    return addToCart(memory, order, sessionId, query);
  }
  if (/^remove (.+)/.test(lower)) {
    const query = lower.replace(/^remove /, '');
    return removeFromCart(memory, order, sessionId, query);
  }

  // Try to match a product name directly
  const matches = findProduct(memory, lower);
  if (matches.length === 1) {
    return addToCart(memory, order, sessionId, matches[0].name);
  }
  if (matches.length > 1) {
    let answer = 'I found a few options:\n';
    matches.slice(0, 5).forEach((p, i) => {
      answer += `${i + 1}. ${p.name} - ${formatPrice(p.price, memory.currency)}\n`;
    });
    answer += '\nType "add [name]" to add one to your order.';
    return { answer, quickReplies: matches.slice(0, 3).map(p => 'Add ' + p.name), isOrderFlow: true };
  }

  // Check for order intent
  if (/\b(order|buy|want|get me|i'll have)\b/.test(lower)) {
    return showMenu(memory, order, sessionId, 'Here\'s what we have! Type "add [item name]" to add to your order:');
  }

  return null; // Not an order message, let normal bot handle it
}

function showMenu(memory, order, sessionId, intro) {
  if (!memory.products.length) {
    return { answer: 'No products available right now.', quickReplies: [], isOrderFlow: true };
  }
  const categories = {};
  memory.products.forEach(p => {
    const cat = p.category || 'Menu';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(p);
  });

  let answer = (intro || 'Here\'s our menu:') + '\n\n';
  for (const [cat, items] of Object.entries(categories)) {
    answer += `--- ${cat} ---\n`;
    items.forEach(p => {
      answer += `• ${p.name} - ${formatPrice(p.price, memory.currency)}\n`;
      if (p.description) answer += `  ${p.description}\n`;
    });
    answer += '\n';
  }
  answer += 'Type "add [item name]" to add to your order, or "cart" to view your order.';

  const quickReplies = memory.products.slice(0, 3).map(p => 'Add ' + p.name);
  quickReplies.push('View cart');

  orderSessions.set(sessionId, order);
  return { answer: answer.trim(), quickReplies, isOrderFlow: true };
}

function addToCart(memory, order, sessionId, query) {
  const matches = findProduct(memory, query);
  if (!matches.length) {
    return { answer: `I couldn't find "${query}". Type "menu" to see what's available.`, quickReplies: ['Show menu'], isOrderFlow: true };
  }
  const product = matches[0];
  const existing = order.items.find(i => i.id === product.id);
  if (existing) {
    existing.qty += 1;
  } else {
    order.items.push({ ...product, qty: 1 });
  }
  orderSessions.set(sessionId, order);

  const total = order.items.reduce((s, i) => s + (i.price * i.qty), 0);
  return {
    answer: `Added ${product.name} (${formatPrice(product.price, memory.currency)}) to your order! 🛒\n\nCart total: ${formatPrice(total, memory.currency)}\n\nType "add [item]" for more, "cart" to review, or "checkout" to place your order.`,
    quickReplies: ['Add more', 'View cart', 'Checkout'],
    isOrderFlow: true
  };
}

function removeFromCart(memory, order, sessionId, query) {
  const idx = order.items.findIndex(i => i.name.toLowerCase().includes(query.toLowerCase()));
  if (idx === -1) {
    return { answer: 'That item isn\'t in your cart.', quickReplies: ['View cart'], isOrderFlow: true };
  }
  order.items.splice(idx, 1);
  orderSessions.set(sessionId, order);
  return showCart(memory, order, sessionId);
}

function showCart(memory, order, sessionId) {
  if (!order.items.length) {
    return { answer: 'Your cart is empty. Type "menu" to see what\'s available!', quickReplies: ['Show menu'], isOrderFlow: true };
  }
  let answer = '🛒 Your order:\n\n';
  let subtotal = 0;
  order.items.forEach((item, i) => {
    const lineTotal = item.price * item.qty;
    subtotal += lineTotal;
    answer += `${i + 1}. ${item.name} x${item.qty} - ${formatPrice(lineTotal, memory.currency)}\n`;
  });

  const deliveryFee = subtotal >= (memory.ordering.freeDeliveryAbove || 0) && memory.ordering.freeDeliveryAbove > 0
    ? 0 : (memory.ordering.deliveryFee || 0);
  const total = subtotal + deliveryFee;

  answer += `\nSubtotal: ${formatPrice(subtotal, memory.currency)}`;
  if (deliveryFee > 0) answer += `\nDelivery: ${formatPrice(deliveryFee, memory.currency)}`;
  else if (memory.ordering.freeDeliveryAbove > 0) answer += `\nDelivery: FREE! 🎉`;
  answer += `\nTotal: ${formatPrice(total, memory.currency)}`;
  answer += '\n\nType "checkout" to place your order, or "add [item]" for more.';

  return { answer, quickReplies: ['Checkout', 'Add more', 'Clear order'], isOrderFlow: true, cart: order.items, total };
}

function checkoutOrder(memory, order, sessionId) {
  const subtotal = order.items.reduce((s, i) => s + (i.price * i.qty), 0);
  const deliveryFee = subtotal >= (memory.ordering.freeDeliveryAbove || 0) && memory.ordering.freeDeliveryAbove > 0
    ? 0 : (memory.ordering.deliveryFee || 0);
  const total = subtotal + deliveryFee;

  let orderText = `NEW ORDER from website chat:\n\n`;
  order.items.forEach((item, i) => {
    orderText += `${i + 1}. ${item.name} x${item.qty} - ${formatPrice(item.price * item.qty, memory.currency)}\n`;
  });
  orderText += `\nTotal: ${formatPrice(total, memory.currency)}`;

  // Clear cart after checkout
  orderSessions.delete(sessionId);

  const waNumber = memory.ordering.whatsappNumber;
  if (waNumber && memory.ordering.orderVia === 'whatsapp') {
    const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent(orderText)}`;
    return {
      answer: `Your order total is ${formatPrice(total, memory.currency)}! 🎉\n\nTap the button below to send your order via WhatsApp for confirmation and delivery details.`,
      quickReplies: [],
      isOrderFlow: true,
      action: { type: 'whatsapp', url: waLink, label: 'Send Order via WhatsApp' }
    };
  }

  return {
    answer: `Order placed! Total: ${formatPrice(total, memory.currency)}\n\nThe business will contact you shortly to confirm. Thank you! 🙏`,
    quickReplies: [],
    isOrderFlow: true,
    orderPlaced: true
  };
}

export function getCartSummary(sessionId) {
  return orderSessions.get(sessionId) || { items: [], state: 'browsing' };
}
