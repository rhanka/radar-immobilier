// bench-v11: download the 100 v101b PDFs, verify sha256 + frozen text.
// Usage: node full/dl-corpus.mjs  (reads harness/manifest-v101b.json under
// BENCH_DIR, default: this harness). Only the extracted text is kept:
// each PDF is deleted right after its text is written and verified, unless
// BENCH_KEEP_PDF=1. An optional pre-downloaded cache can be pointed to with
// BENCH_CACHE_DIR (layout: workers/<city>/grounding-work/pdfs/<sha256>.pdf).
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DIR = process.env.BENCH_DIR ?? new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const manifest = JSON.parse(await readFile(`${DIR}/harness/manifest-v101b.json`, "utf8"));
await mkdir(`${DIR}/full/corpus/pdf`, { recursive: true });
await mkdir(`${DIR}/full/corpus/text`, { recursive: true });

// Reuse pilot PDFs already verified against the same manifest, when present.
if (existsSync(`${DIR}/corpus/picked.json`)) {
  const pilotIds = JSON.parse(await readFile(`${DIR}/corpus/picked.json`, "utf8"));
  for (const id of pilotIds) {
    try { await copyFile(`${DIR}/corpus/pdf/${id}.pdf`, `${DIR}/full/corpus/pdf/${id}.pdf`); } catch { /* pilot pdf absent: skip */ }
  }
}

const UA = "radar-immobilier/0.1 (+bench-v11 corpus verification)";
const rows = [];
for (const doc of manifest.documents) {
  const pdfPath = `${DIR}/full/corpus/pdf/${doc.id}.pdf`;
  // Resume: a verified text already on disk needs no re-download (the PDF
  // itself is deleted after extraction unless BENCH_KEEP_PDF=1).
  try {
    const existingText = await readFile(`${DIR}/full/corpus/text/${doc.id}.txt`, "utf8");
    if (sha256Hex(existingText) === doc.textSha256) {
      rows.push({ id: doc.id, bytes: null, textBytes: Buffer.byteLength(existingText), ok: true, cacheFallback: false, resumed: true });
      console.log(`${doc.id} ok (resumed, text verified)`);
      continue;
    }
  } catch { /* fetch below */ }
  let pdf;
  try { pdf = await readFile(pdfPath); } catch { pdf = null; }
  if (pdf && sha256Hex(pdf) !== doc.sha256) pdf = null; // refetch on mismatch
  if (!pdf) {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const res = await fetch(doc.sourceUrl, { headers: { "user-agent": UA }, redirect: "follow" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        pdf = Buffer.from(await res.arrayBuffer());
      } catch (error) {
        if (attempt >= 4) {
          console.log(`${doc.id} DL-FAIL ${error.message}`);
          pdf = "FAILED";
          break;
        }
        await sleep(5000 * attempt);
        continue;
      }
      break;
    }
    if (pdf === "FAILED" || (pdf && sha256Hex(pdf) !== doc.sha256)) {
      // Optional fallback: frozen-sha copy from a cache pointed to by
      // BENCH_CACHE_DIR (read-only). Skipped when the variable is unset.
      const cacheRoot = process.env.BENCH_CACHE_DIR;
      if (!cacheRoot) {
        rows.push({ id: doc.id, ok: false, reason: `no frozen copy (dl: ${pdf === "FAILED" ? "failed" : "sha drift"}; BENCH_CACHE_DIR unset)` });
        console.log(`${doc.id} NO-FROZEN-COPY`);
        continue;
      }
      const cached = `${cacheRoot}/workers/${doc.city}/grounding-work/pdfs/${doc.sha256}.pdf`;
      try {
        const bytes = await readFile(cached);
        if (sha256Hex(bytes) !== doc.sha256) throw new Error("cache sha mismatch");
        pdf = Buffer.from(bytes);
        doc._cacheFallback = true;
        console.log(`${doc.id} CACHE-FALLBACK ok`);
      } catch (error) {
        rows.push({ id: doc.id, ok: false, reason: `no frozen copy (dl: ${pdf === "FAILED" ? "failed" : "sha drift"}; cache: ${error.message})` });
        console.log(`${doc.id} NO-FROZEN-COPY`);
        continue;
      }
    }
    await writeFile(pdfPath, pdf);
    await sleep(3000);
  }
  const { stdout } = await execFileAsync("pdftotext", ["-q", "-enc", "UTF-8", pdfPath, "-"], { maxBuffer: 64 * 1024 * 1024 });
  if (sha256Hex(stdout) !== doc.textSha256) {
    rows.push({ id: doc.id, ok: false, reason: "textSha256 mismatch (parser drift)" });
    console.log(`${doc.id} TEXT-MISMATCH`);
    continue;
  }
  await writeFile(`${DIR}/full/corpus/text/${doc.id}.txt`, stdout);
  if (process.env.BENCH_KEEP_PDF !== "1") await unlink(pdfPath).catch(() => {});
  rows.push({ id: doc.id, bytes: pdf.length, textBytes: Buffer.byteLength(stdout), ok: true, cacheFallback: Boolean(doc._cacheFallback) });
  console.log(`${doc.id} ok bytes=${pdf.length}`);
}
await writeFile(`${DIR}/full/corpus/verify.json`, JSON.stringify({ count: rows.length, rows }, null, 1));
console.log(`DONE ${rows.length}/100`);
