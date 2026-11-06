// Pure statement helpers for KopaBook History / Statements.
// No React, no network: unit-testable in plain node.
//
// A statement is a dated list of money lines with a running balance:
//   closing = opening + sum(signed amounts)
// A line's amount is SIGNED: positive raises the balance (a sale, a debt
// added), negative lowers it (a payment received, an expense). Lines that
// carry no money movement (stock, customer, staff, settings, receipt)
// have amount null and leave the balance unchanged.
//
// A customer-facing statement NEVER shows cost or profit: this module
// has no cost or profit inputs at all, and StatementPrint only renders
// the lines it is given.
//
// NOTE: the sign table below intentionally mirrors historySign() in
// functions/api/_history.js. It is duplicated (not imported) so the
// client bundle never pulls server code; tests assert the two agree.

export function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

// Mirrors historySign() in functions/api/_history.js (see note above).
export function statementSign(type) {
  if (type === "sale" || type === "debt") return 1;
  if (type === "payment" || type === "expense") return -1;
  return 0;
}

// Type labels + the staff-visible subset. These mirror
// HISTORY_TYPE_LABELS / STAFF_VISIBLE_TYPES in functions/api/_history.js
// (duplicated so the client bundle never pulls server code; tests assert
// the two agree).
export const HISTORY_TYPE_LABELS = {
  sale: "Sales",
  expense: "Expenses",
  payment: "Payments",
  debt: "Debts",
  stock: "Stock",
  customer: "Customers",
  staff: "Staff",
  settings: "Settings",
  receipt: "Receipts",
};

export const STAFF_VISIBLE_TYPES = ["sale", "expense", "payment", "debt", "stock", "customer"];

// lines: [{ date, description, amount }] (amount signed or null).
// Returns the lines in order with a running `balance` each, plus the
// money-in / money-out totals and the closing balance.
export function computeStatement(openingBalance, lines) {
  const opening = round2(openingBalance || 0);
  let balance = opening;
  let totalIn = 0;
  let totalOut = 0;
  const out = (lines || []).map((l) => {
    const amount = l.amount === null || l.amount === undefined ? null : round2(l.amount);
    if (amount !== null) {
      balance = round2(balance + amount);
      if (amount > 0) totalIn = round2(totalIn + amount);
      if (amount < 0) totalOut = round2(totalOut + Math.abs(amount));
    }
    return { ...l, amount, balance };
  });
  return { lines: out, openingBalance: opening, totalIn, totalOut, closingBalance: balance };
}

// Map history events to statement lines. History amounts are stored
// unsigned (the event's money size); the sign comes from the event type.
export function historyEventsToLines(events) {
  return (events || []).map((e) => ({
    date: String(e.created_at || "").slice(0, 10),
    time: String(e.created_at || "").slice(11, 16),
    description: e.summary || "",
    amount:
      e.amount === null || e.amount === undefined
        ? null
        : round2(Number(e.amount) * statementSign(e.type)),
    type: e.type,
  }));
}

// Totals for a filtered history list, for the statement totals block.
export function historyTotals(events) {
  const totalSales = round2(
    (events || []).filter((e) => e.type === "sale").reduce((s, e) => s + Number(e.amount || 0), 0)
  );
  const totalPayments = round2(
    (events || []).filter((e) => e.type === "payment").reduce((s, e) => s + Number(e.amount || 0), 0)
  );
  const totalExpenses = round2(
    (events || []).filter((e) => e.type === "expense").reduce((s, e) => s + Number(e.amount || 0), 0)
  );
  const { closingBalance } = computeStatement(0, historyEventsToLines(events));
  return { totalSales, totalPayments, totalExpenses, closingBalance };
}

// Print flow: mark the page as statement-printing so print.css hides
// everything except the .print-only statement, open the browser print
// dialog (Save as PDF), then clear the mark. Safe to call when
// window/document are absent (tests, SSR): it just returns false.
export function requestStatementPrint() {
  try {
    if (typeof document === "undefined" || typeof window === "undefined") return false;
    document.body.classList.add("kb-printing-statement");
    const done = () => {
      document.body.classList.remove("kb-printing-statement");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
    // Fallback: some browsers never fire afterprint if the dialog is
    // dismissed quickly; clear the class shortly after as well.
    setTimeout(() => document.body.classList.remove("kb-printing-statement"), 5000);
    return true;
  } catch {
    return false;
  }
}

function csvCell(value) {
  const s = String(value === null || value === undefined ? "" : value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Client-side CSV fallback (same columns as the server export). The
// History page normally downloads from /api/history?csv=1 so the Starter
// gate is enforced server-side; this is used only by tests and by any
// caller that already holds gated rows.
export function historyToCsv(events, { businessName, from, to } = {}) {
  const lines = [];
  const row = (cells) => lines.push(cells.map(csvCell).join(","));
  row(["KopaBook History", businessName || "", `${from || ""} to ${to || ""}`]);
  row([]);
  row(["Date", "Time", "Type", "Who", "Role", "Summary", "Amount"]);
  for (const e of events || []) {
    const when = String(e.created_at || "");
    row([
      when.slice(0, 10),
      when.slice(11, 19),
      e.type,
      e.actor_name || "",
      e.actor_role || "",
      e.summary || "",
      e.amount === null || e.amount === undefined ? "" : e.amount,
    ]);
  }
  return lines.join("\r\n");
}
