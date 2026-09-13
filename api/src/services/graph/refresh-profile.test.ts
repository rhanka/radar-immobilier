import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadOntologyProfile,
  registryRecordsToExtraction,
  type Extraction,
  type TextJsonGenerationClient,
  type TextJsonGenerationInput,
} from "@sentropic/graphify";
import { beforeAll, describe, expect, it } from "vitest";

import type { RefreshCorpusChunk } from "./refresh-corpus.js";
import {
  extractRefreshProfile, loadRefreshProfileContext, REFRESH_PROFILE_CONTRACT_VERSION,
  type RefreshProfileContext,
} from "./refresh-profile.js";

const oraclePath = new URL("../../../tests/fixtures/refresh-018/oracle.json", import.meta.url);
const profilePath = fileURLToPath(new URL("../../../../radar/ontology/ontology-profile.yaml", import.meta.url));
interface Oracle { meetingDate: string; sourceUrl: string; docSha: string; originalKey: string; page: number;
  resolution: string; bylawNumber: string; stage: string; excerpt: string; forbiddenProperties: string[] }
let oracle!: Oracle;
let context!: RefreshProfileContext;

beforeAll(async () => {
  oracle = JSON.parse(await readFile(oraclePath, "utf8"));
  const profile = loadOntologyProfile(profilePath);
  const registries = Object.fromEntries(Object.keys(profile.registries).map((id) => [id, []]));
  context = { profile, registries, registryExtraction: registryRecordsToExtraction(registries, profile) };
});

function chunk(id = `${"a".repeat(64)}.1`, text = `[PDF PAGE 3]\n${oracle.excerpt}`): RefreshCorpusChunk {
  return { id, docSha: oracle.docSha, originalKey: oracle.originalKey,
    sourceUrl: oracle.sourceUrl, pages: [oracle.page], text };
}

function extraction(page = oracle.page): Extraction {
  return {
    nodes: [{
      id: "signal-waterloo-26-956-2", label: `Adoption ${oracle.bylawNumber}`,
      file_type: "document", source_file: oracle.originalKey, node_type: "Signal",
      status: "candidate", resolution: oracle.resolution, etape: oracle.stage,
      etape_date: oracle.meetingDate, reglement_number: oracle.bylawNumber,
      citations: [{ source_file: oracle.originalKey, sourceUrl: oracle.sourceUrl,
        rawRef: oracle.originalKey, docSha: oracle.docSha, modality: "pdf", page,
        quote: oracle.excerpt }],
    }],
    edges: [], input_tokens: 100, output_tokens: 50,
  };
}

function client(responses: Array<{ text: string; status?: "completed" | "instructions_written" }>, seen: TextJsonGenerationInput[]) {
  return {
    mode: "mesh", provider: "test", model: "test-model",
    async generateJson(input: TextJsonGenerationInput) {
      seen.push(input);
      const response = responses.shift()!;
      if (response.status === "instructions_written") {
        return { status: response.status, provider: "test", mode: "mesh", audit: {} } as const;
      }
      await input.validateResponse?.(response.text);
      await mkdir(dirname(input.outputPath!), { recursive: true });
      await writeFile(input.outputPath!, response.text);
      return { status: "completed", provider: "test", mode: "mesh",
        outputPath: input.outputPath!, audit: {} } as const;
    },
  } satisfies TextJsonGenerationClient;
}

