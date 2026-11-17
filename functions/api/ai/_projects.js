// Kopa AI — Project tools: helpers and project executors.
// Phase 7.3 split of functions/api/ai/chat.js (was one 4,268-line file).
// Behaviour is unchanged: code moved verbatim; only imports/exports
// were added at the module boundary.
import { onRequestPatch as updateProjectEndpoint, onRequestDelete as deleteProjectEndpoint } from "../projects/[id].js";
import { PROJECT_TYPES } from "../projects/_lib.js";
import { onRequestPost as createProjectEndpoint } from "../projects/index.js";
import { onRequestPost as createProjectInviteEndpoint } from "../projects/invites.js";
import { onRequestPost as addProjectMilestoneEndpoint, onRequestPatch as updateProjectMilestoneEndpoint } from "../projects/milestones.js";
import { onRequestGet as projectReportEndpoint } from "../projects/report.js";
import { onRequestPost as recordProjectTransactionEndpoint } from "../projects/transactions.js";
import { firstMissingProjectField, fmt } from "./_gating.js";

function projectParam(params, ...keys) {
  for (const key of keys) {
    if (params && params[key] !== undefined && params[key] !== null && String(params[key]).trim() !== "") return params[key];
  }
  return "";
}

function cleanProjectText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function roundProjectMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function validProjectDate(value) {
  if (!value) return true;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text + "T00:00:00Z"));
}

async function callProjectEndpoint(context, handler, options = {}) {
  const headers = new Headers(context.request.headers);
  headers.delete("content-length");
  let body;
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }
  const request = new Request(new URL(options.path || "/api/projects", context.request.url), {
    method: options.method || "GET",
    headers,
    body,
  });
  const childContext = { ...context, request, params: options.params || {} };
  const response = await handler(childContext);
  let data = null;
  try { data = await response.json(); } catch (e) { data = null; }
  if (!response.ok || !data || data.ok !== true) {
    return {
      ok: false,
      status: response.status,
      message: (data && data.message) || `The project service returned ${response.status}.`,
      data,
    };
  }
  return { ok: true, status: response.status, data };
}

async function matchBusinessProjects(db, businessId, queryRaw) {
  const query = String(queryRaw || "").trim();
  if (!query) return [];
  if (/^\d+$/.test(query)) {
    const row = await db.prepare(`SELECT * FROM projects WHERE id = ? AND business_id = ? LIMIT 1`)
      .bind(Number(query), businessId).first();
    return row ? [row] : [];
  }
  const exact = await db.prepare(
    `SELECT * FROM projects WHERE business_id = ? AND lower(name) = lower(?) ORDER BY id DESC`
  ).bind(businessId, query).all();
  if ((exact.results || []).length) return exact.results;
  const partial = await db.prepare(
    `SELECT * FROM projects WHERE business_id = ? AND instr(lower(name), lower(?)) > 0 ORDER BY id DESC LIMIT 10`
  ).bind(businessId, query).all();
  return partial.results || [];
}

