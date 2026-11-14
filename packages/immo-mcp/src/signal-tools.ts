import { createHash } from "node:crypto";
import type { InvocationContext } from "./invocation-context.js";
import type { ToolTextResult } from "./tool-handlers.js";
import { CLASS_DEFINITIONS, REASON_DEFINITIONS } from "./class-reasons.js";
import { signalSchemas, isSignalWrite, SIGNAL_WRITE_SCOPE, type SignalTool } from "./signal-contract.js";
import { readSignal } from "./signal-store.js";

const result = (value: Record<string, unknown>): ToolTextResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }], ...(value.error ? { isError: true } : {}),
});
export async function invokeSignalTool(name: SignalTool, input: Record<string, unknown>, ctx: InvocationContext) {
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const audit = async (error: string) => {
    if (isSignalWrite(name) && ctx.signals && ctx.auth.clientId) await ctx.signals.db.query(
      "SELECT signal_mcp_result($1,$2,$3,$4,$5,$6::jsonb)",
      [ctx.auth.sub, ctx.auth.clientId, typeof input.model === "string" ? input.model : null, name, hash, JSON.stringify({ error })]);
    return result({ error });
  };
  if (!ctx.auth.scopes.includes(isSignalWrite(name) ? SIGNAL_WRITE_SCOPE : "immo:read")) return audit("scope_denied");
  const parsed = signalSchemas[name].safeParse(input);
  if (!parsed.success) return audit("invalid_signal_command");
  if (!ctx.signals) return result({ error: "signal_binding_unavailable" });
  if (name === "list_class_reasons") {
    const codes = await ctx.signals.db.query("SELECT code,verdict FROM facet_reason_codes WHERE profile_id=$1 ORDER BY code", ["immo-steve-2026-09"]);
    return result({ classes: CLASS_DEFINITIONS, reasons: codes.rows.map((row) => ({ ...row,
      classe: row.verdict === "non_pertinent" ? "ecarte" : row.verdict, definition: REASON_DEFINITIONS[String(row.code)] ?? null })) });
  }
  const body = parsed.data as Record<string, unknown>;
  const state = await readSignal(ctx.signals.db, ctx.auth.sub, body.signalRef);
  if (state.error) return isSignalWrite(name) ? audit(String(state.error)) : result(state);
  if (name === "get_signal_classification") return result(state);
  if (!ctx.auth.clientId) return audit("verified_client_required");
  const current = state.current as Record<string, unknown> | null;
  if (name === "confirm_classification" && body.verdict === "down" && (!body.newClasse
    || body.newClasse === "non_classe" || body.newClasse === current?.classe || !body.reasonCode || !body.reason)) {
    return audit("reclassification_required");
  }
  if (name === "confirm_classification" && body.verdict === "up"
    && (body.newClasse !== undefined || body.reasonCode !== undefined || body.reason !== undefined)) return audit("invalid_positive_feedback");
  let accepted = false;
  if (name === "confirm_classification" || body.humanConfirmed === true) {
    try { accepted = await ctx.signals.confirm?.(JSON.stringify({ tool: name, proposal: body, current, version: state.version })) === true; }
    catch { accepted = false; }
  }
  if (name === "confirm_classification" && !accepted) return audit("human_confirmation_required");
  const saved = await ctx.signals.db.query("SELECT signal_mcp_write($1,$2,$3,$4::jsonb,$5,$6,$7) AS result",
    [ctx.auth.sub, ctx.auth.clientId, name, JSON.stringify({ ...body, pendingHuman: accepted }), "auto", state.version, hash]);
  return result(saved.rows[0]?.result as Record<string, unknown>);
}
export const SIGNAL_TOOL_HANDLERS = Object.fromEntries(Object.keys(signalSchemas).map((name) => [name,
  (args: Record<string, unknown>, ctx: InvocationContext) => invokeSignalTool(name as SignalTool, args, ctx)]));
