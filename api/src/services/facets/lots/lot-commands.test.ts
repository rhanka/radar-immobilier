/**
 * 6J command digest: versioned, deterministic, batch-complete.
 * Synthetic commands only; no database, no operational data.
 */
import { describe, expect, it } from "vitest";
import {
  lotCommandDigest,
  type LotBatchCommand,
  type LotCommand,
} from "./lot-commands.js";

const target = {
  type: "Lot",
  authority: "lot_versions",
  citySlug: "synthetic-6j-city",
  canonicalId: "lot-canonical-syn-6j-01",
} as const;

const version = {
  lot_version_id: "6a000000-0000-4000-8000-0000000000aa",
  fingerprint: "a".repeat(64),
} as const;

function single(overrides: Partial<LotCommand> = {}): LotCommand {
  return {
    contract_version: "lot-facets-v1",
    command_key: "6a000000-0000-4000-8000-000000000010",
    mode: "real",
    target: { ...target },
    displayed_version: { ...version },
    expected_head_id: null,
    mutation: { action: "select", basket_id: "synthetic-historical-favorites" },
    ...overrides,
  };
}

describe("6J lot command digest", () => {
  it("should pin the contract version and stay deterministic", () => {
    const first = lotCommandDigest("workspace", "single", "workspace-id", single());
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(lotCommandDigest("workspace", "single", "workspace-id", single())).toBe(first);
  });

  it("should separate scopes, families, workspaces, and modes", () => {
    const base = lotCommandDigest("workspace", "single", "workspace-id", single());
    expect(lotCommandDigest("personal", "single", "workspace-id", single())).not.toBe(base);
    expect(lotCommandDigest("workspace", "batch", "workspace-id", single())).not.toBe(base);
    expect(lotCommandDigest("workspace", "single", "other-workspace", single())).not.toBe(base);
    expect(lotCommandDigest("workspace", "single", "workspace-id",
      single({ mode: "simulation" }))).not.toBe(base);
  });

  it("should cover expected heads, versions, reasons, and payloads", () => {
    const base = lotCommandDigest("workspace", "single", "workspace-id", single());
    expect(lotCommandDigest("workspace", "single", "workspace-id",
      single({ expected_head_id: "6a000000-0000-4000-8000-000000000011" }))).not.toBe(base);
    expect(lotCommandDigest("workspace", "single", "workspace-id",
      single({ displayed_version: { ...version, fingerprint: "b".repeat(64) } }))).not.toBe(base);
    expect(lotCommandDigest("workspace", "single", "workspace-id",
      single({ mutation: { action: "deselect", basket_id: "synthetic-historical-favorites" } })))
      .not.toBe(base);
  });

  it("should digest canonically spelled prices identically", () => {
    const canonical = lotCommandDigest("workspace", "single", "workspace-id", single({
      mutation: { action: "set_market", status: "en_vente",
        asking_price: "10.00", listing_url: null },
    }));
    expect(lotCommandDigest("workspace", "single", "workspace-id", single({
      mutation: { action: "set_market", status: "en_vente",
        asking_price: "0010.0", listing_url: null },
    }))).toBe(canonical);
    expect(lotCommandDigest("workspace", "single", "workspace-id", single({
      mutation: { action: "set_market", status: "en_vente",
        asking_price: "10.50", listing_url: null },
    }))).not.toBe(canonical);
  });

  it("should normalize batch item order and deselection order", () => {
    const first: LotBatchCommand = {
      contract_version: "lot-facets-v1",
      command_key: "6a000000-0000-4000-8000-000000000012",
      mode: "real",
      items: [
        { target: { ...target }, displayed_version: { ...version },
          expected_head_id: null,
          mutation: { action: "discard", reasonCode: "N-NON-RES",
            deselect: [
              { basket_id: "b-basket", expected_head_id: null },
              { basket_id: "a-basket", expected_head_id: null },
            ] } },
        { target: { ...target, canonicalId: "lot-canonical-syn-6j-02" },
          displayed_version: { ...version },
          expected_head_id: "6a000000-0000-4000-8000-000000000013",
          mutation: { action: "set_market", status: "en_vente",
            asking_price: "10.00", listing_url: null } },
      ],
    };
    const reordered: LotBatchCommand = {
      ...first,
      items: [...first.items].reverse().map((item) => item.mutation.action === "discard"
        ? { ...item, mutation: { action: "discard", reasonCode: "N-NON-RES",
          deselect: [...(item.mutation as { deselect: unknown[] }).deselect as Array<{
            basket_id: string; expected_head_id: null }>].reverse() } }
        : item),
    };
    expect(lotCommandDigest("workspace", "batch", "workspace-id", reordered))
      .toBe(lotCommandDigest("workspace", "batch", "workspace-id", first));
    const changed = { ...first,
      items: [{ ...first.items[0]!, mutation: { action: "restore" as const } }, first.items[1]!] };
    expect(lotCommandDigest("workspace", "batch", "workspace-id", changed))
      .not.toBe(lotCommandDigest("workspace", "batch", "workspace-id", first));
  });
});
