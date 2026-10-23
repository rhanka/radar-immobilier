import { describe, expect, it } from "vitest";
import {
  adminGrantsNoStatusRight,
  findCallerAuthorityField,
  isConvenienceWorkspace,
  lotDenial,
  signalDenial,
  type StatusRights,
} from "./rights.js";

const moderator: StatusRights = {
  select: true,
  changePipeline: true,
  changeMarket: true,
  discardPersonally: true,
  moderateArchive: true,
};

const contributor: StatusRights = {
  select: false,
  changePipeline: false,
  changeMarket: false,
  discardPersonally: true,
  moderateArchive: false,
};

describe("status rights matrix", () => {
  it("allows personal signal triage without moderation", () => {
    for (const op of ["select", "deselect", "discard", "restore"] as const) {
      expect(signalDenial("personal", op, contributor)).toBeNull();
    }
  });

  it("refuses common signal selection and gates common discard on moderation", () => {
    expect(signalDenial("common", "select", moderator)).toBe("invalid_facet_command");
    expect(signalDenial("common", "deselect", moderator)).toBe("invalid_facet_command");
    expect(signalDenial("common", "discard", contributor)).toBe("workspace_capability_required");
    expect(signalDenial("common", "restore", contributor)).toBe("workspace_capability_required");
    expect(signalDenial("common", "discard", moderator)).toBeNull();
    expect(signalDenial("common", "restore", moderator)).toBeNull();
  });

  it("restricts personal lots to discard and restoration", () => {
    expect(lotDenial("personal", "discard", contributor)).toBeNull();
    expect(lotDenial("personal", "restore", contributor)).toBeNull();
    expect(lotDenial("personal", "select", moderator)).toBe("invalid_facet_command");
    expect(lotDenial("personal", "set_pipeline", moderator)).toBe("invalid_facet_command");
    expect(lotDenial("personal", "set_market", moderator)).toBe("invalid_facet_command");
  });

  it("requires selection rights for common composite discard", () => {
    const selectorWithoutModeration: StatusRights = { ...moderator, moderateArchive: false };
    expect(lotDenial("common", "discard", selectorWithoutModeration)).toBe(
      "workspace_capability_required",
    );
    const moderatorWithoutSelect: StatusRights = { ...moderator, select: false };
    expect(lotDenial("common", "discard", moderatorWithoutSelect)).toBeNull();
    expect(
      lotDenial("common", "discard", moderatorWithoutSelect, { removesSelection: true }),
    ).toBe("workspace_capability_required");
  });

  it("keeps pipeline, market and selection grants independent", () => {
    expect(lotDenial("common", "set_pipeline", contributor)).toBe("workspace_capability_required");
    expect(lotDenial("common", "set_market", contributor)).toBe("workspace_capability_required");
    expect(lotDenial("common", "select", contributor)).toBe("workspace_capability_required");
    expect(lotDenial("common", "set_pipeline", moderator)).toBeNull();
    expect(lotDenial("common", "set_market", moderator)).toBeNull();
    expect(adminGrantsNoStatusRight(true)).toBe(false);
  });

  it.each(["select", "changePipeline", "changeMarket"] as const)(
    "should authorize only its own lot operations with the %s grant alone", (grant) => {
      const rights: StatusRights = { select: false, changePipeline: false, changeMarket: false,
        discardPersonally: false, moderateArchive: false, [grant]: true };
      for (const [required, operations] of [
        ["select", ["select", "deselect"]],
        ["changePipeline", ["set_pipeline", "clear_pipeline"]],
        ["changeMarket", ["set_market", "clear_market"]],
      ] as const) {
        for (const operation of operations) {
          expect(lotDenial("common", operation, rights))
            .toBe(required === grant ? null : "workspace_capability_required");
        }
      }
      expect(lotDenial("common", "discard", rights)).toBe("workspace_capability_required");
      expect(signalDenial("common", "restore", rights)).toBe("workspace_capability_required");
    });

  it("rejects caller-supplied authority and convenience workspaces", () => {
    expect(findCallerAuthorityField({ actor: "x" })).toBe("actor");
    expect(findCallerAuthorityField({ owner: "x" })).toBe("owner");
    expect(findCallerAuthorityField({ tenant: "x" })).toBe("tenant");
    expect(findCallerAuthorityField({ roles: ["admin"] })).toBe("roles");
    expect(findCallerAuthorityField({ grants: [] })).toBe("grants");
    expect(findCallerAuthorityField({ scope: "common" })).toBeNull();
    expect(isConvenienceWorkspace("radar")).toBe(true);
    expect(isConvenienceWorkspace("default")).toBe(true);
    expect(isConvenienceWorkspace("Default ")).toBe(true);
  });
});
