// Kopa AI — Tier limits, tool gating, roles, and small pure helpers.
// Phase 7.3 split of functions/api/ai/chat.js (was one 4,268-line file).
// Behaviour is unchanged: code moved verbatim; only imports/exports
// were added at the module boundary.
import { PROJECT_TYPES } from "../projects/_lib.js";
import { displayUnit } from "./_fastpath.js";

// Per-tier AI allowances. tools: [] = read-only answers; "all" = every tool.
// actionsPerDay: null = unlimited actions within the question cap.
export const AI_TIER_LIMITS = {
  free:    { questionsPerDay: 5,   tools: [], actionsPerDay: 0 },
  starter: { questionsPerDay: 20,  tools: ["record_sale", "add_expense", "draft_debtor_message", "save_memory"], actionsPerDay: 10 },
  solo:    { questionsPerDay: 50,  tools: "all", actionsPerDay: null },
  pro:     { questionsPerDay: 100, tools: "all", actionsPerDay: null },
};
const BASE_TOOLS = ["record_sale", "add_expense", "add_product", "record_customer_payment", "set_reminder", "get_customer_balance", "draft_debtor_message", "send_debtor_message", "save_memory"];
export const PROJECT_WRITE_TOOLS = [
  "create_project_plan",
  "project_add_milestone",
  "project_complete_milestone",
  "project_record_transaction",
  "project_update",
  "project_invite",
];
const PROJECT_TOOLS = [...PROJECT_WRITE_TOOLS, "project_report"];
const ALL_TOOLS = [...BASE_TOOLS, ...PROJECT_TOOLS];
export const UPGRADE_NUDGE = "Upgrade to Starter for AI actions, or Solo/Pro for the full AI assistant.";

// Projects is open to every plan, Free included (Fortune, 2026-10-20), so
// the project tools are allowed on all tiers. What stays tiered is HOW MANY
// AI project actions a Free business may execute: its own bucket of 5 per
// day, counted on execution only (see countProjectActionsToday). Every
// other Free write stays behind the standing read-only rule.
export const FREE_PROJECT_ACTIONS_PER_DAY = 5;
export const FREE_PROJECT_CAP_MSG = "You have used today's 5 free AI project actions for this business. Project actions resume tomorrow, or upgrade to Starter, Solo or Pro for more AI actions. Nothing was created or changed.";

// Pure helpers, exported for local tests. They carry no business data.
export function debtorDraftMatches(lastAssistantContent, message) {
  const draft = typeof lastAssistantContent === "string" ? lastAssistantContent : "";
  const text = typeof message === "string" ? message.trim() : "";
  return !!text && draft.includes(text);
}
export function firstMissingProjectField(name, type, goal) {
  if (!name) return "name";
  if (!PROJECT_TYPES.includes(String(type || "").trim().toLowerCase())) return "type";
  if (!goal) return "goal";
  return null;
}
export function tierAllowsTool(tier, tool) {
  // Project tools are open on every plan. The Projects endpoints make the
  // final access decision, including the invited-member path, and the Free
  // project-action bucket is enforced separately below.
  if (PROJECT_TOOLS.includes(tool)) return true;
  const cfg = AI_TIER_LIMITS[tier] || AI_TIER_LIMITS.free;
  if (cfg.tools === "all") return true;
  return cfg.tools.includes(tool);
}

export function allowedToolsForTier(tier) {
  const cfg = AI_TIER_LIMITS[tier] || AI_TIER_LIMITS.free;
  const base = cfg.tools === "all" ? BASE_TOOLS : [...cfg.tools];
  return [...new Set([...base, ...PROJECT_TOOLS])];
}

// Roles that may use every AI tool. Everyone else (shop staff) may only
// record sales and check customer balances.
const PRIVILEGED_ROLES = ["owner", "partner", "admin"];
const STAFF_TOOLS = ["record_sale", "get_customer_balance", "project_report"];

export function fmt(n, currency) {
  const v = Number(n || 0);
  return (currency || "NGN") + " " + v.toLocaleString("en-NG", { maximumFractionDigits: 2 });
}

// How a unit price reads: a product whose unit is "other" (the form
// default) or blank is priced "each", never "per other". A real unit
// keeps "per <unit>".
export function pricePhrase(unit) {
  const u = displayUnit(unit);
  return u ? `per ${u}` : "each";
}

function isPrivileged(auth) {
  return PRIVILEGED_ROLES.includes(auth.business && auth.business.role);
}

export function toolAllowed(auth, tool) {
  if (isPrivileged(auth)) return true;
  return STAFF_TOOLS.includes(tool);
}
