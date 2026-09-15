import { createHash } from "node:crypto";
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
  extractRefreshProfile, loadRefreshProfileContext, parseStrictJsonResponse, REFRESH_PROFILE_CONTRACT_VERSION,
  type RefreshProfileContext,
} from "./refresh-profile.js";

const oraclePath = new URL("../../../tests/fixtures/refresh-018/oracle.json", import.meta.url);
const v11CasesPath = new URL("../../../tests/fixtures/refresh-018/v11-citation-cases.json", import.meta.url);
const v13CasesPath = new URL("../../../tests/fixtures/refresh-018/v13-citation-cases.json", import.meta.url);
const profilePath = fileURLToPath(new URL("../../../../radar/ontology/ontology-profile.yaml", import.meta.url));
interface Oracle { meetingDate: string; sourceUrl: string; docSha: string; originalKey: string; page: number;
  resolution: string; bylawNumber: string; stage: string; excerpt: string; forbiddenProperties: string[] }
interface V11Case { caseId: string; path: string; page: number; codePoints: number;
  normalizedCodePoints: number; excerpt: string; pageText: string; refusedAsUnderV7: string }
interface V11Cases { overlongExcerpt: V11Case & { handledUnderV9: string };
  shortLabelExcerpt: V11Case & { refusedAsUnderV9: string } }
interface V13Case { excerpt: string; page: number; codePoints: number }
interface V13Cases { zoneLabelExcerpt: V13Case & { refusedAsUnderV9: string };
  decisionExcerpt: V13Case; pageText: string;
  provenance: { manifestPageTextSha256: string; pageTextSha256: string } }
let oracle!: Oracle;
let v11Cases!: V11Cases;
let v13Cases!: V13Cases;
let context!: RefreshProfileContext;

