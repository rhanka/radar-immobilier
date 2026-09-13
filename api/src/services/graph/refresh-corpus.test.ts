import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { materializeRefreshCorpus } from "./refresh-corpus.js";

const HEADER = "source_id\tcity_slug\tsha\trepresentation_key\tsidecar_key";
const encoder = new TextEncoder();

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture(bytes: Uint8Array, text = "page one\fpage two\f") {
  const digest = sha(bytes);
  const pdfKey = `raw/pv-waterloo/cas/${digest}.pdf`;
  const metaKey = `${pdfKey}.meta.json`;
  const manifest = `${HEADER}\npv-waterloo\twaterloo\t${digest}\t${pdfKey}\t${metaKey}\n`;
  return {
    digest,
    pdfKey,
    manifest,
    reader: {
      async get(key: string) {
        if (key === "manifest.tsv") return encoder.encode(manifest);
        if (key === pdfKey) return bytes;
        if (key === metaKey) return encoder.encode(JSON.stringify({
          sourceUrl: "https://ville.waterloo.qc.ca/pv.pdf",
        }));
        throw new Error(`missing ${key}`);
      },
    },
    extractPdf: async () => text,
  };
}

async function materialize(input: ReturnType<typeof fixture>) {
  return materializeRefreshCorpus({
    citySlug: "waterloo",
    manifestKey: "manifest.tsv",
    reader: input.reader,
    extractPdf: input.extractPdf,
  });
}

describe("refresh corpus", () => {
  it("should preserve original PDF identity and physical page mapping", async () => {
    const input = fixture(encoder.encode("pdf-a"));
    const corpus = await materialize(input);
    expect(corpus.documents[0]).toMatchObject({
      sha256: input.digest,
      originalKey: input.pdfKey,
      sourceUrl: "https://ville.waterloo.qc.ca/pv.pdf",
      pages: [{ page: 1, text: "page one" }, { page: 2, text: "page two" }],
    });
    expect(corpus.chunks[0]).toMatchObject({
      id: `${input.digest}.1`,
      pages: [1, 2],
    });
    expect(corpus.chunks[0]?.text).toContain("[PDF PAGE 2]\npage two");
  });

  it("should reject bytes that do not match the immutable manifest checksum", async () => {
    const input = fixture(encoder.encode("pdf-a"));
    const otherDigest = sha(encoder.encode("pdf-b"));
    const badManifest = input.manifest.replaceAll(input.digest, otherDigest);
    const reader = {
      async get(key: string) {
        if (key === "manifest.tsv") return encoder.encode(badManifest);
        return input.reader.get(key.replace(otherDigest, input.digest));
      },
    };
    await expect(materializeRefreshCorpus({
      citySlug: "waterloo", manifestKey: "manifest.tsv", reader,
      extractPdf: input.extractPdf,
    })).rejects.toThrow("Checksum mismatch");
  });

  it("should reject a CAS path outside its declared source and digest", async () => {
    const input = fixture(encoder.encode("pdf-a"));
    const invalid = input.manifest.replace("raw/pv-waterloo/", "raw/pv-other/");
    await expect(materializeRefreshCorpus({
      citySlug: "waterloo",
      manifestKey: "manifest.tsv",
      reader: { async get() { return encoder.encode(invalid); } },
      extractPdf: input.extractPdf,
    })).rejects.toThrow("Invalid CAS representation path");
  });

  it("should change the input hash with the immutable input bytes", async () => {
    const first = await materialize(fixture(encoder.encode("pdf-a")));
    const second = await materialize(fixture(encoder.encode("pdf-b")));
    expect(first.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.inputHash).not.toBe(first.inputHash);
  });

  it("should reject duplicate manifest inputs before reading documents", async () => {
    const input = fixture(encoder.encode("pdf-a"));
    const row = input.manifest.trimEnd().split("\n")[1];
    const duplicated = `${input.manifest}${row}\n`;
    await expect(materializeRefreshCorpus({
      citySlug: "waterloo",
      manifestKey: "manifest.tsv",
      reader: { async get() { return encoder.encode(duplicated); } },
      extractPdf: input.extractPdf,
    })).rejects.toThrow("Duplicate refresh input");
  });

  it("should keep every UTF-8 chunk within the PR678 large-input bound", async () => {
    const input = fixture(encoder.encode("pdf-large"), `${"é".repeat(70_000)}\f${"x".repeat(80_000)}\f`);
    const corpus = await materialize(input);
    expect(corpus.chunks.length).toBeGreaterThan(1);
    expect(corpus.chunks.every((chunk) => Buffer.byteLength(chunk.text) <= 120_000)).toBe(true);
    expect(corpus.chunks.flatMap((chunk) => chunk.pages)).toContain(2);
  });
});
