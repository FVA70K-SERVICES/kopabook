// POST /api/ai/chat: Kopa, the KopaBook business assistant (Workers AI).
// Real read access to the business's OWN data only. The LLM never writes SQL:
// every data question maps to one whitelisted, parameterized D1 query with
// business_id bound from the authenticated session. Tier-gated to Solo/Pro.
import { json, getAuthContext, requireAuth } from "../_utils";
import { getBusinessOwnerTier, LIMITS } from "../billing";
import { checkRateLimit } from "../_webhook_security";

const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const DAILY_CAP = 20;

// Whitelist only. The AI can NEVER generate its own SQL. Every query binds
// business_id from auth, never from the question.
const SAFE_QUERIES = {
  sales_today: `SELECT COALESCE(SUM(total_amount),0) AS total FROM sales WHERE business_id = ? AND date(created_at) = date('now')`,
  sales_month: `SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*) AS cnt FROM sales WHERE business_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now')`,
  expenses_month: `SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE business_id = ? AND strftime('%Y-%m', incurred_on) = strftime('%Y-%m','now')`,
  low_stock: `SELECT p.name, p.unit, COALESCE(ii.quantity_on_hand,0) AS qty FROM products p LEFT JOIN inventory_items ii ON ii.product_id = p.id WHERE p.business_id = ? AND p.is_active = 1 AND COALESCE(ii.quantity_on_hand,0) <= p.low_stock_threshold LIMIT 10`,
  top_products: `SELECT p.name, p.unit, SUM(si.quantity) AS sold FROM sale_items si JOIN sales s ON si.sale_id = s.id JOIN products p ON si.product_id = p.id WHERE s.business_id = ? AND strftime('%Y-%m', s.created_at) = strftime('%Y-%m','now') GROUP BY p.id, p.name, p.unit ORDER BY sold DESC LIMIT 5`,
};

function fmt(n) {
  const v = Number(n || 0);
  return "NGN " + v.toLocaleString("en-NG", { maximumFractionDigits: 2 });
}

function detectIntents(q) {
  const intents = [];
  if (/today/.test(q) && /(sale|revenue|made|earn|turnover)/.test(q)) intents.push("sales_today");
  if (/(this month|month|monthly)/.test(q) && /(sale|revenue|performance|doing|business)/.test(q)) {
    intents.push("sales_month");
    intents.push("expenses_month");
  } else if (/(expense|spent|spend|cost)/.test(q)) {
    intents.push("expenses_month");
  }
  if (/(low stock|out of stock|restock|running low|remain)/.test(q)) intents.push("low_stock");
  if (/(top|best.?sell|best product|popular|fast.?mov)/.test(q)) intents.push("top_products");
  return [...new Set(intents)];
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const businessId = auth.business && auth.business.id;
    if (!businessId) return json({ ok: false, message: "Pick a business first." }, 400);

    const db = context.env.KOPABOOK_DB;

    // Tier gate: Kopa AI is a Solo/Pro feature. Staff use the owner's plan.
    const { tier } = await getBusinessOwnerTier(db, businessId);
    if (!LIMITS[tier] || !LIMITS[tier].aiWorker) {
      return json(
        {
          ok: false,
          upgradeRequired: true,
          message: "Kopa AI is available on Solo and Pro plans. Upgrade to chat with your business data.",
        },
        403
      );
    }

    // Abuse guard on top of the daily AI cap.
    if (!(await checkRateLimit(db, `ai_${auth.user.id}`, 60, 3600000))) {
      return json({ ok: false, message: "Too many questions at once. Slow down a little." }, 429);
    }

    const body = await context.request.json().catch(() => ({}));
    const question = String(body.question || "").trim().slice(0, 500);
    if (!question) return json({ ok: false, message: "Ask a question first." }, 400);

    // Daily cap: 20 AI answers per business per UTC day.
    const day = new Date().toISOString().slice(0, 10);
    const usage = await db
      .prepare(`SELECT count FROM ai_usage WHERE business_id = ? AND day = ?`)
      .bind(String(businessId), day)
      .first();
    if (usage && Number(usage.count) >= DAILY_CAP) {
      return json({
        ok: true,
        answer: "You have used today's Kopa AI limit (20 questions). It resets tomorrow, and your data is untouched.",
        fallback: true,
        capped: true,
      });
    }

    // Run whitelisted queries only. business_id always comes from auth.
    const q = question.toLowerCase();
    const intents = detectIntents(q);
    const parts = [];
    for (const name of intents) {
      try {
        if (name === "sales_today") {
          const r = await db.prepare(SAFE_QUERIES.sales_today).bind(businessId).first();
          parts.push(`Today's sales total: ${fmt(r && r.total)}`);
        } else if (name === "sales_month") {
          const r = await db.prepare(SAFE_QUERIES.sales_month).bind(businessId).first();
          parts.push(`This month's sales: ${fmt(r && r.total)} across ${Number((r && r.cnt) || 0)} sales`);
        } else if (name === "expenses_month") {
          const r = await db.prepare(SAFE_QUERIES.expenses_month).bind(businessId).first();
          parts.push(`This month's expenses: ${fmt(r && r.total)}`);
        } else if (name === "low_stock") {
          const rs = await db.prepare(SAFE_QUERIES.low_stock).bind(businessId).all();
          const rows = (rs.results || []).map((p) => `${p.name} (${p.qty} ${p.unit || "piece"} left)`);
          parts.push(rows.length ? `Low stock: ${rows.join("; ")}` : "Low stock: nothing is running low right now");
        } else if (name === "top_products") {
          const rs = await db.prepare(SAFE_QUERIES.top_products).bind(businessId).all();
          const rows = (rs.results || []).map((p, i) => `${i + 1}. ${p.name} (${p.sold} ${p.unit || "piece"} sold)`);
          parts.push(rows.length ? `Top sellers this month: ${rows.join("; ")}` : "Top sellers: no sales recorded this month yet");
        }
      } catch (e) {
        // One bad query must never kill the whole answer.
      }
    }
    const businessContext = parts.length ? parts.join(". ") + "." : "No business figures matched this question.";

    // Count the question before the AI call so failures still respect the cap.
    await db
      .prepare(
        `INSERT INTO ai_usage (business_id, day, count) VALUES (?, ?, 1)
         ON CONFLICT(business_id, day) DO UPDATE SET count = count + 1`
      )
      .bind(String(businessId), day)
      .run();

    // Graceful degradation: the app must never break because AI is down.
    const ai = context.env.AI;
    if (!ai) {
      return json({
        ok: true,
        answer: `Kopa AI is not connected yet, but here is what your books say. ${businessContext}`,
        fallback: true,
      });
    }

    try {
      const resp = await ai.run(AI_MODEL, {
        messages: [
          {
            role: "system",
            content:
              "You are Kopa, the KopaBook business assistant for Nigerian small business owners. Use ONLY the numbers in the provided business context. Never invent numbers. Keep answers short, warm and practical. Never reveal another business's data.",
          },
          { role: "user", content: `Business context: ${businessContext}\nQuestion: ${question}` },
        ],
      });
      const answer = resp && (resp.response || resp.answer || resp.text);
      if (!answer) throw new Error("empty AI response");
      return json({ ok: true, answer: String(answer) });
    } catch (e) {
      return json({
        ok: true,
        answer: `Kopa AI is resting at the moment, but your books are fine. ${businessContext}`,
        fallback: true,
      });
    }
  } catch (error) {
    return json({ ok: false, message: "Something went wrong. Try again." }, 500);
  }
}
