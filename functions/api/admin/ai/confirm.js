// /api/admin/ai/confirm: platform admin only.
// THE ONLY execution path for Admin AI actions. The chat endpoint can
// prepare proposals but can never run them, and a typed or spoken yes
// in chat does nothing. A proposal runs exactly once, here, when the
// owner taps Confirm on its card and this endpoint receives
// decision "confirm" for that proposal.
import { json, getAuthContext, requireAuth } from "../../_utils.js";
import { requirePlatformAdmin } from "../overview.js";
import { ensureAdminAiTables, getProposal, executeProposal, cancelProposal } from "./_actions.js";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const adminDenied = await requirePlatformAdmin(context, auth);
    if (adminDenied) return adminDenied;

    const db = context.env.KOPABOOK_DB;
    await ensureAdminAiTables(db);

    const body = await context.request.json().catch(() => ({}));
    const proposalId = String(body.proposal_id || body.proposalId || body.id || "").trim();
    const decision = String(body.decision || "").toLowerCase().trim();
    if (!proposalId) return json({ ok: false, message: "proposal_id is required." }, 400);
    if (decision !== "confirm" && decision !== "cancel") {
      return json({ ok: false, message: "decision must be confirm or cancel." }, 400);
    }

    const proposal = await getProposal(db, proposalId);
    if (!proposal || Number(proposal.admin_user_id) !== Number(auth.user.id)) {
      return json({ ok: false, message: "Proposal not found." }, 404);
    }

    if (decision === "cancel") {
      const res = await cancelProposal(context, auth, proposal);
      return json({ ok: res.ok, message: res.message, status: res.status }, res.ok ? 200 : 400);
    }

    const res = await executeProposal(context, auth, proposal);
    return json({ ok: res.ok, message: res.message, status: res.status }, res.ok ? 200 : 400);
  } catch (error) {
    return json({ ok: false, message: "Could not resolve the proposal.", error: String(error) }, 500);
  }
}
