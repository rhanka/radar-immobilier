import { describe, it } from "vitest";
import { runCaptureProbe } from "./capture-stress.fixture.js";

describe("capture-wide allocation budgets", () => {
  it("rejects four retained autoFilter trees under a 512 MiB heap", () => {
    runCaptureProbe(`
      const sheet = '<worksheet><autoFilter ref="A1">' + '<a/>'.repeat(499990) + '</autoFilter></worksheet>';
      const bytes = repeatedSheetWorkbook(4, sheet);
      assert.throws(() => captureWorkbookInventory(bytes),
        { name: 'SteveCaptureError', message: 'XML capture exceeds the 500000-element limit' });
    `);
  });

  it("rejects 480000 elements with twenty attributes each under a 512 MiB heap", () => {
    runCaptureProbe(`
      const attrs = Array.from({ length: 20 }, (_, i) => ' ' + String.fromCharCode(97 + i) + '=""').join('');
      const bytes = repeatedSheetWorkbook(1, '<worksheet>' + ('<a' + attrs + '/>').repeat(480000) + '</worksheet>');
      assert.throws(() => captureWorkbookInventory(bytes),
        { name: 'SteveCaptureError', message: 'XML capture exceeds the 1000000-attribute limit' });
    `);
  });

  it("rejects eight sheets with 245760 cells each under a 512 MiB heap", () => {
    runCaptureProbe(`
      const row = '<row>' + '<c/>'.repeat(16384) + '</row>';
      const bytes = repeatedSheetWorkbook(8, '<worksheet><sheetData>' + row.repeat(15) + '</sheetData></worksheet>');
      assert.throws(() => captureWorkbookInventory(bytes),
        { name: 'SteveCaptureError', message: 'XML capture exceeds the 250000-cell limit' });
    `);
  });
});
