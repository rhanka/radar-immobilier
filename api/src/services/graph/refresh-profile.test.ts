import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
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
        excerpt: oracle.excerpt }],
    }],
    edges: [], input_tokens: 100, output_tokens: 50,
  };
}

function compactExtraction(page = oracle.page): Extraction {
  const value = extraction(page);
  value.nodes[0]!.citations = [{ page, excerpt: oracle.excerpt } as
    unknown as NonNullable<Extraction["nodes"][number]["citations"]>[number]];
  return value;
}

function compactEdgeExtraction(): Extraction {
  const value = compactExtraction();
  value.nodes.unshift({ id: "source-waterloo-pv", label: "Waterloo PV", file_type: "document",
    source_file: oracle.originalKey, node_type: "Source",
    citations: [{ page: oracle.page, excerpt: oracle.excerpt }] } as Extraction["nodes"][number]);
  value.edges = [{ source: "source-waterloo-pv", target: "signal-waterloo-26-956-2",
    relation: "supports", confidence: "EXTRACTED", source_file: oracle.originalKey,
    evidence_refs: ["ev-1"], citations: [{ page: oracle.page, excerpt: oracle.excerpt }] } as
    unknown as Extraction["edges"][number]];
  value.evidence = [{ id: "ev-1", source_file: oracle.originalKey, rawRef: oracle.originalKey,
    docSha: oracle.docSha, sourceUrl: oracle.sourceUrl, modality: "pdf", page: oracle.page,
    excerpt: oracle.excerpt }];
  return value;
}