beforeAll(async () => {
  oracle = JSON.parse(await readFile(oraclePath, "utf8"));
  v11Cases = JSON.parse(await readFile(v11CasesPath, "utf8"));
  v13Cases = JSON.parse(await readFile(v13CasesPath, "utf8"));
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

async function captureExtractionError(text: string, chunkText?: string): Promise<Error> {
  try {
    await extractRefreshProfile([chunk(undefined, chunkText)], {
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

const largeInvalidJsonResponses = [
  ["an unterminated naked fence", "```" + " ".repeat(100_000) + "x"],
  ["an unterminated JSON fence", "```json\n" + " ".repeat(100_000)],
] as const;

describe("refresh profile extraction", () => {
  it.each([
    ["direct JSON", () => JSON.stringify(extraction())],
    ["a JSON fence", () => ` \n\`\`\`JSON\n${JSON.stringify(extraction())}\n\`\`\`  \n `],
    ["a naked fence", () => `\`\`\`\n${JSON.stringify(extraction())}\n\`\`\``],
    ["a CRLF JSON fence", () => `\`\`\`json\r\n${JSON.stringify(extraction())}\r\n\`\`\``],
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
    ["exactly one fence marker", () => "```"],
    ["two fences", () => {
      const fenced = `\`\`\`json\n${JSON.stringify(extraction())}\n\`\`\``;
      return `${fenced}\n${fenced}`;
    }],
    ["a non-JSON fence label", () => `\`\`\`javascript\n${JSON.stringify(extraction())}\n\`\`\``],
    ["a JSON fence label with a trailing space", () => `\`\`\`json \n${JSON.stringify(extraction())}\n\`\`\``],
    ["a preamble", () => `Preamble\n${JSON.stringify(extraction())}`],
    ["a suffix", () => `${JSON.stringify(extraction())}\nSuffix`],
  ])("should reject %s and preserve the parse error", async (_case, response) => {
    const error = await captureExtractionError(response());
    expect(error.cause).toBeInstanceOf(SyntaxError);
    expect(error.message).toContain((error.cause as SyntaxError).message);
  });

  it.each(largeInvalidJsonResponses)("should reject %s through extraction", async (_case, response) => {
    await expect(captureExtractionError(response)).resolves.toBeInstanceOf(Error);
  });

  it.each(largeInvalidJsonResponses)("should reject %s in under 200 ms", (_case, response) => {
    const startedAt = performance.now();
    let thrown: unknown;
    try {
      parseStrictJsonResponse(response);
    } catch (error) {
      thrown = error;
    }
    const elapsedMs = performance.now() - startedAt;
    expect(thrown).toBeInstanceOf(SyntaxError);
    expect(elapsedMs).toBeLessThan(200);
  });

  it("should name profile violations when entity citations are missing", async () => {
    const invalid = extraction();
    delete invalid.nodes[0]!.citations;
    const error = await captureExtractionError(JSON.stringify(invalid));
    expect(error.message).toContain("missing_citation_source_file");
    expect(error.message).toContain("missing_citation_page");
  });

  it("should accept every status value announced by the product profile", async () => {
    for (const status of context.profile.hardening.statuses) {
      const value = extraction();
      value.nodes[0]!.status = status;
      const results = await extractRefreshProfile([chunk()], {
        context, textClient: client([{ text: JSON.stringify(value) }], []), maxOutputTokens: 512,
      });
      expect(results[0]!.extraction).toEqual(value);
    }
  });

  it("should expand compact model citations with the exact PDF identity", async () => {
    const results = await extractRefreshProfile([chunk()], {
      context, textClient: client([{ text: JSON.stringify(compactExtraction()) }], []), maxOutputTokens: 512,
    });
    expect(results[0]!.extraction).toEqual(extraction());
  });

  it("should accept the exact declared v9 contract version", async () => {
    const declared = { ...compactExtraction(), contract_version: REFRESH_PROFILE_CONTRACT_VERSION };
    const results = await extractRefreshProfile([chunk()], { context,
      textClient: client([{ text: JSON.stringify(declared) }], []), maxOutputTokens: 512,
    });
    expect(results[0]!.extraction).toEqual(extraction());
  });

  it.each(["immo-pv-extraction-v8", "immo-pv-extraction-v7", "immo-pv-extraction-v6",
    "immo-pv-extraction-v5"])(
    "should reject declared legacy contract version %s with a named violation", async (contractVersion) => {
      const declared = { ...compactExtraction(), contract_version: contractVersion };
      await expect(extractRefreshProfile([chunk()], { context,
        textClient: client([{ text: JSON.stringify(declared) }], []), maxOutputTokens: 512,
      })).rejects.toThrow("contract_version_mismatch");
    });

  it("should accept absent v4 version while replacing five false identity fields", async () => {
    // Over the v9 excerpt floor: this case proves identity replacement, not the excerpt bound.
    const modelExcerpt = `Adoption du règlement ${oracle.bylawNumber}`;
    const legacy = extraction();
    legacy.nodes[0]!.citations = [{ source_file: "wrong.pdf", rawRef: "wrong-raw",
      docSha: "f".repeat(64), sourceUrl: "https://invalid.example/wrong.pdf", modality: "html",
      page: oracle.page, excerpt: modelExcerpt }] as unknown as
      NonNullable<Extraction["nodes"][number]["citations"]>;
    const results = await extractRefreshProfile([chunk(undefined,
      `[PDF PAGE 3]\n${oracle.excerpt}\n${modelExcerpt}`)], { context,
      textClient: client([{ text: JSON.stringify(legacy) }], []), maxOutputTokens: 512,
    });
    expect(results[0]!.extraction.nodes[0]!.citations![0]).toEqual({
      source_file: oracle.originalKey, rawRef: oracle.originalKey, docSha: oracle.docSha,
      sourceUrl: oracle.sourceUrl, modality: "pdf", page: oracle.page, excerpt: modelExcerpt,
    });
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

  it.each(["node", "edge"] as const)("should truncate a 260-character %s citation excerpt to a verbatim prefix",
    async (kind) => {
      const passage = `${oracle.excerpt} ${"é".repeat(260)}`;
      const longExcerpt = [...passage].slice(0, 260).join("");
      const value = kind === "node" ? compactExtraction() : compactEdgeExtraction();
      const citation = kind === "node" ? value.nodes[0]!.citations![0]! : value.edges[0]!.citations![0]!;
      citation.excerpt = longExcerpt;
      const results = await extractRefreshProfile([chunk(undefined, `[PDF PAGE 3]\n${passage}`)], { context,
        textClient: client([{ text: JSON.stringify(value) }], []), maxOutputTokens: 512,
      });
      const accepted = kind === "node" ? results[0]!.extraction.nodes[0]! : results[0]!.extraction.edges[0]!;
      const excerpt = accepted.citations![0]!.excerpt!;
      expect([...excerpt]).toHaveLength(200);
      expect(excerpt).toBe([...passage].slice(0, 200).join(""));
      expect(passage.startsWith(excerpt)).toBe(true);
    });

  it.each([200, 201, 260])("should keep %i out-of-BMP citation code points within the bound",
    async (codePointCount) => {
      const excerpt = "𐐀".repeat(codePointCount);
      const value = compactExtraction();
      value.nodes[0]!.citations![0]!.excerpt = excerpt;
      const results = await extractRefreshProfile([chunk(undefined,
        `[PDF PAGE 3]\n${oracle.excerpt}\n${excerpt}`)], { context,
        textClient: client([{ text: JSON.stringify(value) }], []), maxOutputTokens: 512,
      });
      // Code points, not UTF-16 units: each astral character counts once.
      expect([...results[0]!.extraction.nodes[0]!.citations![0]!.excerpt!])
        .toHaveLength(Math.min(codePointCount, 200));
    });

  it("should certify the frozen v13 page text by the hash the fixture declares", () => {
    // The manifest hash cannot be recomputed from the repository: the campaign manifest is not
    // versioned here. This one is computed on the string this file delivers, so an edit to the
    // page text below fails here instead of silently invalidating the frozen contrastive pair.
    expect(createHash("sha256").update(v13Cases.pageText, "utf8").digest("hex"))
      .toBe(v13Cases.provenance.pageTextSha256);
    expect(v13Cases.provenance.manifestPageTextSha256)
      .not.toBe(v13Cases.provenance.pageTextSha256);
  });

  it("should accept the real v11 excerpt refused as too long, truncated to its verbatim prefix", async () => {
    const measured = v11Cases.overlongExcerpt;
    expect(measured.codePoints).toBe(203);
    expect(measured.refusedAsUnderV7).toBe("entity_citation_excerpt_too_long");
    expect(measured.handledUnderV9).toBe("truncated_to_a_200_code_point_verbatim_prefix");
    const value = compactExtraction();
    value.nodes[0]!.citations![0]!.excerpt = measured.excerpt;
    const results = await extractRefreshProfile([chunk(undefined,
      `[PDF PAGE 3]\n${measured.pageText}`)], { context,
      textClient: client([{ text: JSON.stringify(value) }], []), maxOutputTokens: 512,
    });
    const excerpt = results[0]!.extraction.nodes[0]!.citations![0]!.excerpt!;
    expect(excerpt).toBe([...measured.excerpt].slice(0, 200).join(""));
    expect(measured.pageText).toContain(excerpt);
  });

  it("should refuse the real v11 short-label excerpt by name before anchoring", async () => {
    const measured = v11Cases.shortLabelExcerpt;
    // Verbatim on its page, 12 code points and 8 once normalized. v8 refused it as an anchoring
    // failure, which named the wrong cause; v9 names the excerpt floor and never reaches the anchor,
    // whose own 12-normalized-character floor is left untouched.
    expect(measured.pageText).toContain(measured.excerpt);
    expect(measured.refusedAsUnderV7).toBe("ungrounded_pdf_excerpt");
    expect(measured.refusedAsUnderV9).toBe("entity_citation_excerpt_too_short");
    expect(measured.normalizedCodePoints).toBe(8);
    const value = compactExtraction();
    value.nodes[0]!.citations![0]!.excerpt = measured.excerpt;
    await expect(extractRefreshProfile([chunk(undefined, `[PDF PAGE 3]\n${measured.pageText}`)], { context,
      textClient: client([{ text: JSON.stringify(value) }], []), maxOutputTokens: 512,
    })).rejects.toThrow(measured.refusedAsUnderV9);
  });

  it("should refuse the real v13 zone label and accept the decision sentence of the same page",
    async () => {
      const { zoneLabelExcerpt, decisionExcerpt, pageText } = v13Cases;
      // Both strings are verbatim on page 12 of the frozen Saint-Etienne minutes; only the second
      // states the decision. This is the contrastive pair the v9 prompt now shows the model.
      expect(pageText).toContain(zoneLabelExcerpt.excerpt);
      expect(pageText).toContain(decisionExcerpt.excerpt);
      expect(zoneLabelExcerpt.codePoints).toBe(13);
      expect(zoneLabelExcerpt.refusedAsUnderV9).toBe("entity_citation_excerpt_too_short");
      const refused = compactExtraction();
      refused.nodes[0]!.citations![0]!.excerpt = zoneLabelExcerpt.excerpt;
      await expect(extractRefreshProfile([chunk(undefined, `[PDF PAGE 3]\n${pageText}`)], { context,
        textClient: client([{ text: JSON.stringify(refused) }], []), maxOutputTokens: 512,
      })).rejects.toThrow("entity_citation_excerpt_too_short");
      const accepted = compactExtraction();
      accepted.nodes[0]!.citations![0]!.excerpt = decisionExcerpt.excerpt;
      const results = await extractRefreshProfile([chunk(undefined, `[PDF PAGE 3]\n${pageText}`)], {
        context, textClient: client([{ text: JSON.stringify(accepted) }], []), maxOutputTokens: 512,
      });
      expect(results[0]!.extraction.nodes[0]!.citations![0]!.excerpt).toBe(decisionExcerpt.excerpt);
    });

  it.each([["refuse", 19], ["accept", 20]] as const)(
    "should %s an entity citation excerpt of exactly %i code points", async (outcome, codePoints) => {
      // The floor counts code points, like the upper bound, and is checked before the page anchor.
      const excerpt = [...`${oracle.excerpt}`].slice(0, codePoints).join("");
      expect([...excerpt]).toHaveLength(codePoints);
      const value = compactExtraction();
      value.nodes[0]!.citations![0]!.excerpt = excerpt;
      const run = () => extractRefreshProfile([chunk()], { context,
        textClient: client([{ text: JSON.stringify(value) }], []), maxOutputTokens: 512 });
      if (outcome === "refuse") {
        await expect(run()).rejects.toThrow("entity_citation_excerpt_too_short");
      } else {
        expect((await run())[0]!.extraction.nodes[0]!.citations![0]!.excerpt).toBe(excerpt);
      }
    });

  it("should refuse a short entity citation excerpt before its page anchor is even checked", async () => {
    // Under v8 this citation was refused as ungrounded_pdf_excerpt on a page it does not appear on;
    // v9 names the excerpt floor instead, so the refusal states the cause the model can act on.
    const value = compactExtraction();
    value.nodes[0]!.citations![0]!.excerpt = "Zone : COM-1";
    const error = await captureExtractionError(JSON.stringify(value));
    expect(error.message).toContain("entity_citation_excerpt_too_short");
    expect(error.message).not.toContain("ungrounded PDF excerpt");
  });

  it("should leave out-of-BMP short excerpts measured in code points, not UTF-16 units", async () => {
    // 19 astral characters are 38 UTF-16 units: counting units would wrongly accept them.
    const value = compactExtraction();
    value.nodes[0]!.citations![0]!.excerpt = "𐐀".repeat(19);
    await expect(extractRefreshProfile([chunk()], { context,
      textClient: client([{ text: JSON.stringify(value) }], []), maxOutputTokens: 512,
    })).rejects.toThrow("entity_citation_excerpt_too_short");
  });

  it("should keep evidence excerpts out of the entity citation floor", async () => {
    // evidence[] declares minLength 1 and carries its own contract: the v9 floor is an entity
    // citation rule only. This 19-code-point excerpt anchors, so it stays accepted.
    const shortExcerpt = [...oracle.excerpt].slice(0, 19).join("");
    const value = extraction();
    value.evidence = [{ id: "ev-short", source_file: oracle.originalKey, rawRef: oracle.originalKey,
      docSha: oracle.docSha, sourceUrl: oracle.sourceUrl, modality: "pdf", page: oracle.page,
      excerpt: shortExcerpt }];
    const results = await extractRefreshProfile([chunk()], { context,
      textClient: client([{ text: JSON.stringify(value) }], []), maxOutputTokens: 512,
    });
    expect(results[0]!.extraction.evidence![0]!.excerpt).toHaveLength(19);
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

  it("should apply typographic page anchoring to evidence excerpts", async () => {
    const pageText = `${oracle.excerpt}\nLa demande de M. YvesMalouin vise la propriété désignée.`;
    const value = extraction();
    value.evidence = [{ id: "ev-normalized", source_file: oracle.originalKey, rawRef: oracle.originalKey,
      docSha: oracle.docSha, sourceUrl: oracle.sourceUrl, modality: "pdf", page: oracle.page,
      excerpt: "YVES-MALOUÏN vise la propriété" }];
    await expect(extractRefreshProfile([chunk(undefined, `[PDF PAGE 3]\n${pageText}`)], { context,
      textClient: client([{ text: JSON.stringify(value) }], []), maxOutputTokens: 512,
    })).resolves.toHaveLength(1);
  });

  it("should refuse a compact evidence item and accept the full one on the same excerpt", async () => {
    // The compact page/excerpt shape holds for entity citations only, because the profile injects
    // the PDF identity there and nowhere else. The schema no longer announces it under evidence:
    // emitted as an evidence item it is refused, on the identity the profile never injects.
    const compact = extraction();
    compact.evidence = [{ id: "ev-compact", page: oracle.page, excerpt: oracle.excerpt } as
      unknown as NonNullable<Extraction["evidence"]>[number]];
    const error = await captureExtractionError(JSON.stringify(compact));
    expect(error.message).toContain("invalid original PDF identity");
    const full = extraction();
    full.evidence = [{ id: "ev-full", source_file: oracle.originalKey, rawRef: oracle.originalKey,
      docSha: oracle.docSha, sourceUrl: oracle.sourceUrl, modality: "pdf", page: oracle.page,
      excerpt: oracle.excerpt }];
    const results = await extractRefreshProfile([chunk()], { context,
      textClient: client([{ text: JSON.stringify(full) }], []), maxOutputTokens: 512,
    });
    expect(results[0]!.extraction.evidence![0]!.id).toBe("ev-full");
  });

  it.each([
    ["the last line of the real v13 page", "ADOPTÉE", 7],
    ["a punctuated 20-code-point excerpt", "1 2 3 4 5 6 7 8 9 10", 11],
  ])("should refuse %s in evidence as excerpt_below_anchor_floor, not as ungrounded",
    async (_case, excerpt, normalizedCodePoints) => {
      // Both strings are verbatim on the cited page: naming them ungrounded stated a cause that is
      // false. The anchor floor is 12 normalized code points and now carries its own refusal.
      const pageText = `${oracle.excerpt}\n${v13Cases.pageText}\n${excerpt}`;
      expect(pageText).toContain(excerpt);
      const value = extraction();
      value.evidence = [{ id: "ev-floor", source_file: oracle.originalKey, rawRef: oracle.originalKey,
        docSha: oracle.docSha, sourceUrl: oracle.sourceUrl, modality: "pdf", page: oracle.page,
        excerpt }];
      const error = await captureExtractionError(JSON.stringify(value), `[PDF PAGE 3]\n${pageText}`);
      expect(error.message).toContain("excerpt_below_anchor_floor");
      expect(error.message).toContain(`${normalizedCodePoints} letters and digits`);
      expect(error.message).not.toContain("ungrounded PDF excerpt");
    });

  it("should accept an evidence excerpt of exactly 12 normalized code points", async () => {
    // The announced minLength is the floor the anchor enforces, in the unit the model can count.
    const excerpt = "ADOPTÉE 12345";
    expect([...excerpt.normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "")
      .toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")]).toHaveLength(12);
    const value = extraction();
    value.evidence = [{ id: "ev-floor-exact", source_file: oracle.originalKey, rawRef: oracle.originalKey,
      docSha: oracle.docSha, sourceUrl: oracle.sourceUrl, modality: "pdf", page: oracle.page, excerpt }];
    const results = await extractRefreshProfile([chunk(undefined,
      `[PDF PAGE 3]\n${oracle.excerpt}\n${excerpt}`)], { context,
      textClient: client([{ text: JSON.stringify(value) }], []), maxOutputTokens: 512,
    });
    expect(results[0]!.extraction.evidence![0]!.excerpt).toBe(excerpt);
  });

  it("should refuse a 20-code-point entity citation excerpt that normalizes under the anchor floor",
    async () => {
      // The two floors are expressed in different units: 20 raw code points in the schema, 12
      // normalized in the anchor. This excerpt clears the first and fails the second, verbatim on
      // its page; it is refused once, under the single name the prompt teaches.
      const excerpt = "1 2 3 4 5 6 7 8 9 10";
      expect([...excerpt]).toHaveLength(20);
      const value = compactExtraction();
      value.nodes[0]!.citations![0]!.excerpt = excerpt;
      const error = await captureExtractionError(JSON.stringify(value),
        `[PDF PAGE 3]\n${oracle.excerpt}\n${excerpt}`);
      expect(error.message).toContain("entity_citation_excerpt_too_short");
      expect(error.message).toContain("20 code points and 11 once normalized");
      expect(error.message).not.toContain("ungrounded PDF excerpt");
      expect(error.message).not.toContain("excerpt_below_anchor_floor");
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
    expect(REFRESH_PROFILE_CONTRACT_VERSION).toBe("immo-pv-extraction-v9");
    expect(schema.contract_version).toBe(REFRESH_PROFILE_CONTRACT_VERSION);
    expect(schema.ontology.node_properties.Signal.reglement_number.description).toContain("ANTI-INVENTION");
    const nodeStatuses = ["candidate", "attached", "needs_review", "validated", "rejected", "superseded"];
    expect(context.profile.hardening.statuses).toEqual(nodeStatuses);
    for (const nodeType of ["Constraint", "Bylaw"]) {
      expect(schema.ontology.node_properties[nodeType].status).toEqual({
        type: "string", enum: nodeStatuses,
        description: "Exact node status accepted by the product validator.",
      });
    }
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
      required_for: ["every edge"],
    });
    expect(schema.graph_contract.entity_citations).toMatchObject({
      node_field: "nodes[].citations", edge_field: "edges[].citations",
      required_for: ["every node", "every edge"], minItems: 1,
    });
    expect(schema.graph_contract.entity_citations.items.required).toEqual(["page", "excerpt"]);
    expect(schema.graph_contract.entity_citations.items.properties).toEqual({
      page: { enum: [3] }, excerpt: { type: "string", minLength: 20, maxLength: 200,
        description: "Exact beginning of the decision sentence, 20 to 200 characters, "
          + "copied verbatim and never completed or corrected. A field label such as "
          + "\"Zone : RUR-12\" is a property, never an excerpt." },
    });
    expect(schema.graph_contract.entity_citations.items.description)
      .toContain("entity_citation_excerpt_too_short");
    expect(schema.graph_contract.entity_citations.items.description)
      .toContain("under 12 once normalized to letters and digits");
    expect(schema.evidence.pdf_identity).toMatchObject({ docSha: oracle.docSha, rawRef: oracle.originalKey });
    // The compact page/excerpt shape is announced once, where it holds: the profile injects the PDF
    // identity into entity citations only. Announcing it under evidence too invited an evidence[]
    // the validator refuses for a missing identity it never injects there.
    expect(schema.evidence).not.toHaveProperty("citation");
    expect(Object.keys(schema.evidence)).toEqual(["pdf_identity", "allowedPages", "evidence_item"]);
    expect(schema.evidence.evidence_item.required).toContain("modality");
    expect(schema.evidence.evidence_item.required).toEqual(
      ["id", "source_file", "rawRef", "docSha", "sourceUrl", "modality", "page", "excerpt"]);
    // The announced floor is the one the anchor enforces, in the unit the model can count.
    expect(schema.evidence.evidence_item.properties.excerpt.minLength).toBe(12);
    expect(schema.evidence.evidence_item.properties.excerpt.description)
      .toContain("excerpt_below_anchor_floor");
    expect(schema.evidence.allowedPages).toEqual([3]);
    expect(seen[0]).toMatchObject({ maxOutputTokens: 512 });
    expect(seen[0]!.prompt).toContain(`[PDF PAGE 3]\n${oracle.excerpt}`);
    expect(seen[0]!.prompt).toContain('Every node file_type must be "document"');
    expect(seen[0]!.prompt).toContain("never emit a numeric confidence");
    expect(seen[0]!.prompt).toContain("arrays of string IDs from evidence[].id");
    expect(seen[0]!.prompt).toContain("Evidence refs do not replace citations");
    expect(seen[0]!.prompt).toContain("use only ontology.node_properties.<node_type>.status.enum");
    expect(seen[0]!.prompt).toContain(`- allowed_statuses: ${nodeStatuses.join(", ")}`);
    expect(seen[0]!.prompt).toContain("Every edge must carry at least one evidence_refs ID that exists in evidence[]");
    expect(seen[0]!.prompt).toContain('{"edges":[{"evidence_refs":["ev-1"]}],"evidence":[{"id":"ev-1"}]}');
    expect(seen[0]!.prompt).toContain("Every node and every edge must include a non-empty citations array");
    expect(seen[0]!.prompt).toContain("Do not repeat the document identity inside citations");
    expect(seen[0]!.prompt).toContain("exact beginning of the cited passage, between 20 and 200 characters");
    expect(seen[0]!.prompt).toContain("never complete or correct it");
    expect(seen[0]!.prompt).toContain("The excerpt carries the act, never a bare field label");
    expect(seen[0]!.prompt).toContain("put the zone code in the node property (Zone.code,");
    // Measured on the v14 Valcourt control: the first v9 wording collapsed an agenda to an empty
    // extraction, 56 output tokens against 6 173 under v8 on the same document and cap.
    expect(seen[0]!.prompt).toContain("the listed item is the act itself");
    expect(seen[0]!.prompt).toContain("Never return an empty extraction merely because");
    // The contrastive pair is the measured v13 one, both strings verbatim on the same real PV page.
    expect(seen[0]!.prompt).toContain(`excerpt "${v13Cases.zoneLabelExcerpt.excerpt}" is refused`);
    expect(seen[0]!.prompt).toContain(`"${v13Cases.decisionExcerpt.excerpt}" is correct`);
    expect(v13Cases.pageText).toContain(v13Cases.zoneLabelExcerpt.excerpt);
    expect(v13Cases.pageText).toContain(v13Cases.decisionExcerpt.excerpt);
    expect(seen[0]!.prompt).toContain("refused as entity_citation_excerpt_too_short, before");
    expect(seen[0]!.prompt).toContain("until you pass 20 characters, without inventing the continuation");
    // The v7 mid-word cut instruction is gone: measured v11 output obeys it and still overshoots.
    expect(seen[0]!.prompt).not.toContain("cut it off");
    expect(seen[0]!.prompt).toContain('PDF text says "YvesMalouin"');
    expect(seen[0]!.prompt).toContain('never "Yves-Malouin"');
  });

  it("should reject the page-3 quotation when the model attributes it to page 1", async () => {
    const seen: TextJsonGenerationInput[] = [];
    await expect(extractRefreshProfile([chunk()], {
      context, textClient: client([{ text: JSON.stringify(extraction(1)) }], seen), maxOutputTokens: 512,
    })).rejects.toThrow("invalid original PDF page");
    expect(seen).toHaveLength(1);
  });

  it("should enforce both physical page boundaries in a multi-page chunk", async () => {
    const firstExcerpt = "First-page regulatory finding.";
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
    // An empty excerpt is a string of zero code points: v9 names the floor it violates.
    await reject((value) => { value.nodes[0]!.citations![0]!.excerpt = ""; },
      "entity_citation_excerpt_too_short");
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
