import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = process.env.BENCHMARK_REPOSITORY_ROOT;
if (!root) throw new Error("BENCHMARK_REPOSITORY_ROOT is required");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(await readFile(resolve(root,
  "docs/reviews/refresh-benchmark/manifest.json"), "utf8"));
const prompts = JSON.parse(await readFile(resolve(root,
  "docs/reviews/refresh-benchmark/prompt-freeze.json"), "utf8"));

test("the five immutable PDFs and page texts match the manifest", async () => {
  assert.equal(manifest.documents.length, 5);
  for (const document of manifest.documents) {
    const worker = resolve(manifest.sourceRunRoot, "workers", document.city);
    const pdf = await readFile(resolve(worker, "corpus", `${document.sha256}.pdf`));
    const text = await readFile(resolve(worker, "parsed", document.city,
      `${document.sha256}.txt`), "utf8");
    const pages = text.split("\f").map((page) => page.replace(/\r\n/g, "\n"));
    if (pages.at(-1) === "") pages.pop();
    assert.equal(sha256(pdf), document.sha256);
    assert.equal(sha256(text), document.textSha256);
    assert.equal(pages.length, document.pageCount);
    assert.deepEqual(pages.map(sha256), document.pageTextSha256);
    assert.equal(document.sourceUrl.startsWith("https://"), true);
  }
});

test("prompt contract covers each input once and is tied to corrected T1", async () => {
  assert.equal(prompts.graphifyVersion, "0.18.0");
  assert.equal(prompts.meshVersion, "0.19.0");
  assert.equal(prompts.t1Commit, "f9b311da536bda2e1442d154a05599c35b482518");
  assert.equal(sha256(prompts.systemPrompt), prompts.systemPromptSha256);
  assert.deepEqual(prompts.documents.map(({ id }) => id).sort(),
    manifest.documents.map(({ id }) => id).sort());
  for (const document of prompts.documents) {
    assert.match(document.schemaSha256, /^[0-9a-f]{64}$/);
    assert.match(document.promptSha256, /^[0-9a-f]{64}$/);
    assert.equal(document.pages.length,
      manifest.documents.find(({ id }) => id === document.id).pageCount);
  }
});

test("controls keep their regulatory meaning", () => {
  const negative = manifest.documents.find(({ id }) => id.endsWith("negative"));
  const agenda = manifest.documents.find(({ id }) => id.startsWith("wickham"));
  assert.match(negative.selectionRationale, /Observed no-finding control/);
  assert.match(agenda.selectionRationale, /future agenda/);
  assert.match(agenda.selectionRationale, /no completed adoption/);
});
