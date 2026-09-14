import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const generated = '.generated';
const current = `${generated}/current-report.pdf`;
const previous = '../../reports/rapport-mois-2026-07-13_2026-08-09.pdf';
const finalPdf = '../../reports/rapport-mois-2026-08-10_2026-09-13.pdf';
const manifestPath = '../../reports/architecture-monthly/evidence-manifest-2026-09-13.json';
const render = JSON.parse(await readFile(`${generated}/report-render.json`, 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hashFile = async file => sha256(await readFile(file));
const pages = async file => Number((await exec('pdfinfo', [file])).stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
const ignoreMissing = async file => { try { await unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } };

await mkdir(generated, { recursive: true });
await ignoreMissing(finalPdf);
// v11, owner decision: the preceding report is no longer concatenated nor
// attached to this PDF. The document ends after its annex pages and cites the
// predecessor by path. Nothing is regenerated for the predecessor; it is only
// read to record what the citation points at.
await copyFile(current, finalPdf);
const currentPages = await pages(current), finalPages = await pages(finalPdf);
if (finalPages !== currentPages) throw Error('the final PDF is not the report alone');
const text = (await exec('pdftotext', [finalPdf, '-'])).stdout;
if (/Rapport d[’']étude/.test(text)) throw Error('the preceding report is still embedded in the pages');

const captureById = Object.fromEntries(render.captures.map(capture => [capture.id, capture]));
const graphPages = render.annexPages.map((annex, index) => {
  const capture = captureById[annex.sceneId];
  const page = currentPages - render.annexPages.length + index + 1;
  return { sceneId: annex.sceneId, annex: annex.label, part: annex.part,
    pair: capture.pair, date: capture.date, sceneHash: capture.sceneHash,
    page, captureSha256: capture.captureSha256, widthPx: capture.width, heightPx: capture.height,
    pageFit: annex.fit, measuredFit: annex.measuredFit, measuredTypePt: annex.measuredTypePt,
    commentLines: annex.commentLines, wholeScene: true,
    nativeScale: capture.scale, deviceScaleFactor: render.chromium.deviceScaleFactor,
    effectiveTypePt: annex.effectiveTypePt };
});
for (const graph of graphPages) {
  const prefix = `${generated}/report-graph-${graph.sceneId}`;
  await exec('pdftoppm', ['-png', '-r', '110', '-cropbox', '-singlefile', '-f', String(graph.page), '-l', String(graph.page), finalPdf, prefix]);
  graph.renderedPagePngSha256 = await hashFile(`${prefix}.png`);
  graph.renderedPagePng = `${prefix}.png`;
}
// No type floor any more: the owner ratified the whole scene on one page over a
// split kept above 6 pt. The printed size is measured and published instead.
const minTypePt = Math.min(...graphPages.map(graph => graph.measuredTypePt));
const inlineMinTypePt = Math.min(...render.inline.map(figure => 22 * figure.fit * 0.75));
for (const graph of graphPages) {
  if (!Number.isFinite(graph.measuredTypePt)) throw Error(`${graph.annex}: no measured type size`);
  if (graph.commentLines < 3) throw Error(`${graph.annex}: transition commentary shorter than three lines`);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.report = {
  markdown: 'rapport-mois-2026-08-10_2026-09-13.md', html: 'rapport-mois-2026-08-10_2026-09-13.html', pdf: 'rapport-mois-2026-08-10_2026-09-13.pdf',
  markdownSha256: await hashFile('../../reports/rapport-mois-2026-08-10_2026-09-13.md'),
  htmlSha256: await hashFile('../../reports/rapport-mois-2026-08-10_2026-09-13.html'),
  pdfSha256: await hashFile(finalPdf), currentReportPages: currentPages, totalPages: finalPages,
  chromium: render.chromium,
  diagramPage: { paper: render.paper.annex, orientation: 'portrait', mode: render.paper.annexMode,
    widthPx: Math.round(render.paper.annexBoxPx.width), heightPx: Math.round(render.paper.annexBoxPx.height),
    imageBoxPx: { widthPx: Math.round(render.paper.annexImageBoxPx.width), heightPx: Math.round(render.paper.annexImageBoxPx.height) },
    printScale: 1, minTypePt, inlineMinTypePt, typeFloorPt: null },
  inlineScenes: render.inline,
  graphPages,
};
manifest.previousReport = {
  file: 'rapport-mois-2026-07-13_2026-08-09.pdf',
  path: 'docs/reports/rapport-mois-2026-07-13_2026-08-09.pdf',
  sha256: await hashFile(previous), pages: await pages(previous),
  embedded: false, attached: false,
  note: 'v11: cited by path only. The concatenated copy and the PDF attachment were removed on owner instruction.',
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ finalPages, currentPages, previousEmbedded: false,
  graphPages: graphPages.map(graph => [graph.annex, graph.page, Number(graph.measuredTypePt.toFixed(2))]),
  minTypePt: Number(minTypePt.toFixed(2)), inlineMinTypePt: Number(inlineMinTypePt.toFixed(2)) }));
