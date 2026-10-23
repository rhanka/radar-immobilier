import { describe, expect, it } from "vitest";
import { STATUS_TOOL_CONTRACTS } from "./tool-contracts.js";

const commandKey = "11111111-2222-4333-8444-555555555555";
const receipt = { commandKey, replayed: true, stateKind: "command_snapshot" };
const target = { type: "Lot", authority: "lot_versions", citySlug: "longueuil", canonicalId: "L1" };
const item = { target, mode: "real", events: [], heads: [], appended: false };

describe("command response contracts", () => {
  it.each([
    ["command_signal_facet", { ...receipt, event: null }],
    ["command_lot_facet", { ...receipt, events: [], heads: [], appended: false }],
    ["batch_lot_facet_commands", { ...receipt, targets: 1, changed: 0, unchanged: 1,
      eventsAppended: 0, items: [item] }],
  ] as const)("should accept %s historical snapshots and reject current-state claims", (name, output) => {
    const schema = STATUS_TOOL_CONTRACTS[name].output;
    expect(schema.safeParse(output).success).toBe(true);
    expect(schema.safeParse({ ...output, stateKind: "current" }).success).toBe(false);
    expect(schema.safeParse({ ...output, commandKey: "bad" }).success).toBe(false);
    expect(schema.safeParse({ ...output, actor: "private" }).success).toBe(false);
  });

  it("should reject partial, duplicate and inconsistent atomic batch summaries", () => {
    const output = { ...receipt, targets: 1, changed: 0, unchanged: 1, eventsAppended: 0, items: [item] };
    const schema = STATUS_TOOL_CONTRACTS.batch_lot_facet_commands.output;
    for (const patch of [{ targets: 2 }, { changed: 1 }, { eventsAppended: 1 }, { items: [] },
      { targets: 2, unchanged: 2, items: [item, item] }]) {
      expect(schema.safeParse({ ...output, ...patch }).success).toBe(false);
    }
  });
});
