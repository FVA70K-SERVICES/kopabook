// Kopa Bot Owner Mode - understands owner/staff commands and runs business tasks
import {
  getBusinessContext, getTodaySales, getTodayExpenses, getLowStock,
  getOwed, getWeekSales, findProduct, recordQuickSale, recordQuickExpense,
  getTargets, setTarget, getTargetProgress, formatNaira
} from './bot-tools.js';

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
    note: 'Starter: briefings and stock alerts. Upgrade to Pro to record sales and set targets.'
  },
  pro: {
    briefing: true, stockAlerts: true, recordSale: true,
    recordExpense: true, targets: true, tasks: true,
    note: null
  },
  internal: {
    briefing: true, stockAlerts: true, recordSale: true,
    recordExpense: true, targets: true, tasks: true,
    note: null
  }
};

// Staff role limits (within owner mode)
const STAFF_LIMITS = {
  owner: ['briefing', 'stock', 'sale', 'expense', 'target', 'task'],
  admin: ['briefing', 'stock', 'sale', 'expense', 'target'],
  staff: ['briefing', 'stock'],
  viewer: ['briefing']
};

function canDo(role, action) {
  const allowed = STAFF_LIMITS[role] || STAFF_LIMITS.viewer;
  return allowed.includes(action);
}

export async function handleOwnerCommand(message, ctx) {
  const { db, businessId, userId, userName, userRole, tier } = ctx;
  const lower = message.toLowerCase().trim();
  const limits = BOT_TIER_LIMITS[tier] || BOT_TIER_LIMITS.free;
  const role = userRole || 'owner';

  const biz = await getBusinessContext(db, businessId);
  const bizName = biz?.name || 'your business';

  // --- BRIEF ME ---
  if (lower.match(/^(brief|brief me|morning brief|daily brief|summary|how is business|business update)/)) {
    if (!limits.briefing) return tierBlocked('briefings', limits);
    if (!canDo(role, 'briefing')) return roleBlocked();

    const [sales, expenses, lowStock, owed, targets] = await Promise.all([
      getTodaySales(db, businessId),
      getTodayExpenses(db, businessId),
      getLowStock(db, businessId, 5),
      getOwed(db, businessId),
      getTargets(db, businessId)
    ]);

    let brief = `Good day, ${userName || 'boss'}. Here is your briefing for ${bizName}:\n\n`;
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

    return { answer: brief, quickReplies: ['Check stock', 'Record sale', 'Set target'] };
  }

  // --- CHECK STOCK ---
  if (lower.match(/(check stock|stock level|low stock|inventory|what.*low)/)) {
    if (!limits.stockAlerts) return tierBlocked('stock alerts', limits);
    if (!canDo(role, 'stock')) return roleBlocked();

    const low = await getLowStock(db, businessId, 10);
    if (low.length === 0) {
      return { answer: `All stock levels look healthy for ${bizName}. Nothing is running low right now.`, quickReplies: ['Brief me'] };
    }
    let msg = `These products are running low:\n\n`;
    low.forEach(p => { msg += `- ${p.name}: ${p.quantity} left (${formatNaira(p.price)} each)\n`; });
    msg += `\nWant me to help you restock?`;
    return { answer: msg, quickReplies: ['Brief me', 'Record sale'] };
  }

  // --- RECORD SALE: "record sale 2 rice" or "sell 3 coke" ---
  const saleMatch = lower.match(/(?:record sale|sell|record)\s+(\d+)\s+(.+)/);
  if (saleMatch) {
    if (!limits.recordSale) return tierBlocked('recording sales', limits);
    if (!canDo(role, 'sale')) return roleBlocked();

    const qty = parseInt(saleMatch[1]);
    const productSearch = saleMatch[2].trim();
    const products = await findProduct(db, businessId, productSearch);

    if (products.length === 0) {
      return { answer: `I could not find "${productSearch}" in your products. Check the spelling or add it first.`, quickReplies: ['Check stock'] };
    }
    if (products.length > 1) {
      let msg = `I found ${products.length} matches. Which one?\n\n`;
      products.forEach((p, i) => { msg += `${i + 1}. ${p.name} - ${formatNaira(p.price)} (${p.quantity} in stock)\n`; });
      msg += `\nReply with the number, e.g. "1"`;
      return { answer: msg, quickReplies: products.map((p, i) => `${i + 1}`), pendingAction: { type: 'sale', qty, products } };
    }

    const result = await recordQuickSale(db, businessId, products[0].id, qty, userId);
    if (result.error) return { answer: `Could not record sale: ${result.error}`, quickReplies: ['Check stock'] };
    return {
      answer: `Sale recorded! ${qty}x ${result.product} = ${formatNaira(result.total)}. Stock updated.`,
      quickReplies: ['Brief me', 'Record another sale']
    };
  }

  // --- RECORD EXPENSE: "record expense 5000 fuel" ---
  const expMatch = lower.match(/(?:record expense|add expense|expense)\s+(\d+)\s*(.+)?/);
  if (expMatch) {
    if (!limits.recordExpense) return tierBlocked('recording expenses', limits);
    if (!canDo(role, 'expense')) return roleBlocked();

    const amount = parseInt(expMatch[1]);
    const desc = (expMatch[2] || 'Expense').trim();
    const result = await recordQuickExpense(db, businessId, amount, desc, 'general', userId);
    if (result.error) return { answer: `Could not record expense: ${result.error}` };
    return {
      answer: `Expense recorded: ${formatNaira(amount)} for "${desc}".`,
      quickReplies: ['Brief me', 'Record sale']
    };
  }

  // --- SET TARGET: "set target 100000 sales this week" ---
  const targetMatch = lower.match(/(?:set target|new target|target)\s+(\d+)\s*(sales?)?\s*(today|this week|week|this month|month)?/);
  if (targetMatch) {
    if (!limits.targets) return tierBlocked('targets', limits);
    if (!canDo(role, 'target')) return roleBlocked();

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

  // --- HELP ---
  if (lower.match(/^(help|what can you do|commands)/)) {
    let msg = `Here is what I can do for ${bizName}:\n\n`;
    msg += `- "Brief me" - daily business summary\n`;
    msg += `- "Check stock" - low stock alerts\n`;
    if (limits.recordSale) msg += `- "Record sale 2 rice" - record a sale\n`;
    if (limits.recordExpense) msg += `- "Record expense 5000 fuel" - record an expense\n`;
    if (limits.targets) msg += `- "Set target 100000 sales this week" - set a goal\n`;
    if (limits.targets) msg += `- "My targets" - check goal progress\n`;
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

function roleBlocked() {
  return {
    answer: `Your staff role does not have permission for that action. Ask the business owner.`,
    quickReplies: ['Brief me', 'Check stock']
  };
}
