import { describe, it } from "vitest";
import { runCaptureProbe } from "./capture-stress.fixture.js";

describe("capture CPU bounds", () => {
  it("merges 499990 overlapping column spans into one interval without expansion", () => {
    runCaptureProbe(`
      const { readHiddenColumns } = await import(${JSON.stringify(new URL("./sheet-parse.ts", import.meta.url).href)});
      const col = { name: 'col', attrs: { min: '1', max: '16384', hidden: '1' }, children: [], text: '' };
      const cols = { name: 'cols', attrs: {}, children: Array(499990).fill(col), text: '' };
      const ws = { name: 'worksheet', attrs: {}, children: [cols], text: '' };
      const hidden = readHiddenColumns(ws, 'Synthetic');
      assert.deepEqual(hidden, [{ min: 1, max: 16384 }]);
    `, 2000);
  });

  it("keeps ten full-width hidden intervals bounded without per-column objects", () => {
    runCaptureProbe(`
      const sheet = '<worksheet><cols><col min="2" max="16384" hidden="1"/></cols></worksheet>';
      const inventory = captureWorkbookInventory(repeatedSheetWorkbook(10, sheet));
      assert.equal(inventory.hiddenColumns.length, 10);
      assert.deepEqual(inventory.hiddenColumns[0], { sheet: 'Synthetic 1', sheetId: 1, min: 2, max: 16384 });
    `);
  });

  it("rejects an archive with 499990 hidden full-width column spans within five seconds", () => {
    runCaptureProbe(`
      const sheet = '<worksheet><cols>' + '<col min="1" max="16384" hidden="1"/>'.repeat(499990) + '</cols></worksheet>';
      assert.throws(() => captureWorkbookInventory(repeatedSheetWorkbook(1, sheet)),
        { name: 'SteveCaptureError', message: 'XML capture exceeds the 1000000-attribute limit' });
    `);
  });

  it("resolves inherited namespaces once for 2000 sheets within three seconds", () => {
    runCaptureProbe(`
      const declarations = 'xmlns:probe="urn:probe" ' + Array.from({ length: 240 }, (_, i) =>
        'xmlns:n' + i + '="urn:synthetic:' + i + '"').join(' ');
      const bytes = repeatedSheetWorkbook(2000, '<worksheet/>', declarations);
      const entries = Object.entries;
      let inheritedScans = 0;
      Object.entries = function(value) {
        if (value['xmlns:probe'] === 'urn:probe') inheritedScans++;
        return entries(value);
      };
      try {
        assert.equal(captureWorkbookInventory(bytes).sheets.length, 2000);
      } finally { Object.entries = entries; }
      assert.equal(inheritedScans, 1);
    `, 3000);
  });
});
