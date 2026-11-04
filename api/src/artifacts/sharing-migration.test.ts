import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Lot I2 B1: the immo 0032 migration must mirror the generic G1 0006
 * migration completely. A column-only 0032 breaks artifacts_set_access in
 * production (the provider inserts into artifact_access_events in the same
 * transaction) and drops the Q1 schema guards. This test locks the full
 * object list so a future trim fails without a database.
 */
const MIGRATION = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle", "0032_artifacts_sharing_access_mode.sql"),
  "utf8",
);

describe("sharing access_mode migration mirror", () => {
  it("should carry the access_mode column with the closed immo belt", () => {
    expect(MIGRATION).toContain("ADD COLUMN IF NOT EXISTS access_mode");
    expect(MIGRATION).toContain("SET access_mode = 'platform' WHERE is_public = true");
    expect(MIGRATION).not.toMatch(/access_mode IN \('restricted', 'platform', 'public'\)/);
  });

  it("should enforce the belt as a named constraint separate from the ADD COLUMN", () => {
    // Deterministic even when the column already exists (generic 0006
    // applied first): both CHECKs AND, so 'public' stays closed here.
    expect(MIGRATION).toContain("artifacts_access_mode_immo_check");
    expect(MIGRATION).toContain("CHECK (access_mode IN ('restricted', 'platform'))");
  });

  it("should create the append-only access audit trail", () => {
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS artifacts.artifact_access_events");
    expect(MIGRATION).toContain("CREATE INDEX IF NOT EXISTS access_events_by_artifact");
    expect(MIGRATION).toContain("artifacts.reject_access_event_mutation()");
    expect(MIGRATION).toContain("CREATE TRIGGER artifact_access_events_append_only");
  });

  it("should dedupe legacy multi-source grants before the unique index", () => {
    const dedupe = MIGRATION.indexOf("SET permission = 'read'");
    const unique = MIGRATION.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS artifact_access_one_source");
    expect(dedupe).toBeGreaterThan(-1);
    expect(unique).toBeGreaterThan(-1);
    expect(dedupe).toBeLessThan(unique);
  });

  it("should carry both Q1 schema guards with the generic object names", () => {
    expect(MIGRATION).toContain("artifacts.reject_source_outside_restricted()");
    expect(MIGRATION).toContain("CREATE TRIGGER artifact_access_source_guard");
    expect(MIGRATION).toContain("artifacts.reject_widening_with_source_grant()");
    expect(MIGRATION).toContain("CREATE TRIGGER artifacts_widening_source_guard");
  });
});
