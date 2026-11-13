import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOntologyProfile, registryRecordsToExtraction,
  type TextJsonGenerationClient, type TextJsonGenerationInput } from "@sentropic/engram";
import { beforeAll, describe, expect, it } from "vitest";
import { extractRefreshProfile, type RefreshProfileContext } from "./refresh-profile.js";
import { loadSinglePassPrompt, parseSinglePassClass, singlePassEnabled,
  type SinglePassPrompt } from "./refresh-single-pass.js";
import type { RefreshCorpusChunk } from "./refresh-corpus.js";

let context: RefreshProfileContext;
let chunk: RefreshCorpusChunk;
let node: Record<string, unknown>;
let prompt: SinglePassPrompt;
const annotation = { nodeId: "signal-waterloo-26-956-2", classe: "pertinent",
  reason: "Residential densification bylaw adopted", reasonCode: "P-DENSIFICATION" };

beforeAll(async () => {
  const oracle = JSON.parse(await readFile(new URL("../../../tests/fixtures/refresh-018/oracle.json", import.meta.url), "utf8"));
  const profile = loadOntologyProfile(fileURLToPath(new URL("../../../../radar/ontology/ontology-profile.yaml", import.meta.url)));
  const registries = Object.fromEntries(Object.keys(profile.registries).map((id) => [id, []]));
  context = { profile, registries, registryExtraction: registryRecordsToExtraction(registries, profile) };
  chunk = { id: `${"a".repeat(64)}.1`, docSha: oracle.docSha, originalKey: oracle.originalKey,
    sourceUrl: oracle.sourceUrl, pages: [oracle.page], text: `[PDF PAGE ${oracle.page}]\n${oracle.excerpt}` };
  node = { id: annotation.nodeId, label: `Adoption ${oracle.bylawNumber}`, file_type: "document",
    source_file: oracle.originalKey, node_type: "Signal", status: "candidate",
    resolution: oracle.resolution, etape: oracle.stage, etape_date: oracle.meetingDate,
    reglement_number: oracle.bylawNumber, citations: [{ page: oracle.page, excerpt: oracle.excerpt }] };
  prompt = await loadSinglePassPrompt();
});

function client(body: unknown, seen: TextJsonGenerationInput[]): TextJsonGenerationClient {
  return { mode: "mesh", provider: "test", model: "test-model", async generateJson(input) {
    seen.push(input);
    const text = JSON.stringify(body);
    await input.validateResponse?.(text);
    await mkdir(dirname(input.outputPath!), { recursive: true });
    await writeFile(input.outputPath!, text);
    return { status: "completed", provider: "test", mode: "mesh", outputPath: input.outputPath!, audit: {} };
  } };
}

function body(annotations?: unknown[]) {
  return { nodes: [structuredClone(node)], edges: [], input_tokens: 10, output_tokens: 20,
    ...(annotations ? { annotations } : {}) };
}

describe("single-pass refresh extraction", () => {
  it("should keep flag zero byte-identical to the existing prompt and schema with no class output", async () => {
    const seen: TextJsonGenerationInput[] = [];
    const disabled = singlePassEnabled("0") ? prompt : undefined;
    const base = { context, maxOutputTokens: 512 };
    const legacy = await extractRefreshProfile([chunk], { ...base, textClient: client(body(), seen) });
    const flagged = await extractRefreshProfile([chunk], { ...base, textClient: client(body(), seen),
      ...(disabled ? { singlePassPrompt: disabled } : {}) });
    expect(flagged).toEqual(legacy);
    expect(flagged[0]).not.toHaveProperty("annotations");
    expect(seen[1]!.prompt).toBe(seen[0]!.prompt);
    expect(seen[1]!.schema).toBe(seen[0]!.schema);
    expect(singlePassEnabled(undefined)).toBe(false);
    expect(singlePassEnabled("1")).toBe(true);
    expect(() => singlePassEnabled("true")).toThrow("0 or 1");
  });

  it("should extract native acts and complete class coverage in exactly one generation per chunk", async () => {
    const seen: TextJsonGenerationInput[] = [];
    const chunks = [chunk, { ...chunk, id: `${"b".repeat(64)}.1` }];
    const result = await extractRefreshProfile(chunks, { context, singlePassPrompt: prompt,
      maxOutputTokens: 512, textClient: client(body([annotation]), seen) });
    expect(seen).toHaveLength(2);
    expect(result.map((item) => item.annotations)).toEqual([[annotation], [annotation]]);
    expect(result[0]!.extraction).not.toHaveProperty("annotations");
    expect(result[0]!.extraction.nodes[0]!.citations![0]).toMatchObject({ docSha: chunk.docSha,
      rawRef: chunk.originalKey, sourceUrl: chunk.sourceUrl, modality: "pdf" });
    expect(seen[0]!.prompt.startsWith(`${prompt.text}\n\n`)).toBe(true);
  });

  it.each([
    ["missing", []], ["duplicate", [annotation, annotation]],
    ["unknown act", [{ ...annotation, nodeId: "unknown-act" }]],
  ])("should reject %s annotation coverage before accepting the act", async (_name, annotations) => {
    await expect(extractRefreshProfile([chunk], { context, singlePassPrompt: prompt,
      maxOutputTokens: 512, textClient: client(body(annotations), []) }))
      .rejects.toThrow("coverage mismatch");
  });

  it("should require the annotation envelope and reject a class that disagrees with its reason code", async () => {
    await expect(extractRefreshProfile([chunk], { context, singlePassPrompt: prompt,
      maxOutputTokens: 512, textClient: client(body(), []) })).rejects.toThrow();
    await expect(extractRefreshProfile([chunk], { context, singlePassPrompt: prompt,
      maxOutputTokens: 512, textClient: client(body([{ ...annotation, classe: "ecarte" }]), []) }))
      .rejects.toThrow("class and reason code disagree");
    expect(() => parseSinglePassClass({ ...annotation, reason: " " })).toThrow();
  });

  it("should still reject an invented citation through the unchanged native validator", async () => {
    const invalid = body([annotation]);
    invalid.nodes[0]!["citations"] = [{ page: chunk.pages[0], excerpt: "Invented residential bylaw with no documentary support" }];
    await expect(extractRefreshProfile([chunk], { context, singlePassPrompt: prompt,
      maxOutputTokens: 512, textClient: client(invalid, []) })).rejects.toThrow("ungrounded PDF excerpt");
  });

  it("should load the versioned prompt with an exact SHA-256 of its bytes", () => {
    expect(prompt.id.length).toBeGreaterThan(0);
    expect(prompt.sha256).toBe(createHash("sha256").update(prompt.text).digest("hex"));
  });
});