export async function resolveBusinessProject(db, auth, params) {
  const query = projectParam(params, "project", "project_name", "projectName", "project_id", "projectId", "id");
  if (!query) return { clarification: "Which project do you mean? Give me its exact name." };
  const matches = await matchBusinessProjects(db, auth.business.id, query);
  if (!matches.length) return { clarification: `I could not find a project called "${query}" in this business.` };
  if (matches.length > 1) {
    return { clarification: `"${query}" matches more than one project: ${matches.map((p) => `#${p.id} ${p.name}`).join(", ")}. Which one do you mean?` };
  }
  return { project: matches[0] };
}

async function matchProjectMilestones(db, projectId, queryRaw) {
  const query = String(queryRaw || "").trim();
  if (!query) return [];
  if (/^\d+$/.test(query)) {
    const row = await db.prepare(`SELECT * FROM project_milestones WHERE id = ? AND project_id = ? LIMIT 1`)
      .bind(Number(query), projectId).first();
    return row ? [row] : [];
  }
  const exact = await db.prepare(
    `SELECT * FROM project_milestones WHERE project_id = ? AND lower(title) = lower(?) ORDER BY id ASC`
  ).bind(projectId, query).all();
  if ((exact.results || []).length) return exact.results;
  const partial = await db.prepare(
    `SELECT * FROM project_milestones WHERE project_id = ? AND instr(lower(title), lower(?)) > 0 ORDER BY id ASC LIMIT 10`
  ).bind(projectId, query).all();
  return partial.results || [];
}

async function resolveProjectMilestone(db, project, params) {
  const query = projectParam(params, "milestone", "milestone_name", "milestoneName", "milestone_id", "milestoneId", "id");
  if (!query) return { clarification: `Which milestone in ${project.name} should I update?` };
  const matches = await matchProjectMilestones(db, project.id, query);
  if (!matches.length) return { clarification: `I could not find a milestone called "${query}" in ${project.name}.` };
  if (matches.length > 1) {
    return { clarification: `"${query}" matches more than one milestone in ${project.name}: ${matches.map((m) => `#${m.id} ${m.title}`).join(", ")}. Which one do you mean?` };
  }
  return { milestone: matches[0] };
}

function requireProjectOwnerPartner(auth, action) {
  if (["owner", "partner"].includes(auth.business && auth.business.role)) return null;
  return `Only the project owner or a partner can ${action}.`;
}

function normalizeProjectMilestones(params) {
  const raw = params && (params.milestones || params.steps);
  // Round 6: no milestones yet is a plan with zero milestones, not an
  // error. The executor used to ask "What milestones should the project
  // plan include, in order?" whenever none were supplied, so the
  // deterministic interview (name, type, goal, per the system prompt's
  // own project interview) could never reach a dry-run proposal: the
  // model path only worked because the model drafts a milestone list
  // from the goal, and the fast path must never invent milestones.
  // The proposal itself says "with 0 milestones", so the owner sees
  // it before Confirm, and milestones can be added afterwards with
  // project_add_milestone. Supplied milestones are still validated
  // exactly as before, and the 50 cap is unchanged.
  if (!Array.isArray(raw) || !raw.length) {
    return { milestones: [] };
  }
  if (raw.length > 50) return { error: "That project plan has too many milestones. Keep it to 50 or fewer." };
  const milestones = [];
  for (let i = 0; i < raw.length; i++) {
    const item = typeof raw[i] === "string" ? { title: raw[i] } : (raw[i] || {});
    const title = cleanProjectText(item.title || item.name, 200);
    if (!title) return { error: `Milestone ${i + 1} needs a title.` };
    const dueDate = item.due_date || item.dueDate || null;
    if (!validProjectDate(dueDate)) return { error: `Milestone "${title}" has an invalid due date. Use YYYY-MM-DD.` };
    milestones.push({
      title,
      description: cleanProjectText(item.description, 1000),
      dueDate: dueDate ? String(dueDate).slice(0, 10) : null,
    });
  }
  return { milestones };
}

function normalizeProjectBudgetLines(params) {
  const raw = params && (params.budget_lines || params.budgetLines || params.planned_budget || params.plannedBudget);
  const lines = [];
  if (raw !== undefined && raw !== null && raw !== "") {
    if (!Array.isArray(raw)) return { error: "Give the planned budget as a list of cost lines, each with a label and amount." };
    if (raw.length > 50) return { error: "That project plan has too many budget lines. Keep it to 50 or fewer." };
    for (let i = 0; i < raw.length; i++) {
      const item = typeof raw[i] === "string" ? { label: raw[i] } : (raw[i] || {});
      const label = cleanProjectText(item.label || item.category || item.name || item.description, 100);
      const amount = Number(item.amount ?? item.value ?? item.cost);
      if (!label) return { error: `Budget line ${i + 1} needs a label.` };
      if (!Number.isFinite(amount) || amount < 0) return { error: `What amount should I plan for "${label}"?` };
      lines.push({ label, amount: roundProjectMoney(amount) });
    }
  }
  const linesTotal = roundProjectMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  const explicitRaw = params && (params.budget ?? params.total_budget ?? params.totalBudget);
  let budget = linesTotal;
  if (explicitRaw !== undefined && explicitRaw !== null && explicitRaw !== "") {
    const explicit = Number(explicitRaw);
    if (!Number.isFinite(explicit) || explicit < 0) return { error: "The project budget must be a valid non-negative amount." };
    budget = roundProjectMoney(explicit);
    if (lines.length && budget !== linesTotal) {
      return { error: "The project budget total does not match the planned budget lines. Which total should I use?" };
    }
  }
  return { lines, budget };
}

function plannedProjectDescription(goal, lines, currency) {
  let description = String(goal || "").trim();
  if (lines.length) {
    description += "\n\nPlanned budget lines:\n" + lines.map((line) => `- ${line.label}: ${fmt(line.amount, currency)}`).join("\n");
  }
  return description;
}

export async function execCreateProjectPlan(context, db, auth, params, currency, opts) {
  const name = cleanProjectText(projectParam(params, "name", "project", "project_name", "projectName"), 200);
  const type = String(projectParam(params, "type", "project_type", "projectType") || "").trim().toLowerCase();
  const goal = cleanProjectText(projectParam(params, "goal", "description", "objective"), 2000);
  // Interview gate, shared with local tests: no action while name, type,
  // or goal is missing. Each missing field asks one short question.
  const missingField = firstMissingProjectField(name, type, goal);
  if (missingField === "name") return { ok: false, clarification: "What should we call the project?" };
  if (missingField === "type") return { ok: false, clarification: `What type of project is "${name}"? Choose one: ${PROJECT_TYPES.join(", ")}.` };
  if (missingField === "goal") return { ok: false, clarification: `What is the goal of "${name}"? Tell me what success should look like.` };

  const milestoneResult = normalizeProjectMilestones(params || {});
  if (milestoneResult.error) return { ok: false, clarification: milestoneResult.error };
  const budgetResult = normalizeProjectBudgetLines(params || {});
  if (budgetResult.error) return { ok: false, clarification: budgetResult.error };

  const startDate = projectParam(params, "start_date", "startDate") || null;
  const endDate = projectParam(params, "end_date", "endDate") || null;
  if (!validProjectDate(startDate) || !validProjectDate(endDate)) {
    return { ok: false, clarification: "Project dates must use YYYY-MM-DD." };
  }
  if (startDate && endDate && String(endDate).slice(0, 10) < String(startDate).slice(0, 10)) {
    return { ok: false, clarification: "The project end date is before its start date. Which dates are correct?" };
  }
  const description = plannedProjectDescription(goal, budgetResult.lines, currency);
  if (description.length > 2000) {
    return { ok: false, clarification: "That project goal and budget plan are too long to store together. Shorten the goal or budget lines." };
  }

  if (opts && opts.dryRun) {
    const lines = [
      `Project: ${name}`,
      `Type: ${type}`,
      `Goal: ${goal}`,
      `Planned budget: ${fmt(budgetResult.budget, currency)}`,
    ];
    for (const line of budgetResult.lines) lines.push(`Budget: ${line.label}: ${fmt(line.amount, currency)}`);
    lines.push("Milestones, in order:");
    milestoneResult.milestones.forEach((m, i) => {
      lines.push(`${i + 1}. ${m.title}${m.dueDate ? ` (due ${m.dueDate})` : ""}${m.description ? `: ${m.description}` : ""}`);
    });
    if (startDate) lines.push(`Start date: ${String(startDate).slice(0, 10)}`);
    if (endDate) lines.push(`End date: ${String(endDate).slice(0, 10)}`);
    return {
      ok: true,
      proposal: {
        summary: `Create project "${name}" (${type}) with ${milestoneResult.milestones.length} milestones and a planned budget of ${fmt(budgetResult.budget, currency)}.`,
        lines,
      },
    };
  }

  const created = await callProjectEndpoint(context, createProjectEndpoint, {
    method: "POST",
    path: "/api/projects",
    body: {
      name,
      type,
      description,
      budget: budgetResult.budget,
      startDate: startDate ? String(startDate).slice(0, 10) : null,
      endDate: endDate ? String(endDate).slice(0, 10) : null,
    },
  });
  if (!created.ok) return { ok: false, clarification: created.message };
  const projectId = created.data.id;

  for (const milestone of milestoneResult.milestones) {
    const added = await callProjectEndpoint(context, addProjectMilestoneEndpoint, {
      method: "POST",
      path: "/api/projects/milestones",
      body: {
        projectId,
        title: milestone.title,
        description: milestone.description,
        dueDate: milestone.dueDate,
      },
    });
    if (!added.ok) {
      const rollback = await callProjectEndpoint(context, deleteProjectEndpoint, {
        method: "DELETE",
        path: `/api/projects/${projectId}`,
        params: { id: String(projectId) },
      }).catch(() => ({ ok: false }));
      return {
        ok: false,
        clarification: rollback.ok
          ? `I could not add the milestone "${milestone.title}", so I removed the incomplete project and changed nothing. ${added.message}`
          : `I created ${name}, but could not add the milestone "${milestone.title}". The incomplete project could not be removed automatically, so please check Projects before trying again. ${added.message}`,
      };
    }
  }

  return {
    ok: true,
    summary: `Created project "${name}" (${type}) with ${milestoneResult.milestones.length} milestones in order and a planned budget of ${fmt(budgetResult.budget, currency)}. Project ID ${projectId}.`,
  };
}

export async function execProjectAddMilestone(context, db, auth, params, currency, opts) {
  const resolved = await resolveBusinessProject(db, auth, params || {});
  if (resolved.clarification) return { ok: false, clarification: resolved.clarification };
  const project = resolved.project;
  const title = cleanProjectText(projectParam(params, "title", "milestone", "milestone_name", "milestoneName"), 200);
  if (!title) return { ok: false, clarification: `What milestone should I add to ${project.name}?` };
  const description = cleanProjectText(params && params.description, 1000);
  const dueDate = projectParam(params, "due_date", "dueDate") || null;
  if (!validProjectDate(dueDate)) return { ok: false, clarification: "The milestone due date must use YYYY-MM-DD." };
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Add milestone "${title}" to project "${project.name}".`,
        lines: [
          `Project: ${project.name} (#${project.id})`,
          `Milestone: ${title}`,
          ...(description ? [`Details: ${description}`] : []),
          ...(dueDate ? [`Due date: ${String(dueDate).slice(0, 10)}`] : []),
        ],
      },
    };
  }
  const added = await callProjectEndpoint(context, addProjectMilestoneEndpoint, {
    method: "POST",
    path: "/api/projects/milestones",
    body: { projectId: project.id, title, description, dueDate: dueDate ? String(dueDate).slice(0, 10) : null },
  });
  if (!added.ok) return { ok: false, clarification: added.message };
  return { ok: true, summary: `Added milestone "${title}" to project "${project.name}".` };
}

