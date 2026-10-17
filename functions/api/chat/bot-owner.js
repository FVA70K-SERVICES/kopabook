// Kopa Bot Owner Mode - understands owner/staff commands and runs business tasks
import {
  getBusinessContext, getTodaySales, getTodayExpenses, getLowStock,
  getOwed, getWeekSales, findProduct,
  getTargets, setTarget, getTargetProgress, formatNaira, formatNGN,
  findCustomer, getDebtors, recordSale,
  saveMemory, listMemories, forgetMemory,
  savePendingAction, getPendingAction, clearPendingAction
} from './bot-tools.js';
import { handleReminderCommand, checkDueReminders } from './bot-reminders.js';

// Tier capabilities for bot tools
export const BOT_TIER_LIMITS = {
  free: {
    briefing: false, stockAlerts: false, recordSale: false,
    recordExpense: false, targets: false, tasks: false,
    note: 'Upgrade to Starter to unlock business insights.'
  },
  starter: {
    briefing: true, stockAlerts: true, recordSale: false,
    recordExpense: false, targets: false, tasks: false,
    note: 'Starter: briefings and stock alerts. Upgrade to Solo for your AI worker.'
  },
  solo: {
    briefing: true, stockAlerts: true, recordSale: true,
    recordExpense: true, targets: true, tasks: true,
    agentWorkers: true,
    note: null
  },
  pro: {
    briefing: true, stockAlerts: true, recordSale: true,
    recordExpense: true, targets: true, tasks: true,
    agentWorkers: true, multiBusiness: true,
    note: null
  },
  internal: {
    briefing: true, stockAlerts: true, recordSale: true,
    recordExpense: true, targets: true, tasks: true,
    agentWorkers: true, multiBusiness: true,
    note: null
  }
};

// Staff role limits (within owner mode)
const STAFF_LIMITS = {
  owner: ['briefing', 'stock', 'sale', 'expense', 'target', 'task', 'price', 'customers', 'memory'],
  admin: ['briefing', 'stock', 'sale', 'expense', 'target', 'price', 'customers', 'memory'],
  staff: ['briefing', 'stock', 'price', 'customers'],
  viewer: ['briefing']
};

function canDo(role, action) {
  const allowed = STAFF_LIMITS[role] || STAFF_LIMITS.viewer;
  return allowed.includes(action);
}

// Plain-words description of what each role can ask the bot to do
const ROLE_ABILITIES = {
  owner: 'briefings, stock checks, price lookups, customer lookups, sales, expenses, targets, reminders and memories',
  admin: 'briefings, stock checks, price lookups, customer lookups, sales, expenses, targets and reminders',
  staff: 'price checks ("how much is X"), stock levels, customer and debtor lookups, and the daily briefing',
  viewer: 'the daily briefing'
};

