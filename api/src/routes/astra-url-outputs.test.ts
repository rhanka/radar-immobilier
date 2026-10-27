import { describe, expect, it } from "vitest";
import { z as bundledV3 } from "zod/v3";
import { contractSafeParse, ScrapeStatus, ProspectMark, ProspectMarkMarcheInput } from "@radar/domain";
import { RawDocumentRecordSchema } from "@radar/sources";
import { createMarkSchema } from "./prospect-marks.js";

const z3: typeof bundledV3 = process.env.ZOD3_REFERENCE
  ? (await import(/* @vite-ignore */ process.env.ZOD3_REFERENCE)).z : bundledV3;
const fields = [RawDocumentRecordSchema.shape.sourceUrl, ScrapeStatus.shape.siteUrl,
  createMarkSchema.options[1].shape.lienAnnonce, ProspectMark.shape.lienAnnonce,
  ProspectMarkMarcheInput.shape.lienAnnonce];
describe("Astra accepted URL values remain verbatim", () => {
  for (const input of [" https://example.com/document.pdf ", "\thttps://a.test/a",
    "https://a.test/a\tb", "https://a.test/a\rb", "https://a.test/a\nb",
    "https://a.test/a b", "HTTPS://A.TEST/a", "https://a.test/a%20b", "invalid", 42]) {
    it("preserves URL input and diagnostics " + JSON.stringify(input), () => {
      const expected = z3.string().url().safeParse(input);
      for (const field of fields) {
        const actual = contractSafeParse(field, input);
        expect(actual.success).toBe(expected.success);
        if (actual.success && expected.success) expect(actual.data).toEqual(expected.data);
        else if (!actual.success && !expected.success) expect(actual.error.issues).toEqual(expected.error.issues);
      }
    });
  }
});