export async function execProjectCompleteMilestone(context, db, auth, params, currency, opts) {
  const resolved = await resolveBusinessProject(db, auth, params || {});
  if (resolved.clarification) return { ok: false, clarification: resolved.clarification };
  const found = await resolveProjectMilestone(db, resolved.project, params || {});
  if (found.clarification) return { ok: false, clarification: found.clarification };
  const milestone = found.milestone;
  if (milestone.status === "done") {
    return { ok: false, clarification: `"${milestone.title}" in ${resolved.project.name} is already marked done.` };
  }
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Mark milestone "${milestone.title}" as done in project "${resolved.project.name}".`,
        lines: [
          `Project: ${resolved.project.name} (#${resolved.project.id})`,
          `Milestone: ${milestone.title} (#${milestone.id})`,
          "New status: done",
        ],
      },
    };
  }
  const updated = await callProjectEndpoint(context, updateProjectMilestoneEndpoint, {
    method: "PATCH",
    path: "/api/projects/milestones",
    body: { id: milestone.id, status: "done" },
  });
  if (!updated.ok) return { ok: false, clarification: updated.message };
  return { ok: true, summary: `Marked milestone "${milestone.title}" as done in project "${resolved.project.name}".` };
}

export async function execProjectRecordTransaction(context, db, auth, params, currency, opts) {
  const resolved = await resolveBusinessProject(db, auth, params || {});
  if (resolved.clarification) return { ok: false, clarification: resolved.clarification };
  const project = resolved.project;
  const kind = String(projectParam(params, "kind", "transaction_type", "transactionType") || "").trim().toLowerCase();
  if (!["income", "expense"].includes(kind)) {
    return { ok: false, clarification: `Was that money coming in (income) or going out (expense) for ${project.name}?` };
  }
  const amount = Number(params && params.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, clarification: `How much was the project ${kind}? I need an amount greater than zero.` };
  }
  const description = cleanProjectText(params && params.description, 500);
  if (!description) return { ok: false, clarification: `What was the project ${kind} for? Give me a short description.` };
  const category = cleanProjectText(params && params.category, 100);
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Record project ${kind} of ${fmt(amount, currency)} for "${project.name}": ${description}.`,
        lines: [
          `Project: ${project.name} (#${project.id})`,
          `Type: ${kind}`,
          `Amount: ${fmt(amount, currency)}`,
          `Description: ${description}`,
          ...(category ? [`Category: ${category}`] : []),
        ],
      },
    };
  }
  const recorded = await callProjectEndpoint(context, recordProjectTransactionEndpoint, {
    method: "POST",
    path: "/api/projects/transactions",
    body: { projectId: project.id, kind, amount: roundProjectMoney(amount), category, description },
  });
  if (!recorded.ok) return { ok: false, clarification: recorded.message };
  return { ok: true, summary: `Recorded project ${kind} of ${fmt(amount, currency)} for "${project.name}": ${description}.` };
}

