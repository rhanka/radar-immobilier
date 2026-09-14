import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const generated = '.generated';
const current = `${generated}/current-report.pdf`;
const combined = `${generated}/current-with-appendix.pdf`;
const attachment = `${generated}/study-2026-08-report.pdf`;
const extracted = `${generated}/extracted-study-2026-08-report.pdf`;
const previous = '../../spec/reports/study-2026-08/report.pdf';
const finalPdf = '../../reports/architecture-monthly/report-through-2026-09-13.pdf';
const manifestPath = '../../reports/architecture-monthly/evidence-manifest-2026-09-13.json';
const render = JSON.parse(await readFile(`${generated}/report-render.json`, 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hashFile = async file => sha256(await readFile(file));
const pages = async file => Number((await exec('pdfinfo', [file])).stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
const ignoreMissing = async file => { try { await unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } };

await mkdir(generated, { recursive: true });
for (const file of [combined, attachment, extracted, finalPdf]) await ignoreMissing(file);
await copyFile(previous, attachment);
await exec('pdfunite', [current, previous, combined]);
await exec('pdfattach', [combined, attachment, finalPdf]);
await exec('pdfdetach', ['-save', '1', '-o', extracted, finalPdf]);

const sourceSha256 = await hashFile(previous);
const extractedSha256 = await hashFile(extracted);
if (sourceSha256 !== '86ae37810016bca61cc897105121cfcbcd1951426fc889616ae1efe37ae29528') throw Error('preceding report source hash mismatch');
if (extractedSha256 !== sourceSha256) throw Error('embedded preceding report is not byte-identical');
const currentPages = await pages(current), sourcePages = await pages(previous), finalPages = await pages(finalPdf);
if (sourcePages !== 9 || finalPages !== currentPages + sourcePages) throw Error('visual appendix page count mismatch');

const poppler = (await exec('pdftoppm', ['-v'])).stderr.trim().split('\n')[0];
const flags = ['-png', '-r', '144', '-cropbox', '-singlefile'];
const sourcePageHashes = [], appendixPageHashes = [], pageMap = [];
for (let page = 1; page <= sourcePages; page++) {
  const sourcePrefix = `${generated}/previous-source-${page}`;
  const appendixPrefix = `${generated}/previous-appendix-${page}`;
  const finalPage = currentPages + page;
  await exec('pdftoppm', [...flags, '-f', String(page), '-l', String(page), previous, sourcePrefix]);
  await exec('pdftoppm', [...flags, '-f', String(finalPage), '-l', String(finalPage), finalPdf, appendixPrefix]);
  const sourceHash = await hashFile(`${sourcePrefix}.png`), appendixHash = await hashFile(`${appendixPrefix}.png`);
  if (sourceHash !== appendixHash) throw Error(`visual appendix page ${page} differs`);
  sourcePageHashes.push(sourceHash); appendixPageHashes.push(appendixHash);
  pageMap.push({ sourcePage: page, finalPage, sourcePngSha256: sourceHash, finalPngSha256: appendixHash });
}

const graphPages = render.captures.map((capture, index) => {
  const page = currentPages - render.captures.length + index + 1;
  return { sceneId: capture.id, pair: capture.pair, date: capture.date, sceneHash: capture.sceneHash,
    page, captureSha256: capture.captureSha256, widthPx: capture.width, heightPx: capture.height,
    nativeScale: capture.metrics.scale, deviceScaleFactor: capture.metrics.devicePixelRatio,
    effectiveTypePt: { title: 24, edge: 18, repo: 18, status: 16.5 } };
});
for (const graph of graphPages) {
  const prefix = `${generated}/report-graph-${graph.sceneId}`;
  await exec('pdftoppm', ['-png', '-r', '110', '-cropbox', '-singlefile', '-f', String(graph.page), '-l', String(graph.page), finalPdf, prefix]);
  graph.renderedPagePngSha256 = await hashFile(`${prefix}.png`);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.report = {
  markdown: 'report-through-2026-09-13.md', html: 'report-through-2026-09-13.html', pdf: 'report-through-2026-09-13.pdf',
  markdownSha256: await hashFile('../../reports/architecture-monthly/report-through-2026-09-13.md'),
  htmlSha256: await hashFile('../../reports/architecture-monthly/report-through-2026-09-13.html'),
  pdfSha256: await hashFile(finalPdf), currentReportPages: currentPages, totalPages: finalPages,
  chromium: render.chromium, diagramPage: { widthPx: render.paper.width, heightPx: render.paper.height, printScale: 1 },
  graphPages,
};
manifest.previousReport = {
  ...manifest.previousReport, sourcePages, currentReportEndPage: currentPages,
  graphPages: graphPages.map(graph => graph.page), predecessorStartPage: currentPages + 1, predecessorEndPage: finalPages,
  extractedAttachmentSha256: extractedSha256, renderer: poppler,
  flags: 'pdftoppm -png -r 144 -cropbox -singlefile',
  sourcePageHashes, appendixPageHashes, pageMap,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ finalPages, currentPages, graphPages: graphPages.map(graph => [graph.sceneId, graph.page]), previousPages: sourcePages, attachmentSha256: extractedSha256, visualParity: true }));
