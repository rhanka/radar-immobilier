import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOntologyProfile, registryRecordsToExtraction,
  type TextJsonGenerationClient } from "@sentropic/engram";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { database, describeDb } from "../facets/scope-db-fixture.js";
import { readClassAnnotations, writeClassAnnotation, type AiClassAnnotation } from "./class-annotations.js";
import { extractRefreshProfile } from "./refresh-profile.js";
import { attachSinglePassAnnotations, loadSinglePassPrompt } from "./refresh-single-pass.js";
import { extractionToV23Graph } from "./refresh-v23.js";
import { upsertGraphAtomic } from "./graph-store.js";
import type { RefreshCorpusChunk } from "./refresh-corpus.js";

describeDb("single-pass extraction to PostgreSQL annotation", () => {
  it("should preserve the accepted model and prompt provenance through the native graph projection", async () => {
    const { db } = await database();
    const oracle = JSON.parse(await readFile(new URL("../../../tests/fixtures/refresh-018/oracle.json", import.meta.url), "utf8"));
    const profile = loadOntologyProfile(fileURLToPath(new URL("../../../../radar/ontology/ontology-profile.yaml", import.meta.url)));
    const registries = Object.fromEntries(Object.keys(profile.registries).map((id) => [id, []]));
    const context = { profile, registries, registryExtraction: registryRecordsToExtraction(registries, profile) };
    const prompt = await loadSinglePassPrompt();
    const chunk: RefreshCorpusChunk = { id: `${"a".repeat(64)}.1`, docSha: oracle.docSha,
      originalKey: oracle.originalKey, sourceUrl: oracle.sourceUrl, pages: [oracle.page],
      text: `[PDF PAGE ${oracle.page}]\n${oracle.excerpt}` };
    const body = { nodes: [{ id: "signal-extracted", label: `Adoption ${oracle.bylawNumber}`,
      file_type: "document", source_file: oracle.originalKey, node_type: "Signal", status: "candidate",
      resolution: oracle.resolution, etape: oracle.stage, etape_date: oracle.meetingDate,
      reglement_number: oracle.bylawNumber, citations: [{ page: oracle.page, excerpt: oracle.excerpt }] }],
      edges: [], input_tokens: 10, output_tokens: 20,
      annotations: [{ nodeId: "signal-extracted", classe: "a_surveiller",
        reason: "Residential effect requires review", reasonCode: "S-REVIEW" }] };
    const client: TextJsonGenerationClient = { mode: "mesh", provider: "test", model: "gemini-3.8-flash",
      async generateJson(input) {
        const text = JSON.stringify(body);
        await input.validateResponse?.(text);
        await mkdir(dirname(input.outputPath!), { recursive: true });
        await writeFile(input.outputPath!, text);
        return { status: "completed", provider: "test", mode: "mesh", outputPath: input.outputPath!, audit: {} };
      } };
    const [result] = await extractRefreshProfile([chunk], { context, singlePassPrompt: prompt,
      maxOutputTokens: 512, textClient: client });
    // Use the accepted fallback receipt, rather than the configured primary.
    attachSinglePassAnnotations(result!, { model: { model: "gemini-3.8-flash", effort: "low" },
      prompt, pipelineRunId: "refresh-fallback-run" });
    const graph = extractionToV23Graph(result!.extraction, { municipality: "synthetic-city",
      generatedAt: "2026-11-13T17:00:00.000Z", baseline: { nodes: [], edges: [] },
      documents: [{ sourceId: "proces-verbaux-synthetic", citySlug: "synthetic-city", sha256: chunk.docSha,
        originalKey: chunk.originalKey, sourceUrl: chunk.sourceUrl,
        pages: [{ page: oracle.page, text: oracle.excerpt }], chunks: [chunk] }] });
    const node = graph.nodes[0]!;
    if (!node.type) throw new Error("Expected a typed extracted node");
    expect((await upsertGraphAtomic(db, "synthetic-city", graph)).aborted).toBe(false);
    expect((await db.execute(sql`SELECT id FROM graph_nodes WHERE city_slug='synthetic-city'`)).rows)
      .toEqual([{ id: "signal-extracted" }]);
    const annotation = node.properties!["classAnnotation"] as AiClassAnnotation;
    expect(await writeClassAnnotation(db, { ...annotation, citySlug: "synthetic-city",
      nodeType: node.type, nodeId: node.id })).toBe("written");
    const stored = (await readClassAnnotations(db, "synthetic-city")).get("Signal:signal-extracted");
    expect(stored).toMatchObject({ source: "ai", classe: "a_surveiller",
      reason: "Residential effect requires review", model: "gemini-3.8-flash", effort: "low",
      promptId: prompt.id, promptSha256: prompt.sha256, pipelineRunId: "refresh-fallback-run" });
    expect(stored!.inputSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