async function captureExtractionError(text: string): Promise<Error> {
  try {
    await extractRefreshProfile([chunk()], {
      context, textClient: client([{ text }], []), maxOutputTokens: 512,
    });
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("Expected extraction to fail");
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
  it.each([
    ["direct JSON", () => JSON.stringify(extraction())],
    ["a JSON fence", () => ` \n\`\`\`JSON\n${JSON.stringify(extraction())}\n\`\`\`  \n `],
    ["a naked fence", () => `\`\`\`\n${JSON.stringify(extraction())}\n\`\`\``],
    ["an external BOM", () => `\uFEFF${JSON.stringify(extraction())}`],
    ["backticks inside a JSON string", () => {
      const value = extraction();
      value.nodes[0]!.label = "Label containing ``` inside JSON";
      return JSON.stringify(value);
    }],
  ])("should accept %s as one strict JSON response", async (_case, response) => {
    const results = await extractRefreshProfile([chunk()], {
      context, textClient: client([{ text: response() }], []), maxOutputTokens: 512,
    });
    expect(results[0]!.extraction.nodes[0]!.id).toBe("signal-waterloo-26-956-2");
  });

  it.each([
    ["an incomplete fence", () => `\`\`\`json\n${JSON.stringify(extraction())}`],
    ["two fences", () => {
      const fenced = `\`\`\`json\n${JSON.stringify(extraction())}\n\`\`\``;
      return `${fenced}\n${fenced}`;
    }],
    ["a non-JSON fence label", () => `\`\`\`javascript\n${JSON.stringify(extraction())}\n\`\`\``],
    ["a preamble", () => `Preamble\n${JSON.stringify(extraction())}`],
    ["a suffix", () => `${JSON.stringify(extraction())}\nSuffix`],
  ])("should reject %s and preserve the parse error", async (_case, response) => {
    const error = await captureExtractionError(response());
    expect(error.cause).toBeInstanceOf(SyntaxError);
    expect(error.message).toContain((error.cause as SyntaxError).message);
  });

  it.each([
    ["an unterminated naked fence", "```" + " ".repeat(100_000) + "x"],
    ["an unterminated JSON fence", "```json\n" + " ".repeat(100_000)],
  ])("should reject %s in under 50 ms", async (_case, response) => {
    const startedAt = performance.now();
    await expect(captureExtractionError(response)).resolves.toBeInstanceOf(Error);
    expect(performance.now() - startedAt).toBeLessThan(50);
  });

  it("should name profile violations when entity citations are missing", async () => {
    const invalid = extraction();
    delete invalid.nodes[0]!.citations;
    const error = await captureExtractionError(JSON.stringify(invalid));
    expect(error.message).toContain("missing_citation_source_file");
    expect(error.message).toContain("missing_citation_page");
  });

  it("should accept output with profile-compliant entity citations", async () => {
    const results = await extractRefreshProfile([chunk()], {
      context, textClient: client([{ text: JSON.stringify(extraction()) }], []), maxOutputTokens: 512,
    });
    expect(results[0]!.extraction).toEqual(extraction());
  });

  it("should expand compact model citations with the exact PDF identity", async () => {
    const results = await extractRefreshProfile([chunk()], {
      context, textClient: client([{ text: JSON.stringify(compactExtraction()) }], []), maxOutputTokens: 512,
    });
    expect(results[0]!.extraction).toEqual(extraction());
  });

  it("should reject a compact citation without its required page", async () => {
    const invalid = compactExtraction();
    delete (invalid.nodes[0]!.citations![0] as { page?: number }).page;
    await expect(extractRefreshProfile([chunk()], { context,
      textClient: client([{ text: JSON.stringify(invalid) }], []), maxOutputTokens: 512,
    })).rejects.toThrow("missing_citation_page");
  });

  it("should reject a compact citation without its required excerpt", async () => {
    const invalid = compactExtraction();
    delete (invalid.nodes[0]!.citations![0] as { excerpt?: string }).excerpt;
    await expect(extractRefreshProfile([chunk()], { context,
      textClient: client([{ text: JSON.stringify(invalid) }], []), maxOutputTokens: 512,
    })).rejects.toThrow("ungrounded PDF excerpt");
  });

  it("should expand a compact edge citation with the exact PDF identity", async () => {
    const results = await extractRefreshProfile([chunk()], { context,
      textClient: client([{ text: JSON.stringify(compactEdgeExtraction()) }], []), maxOutputTokens: 512,
    });
    expect(results[0]!.extraction.edges[0]!.citations![0]).toEqual({
      source_file: oracle.originalKey, rawRef: oracle.originalKey, docSha: oracle.docSha,
      sourceUrl: oracle.sourceUrl, modality: "pdf", page: oracle.page, excerpt: oracle.excerpt,
    });
  });

  it.each(["page", "excerpt"] as const)("should reject a compact edge citation without %s", async (field) => {
    const invalid = compactEdgeExtraction();
    delete (invalid.edges[0]!.citations![0] as unknown as Record<string, unknown>)[field];
    await expect(extractRefreshProfile([chunk()], { context,
      textClient: client([{ text: JSON.stringify(invalid) }], []), maxOutputTokens: 512,
    })).rejects.toThrow(field === "page" ? "missing_citation_page" : "ungrounded PDF excerpt");
  });

  it.each(["node", "edge"] as const)("should reject a 201-character %s citation excerpt", async (kind) => {
    const longExcerpt = "é".repeat(201);
    const invalid = kind === "node" ? compactExtraction() : compactEdgeExtraction();
    const citation = kind === "node" ? invalid.nodes[0]!.citations![0]! : invalid.edges[0]!.citations![0]!;
    citation.excerpt = longExcerpt;
    await expect(extractRefreshProfile([chunk(undefined,
      `[PDF PAGE 3]\n${oracle.excerpt}\n${longExcerpt}`)], { context,
      textClient: client([{ text: JSON.stringify(invalid) }], []), maxOutputTokens: 512,
    })).rejects.toThrow("entity_citation_excerpt_too_long");
  });

  it("should preserve the distinct unbounded evidence excerpt contract", async () => {
    const longExcerpt = "é".repeat(201);
    const value = extraction();
    value.evidence = [{ id: "ev-long", source_file: oracle.originalKey, rawRef: oracle.originalKey,
      docSha: oracle.docSha, sourceUrl: oracle.sourceUrl, modality: "pdf", page: oracle.page,
      excerpt: longExcerpt }];
    const results = await extractRefreshProfile([chunk(undefined,
      `[PDF PAGE 3]\n${oracle.excerpt}\n${longExcerpt}`)], { context,
      textClient: client([{ text: JSON.stringify(value) }], []), maxOutputTokens: 512,
    });
    expect(results[0]!.extraction.evidence![0]!.excerpt).toHaveLength(201);
  });

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
    expect(REFRESH_PROFILE_CONTRACT_VERSION).toBe("immo-pv-extraction-v5");
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
    expect(schema.graph_contract.entity_citations).toMatchObject({
      node_field: "nodes[].citations", edge_field: "edges[].citations",
      required_for: ["every node", "every edge"], minItems: 1,
    });
    expect(schema.graph_contract.entity_citations.items.required).toEqual(["page", "excerpt"]);
    expect(schema.graph_contract.entity_citations.items.properties).toEqual({
      page: { enum: [3] }, excerpt: { type: "string", minLength: 1, maxLength: 200,
        description: "short verbatim text from the cited page" },
    });
    expect(schema.evidence.pdf_identity).toMatchObject({ docSha: oracle.docSha, rawRef: oracle.originalKey });
    expect(schema.evidence.citation.required).toEqual(["page", "excerpt"]);
    expect(schema.evidence.evidence_item.required).toContain("modality");
    expect(schema.evidence.citation.properties).not.toHaveProperty("source_file");
    expect(schema.evidence.citation.properties).not.toHaveProperty("modality");
    expect(schema.evidence.citation.properties.excerpt.minLength).toBe(1);
    expect(schema.evidence.allowedPages).toEqual([3]);
    expect(seen[0]).toMatchObject({ maxOutputTokens: 512 });
    expect(seen[0]!.prompt).toContain(`[PDF PAGE 3]\n${oracle.excerpt}`);
    expect(seen[0]!.prompt).toContain('Every node file_type must be "document"');
    expect(seen[0]!.prompt).toContain("never emit a numeric confidence");
    expect(seen[0]!.prompt).toContain("arrays of string IDs from evidence[].id");
    expect(seen[0]!.prompt).toContain("Evidence refs do not replace citations");
    expect(seen[0]!.prompt).toContain("Every node and every edge must include a non-empty citations array");
    expect(seen[0]!.prompt).toContain("Do not repeat the document identity inside citations");
    expect(seen[0]!.prompt).toContain("non-empty verbatim text on its claimed physical PDF page");
  });

  it("should reject the page-3 quotation when the model attributes it to page 1", async () => {
    const seen: TextJsonGenerationInput[] = [];
    await expect(extractRefreshProfile([chunk()], {
      context, textClient: client([{ text: JSON.stringify(extraction(1)) }], seen), maxOutputTokens: 512,
    })).rejects.toThrow("invalid original PDF page");
    expect(seen).toHaveLength(1);
  });

  it("should enforce both physical page boundaries in a multi-page chunk", async () => {
    const firstExcerpt = "First-page finding.";
    const multiPage = { ...chunk(undefined,
      `[PDF PAGE 1]\n${firstExcerpt}\n\n[PDF PAGE 3]\n${oracle.excerpt}`), pages: [1, 3] };
    const attributedToFirst = extraction(1);
    const attributedToLast = extraction(3);
    attributedToLast.nodes[0]!.citations![0]!.excerpt = firstExcerpt;
    for (const invalid of [attributedToFirst, attributedToLast]) {
      await expect(extractRefreshProfile([multiPage], { context,
        textClient: client([{ text: JSON.stringify(invalid) }], []), maxOutputTokens: 512,
      })).rejects.toThrow("ungrounded PDF excerpt");
    }
  });

  it("should reject missing, repeated and displaced physical page markers before generation", async () => {
    const malformed = [oracle.excerpt, `[PDF PAGE 3]\n${oracle.excerpt}\n[PDF PAGE 3]\nRepeated.`,
      `Preamble.\n[PDF PAGE 3]\n${oracle.excerpt}`];
    for (const text of malformed) {
      const seen: TextJsonGenerationInput[] = [];
      await expect(extractRefreshProfile([chunk(undefined, text)], { context,
        textClient: client([], seen), maxOutputTokens: 512,
      })).rejects.toThrow("Invalid physical PDF page markers");
      expect(seen).toHaveLength(0);
    }
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

  it("should reject invalid evidence identity, aliases and missing entity source files", async () => {
    const reject = async (mutate: (value: Extraction) => void, message: string) => {
      const invalid = extraction();
      mutate(invalid);
      await expect(extractRefreshProfile([chunk()], { context,
        textClient: client([{ text: JSON.stringify(invalid) }], []), maxOutputTokens: 512,
      })).rejects.toThrow(message);
    };
    await reject((value) => { value.evidence = [{ id: "ev-1", source_file: oracle.originalKey,
      rawRef: oracle.originalKey, docSha: "f".repeat(64), sourceUrl: oracle.sourceUrl,
      modality: "pdf", page: oracle.page, excerpt: oracle.excerpt }]; }, "invalid original PDF identity");
    await reject((value) => { value.nodes[0]!.citations![0]!.excerpt = ""; }, "ungrounded PDF excerpt");
    await reject((value) => { const citation = value.nodes[0]!.citations![0]!;
      delete (citation as { excerpt?: string }).excerpt; citation.quote = oracle.excerpt; }, "ungrounded PDF excerpt");
    await reject((value) => { delete (value.nodes[0]! as { source_file?: string }).source_file; },
      "Invalid Graphify extraction");
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
