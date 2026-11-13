import { describe, expect, it, vi } from "vitest";
import { invokeSignalTool } from "./signal-tools.js";
import { captureInvocationContext } from "./invocation-context.js";
import { resolveAuthContext } from "./auth-context.js";
import { createDataSource } from "./data-source.js";
import { createRawDataSource } from "./raw-data.js";

const signalRef = { workspaceId: "10000000-0000-4000-8000-000000000001", scope: "personal",
  citySlug: "synthetic-city", type: "Signal", id: "signal-1" };
const input = { signalRef, classe: "pertinent", reasonCode: "P-DENSITE", reason: "More housing", model: "client-model" };
const parse = (result: Awaited<ReturnType<typeof invokeSignalTool>>) => JSON.parse(result.content[0]!.text);
function fixture(scopes = "immo:read immo:signals:write", accepted = true) {
  const query = vi.fn(async (text: string, values: unknown[]) => ({ rows: text.includes("signal_mcp_read")
    ? [{ state: { version: "v1", current: { classe: "pertinent", source: "ai" }, notes: [] } }]
    : text.includes("signal_mcp_write") ? [{ result: { id: "event-1", validation: values[4] } }] : [{}] }));
  const confirm = vi.fn(async () => accepted);
  const auth = { ...resolveAuthContext({ IMMO_MCP_AUTH_STUB_SCOPES: scopes }), clientId: "verified-client" };
  const ctx = captureInvocationContext({ auth, data: createDataSource({}), raw: createRawDataSource({}), signals: { db: { query }, confirm } });
  return { query, confirm, ctx };
}
describe("MCP signal write guards", () => {
  it("should deny writes without the explicit scope and audit the refusal", async () => {
    const f = fixture("immo:read immo:artifacts:write");
    expect(parse(await invokeSignalTool("classify_signal", input, f.ctx))).toEqual({ error: "scope_denied" });
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(f.query.mock.calls[0]![0]).toContain("signal_mcp_result");
  });
  it("should treat the client boolean only as an elicitation request", async () => {
    const f = fixture(undefined, false);
    expect(parse(await invokeSignalTool("classify_signal", { ...input, humanConfirmed: true }, f.ctx))).toMatchObject({ validation: "auto" });
    expect(f.confirm).toHaveBeenCalledOnce();
    expect(f.confirm.mock.calls[0]![0]).toContain('"version":"v1"');
  });
  it("should count human validation only after accepted elicitation", async () => {
    const f = fixture();
    expect(parse(await invokeSignalTool("classify_signal", { ...input, humanConfirmed: true }, f.ctx))).toMatchObject({ validation: "human" });
    expect(parse(await invokeSignalTool("classify_signal", input, f.ctx))).toMatchObject({ validation: "auto" });
  });
  it("should reject negative feedback without a new class before eliciting", async () => {
    const f = fixture();
    expect(parse(await invokeSignalTool("confirm_classification", { signalRef, model: "client-model", verdict: "down" }, f.ctx)))
      .toEqual({ error: "reclassification_required" });
    expect(f.confirm).not.toHaveBeenCalled();
  });
  it("should reject confirmation when elicitation is declined", async () => {
    const f = fixture(undefined, false);
    expect(parse(await invokeSignalTool("confirm_classification", { signalRef, model: "client-model", verdict: "up" }, f.ctx)))
      .toEqual({ error: "human_confirmation_required" });
  });
  it("should reject identity injection, missing model and oversized notes", async () => {
    const f = fixture();
    for (const args of [{ ...input, clientId: "forged" }, { ...input, model: " " }]) {
      expect(parse(await invokeSignalTool("classify_signal", args, f.ctx))).toEqual({ error: "invalid_signal_command" });
    }
    expect(parse(await invokeSignalTool("annotate_signal", { signalRef, model: "client-model", text: "x".repeat(2001) }, f.ctx)))
      .toEqual({ error: "invalid_signal_command" });
  });
});
