/**
 * Issue #805 — the documentary date reads page 1 only, so poppler is asked for
 * page 1 only (`pdftotext -l 1`) on a temp file that never outlives the call.
 * Requires poppler on PATH, like the preflight test of the same toolchain.
 */
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { SourceFetchError } from "./avis-publics-valleyfield.js";
import { pdfFirstPageToTextViaPoppler, pdfToTextViaPoppler } from "./reglements-urbanisme-valleyfield.js";

/** A valid two-page PDF with one line of Helvetica text per page. */
function twoPagePdf(first: string, second: string): Uint8Array {
  const content = (text: string) => `BT /F1 18 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content(first).length} >>\nstream\n${content(first)}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${content(second).length} >>\nstream\n${content(second)}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const tempDirs = async () => (await readdir(tmpdir())).filter((name) => name.startsWith("radar-pdf-page1-"));

describe("pdfFirstPageToTextViaPoppler (#805)", () => {
  const pdf = twoPagePdf("Seance du conseil PAGE ONE", "Annexe PAGE TWO");

  it("returns the first page only, where the full extraction returns both", async () => {
    const full = await pdfToTextViaPoppler("https://example.org/a.pdf")(pdf, 30_000);
    expect(full).toContain("PAGE ONE");
    expect(full).toContain("PAGE TWO");

    const before = await tempDirs();
    const firstPage = await pdfFirstPageToTextViaPoppler("https://example.org/a.pdf")(pdf, 30_000);
    expect(firstPage).toContain("PAGE ONE");
    expect(firstPage).not.toContain("PAGE TWO");
    expect(await tempDirs()).toEqual(before);
  });

  it("removes its temp file and raises a typed parse error on an unreadable PDF", async () => {
    const before = await tempDirs();
    const error = await pdfFirstPageToTextViaPoppler("https://example.org/broken.pdf")(
      new TextEncoder().encode("not a pdf"), 30_000).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceFetchError);
    expect(error).toMatchObject({ kind: "parse", url: "https://example.org/broken.pdf" });
    expect(await tempDirs()).toEqual(before);
  });
});
