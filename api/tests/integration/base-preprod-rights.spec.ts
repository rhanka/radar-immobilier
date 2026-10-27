import { describe, expect, it } from "vitest";
import requirements from "../../src/scripts/base-preprod-rights.json" with { type: "json" };
import { sufficientPrivileges } from "../../src/scripts/base-preprod-rights.js";

const qualified = [...new Set(Object.values(requirements).flatMap((operation) => Object.values(operation).flat()))]
  .map((relation) => ({ relation, read: true, insert: true, update: true, lock_authority: true }));

describe("operation-specific SQL rights", () => {
  for (const action of ["init", "attach", "activate"] as const) {
    it(`should accept the qualified ${action} role`, () => {
      expect(sufficientPrivileges(qualified, action)).toBe(true);
    });
    for (const [privilege, relations] of Object.entries(requirements[action])) {
      for (const relation of relations) {
        it(`should refuse ${action} without ${privilege} on ${relation}`, () => {
          const rows = qualified.map((row) => row.relation === relation ? { ...row, [privilege]: false } : row);
          expect(sufficientPrivileges(rows, action)).toBe(false);
        });
      }
    }
  }
  it("should refuse DELETE-only row-lock authority even when table locks are allowed", () => {
    expect(sufficientPrivileges(qualified.map((row) => ({ ...row, update: false, delete: true })), "activate")).toBe(false);
  });
  it("should require the previously omitted context insertion", () => {
    expect(requirements.activate.insert).toContain("facet_command_contexts");
    expect(requirements.activate.lock_authority).toContain("facet_event_bindings");
    expect(requirements.activate.update).toContain("facet_activation_state");
  });
});
