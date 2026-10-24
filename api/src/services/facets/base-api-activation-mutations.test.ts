/** Discriminating safety mutations; each case fails if its guard is removed. */
import { describe, expect, it, vi } from "vitest";
import {
  qualifiedActivationSafety, qualifiedLotCutoverSafetyFor,
  validateQualifiedMaintenanceEvidence, type QualifiedMaintenanceEvidence,
} from "./activation-maintenance-safety.js";
import {
  checkCutoverReadbackCoverage,
  expectedCutoverHeadValues,
  parseReadyTargetKeys,
} from "./lots/lot-cutover-expectations.js";
import type { CutoverReadbackHead } from "./lots/lot-cutover-readback.js";
import type { ExpectedCutoverHeadValue } from "./lots/lot-cutover-types.js";
import { cleanCutoverReport } from "./lots/cutover-fixture.js";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-23T12:00:00.000Z");
const bound = { workspaceId: WORKSPACE_ID, actorSub: "synthetic-actor-1",
  maintenanceAttemptId: ATTEMPT_ID, releaseId: "synthetic-release-1", instanceIds: ["api-1", "worker-1"] };
const options = { now: NOW };
const proof = { completedAt: NOW.toISOString(), coveredInstanceIds: bound.instanceIds };
function validEvidence(): QualifiedMaintenanceEvidence {
  return { ...bound, reason: "synthetic maintenance window", drain: proof, shutdown: proof };
}
function rejects(evidence: unknown, status: number, message: string) {
  expect(() => validateQualifiedMaintenanceEvidence(evidence, bound, options))
    .toThrowError(expect.objectContaining({ status, message }));
}

describe("discriminating activation safety mutations", () => {
  it("rejects an empty reason", () => rejects({ ...validEvidence(), reason: "" }, 400, "invalid_activation_command"));
  it("rejects an overlong reason", () => rejects({ ...validEvidence(), reason: "r".repeat(513) }, 400, "invalid_activation_command"));
  it("rejects a malformed attempt id", () => rejects({ ...validEvidence(), maintenanceAttemptId: "not-a-uuid" }, 400, "invalid_maintenance_attempt"));
  it("rejects an empty release", () => rejects({ ...validEvidence(), releaseId: "" }, 503, "maintenance_evidence_release_required"));
  it("rejects an unparsable coverage timestamp", () => {
    rejects({ ...validEvidence(), drain: { ...proof, completedAt: "not-a-date" } }, 400, "invalid_maintenance_evidence");
  });
  it("validates evidence on 6H drain", async () => {
    const safety = qualifiedActivationSafety(bound, { ...validEvidence(), maintenanceAttemptId: OTHER_ID }, undefined, options);
    await expect(safety.drain(WORKSPACE_ID))
      .rejects.toMatchObject({ status: 403, message: "maintenance_evidence_attempt_mismatch" });
  });
  it("validates 6H readback before delegating", async () => {
    const readback = vi.fn(async () => {});
    const safety = qualifiedActivationSafety(bound, { ...validEvidence(), releaseId: "other-release" }, { readback }, options);
    await expect(safety.readback(WORKSPACE_ID))
      .rejects.toMatchObject({ status: 403, message: "maintenance_evidence_release_mismatch" });
    expect(readback).not.toHaveBeenCalled();
  });
  it("rejects 6H cross-workspace readback without delegating", async () => {
    const readback = vi.fn(async () => {});
    const safety = qualifiedActivationSafety(bound, validEvidence(), { readback }, options);
    await expect(safety.readback(OTHER_ID))
      .rejects.toMatchObject({ status: 403, message: "maintenance_evidence_workspace_mismatch" });
    expect(readback).not.toHaveBeenCalled();
  });
  it("validates evidence on 6K drain", async () => {
    const safety = qualifiedLotCutoverSafetyFor(bound,
      { ...validEvidence(), releaseId: "other-release" }, ["dest:city::real"], undefined, options);
    await expect(safety.drainDeliveryPaths(WORKSPACE_ID))
      .rejects.toMatchObject({ status: 403, message: "maintenance_evidence_release_mismatch" });
  });
  it("rejects 6K cross-workspace readback without delegating", async () => {
    const readbackAuthorized = vi.fn(async () => {});
    const safety = qualifiedLotCutoverSafetyFor(bound, validEvidence(), ["dest:city::real"], { readbackAuthorized }, options);
    await expect(safety.readbackAuthorized(OTHER_ID))
      .rejects.toMatchObject({ status: 403, message: "maintenance_evidence_workspace_mismatch" });
    expect(readbackAuthorized).not.toHaveBeenCalled();
  });
  it("delegates a declared empty manifest instead of always rejecting", async () => {
    const readbackAuthorized = vi.fn(async () => {});
    const safety = qualifiedLotCutoverSafetyFor(bound, validEvidence(), [], { readbackAuthorized },
      { ...options, qualifiedEmptyManifest: true });
    await expect(safety.readbackAuthorized(WORKSPACE_ID)).resolves.toBeUndefined();
    expect(readbackAuthorized).toHaveBeenCalledExactlyOnceWith(WORKSPACE_ID);
  });
});

