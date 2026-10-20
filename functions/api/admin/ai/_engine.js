// Admin AI chat engine (owner-only control centre).
//
// HARD RULE: this engine NEVER executes a write action. It can read
// figures with the read tools and prepare proposals with the propose
// tools. Execution happens only in POST /api/admin/ai/confirm when the
// owner taps Confirm on the proposal card. A typed or spoken "yes",
// "confirm" or "go ahead" in chat changes nothing in the database: if a
// proposal is pending, the engine says so and leaves it pending.
// This file deliberately does not import executeProposal at all.
import { generateText, aiProviderAvailable } from "../../ai/chat.js";
import { TOOL_DEFS, READ_TOOL_NAMES, executeReadTool, composeBriefingText, composeDailyText } from "./_tools.js";
import { PROPOSE_TOOL_DEFS, ensureAdminAiTables, createProposal, getPendingProposal } from "./_actions.js";

const PROPOSE_TO_ACTION = {
  propose_set_tier: "set_tier",
  propose_grant: "grant",
  propose_suspend: "suspend",
  propose_unsuspend: "unsuspend",
  propose_revoke_promo: "revoke_promo",
};

const CONFIRM_WORDS = /^\s*(yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|approve|approved|go ahead|do it|proceed|run it|execute|please do|yes please|yes do it)\b/i;

function systemPromptText() {
  const toolLines = [...TOOL_DEFS, ...PROPOSE_TOOL_DEFS]
    .map((t) => `- ${t.name}: ${t.description} Args: ${JSON.stringify(t.args || {})}`)
    .join("\n");
  return `You are Admin AI, the owner-only control centre assistant for KopaBook. You are talking to the platform owner, the only person who can use this chat.

How you work:
- Figures come only from tools. Never invent, estimate or repeat a number you did not get from a tool result in this conversation.
- To call a tool, reply with exactly one line in this format and nothing else on that line:
TOOL_CALL {"name":"tool_name","args":{...}}
- After a tool result comes back, either call another tool the same way or give the final answer in plain text with no TOOL_CALL line.
- Read tools only read. The propose tools prepare a proposal card. A proposal is not done, not approved and not executed: it only runs if the owner taps the Confirm button on its card, which calls a separate confirm endpoint.
- Chat can never execute an action. If the owner types or says yes, confirm, go ahead, do it or anything similar in chat, that does NOT confirm anything. Tell them the action is waiting for a tap on the Confirm button on its card, and leave the proposal pending. Never say an action is done, completed, applied or executed unless a tool result in this conversation proves a read, and never claim a proposal ran.
- Never narrate a proposed action as if it already happened. Say you have prepared it for confirmation.
- Be concise and direct, in plain English. Format money as NGN with commas, for example NGN 10,000. Do not use em dashes.

Available tools:
${toolLines}`;
}

function stripToolCalls(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => !/TOOL_CALL/.test(line))
    .join("\n")
    .trim();
}