export async function execProjectUpdate(context, db, auth, params, currency, opts) {
  const ownerDenied = requireProjectOwnerPartner(auth, "rename or close a project");
  if (ownerDenied) return { ok: false, clarification: ownerDenied };
  const resolved = await resolveBusinessProject(db, auth, params || {});
  if (resolved.clarification) return { ok: false, clarification: resolved.clarification };
  const project = resolved.project;
  const newName = cleanProjectText(projectParam(params, "new_name", "newName", "rename_to", "renameTo"), 200);
  const statusText = String(projectParam(params, "status", "action") || "").trim().toLowerCase();
  let status = null;
  if (["completed", "complete", "closed", "close", "done"].includes(statusText)) status = "completed";
  else if (["active", "reopen", "reopened"].includes(statusText)) status = "active";
  else if (statusText) return { ok: false, clarification: "I can close a project by marking it completed, or reopen it as active. Which should I do?" };
  if (!newName && !status) {
    return { ok: false, clarification: `What should I change on ${project.name}: its name, or close it by marking it completed?` };
  }
  if (newName && newName === project.name && (!status || status === project.status)) {
    return { ok: false, clarification: `${project.name} already has that name and status.` };
  }
  if (!newName && status && status === project.status) {
    return { ok: false, clarification: `${project.name} is already ${status}.` };
  }
  const body = {};
  if (newName) body.name = newName;
  if (status) body.status = status;
  if (opts && opts.dryRun) {
    const changes = [];
    if (newName) changes.push(`Name: ${project.name} -> ${newName}`);
    if (status) changes.push(`Status: ${project.status} -> ${status}`);
    return {
      ok: true,
      proposal: {
        summary: `Update project "${project.name}": ${changes.join("; ")}.`,
        lines: [`Project: ${project.name} (#${project.id})`, ...changes],
      },
    };
  }
  const updated = await callProjectEndpoint(context, updateProjectEndpoint, {
    method: "PATCH",
    path: `/api/projects/${project.id}`,
    params: { id: String(project.id) },
    body,
  });
  if (!updated.ok) return { ok: false, clarification: updated.message };
  return { ok: true, summary: `Updated project "${project.name}"${newName ? ` to "${newName}"` : ""}${status ? ` and set its status to ${status}` : ""}.` };
}

