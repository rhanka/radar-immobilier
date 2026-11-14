import { createHash } from "node:crypto";
import type { InvocationContext } from "./invocation-context.js";
import { isSignalWrite } from "./signal-contract.js";

export interface SignalAttempt { tool: string; inputHash: string; model: string | null }
export function signalAttempt(tool: string, args: Record<string, unknown>): SignalAttempt | undefined {
  return isSignalWrite(tool) ? { tool, model: typeof args.model === "string" ? args.model.slice(0, 256) : null,
    inputHash: createHash("sha256").update(JSON.stringify(args)).digest("hex") } : undefined;
}
/** Includes pre-dispatch scope/schema/account refusals; contains no raw input. */
export function auditSignalResult(ctx: InvocationContext, attempt: SignalAttempt | undefined, outcome: string): void {
  if (!attempt) return;
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), kind: "immo-mcp.signal-write",
    sub: ctx.auth.sub, clientId: ctx.auth.clientId ?? null, ...attempt, result: outcome })}\n`);
}
