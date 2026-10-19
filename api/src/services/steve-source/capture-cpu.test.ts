import { describe, it } from "vitest";
import { runCaptureProbe } from "./capture-stress.fixture.js";

describe("capture CPU bounds", () => {
  it("merges 499990 overlapping column spans before expanding at most 16384 columns", () => {
    runCaptureProbe(`
      const { readHiddenColumns } = await import(${JSON.stringify(new URL("./sheet-parse.ts", import.meta.url).href)});
      const col = { name: 'col', attrs: { min: '1', max: '16384', hidden: '1' }, children: [], text: '' };
      const cols = { name: 'cols', attrs: {}, children: Array(499990).fill(col), text: '' };
      const ws = { name: 'worksheet', attrs: {}, children: [cols], text: '' };
      const hidden = readHiddenColumns(ws, 'Synthetic');
      assert.equal(hidden.length, 16384);
      assert.equal(hidden[0], 1);
      assert.equal(hidden.at(-1), 16384);
    `, 2000);
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
