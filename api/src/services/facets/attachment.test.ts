/**
 * 6H attachment input guard: operator references arrive as arguments, the
 * guard rejects malformed batches before any database work. Synthetic ids.
 */
import { describe, expect, it } from "vitest";
import { assertAttachmentInput, type AttachmentInput } from "./attachment-input.js";
import { ScopeError } from "./scope.js";

const account = "22222222-2222-2222-2222-222222222222";
const workspace = "11111111-1111-1111-1111-111111111111";

function input(overrides: Partial<AttachmentInput> = {}): AttachmentInput {
  return {
    entries: [{ accountId: account, workspaceId: workspace }],
    actorAccountId: account,
    reason: "operator attachment",
    ...overrides,
  };
}

describe("assertAttachmentInput", () => {
  it("accepts a well-formed operator batch", () => {
    expect(() => assertAttachmentInput(input())).not.toThrow();
  });

  it("rejects empty and oversized batches", () => {
    expect(() => assertAttachmentInput(input({ entries: [] }))).toThrowError(ScopeError);
    const entries = Array.from({ length: 501 }, () => ({ accountId: account, workspaceId: workspace }));
    expect(() => assertAttachmentInput(input({ entries }))).toThrowError(ScopeError);
  });

  it("rejects malformed references without touching the database", () => {
    expect(() => assertAttachmentInput(input({
      entries: [{ accountId: "not-a-uuid", workspaceId: workspace }],
    }))).toThrowError("invalid_attachment_command");
    expect(() => assertAttachmentInput(input({ actorAccountId: "actor" })))
      .toThrowError("invalid_attachment_command");
  });

  it("rejects missing or oversized reasons", () => {
    expect(() => assertAttachmentInput(input({ reason: "" }))).toThrowError(ScopeError);
    expect(() => assertAttachmentInput(input({ reason: "x".repeat(513) }))).toThrowError(ScopeError);
  });
});
