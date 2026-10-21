import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const HISTORICAL_SHA256 = "31487e8fb9b85019fc707ed3a7296e33156c46fb5fd3071d456d6dae1b44d998";
const AMENDED_SHA256 = "2145e05ae003ce567f3f4edf5bd628d0367e38c44d23dad5de1e3e3e331869d3";
const SHOW_DISCARDED_BLOCK =
  '          "showDiscarded": {\n' +
  '            "type": "boolean",\n' +
  '            "description": "Reveal archived signals hidden by default (default false). Read-only."\n' +
  "          },\n";
const STUBS = [
  "search_lots",
  "get_lot_card",
  "get_opportunity_dossier",
  "list_documents",
  "read_document_excerpt",
];
const TWELVE_TOOLS = [
  "search_lots",
  "get_lot_card",
  "search_signals",
  "get_opportunity_dossier",
  "list_documents",
  "read_document_excerpt",
  "get_zones_geojson",
  "get_lots_geojson",
  "get_grille_pdf",
  "get_pv_pdf",
  "get_reglement_provenance",
  "query_zoning_events",
];

const fixtureUrl = new URL("./fixtures/immo-tools.v1.json", import.meta.url);
const provenanceUrl = new URL("./fixtures/immo-tools.provenance.v1.json", import.meta.url);
const artifactHostMkUrl = new URL("../../../tools/artifact-host.mk", import.meta.url);
const h4RunnerMkUrl = new URL("../../../tools/h4-mcp.mk", import.meta.url);

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("H4 P0 fixture provenance", () => {
  it("attributes showDiscarded as a source amendment on captured bytes", () => {
    const raw = readFileSync(fixtureUrl, "utf8");
    expect(raw).toContain(SHOW_DISCARDED_BLOCK);
    const captured = raw.replace(SHOW_DISCARDED_BLOCK, "");
    expect(captured).not.toBe(raw);
    expect(captured).not.toContain("showDiscarded");
    expect(sha256(captured)).toBe(HISTORICAL_SHA256);
    expect(sha256(raw)).toBe(AMENDED_SHA256);
    const provenance = JSON.parse(readFileSync(provenanceUrl, "utf8")) as {
      captured: { sha256: string };
      amendment: { amendedSourceSha256: string };
    };
    expect(provenance.captured.sha256).toBe(HISTORICAL_SHA256);
    expect(provenance.amendment.amendedSourceSha256).toBe(AMENDED_SHA256);
  });

  it("keeps the five stub errors byte-stable", () => {
    const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as {
      captures: { http: { calls: Record<string, { result: { content: { text?: string }[]; isError?: boolean } }> } };
    };
    for (const name of STUBS) {
      const result = fixture.captures.http.calls[name]?.result;
      expect(result?.isError, name).toBe(true);
      expect(result?.content[0]?.text, name).toContain("not_wired_yet:http_data_source");
    }
  });

  it("retains the historical 401 capture and records the 403 delta separately", () => {
    const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as {
      captures: { http: { missingCoarseScope: { code: number } } };
    };
    expect(fixture.captures.http.missingCoarseScope.code).toBe(401);
    const provenance = JSON.parse(readFileSync(provenanceUrl, "utf8")) as {
      coarseScope: { captured: { code: number }; expectedAfterMcpAuth022: { code: number } };
    };
    expect(provenance.coarseScope.captured.code).toBe(401);
    expect(provenance.coarseScope.expectedAfterMcpAuth022.code).toBe(403);
  });

  it("keeps capture, source, ingress and stdio evidence distinct", () => {
    const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as {
      captures: { http: { capturedAt: string }; simulation: { capturedAt: string } };
    };
    const receipt = JSON.parse(
      readFileSync(new URL("./fixtures/immo-deployed-baseline.v1.json", import.meta.url), "utf8"),
    ) as { capturedAt: string };
    expect(fixture.captures.http.capturedAt).toBe(receipt.capturedAt);
    expect(fixture.captures.simulation.capturedAt).not.toBe(fixture.captures.http.capturedAt);
    const provenance = JSON.parse(readFileSync(provenanceUrl, "utf8")) as {
      evidenceClasses: Record<string, string>;
    };
    expect(Object.keys(provenance.evidenceClasses).sort()).toEqual(
      ["httpImageCapture", "ingress", "sourceExpectation", "stdio"],
    );
  });

  it("pins the twelve-tool contract names", () => {
    const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as { tools: { name: string }[] };
    expect(fixture.tools.map((tool) => tool.name).sort()).toEqual([...TWELVE_TOOLS].sort());
  });

  it("excludes service E2E from the ordinary test-mcp target", () => {
    const mk = readFileSync(artifactHostMkUrl, "utf8");
    expect(mk).toContain("--exclude '**/*.e2e.test.ts'");
  });

  it("guards the dedicated H4 runner", () => {
    const mk = readFileSync(h4RunnerMkUrl, "utf8");
    expect(mk).toContain("COMPOSE_DISABLE_ENV_FILE");
    expect(mk).toContain("--env-file /dev/null");
    expect(mk).toContain("down -v --remove-orphans");
    expect(mk).toContain("radar-$(ENV)");
    expect(mk).toContain("ENV last");
    expect(mk).not.toContain("env_file");
  });
});