describe("refresh profile extraction", () => {
  it("should load an unregistered PV profile and refuse registry-backed output", async () => {
    const pvContext = loadRefreshProfileContext({ root: "/unused", profilePath, unregisteredOnly: true });
    expect(pvContext.registries).toEqual({});
    const invalid = extraction();
    invalid.nodes[0]!.node_type = "Municipality";
    const seen: TextJsonGenerationInput[] = [];
    await expect(extractRefreshProfile([chunk()], {
      context: pvContext, textClient: client([{ text: JSON.stringify(invalid) }], seen), maxOutputTokens: 512,
    })).rejects.toThrow("requires loaded registry municipalities");
    expect(JSON.parse(seen[0]!.schema).ontology.allowed_node_types).not.toContain("Municipality");
  });

  it("should return every validated extraction in chunk order with typed PDF evidence", async () => {
    const seen: TextJsonGenerationInput[] = [];
    const second = chunk(`${"b".repeat(64)}.1`, "[PDF PAGE 4]\nNo relevant regulatory fact.");
    const results = await extractRefreshProfile([chunk(), { ...second, pages: [4] }], {
      context, textClient: client([
        { text: JSON.stringify(extraction()) },
        { text: JSON.stringify({ nodes: [], edges: [], input_tokens: 5, output_tokens: 5 }) },
      ], seen), maxOutputTokens: 512,
    });
    expect(results.map((result) => result.chunk.id)).toEqual([`${"a".repeat(64)}.1`, `${"b".repeat(64)}.1`]);
    expect(results[0]?.extraction.nodes[0]).toMatchObject({
      node_type: "Signal", resolution: oracle.resolution, etape: "adoption",
      reglement_number: oracle.bylawNumber,
    });
    for (const forbidden of oracle.forbiddenProperties) {
      expect(results[0]?.extraction.nodes[0]).not.toHaveProperty(forbidden);
    }
    expect(results[1]).toMatchObject({ chunk: { originalKey: oracle.originalKey },
      extraction: { nodes: [], edges: [] } });
    const schema = JSON.parse(seen[0]!.schema);
    expect(schema.contract_version).toBe(REFRESH_PROFILE_CONTRACT_VERSION);
    expect(schema.ontology.node_properties.Signal.reglement_number.description).toContain("ANTI-INVENTION");
    expect(schema.ontology.relation_signatures.supports).toMatchObject({
      source_node_types: ["Source"], requires_evidence_refs: true,
    });
    expect(schema.ontology.relation_signatures.references).toMatchObject({
      source_node_types: ["Source"], target_node_types: ["Bylaw", "DesignationEvent"],
    });
    expect(schema.graph_contract).toMatchObject({
      node_file_type: ["code", "concept", "document", "image", "paper", "rationale"],
      edge_confidence: ["AMBIGUOUS", "EXTRACTED", "INFERRED"],
    });
    expect(schema.graph_contract.evidence_refs).toMatchObject({
      type: "array", items: { type: "string", references: "evidence[].id" }, minItems: 1,
    });
    expect(schema.evidence.pdf_identity).toMatchObject({ docSha: oracle.docSha, rawRef: oracle.originalKey });
    expect(schema.evidence.citation.required).toContain("source_file");
    expect(schema.evidence.citation.properties.source_file).toEqual({ const: oracle.originalKey });
    expect(schema.evidence.citation.properties.modality).toEqual({ const: "pdf" });
    expect(schema.evidence.allowedPages).toEqual([3]);
    expect(seen[0]).toMatchObject({ maxOutputTokens: 512 });
    expect(seen[0]!.prompt).toContain(`[PDF PAGE 3]\n${oracle.excerpt}`);
    expect(seen[0]!.prompt).toContain('Every node file_type must be "document"');
    expect(seen[0]!.prompt).toContain("never emit a numeric confidence");
    expect(seen[0]!.prompt).toContain("arrays of string IDs from evidence[].id");
  });

  it("should reject the page-3 quotation when the model attributes it to page 1", async () => {
    const seen: TextJsonGenerationInput[] = [];
    await expect(extractRefreshProfile([chunk()], {
      context, textClient: client([{ text: JSON.stringify(extraction(1)) }], seen), maxOutputTokens: 512,
    })).rejects.toThrow("invalid original PDF page");
    expect(seen).toHaveLength(1);
  });

  it("should throw instead of returning a partial result when any required chunk fails", async () => {
    const seen: TextJsonGenerationInput[] = [];
    await expect(extractRefreshProfile([chunk(), chunk(`${"b".repeat(64)}.1`)], {
      context, textClient: client([
        { text: JSON.stringify(extraction()) }, { text: JSON.stringify(extraction(1)) },
      ], seen), maxOutputTokens: 512,
    })).rejects.toThrow("invalid original PDF page");
    expect(seen).toHaveLength(2);
  });

  it("should identify a wrong PDF identity as model output without rejecting zero findings", async () => {
    const invalid = extraction();
    invalid.nodes[0]!.citations![0]!.rawRef = "raw/wrong.pdf";
    await expect(extractRefreshProfile([chunk()], { context,
      textClient: client([{ text: JSON.stringify(invalid) }], []), maxOutputTokens: 512,
    })).rejects.toThrow("Model output has invalid original PDF identity");
  });

  it("should reject non-completed output and unsupported empty scanned chunks", async () => {
    const seen: TextJsonGenerationInput[] = [];
    await expect(extractRefreshProfile([chunk()], {
      context, textClient: client([{ text: "", status: "instructions_written" }], seen), maxOutputTokens: 512,
    })).rejects.toThrow("was not completed");
    await expect(extractRefreshProfile([chunk(`${"c".repeat(64)}.1`, "  ")], {
      context, textClient: client([], seen), maxOutputTokens: 512,
    })).rejects.toThrow("Invalid required chunk");
  });
});