const ACTION_LABELS = {
  briefing: 'briefings',
  stock: 'stock checks',
  sale: 'recording sales',
  expense: 'recording expenses',
  target: 'setting targets',
  task: 'reminders and tasks',
  memory: 'saving memories',
  customers: 'customer lookups',
  price: 'price checks'
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function firstName(userName) {
  if (!userName || userName === 'Visitor') return null;
  return String(userName).split(' ')[0];
}

// Warm, personal limit response: names the person, states the boundary,
// reminds them of their team role, and lists exactly what they CAN do.
function roleBlocked(action, role, userName) {
  const nm = firstName(userName);
  const nameBit = nm ? `, ${nm}` : '';
  const roleWord = role === 'staff' ? 'staff' : role === 'viewer' ? 'a viewer' : `an ${role}`;
  const canDoList = ROLE_ABILITIES[role] || ROLE_ABILITIES.viewer;
  return {
    answer: `That one is for owners and admins${nameBit}. As ${roleWord}, I can help you with ${canDoList}. What do you need?`,
    quickReplies: ['Brief me', 'Check stock']
  };
}

export async function handleOwnerCommand(message, ctx) {
  const { db, businessId, userId, userName, userRole, tier } = ctx;
  const lower = message.toLowerCase().trim();
  const limits = BOT_TIER_LIMITS[tier] || BOT_TIER_LIMITS.free;
  const role = userRole || 'owner';
  const nm = firstName(userName); // for warm, personal replies

  const biz = await getBusinessContext(db, businessId);
  const bizName = biz?.name || 'your business';

  // --- PENDING SALE CONFIRMATION: "yes" after a sale quote ---
  if (ctx.sessionId) {
    if (/^(yes|yeah|yep|confirm|ok|okay|sure|no|nope|cancel|never mind)$/i.test(lower)) {
      const pending = await getPendingAction(db, ctx.sessionId, businessId);
      if (pending && pending.action_type === 'sale_quote') {
        const isYes = /^(yes|yeah|yep|confirm|ok|okay|sure)$/i.test(lower);
        await clearPendingAction(db, ctx.sessionId, businessId);
        if (!isYes) {
          return { answer: `Cancelled. Nothing was recorded.`, quickReplies: ['Brief me', 'Check stock'] };
        }
        if (!limits.recordSale) return tierBlocked('recording sales', limits);
        if (!canDo(role, 'sale')) return roleBlocked('sale', role, userName);
        const q = pending.payload || {};
        if (!q.productId || !q.qty) {
          return { answer: `That sale confirmation expired. Tell me the sale again, like "sell 2 cabin biscuits".`, quickReplies: ['Brief me'] };
        }
        const res = await recordSale(db, businessId, q.productId, q.qty, q.unitPrice, userId);
        if (res.error) return { answer: `I could not record that sale. Nothing was saved.` };
        return {
          answer: `Done${nm ? `, ${nm}` : ''}! Recorded: ${q.qty} x ${q.productName}, ${formatNGN(q.total)}.`,
          quickReplies: ['Brief me', 'Check stock']
        };
      }
    } else {
      // Any other message cancels a stale pending quote
      await clearPendingAction(db, ctx.sessionId, businessId);
    }
  }

  // --- REMINDERS (never forget) ---
  if (lower.startsWith('remind me') || lower.match(/^(my reminders|list reminders|reminders|cancel reminder)/)) {
    if (!limits.tasks) return tierBlocked('reminders', limits);
    const remResult = await handleReminderCommand(message, ctx);
    if (remResult) return remResult;
  }

  // Check for due reminders and include them
  let dueReminderNote = '';
  try {
    const due = await checkDueReminders(db, businessId);
    if (due.length > 0) {
      dueReminderNote = `\n\nReminder! ${due.map(r => `"${r.title}"`).join(', ')}`;
    }
  } catch {}

  // --- BRIEF ME ---
  if (lower.match(/^(brief|brief me|morning brief|daily brief|summary|how is business|business update)/)) {
    if (!limits.briefing) return tierBlocked('briefings', limits);
    if (!canDo(role, 'briefing')) return roleBlocked('briefing', role, userName);

    const [sales, expenses, lowStock, owed, targets] = await Promise.all([
      getTodaySales(db, businessId),
      getTodayExpenses(db, businessId),
      getLowStock(db, businessId, 5),
      getOwed(db, businessId),
      getTargets(db, businessId)
    ]);

    const greetings = [
      `Good day${nm ? `, ${nm}` : ''}. Here is your briefing for ${bizName}:`,
      `Here is how ${bizName} is doing today${nm ? `, ${nm}` : ''}:`,
      `Your business update${nm ? `, ${nm}` : ''}. Here is ${bizName} today:`
    ];
    let brief = pick(greetings) + `\n\n`;
    brief += `Sales today: ${formatNaira(sales.total)} (${sales.count} sales)\n`;
    brief += `Expenses today: ${formatNaira(expenses.total)}\n`;
    brief += `Net: ${formatNaira(sales.total - expenses.total)}\n\n`;

    if (lowStock.length > 0) {
      brief += `Low stock alert! ${lowStock.length} product(s) running low:\n`;
      lowStock.forEach(p => { brief += `- ${p.name}: ${p.quantity} left\n`; });
      brief += '\n';
    } else {
      brief += `Stock levels look good.\n\n`;
    }

    if (owed.total > 0) {
      brief += `Customers owe you ${formatNaira(owed.total)} (${owed.count} customers).\n\n`;
    }

    if (targets.length > 0 && limits.targets) {
      brief += `Targets:\n`;
      for (const t of targets.slice(0, 3)) {
        const prog = await getTargetProgress(db, businessId, t);
        brief += `- ${t.description}: ${formatNaira(prog.current)} / ${formatNaira(prog.target)} (${prog.pct}%)\n`;
      }
    }

    try {
      const mems = await listMemories(db, businessId);
      if (mems.length > 0) {
        brief += `\nYou asked me to remember: "${mems[0].memory_value}"\n`;
      }
    } catch {}

    if (dueReminderNote) brief += dueReminderNote;

    return { answer: brief, quickReplies: ['Check stock', 'Record sale', 'Set target'] };
  }

  // --- CHECK STOCK ---
  if (lower.match(/(check stock|stock level|low stock|inventory|what.*low)/)) {
    if (!limits.stockAlerts) return tierBlocked('stock alerts', limits);
    if (!canDo(role, 'stock')) return roleBlocked('stock', role, userName);

    const low = await getLowStock(db, businessId, 10);
    if (low.length === 0) {
      return { answer: `All stock levels look healthy for ${bizName}. Nothing is running low right now.`, quickReplies: ['Brief me'] };
    }
    let msg = `These products are running low:\n\n`;
    low.forEach(p => { msg += `- ${p.name}: ${p.quantity} left (${formatNaira(p.price)} each)\n`; });
    msg += `\nWant me to help you restock?`;
    return { answer: msg, quickReplies: ['Brief me', 'Record sale'] };
  }

  // --- PRICE LOOKUP: "how much is X", "price of X", "X price" ---
  // Works on ALL tiers. Never invents a price.
  const priceMatch = lower.match(/(?:how much is|how much are|how much does|price of|what(?:'s| is) the price of)\s+(.+?)\??$/)
    || lower.match(/^(.+?)\s+price\??$/);
  if (priceMatch) {
    if (!canDo(role, 'price')) return roleBlocked('price', role, userName);
    let term = priceMatch[1].trim().replace(/\s+cost\??$/, '');
    if (term.length < 2) return null;
    const products = await findProduct(db, businessId, term);
    if (products.length === 0) {
      return { answer: `I do not have "${term}" in your products. I will not guess. Add it in Products first, then ask me again.`, quickReplies: ['Check stock'] };
    }
    if (products.length === 1) {
      const p = products[0];
      const answers = [
        `${p.name} is ${formatNGN(p.price)}, ${p.quantity} in stock.`,
        nm ? `${nm}, ${p.name} goes for ${formatNGN(p.price)}. We have ${p.quantity} in stock.` : `${p.name} goes for ${formatNGN(p.price)}. We have ${p.quantity} in stock.`,
        `${p.name}: ${formatNGN(p.price)} each, ${p.quantity} available. Anything else you need${nm ? `, ${nm}` : ''}?`
      ];
      return { answer: pick(answers), quickReplies: ['Check stock', 'Brief me'] };
    }
    let msg = `I found ${products.length} matches:\n\n`;
    products.slice(0, 3).forEach(p => { msg += `- ${p.name}: ${formatNGN(p.price)} (${p.quantity} in stock)\n`; });
    return { answer: msg, quickReplies: ['Check stock'] };
  }

  // --- RECORD SALE: "sell 2 cabin biscuits" -> quote -> YES confirms ---
  const saleMatch = lower.match(/(?:record sale|sell|record)\s+(\d+)\s+(.+)/);
  if (saleMatch) {
    if (!limits.recordSale) return tierBlocked('recording sales', limits);
    if (!canDo(role, 'sale')) return roleBlocked('sale', role, userName);

    const qty = parseInt(saleMatch[1]);
    const productSearch = saleMatch[2].trim();
    const products = await findProduct(db, businessId, productSearch);

    if (products.length === 0) {
      return { answer: `I could not find "${productSearch}" in your products. I will not guess. Check the spelling or add it first.`, quickReplies: ['Check stock'] };
    }
    if (products.length > 1) {
      let msg = `Which one did you mean?\n\n`;
      products.slice(0, 3).forEach((p, i) => { msg += `${i + 1}. ${p.name} at ${formatNGN(p.price)}\n`; });
      msg += `\nSay "sell ${qty}" plus the full name.`;
      return { answer: msg, quickReplies: ['Check stock'] };
    }

    const p = products[0];
    if (qty > p.quantity) {
      return { answer: `You only have ${p.quantity} of ${p.name} in stock. I cannot sell ${qty}.`, quickReplies: ['Check stock'] };
    }
    const total = qty * p.price;
    if (ctx.sessionId) {
      await savePendingAction(db, ctx.sessionId, businessId, 'sale_quote', {
        productId: p.id, productName: p.name, qty, unitPrice: p.price, total
      });
    }
    return {
      answer: `${qty} x ${p.name} at ${formatNGN(p.price)} = ${formatNGN(total)}. Reply YES to record this sale.`,
      quickReplies: ['Yes', 'No']
    };
  }

  // --- RECORD EXPENSE: guide to app ---
  const expMatch = lower.match(/(?:record expense|add expense|expense)\s+(\d+)\s*(.+)?/);
  if (expMatch) {
    if (!limits.recordExpense) return tierBlocked('recording expenses', limits);
    if (!canDo(role, 'expense')) return roleBlocked('expense', role, userName);

    const amount = parseInt(expMatch[1]);
    const desc = (expMatch[2] || 'Expense').trim();
    return {
      answer: `Got it: ${formatNaira(amount)} for "${desc}".\n\nTo save this, tap Expenses > Add in the app. Full expense recording via chat is coming soon!`,
      quickReplies: ['Brief me']
    };
  }

  // --- SET TARGET: "set target 100000 sales this week" ---
  const targetMatch = lower.match(/(?:set target|new target|target)\s+(\d+)\s*(sales?)?\s*(today|this week|week|this month|month)?/);
  if (targetMatch) {
    if (!limits.targets) return tierBlocked('targets', limits);
    if (!canDo(role, 'target')) return roleBlocked('target', role, userName);

    const value = parseInt(targetMatch[1]);
    let period = 'today';
    if (targetMatch[3]) {
      if (targetMatch[3].includes('week')) period = 'week';
      if (targetMatch[3].includes('month')) period = 'month';
    }
    const desc = `Sales target: ${formatNaira(value)} ${period}`;
    const result = await setTarget(db, businessId, 'sales', value, period, desc, userId);
    if (result.error) return { answer: `Could not set target: ${result.error}` };
    return {
      answer: `Target set! ${desc}. I will track your progress and include it in your briefings.`,
      quickReplies: ['Brief me', 'Check my targets']
    };
  }

  // --- CHECK TARGETS ---
  if (lower.match(/(my targets|check.*target|target progress|goals)/)) {
    if (!limits.targets) return tierBlocked('targets', limits);
    if (!canDo(role, 'target')) return roleBlocked('target', role, userName);
    const targets = await getTargets(db, businessId);
    if (targets.length === 0) {
      return { answer: `You have no active targets. Say "set target 50000 sales today" to create one.`, quickReplies: ['Brief me'] };
    }
    let msg = `Your active targets:\n\n`;
    for (const t of targets) {
      const prog = await getTargetProgress(db, businessId, t);
      const bar = '█'.repeat(Math.min(10, Math.round(prog.pct / 10))) + '░'.repeat(10 - Math.min(10, Math.round(prog.pct / 10)));
      msg += `${t.description}\n${bar} ${prog.pct}%\n${formatNaira(prog.current)} / ${formatNaira(prog.target)}\n\n`;
    }
    return { answer: msg, quickReplies: ['Brief me', 'Set target'] };
  }

  // --- WHO OWES ME / DEBTORS ---
  if (lower.match(/(who owes me|debtors|list debtors|who.*owes|outstanding debts)/)) {
    if (!canDo(role, 'customers')) return roleBlocked('customers', role, userName);
    const debtors = await getDebtors(db, businessId, 10);
    if (debtors.length === 0) {
      return { answer: `Good news, nobody owes ${bizName} right now.`, quickReplies: ['Brief me'] };
    }
    let msg = `These customers owe you:\n\n`;
    debtors.forEach(d => { msg += `- ${d.name}: ${formatNGN(d.owed)}${d.phone ? ` (${d.phone})` : ''}\n`; });
    const totalOwed = debtors.reduce((s, d) => s + d.owed, 0);
    msg += `\nTotal owed: ${formatNGN(totalOwed)}`;
    return { answer: msg, quickReplies: ['Brief me'] };
  }

  // --- FIND CUSTOMER: "find customer Ada" / "customer Ada" ---
  const custMatch = lower.match(/(?:find customer|customer)\s+(.+)/);
  if (custMatch) {
    if (!canDo(role, 'customers')) return roleBlocked('customers', role, userName);
    const term = custMatch[1].trim();
    if (term.length < 2) return null;
    const customers = await findCustomer(db, businessId, term);
    if (customers.length === 0) {
      return { answer: `I do not have a customer named "${term}" for ${bizName}. I will not guess.`, quickReplies: ['Brief me'] };
    }
    if (customers.length > 1) {
      let msg = `I found ${customers.length} customers:\n\n`;
      customers.slice(0, 3).forEach(c => { msg += `- ${c.name}${c.phone ? ` (${c.phone})` : ''}\n`; });
      msg += `\nGive me more of the name.`;
      return { answer: msg, quickReplies: ['Brief me'] };
    }
    const c = customers[0];
    let msg = `${c.name}${c.phone ? ` (${c.phone})` : ''}\n`;
    msg += `Owes: ${formatNGN(c.owed)}\n`;
    msg += c.last_purchase ? `Last purchase: ${String(c.last_purchase).slice(0, 10)}` : `No purchases recorded yet.`;
    return { answer: msg, quickReplies: ['Brief me'] };
  }

  // --- WEEK SUMMARY ---
  if (lower.match(/(week|weekly|7 days|last 7)/)) {
    if (!limits.briefing) return tierBlocked('reports', limits);
    const week = await getWeekSales(db, businessId);
    if (week.length === 0) return { answer: `No sales recorded in the last 7 days.` };
    const total = week.reduce((s, d) => s + d.total, 0);
    let msg = `Last 7 days: ${formatNaira(total)} total\n\n`;
    week.forEach(d => { msg += `${d.day}: ${formatNaira(d.total)} (${d.count} sales)\n`; });
    return { answer: msg, quickReplies: ['Brief me'] };
  }

  // --- REMEMBER: "remember that ..." / "note that ..." / "do not forget ..." ---
  const memMatch = lower.match(/^(?:remember that|note that|do not forget that|dont forget that|don't forget that)\s+(.+)/);
  if (memMatch) {
    if (!canDo(role, 'memory')) return roleBlocked('memory', role, userName);
    const text = memMatch[1].trim();
    if (text.length < 3) return { answer: `What should I remember? Say "remember that ..." followed by the thing.` };
    const key = text.split(/\s+/).slice(0, 5).join(' ').toLowerCase();
    const res = await saveMemory(db, businessId, key, text, userId);
    if (res.error) return { answer: `I could not save that memory. Try again.` };
    return { answer: pick([`Got it, I will remember: "${text}".`, `Noted${nm ? `, ${nm}` : ''}! I will remember: "${text}".`]), quickReplies: ['Brief me'] };
  }

  // --- WHAT DO YOU REMEMBER / LIST MEMORIES ---
  if (lower.match(/(what do you remember|list memories|your memories|show memories|what.*remember)/)) {
    if (!canDo(role, 'memory')) return roleBlocked('memory', role, userName);
    const mems = await listMemories(db, businessId);
    if (mems.length === 0) {
      return { answer: `I am not holding any memories for ${bizName} yet. Say "remember that ..." and I will keep it.`, quickReplies: ['Brief me'] };
    }
    let msg = `Here is what I remember for ${bizName}:\n\n`;
    mems.slice(0, 10).forEach((m, i) => { msg += `${i + 1}. ${m.memory_value}\n`; });
    return { answer: msg, quickReplies: ['Brief me'] };
  }

  // --- FORGET: "forget ..." ---
  const forgetMatch = lower.match(/^forget\s+(.+)/);
  if (forgetMatch) {
    if (!canDo(role, 'memory')) return roleBlocked('memory', role, userName);
    const res = await forgetMemory(db, businessId, forgetMatch[1].trim().toLowerCase());
    if (res.error) return { answer: `I could not forget that. Try again.` };
    if (!res.deleted) return { answer: `I do not have a memory about that.` };
    return { answer: `Forgotten. I will not bring it up again.`, quickReplies: ['Brief me'] };
  }

  // --- HELP: role-aware, lists only what THIS person can do ---
  if (lower.match(/^(help|what can you do|commands|what are my limits|my limits|what are my permissions)/)) {
    let msg = `Here is what I can do for you${nm ? `, ${nm}` : ''}:\n\n`;
    msg += `- "Brief me" - daily business summary\n`;
    if (canDo(role, 'stock')) msg += `- "Check stock" - low stock alerts\n`;
    if (canDo(role, 'price')) msg += `- "How much is cabin biscuits" - price lookup\n`;
    if (canDo(role, 'customers')) msg += `- "Who owes me" - customers with debts\n`;
    if (canDo(role, 'customers')) msg += `- "Find customer Ada" - customer details\n`;
    if (canDo(role, 'sale') && limits.recordSale) msg += `- "Sell 2 cabin biscuits" - record a sale (I will ask you to confirm)\n`;
    if (canDo(role, 'expense') && limits.recordExpense) msg += `- "Record expense 5000 fuel" - record an expense\n`;
    if (canDo(role, 'target') && limits.targets) msg += `- "Set target 100000 sales this week" - set a goal\n`;
    if (canDo(role, 'target') && limits.targets) msg += `- "My targets" - check goal progress\n`;
    if (canDo(role, 'task') && limits.tasks) msg += `- "Remind me to call supplier tomorrow at 9am" - never forget\n`;
    if (canDo(role, 'task') && limits.tasks) msg += `- "My reminders" - see all reminders\n`;
    if (canDo(role, 'memory')) msg += `- "Remember that supplier Ade delivers on Mondays" - I keep it in mind\n`;
    if (canDo(role, 'memory')) msg += `- "What do you remember" - see my memories\n`;
    msg += `- "Week summary" - last 7 days\n`;
    if (limits.note) msg += `\n${limits.note}`;
    return { answer: msg, quickReplies: ['Brief me', 'Check stock'] };
  }

  return null; // Not an owner command, fall through to normal bot
}

function tierBlocked(feature, limits) {
  return {
    answer: `Your current plan does not include ${feature}. ${limits.note || 'Upgrade to unlock this.'}`,
    quickReplies: ['Pricing', 'Brief me']
  };
}
