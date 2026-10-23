import { describe, expect, it } from "vitest";
import { CommandSignalFacetInputSchema } from "./signal-command-schemas.js";
import { BatchLotFacetCommandsInputSchema, CommandLotFacetInputSchema,
  LotMutationSchema } from "./lot-command-schemas.js";

const uuid = "11111111-2222-4333-8444-555555555555";
const envelope = { workspaceId: uuid, scope: "common", commandKey: uuid };
const lot = { target: { type: "Lot", authority: "lot_versions", citySlug: "longueuil", canonicalId: "L1" },
  displayed_version: { lot_version_id: uuid, fingerprint: "a".repeat(64) },
  expected_head_id: null, mutation: { action: "restore" } };
const signal = { target: { citySlug: "longueuil", type: "Signal", id: "s1" },
  expectedHeadId: null, displayedFingerprint: "a".repeat(64) };

describe("closed command schemas", () => {
  it.each(["actor", "owner", "tenant", "roles", "grants", "extra"])(
    "should reject caller %s at every command layer", (field) => {
      expect(CommandLotFacetInputSchema.safeParse({ ...envelope, mode: "real", body: lot, [field]: "x" }).success)
        .toBe(false);
      expect(CommandLotFacetInputSchema.safeParse({ ...envelope, mode: "real",
        body: { ...lot, target: { ...lot.target, [field]: "x" } } }).success).toBe(false);
      expect(CommandSignalFacetInputSchema.safeParse({ ...envelope, scope: "personal", action: "restore",
        body: { ...signal, [field]: "x" } }).success).toBe(false);
    });

  it("should accept all existing lot mutation families and explicit nullable market replacement", () => {
    const mutations = [{ action: "select", basket_id: "favorites" }, { action: "deselect", basket_id: "favorites" },
      { action: "discard", reasonCode: "OUT-OF-SCOPE" }, { action: "restore" },
      { action: "set_pipeline", status: "sollicite" }, { action: "set_pipeline", status: "lettre_envoyee" },
      { action: "clear_pipeline" }, { action: "set_market", status: "en_vente", asking_price: null, listing_url: null },
      { action: "clear_market" }];
    for (const mutation of mutations) {
      expect(CommandLotFacetInputSchema.safeParse({ ...envelope, mode: "real", body: { ...lot, mutation } }).success)
        .toBe(true);
    }
    for (const body of [{ ...lot, displayed_version: undefined }, { ...lot, expected_head_id: undefined },
      { ...lot, target: { ...lot.target, authority: "geo" } },
      { ...lot, mutation: { action: "discard", deselect: [{ basket_id: "favorites" }] } }]) {
      expect(CommandLotFacetInputSchema.safeParse({ ...envelope, mode: "real", body }).success).toBe(false);
    }
  });

  it("should preserve decimal prices without accepting numbers, omissions or unsafe links", () => {
    const market = { action: "set_market", status: "en_vente", asking_price: "999999999999.99", listing_url: null };
    expect(LotMutationSchema.parse(market)).toEqual(market);
    for (const asking_price of [12.34, "0.00", "-1", "1e3", "1.001", "1000000000000"]) {
      expect(LotMutationSchema.safeParse({ ...market, asking_price }).success).toBe(false);
    }
    for (const listing_url of [undefined, "https://u:p@example.test", "javascript:alert(1)", "https://a.test/ a"]) {
      expect(LotMutationSchema.safeParse({ ...market, listing_url }).success).toBe(false);
    }
  });

  it("should enforce signal action-specific fields, null heads and composite expectations", () => {
    const personal = { ...envelope, scope: "personal" };
    for (const action of ["select", "deselect", "discard", "restore"]) {
      const body = ["select", "deselect"].includes(action) ? { ...signal, basket: "pertinent" }
        : action === "discard" ? { ...signal, reasonCode: "X" } : signal;
      expect(CommandSignalFacetInputSchema.safeParse({ ...personal, action, body }).success).toBe(true);
    }
    const discard = { ...personal, action: "discard", body: { ...signal, reasonCode: "X", deselect: ["pertinent"],
      expectedSelectionHeads: { pertinent: null } } };
    expect(CommandSignalFacetInputSchema.safeParse(discard).success).toBe(true);
    expect(CommandSignalFacetInputSchema.safeParse({ ...discard, body: { ...discard.body,
      expectedSelectionHeads: {} } }).success).toBe(false);
    expect(CommandSignalFacetInputSchema.safeParse({ ...personal, action: "restore",
      body: { ...signal, reasonCode: "X" } }).success).toBe(false);
    expect(CommandSignalFacetInputSchema.safeParse({ ...envelope, action: "select",
      body: { ...signal, basket: "pertinent" } }).success).toBe(false);
    expect(CommandSignalFacetInputSchema.safeParse({ ...discard, scope: "common" }).success).toBe(false);
    expect(CommandSignalFacetInputSchema.safeParse({ ...personal, action: "discard", body: signal }).success).toBe(false);
    expect(CommandLotFacetInputSchema.safeParse({ ...envelope, scope: "personal", mode: "real",
      body: { ...lot, mutation: { action: "select", basket_id: "favorites" } } }).success).toBe(false);
    expect(CommandLotFacetInputSchema.safeParse({ ...envelope, scope: "personal", mode: "real",
      body: { ...lot, mutation: { action: "discard", reasonCode: "X", deselect: [] } } }).success).toBe(false);
  });

  it("should match the scoped HTTP bounds for baskets and deselection lists", () => {
    for (const action of ["select", "deselect"]) {
      for (const length of [0, 1, 128, 129, 256, 257]) {
        const command = { ...envelope, mode: "real",
          body: { ...lot, mutation: { action, basket_id: "b".repeat(length) } } };
        const accepted = length > 0 && length <= 256;
        expect(CommandLotFacetInputSchema.safeParse(command).success).toBe(accepted);
        expect(BatchLotFacetCommandsInputSchema.safeParse({ ...envelope, mode: "real",
          items: [command.body] }).success).toBe(accepted);
      }
    }
    const removals = (count: number) => Array.from({ length: count },
      (_, i) => ({ basket_id: `basket-${i}`, expected_head_id: null }));
    const discard = (deselect: ReturnType<typeof removals>) => ({ ...envelope, mode: "real",
      body: { ...lot, mutation: { action: "discard", reasonCode: "X", deselect } } });
    expect(CommandLotFacetInputSchema.safeParse(discard(removals(8))).success).toBe(true);
    expect(CommandLotFacetInputSchema.safeParse(discard(removals(9))).success).toBe(false);
    for (const length of [0, 1, 129, 256, 257]) {
      expect(CommandLotFacetInputSchema.safeParse(discard([
        { basket_id: "b".repeat(length), expected_head_id: null },
      ])).success).toBe(length > 0 && length <= 256);
    }
    for (const count of [8, 9]) {
      expect(BatchLotFacetCommandsInputSchema.safeParse({ ...envelope, mode: "real",
        items: [discard(removals(count)).body] }).success).toBe(count <= 8);
    }
  });

  it("should reject orphan selection expectations without removals", () => {
    const personal = { ...envelope, scope: "personal" };
    for (const deselect of [undefined, []]) {
      for (const expectedSelectionHeads of [{}, { pertinent: null }, { pertinent: uuid }]) {
        expect(CommandSignalFacetInputSchema.safeParse({ ...personal, action: "discard",
          body: { ...signal, reasonCode: "X", deselect, expectedSelectionHeads } }).success).toBe(false);
      }
      expect(CommandSignalFacetInputSchema.safeParse({ ...personal, action: "discard",
        body: { ...signal, reasonCode: "X", deselect } }).success).toBe(true);
    }
  });

  it("should accept exactly 500 distinct lot targets and refuse invalid atomic envelopes", () => {
    const batch = { ...envelope, mode: "simulation", items: Array.from({ length: 500 }, (_, i) => ({ ...lot,
      target: { ...lot.target, canonicalId: `L${i}` } })) };
    expect(BatchLotFacetCommandsInputSchema.safeParse(batch).success).toBe(true);
    for (const items of [[], [...batch.items, lot], [lot, lot], [{ ...lot, mode: "real" }]]) {
      expect(BatchLotFacetCommandsInputSchema.safeParse({ ...batch, items }).success).toBe(false);
    }
    expect(BatchLotFacetCommandsInputSchema.safeParse({ ...batch, commandKey: "bad" }).success).toBe(false);
  });
});