const READBACK_KEY = "dest:synthetic-city::lot-canonical-syn-01::real";
const MARKET_EXPECTED: ExpectedCutoverHeadValue = { targetKey: READBACK_KEY, sourceId: "synthetic-source", facet: "market",
  statut: "en_vente", prixDemande: "250000.00",
  lienAnnonce: "https://synthetic.invalid/annonce/1" };

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    target: { type: "Lot", authority: "lot_versions", citySlug: "synthetic-city",
      canonicalId: "lot-canonical-syn-01" },
    mode: "real", facet: "market", basket: null, state: "active", reasonCode: null,
    verdict: null, pipelineStatus: null, askingPrice: "250000.00",
    listingUrl: "https://synthetic.invalid/annonce/1",
    displayedVersion: { lot_version_id: "", fingerprint: "f".repeat(64) },
    source: { importRunId: "synthetic-run", sourceRowId: "synthetic-source", sourceChainId: null },
    createdAt: "2026-01-01T00:00:00.000Z", ...overrides,
  };
}

function marketHead(price: string | null = "250000.00",
  url: string | null = "https://synthetic.invalid/annonce/1"): CutoverReadbackHead {
  return {
    target: { type: "Lot", authority: "lot_versions", citySlug: "synthetic-city",
      canonicalId: "lot-canonical-syn-01" },
    selection: [],
    archive: { personal: null, workspace: null, effectiveDiscarded: false },
    pipeline: null,
    market: snapshot({ askingPrice: price, listingUrl: url }),
  } as unknown as CutoverReadbackHead;
}

function coverageMismatch(head: CutoverReadbackHead, expected: ExpectedCutoverHeadValue[] = [MARKET_EXPECTED]) {
  expect(() => checkCutoverReadbackCoverage([READBACK_KEY], new Map([[READBACK_KEY, head]]), expected))
    .toThrowError(expect.objectContaining({ status: 503, message: "lot_cutover_readback_unconfirmed" }));
}

describe("6K readback coverage and values comparison", () => {
  it("accepts a matching head", () => {
    expect(() => checkCutoverReadbackCoverage([READBACK_KEY],
      new Map([[READBACK_KEY, marketHead()]]), [MARKET_EXPECTED])).not.toThrow();
  });
  it("accepts a canonically equal price", () => {
    expect(() => checkCutoverReadbackCoverage([READBACK_KEY],
      new Map([[READBACK_KEY, marketHead("250000")]]), [MARKET_EXPECTED])).not.toThrow();
  });
  it("rejects a missing head", () => {
    expect(() => checkCutoverReadbackCoverage([READBACK_KEY], new Map(), [MARKET_EXPECTED]))
      .toThrowError(expect.objectContaining({ status: 503, message: "lot_cutover_readback_unconfirmed" }));
  });
  it("rejects an altered price", () => coverageMismatch(marketHead("1.00")));
  it("rejects an altered listing url", () => {
    coverageMismatch(marketHead("250000.00", "https://synthetic.invalid/other"));
  });
  it("rejects a missing expectation", () => coverageMismatch(marketHead(), []));
  it("rejects an inactive market head", () => {
    const head = marketHead();
    coverageMismatch({ ...head, market: { ...head.market!, state: "inactive" } } as CutoverReadbackHead);
  });
  it("rejects an unverifiable ready key", () => {
    expect(() => parseReadyTargetKeys(["native:whatever"]))
      .toThrowError(expect.objectContaining({ status: 503, message: "lot_cutover_readback_unconfirmed" }));
  });
  it("derives terminal mapped expectations from the manifest", () => {
    const { report } = cleanCutoverReport();
    expect(expectedCutoverHeadValues(report, [])).toEqual([
      expect.objectContaining({ targetKey: "dest:synthetic-6j-city::lot-canonical-syn-6j-01::real", facet: "archive",
        statut: "ecarte", prixDemande: null, lienAnnonce: null }),
      expect.objectContaining({ targetKey: "dest:synthetic-6j-city::lot-canonical-syn-6j-02::real", facet: "market",
        statut: "en_vente", prixDemande: "999999999999.99",
        lienAnnonce: "https://synthetic.invalid/annonce/6j" }),
    ]);
  });
});