export async function execProjectInvite(context, db, auth, params, currency, opts) {
  const ownerDenied = requireProjectOwnerPartner(auth, "invite people to a project");
  if (ownerDenied) return { ok: false, clarification: ownerDenied };
  const resolved = await resolveBusinessProject(db, auth, params || {});
  if (resolved.clarification) return { ok: false, clarification: resolved.clarification };
  const project = resolved.project;
  const identifier = cleanProjectText(projectParam(params, "email", "identifier", "username"), 200);
  if (!identifier) return { ok: false, clarification: `What email should I invite to ${project.name}?` };
  const role = String(projectParam(params, "role") || "contributor").trim().toLowerCase() === "viewer" ? "viewer" : "contributor";
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Create a ${role} invite for ${identifier} to project "${project.name}".`,
        lines: [
          `Project: ${project.name} (#${project.id})`,
          `Invite: ${identifier}`,
          `Role: ${role}`,
        ],
      },
    };
  }
  const created = await callProjectEndpoint(context, createProjectInviteEndpoint, {
    method: "POST",
    path: "/api/projects/invites",
    body: { projectId: project.id, identifier, role },
  });
  if (!created.ok) return { ok: false, clarification: created.message };
  return {
    ok: true,
    summary: `Created a ${role} invite for ${identifier} to project "${project.name}". Share this join link with them: ${created.data.joinLink}`,
  };
}