function parseToolCall(text) {
  const raw = String(text || "");
  const idx = raw.indexOf("TOOL_CALL");
  if (idx < 0) return null;
  const rest = raw.slice(idx + "TOOL_CALL".length);
  const start = rest.indexOf("{");
  if (start < 0) return { error: "A TOOL_CALL line had no JSON object." };
  // Find the matching closing brace for the first object.
  let depth = 0;
  let end = -1;
  let inStr = false;
  let esc = false;
  for (let i = start; i < rest.length; i++) {
    const ch = rest[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return { error: "A TOOL_CALL line had incomplete JSON." };
  try {
    const obj = JSON.parse(rest.slice(start, end + 1));
    if (!obj || !obj.name) return { error: "A TOOL_CALL line had no tool name." };
    return { name: String(obj.name), args: obj.args && typeof obj.args === "object" ? obj.args : {} };
  } catch (e) {
    return { error: "A TOOL_CALL line had invalid JSON." };
  }
}

async function callModel(context, deps, messages) {
  if (deps && typeof deps.generateText === "function") {
    return await deps.generateText(context.env, messages, { temperature: 0.2, maxOutputTokens: 1200 });
  }
  return await generateText(context.env, messages, { temperature: 0.2, maxOutputTokens: 1200 });
}

export async function runAdminAiChat(context, auth, body, deps = {}) {
  const env = context.env;
  const db = env.KOPABOOK_DB;
  const message = String((body && body.message) || "").trim();
  const history = Array.isArray(body && body.history) ? body.history : [];
  if (!message) return { ok: false, reply: "Type a message first.", tools_used: [] };

  try { await ensureAdminAiTables(db); } catch (e) { /* proposals degrade */ }

  // Hard rule, checked before anything else: a chat confirmation word
  // never executes. If a proposal is pending, point at its card.
  if (CONFIRM_WORDS.test(message)) {
    let pending = null;
    try { pending = await getPendingProposal(db, auth.user.id); } catch (e) { pending = null; }
    if (pending) {
      return {
        ok: true,
        reply: `That action is waiting for your confirmation. Chat cannot run it, even when you say yes here. Tap the Confirm button on its card to run it, or tap Cancel on the card to drop it. Waiting proposal: ${pending.summary}`,
        tools_used: [],
        proposal: pending,
      };
    }
  }

  // Deterministic shortcut: "brief me" always runs the full briefing,
  // with or without a model provider.
  if (/brief me/i.test(message)) {
    const pack = await executeReadTool(db, "full_briefing", {});
    return { ok: true, reply: composeBriefingText(pack), tools_used: ["full_briefing"] };
  }

  const hasModel = (deps && typeof deps.generateText === "function") || aiProviderAvailable(env);
  if (!hasModel) {
    if (/\b(daily\s+)?briefing\b/i.test(message)) {
      const pack = await executeReadTool(db, "full_briefing", {});
      return { ok: true, reply: composeDailyText(pack), tools_used: ["full_briefing"] };
    }
    return {
      ok: true,
      reply: "Admin AI is not connected right now. No AI provider is configured, so I can only run the built in briefing. Ask me to brief you and I will pull the live figures.",
      tools_used: [],
    };
  }

  const messages = [{ role: "system", content: systemPromptText() }];
  for (const h of history.slice(-16)) {
    const role = h && h.role === "assistant" ? "assistant" : "user";
    const content = String((h && h.content) || "").trim();
    if (content) messages.push({ role, content: content.slice(0, 4000) });
  }
  messages.push({ role: "user", content: message });

  const toolsUsed = [];
  let lastText = "";
  for (let round = 0; round < 5; round++) {
    let text = "";
    try {
      text = String((await callModel(context, deps, messages)) || "");
    } catch (e) {
      if (!toolsUsed.length) {
        return {
          ok: true,
          reply: "Admin AI is not connected right now. The AI provider did not answer, so I cannot run that yet. Ask me to brief you and I will pull the live figures directly.",
          tools_used: [],
        };
      }
      break;
    }
    lastText = text;
    const call = parseToolCall(text);
    if (!call) {
      const reply = stripToolCalls(text) || "I do not have an answer for that yet. Try asking for a briefing or a specific figure.";
      return { ok: true, reply, tools_used: toolsUsed };
    }
    if (call.error) {
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: `TOOL_RESULT error ${JSON.stringify({ error: call.error })} Reply to the owner in plain text, or call a valid tool.` });
      continue;
    }
    const name = call.name;
    const args = call.args || {};

    // Proposal path: create the card and stop. Never execute here.
    if (Object.prototype.hasOwnProperty.call(PROPOSE_TO_ACTION, name)) {
      toolsUsed.push(name);
      const proposal = await createProposal(context, auth, PROPOSE_TO_ACTION[name], args);
      if (proposal && proposal.error) {
        messages.push({ role: "assistant", content: text });
        messages.push({
          role: "user",
          content: `TOOL_RESULT ${name} ${JSON.stringify({ error: proposal.error, candidates: proposal.candidates || [] })} Tell the owner what is missing or ambiguous in plain text. Do not claim anything was prepared or done.`,
        });
        continue;
      }
      return {
        ok: true,
        reply: "Prepared for your confirmation. " + proposal.summary + " Nothing has changed yet. Tap Confirm on the card to run it, or Cancel to drop it.",
        tools_used: toolsUsed,
        proposal,
      };
    }

    if (!READ_TOOL_NAMES.includes(name)) {
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: `TOOL_RESULT ${name} ${JSON.stringify({ error: "Unknown tool." })} Use only the listed tools.` });
      continue;
    }

    toolsUsed.push(name);
    let result;
    try {
      result = await executeReadTool(db, name, args);
    } catch (e) {
      result = { error: String((e && e.message) || e) };
    }
    messages.push({ role: "assistant", content: text });
    messages.push({ role: "user", content: `TOOL_RESULT ${name} ${JSON.stringify(result).slice(0, 8000)}` });
  }

  const fallback = stripToolCalls(lastText);
  return {
    ok: true,
    reply: fallback || "I checked the available figures but could not finish a clean answer. Try asking for one specific figure, or ask me to brief you.",
    tools_used: toolsUsed,
  };
}
