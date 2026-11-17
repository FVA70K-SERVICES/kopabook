// Kopa AI — TOOL_EXECUTORS: tool name -> executor.
// Phase 7.3 split of functions/api/ai/chat.js (was one 4,268-line file).
// Behaviour is unchanged: code moved verbatim; only imports/exports
// were added at the module boundary.
import { execAddExpense, execAddProduct, execDraftDebtorMessage, execGetCustomerBalance, execMarkReminderDone, execRecordCustomerPayment, execRecordSale, execSaveMemory, execSendDebtorMessage, execSetReminder } from "./_executors.js";
import { execCreateProjectPlan, execProjectAddMilestone, execProjectCompleteMilestone, execProjectInvite, execProjectRecordTransaction, execProjectReport, execProjectUpdate } from "./_projects.js";

export const TOOL_EXECUTORS = {
  record_sale: execRecordSale,
  add_expense: execAddExpense,
  add_product: execAddProduct,
  record_customer_payment: execRecordCustomerPayment,
  set_reminder: execSetReminder,
  get_customer_balance: execGetCustomerBalance,
  draft_debtor_message: execDraftDebtorMessage,
  send_debtor_message: execSendDebtorMessage,
  mark_reminder_done: execMarkReminderDone,
  save_memory: execSaveMemory,
  create_project_plan: execCreateProjectPlan,
  project_add_milestone: execProjectAddMilestone,
  project_complete_milestone: execProjectCompleteMilestone,
  project_record_transaction: execProjectRecordTransaction,
  project_update: execProjectUpdate,
  project_invite: execProjectInvite,
  project_report: execProjectReport,
};