export async function execProjectReport(context, db, auth, params, currency) {
  const query = projectParam(params, "project", "project_name", "projectName", "project_id", "projectId", "id");
  let projectId = null;
  if (query && /^\d+$/.test(String(query))) {
    projectId = Number(query);
  } else if (query) {
    const byId = new Map();
    for (const p of await matchBusinessProjects(db, auth.business.id, query)) byId.set(Number(p.id), p);
    const invited = await db.prepare(
      `SELECT p.* FROM projects p JOIN project_members pm ON pm.project_id = p.id
       WHERE pm.user_id = ? AND (lower(p.name) = lower(?) OR instr(lower(p.name), lower(?)) > 0)
       ORDER BY CASE WHEN lower(p.name) = lower(?) THEN 0 ELSE 1 END, p.id DESC LIMIT 10`
    ).bind(auth.user.id, query, query, query).all();
    for (const p of invited.results || []) byId.set(Number(p.id), p);
    const matches = [...byId.values()];
    if (!matches.length) return { ok: false, clarification: `I could not find a project called "${query}" that you can access.` };
    if (matches.length > 1) {
      return { ok: false, clarification: `"${query}" matches more than one accessible project: ${matches.map((p) => `#${p.id} ${p.name}`).join(", ")}. Which one do you mean?` };
    }
    projectId = Number(matches[0].id);
  } else {
    const visible = (await buildVisibleProjectIds(db, auth));
    if (visible.length === 1) projectId = visible[0];
    else if (!visible.length) return { ok: false, clarification: "I could not find any project you can access." };
    else return { ok: false, clarification: "Which project should I report on? Give me its exact name." };
  }

  const report = await callProjectEndpoint(context, projectReportEndpoint, {
    method: "GET",
    path: `/api/projects/report?projectId=${encodeURIComponent(projectId)}`,
  });
  if (!report.ok) return { ok: false, clarification: report.message };
  const project = report.data.project || {};
  const totals = report.data.totals || {};
  return {
    ok: true,
    summary: `${project.name || "That project"} (${project.type || "custom"}, ${project.status || "active"}) has received ${fmt(totals.totalIncome, currency)} in income and recorded ${fmt(totals.totalExpense, currency)} in expenses, leaving a balance of ${fmt(totals.balance, currency)}. Milestones are ${Number(totals.milestonesDone) || 0} of ${Number(totals.milestonesTotal) || 0} done. Its planned budget is ${fmt(project.budget, currency)}.`,
  };
}

async function buildVisibleProjectIds(db, auth) {
  const ids = new Set();
  const own = await db.prepare(`SELECT id FROM projects WHERE business_id = ?`).bind(auth.business.id).all();
  for (const row of own.results || []) ids.add(Number(row.id));
  const invited = await db.prepare(`SELECT project_id AS id FROM project_members WHERE user_id = ?`).bind(auth.user.id).all();
  for (const row of invited.results || []) ids.add(Number(row.id));
  return [...ids];
}
