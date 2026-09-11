/* global process */
import fs from 'node:fs';
import path from 'node:path';

const [city, manifestPath, corpusDir, findingsDir, batchSha, outputPath] = process.argv.slice(2);
if (!city || !manifestPath || !corpusDir || !findingsDir || !batchSha || !outputPath) process.exit(2);

const rows = fs.readFileSync(manifestPath, 'utf8').trim().split(/\r?\n/u).slice(1)
  .map((line) => line.split('\t')).filter((row) => row[1] === city);
const nodes = [];
const edges = [];
const evidence = [];

const optional = ['zone_ref', 'no_lot', 'reglement_number', 'resolution', 'outcome'];
const citationFor = (id, rawRef, page, text) => ({ id, source_file: rawRef, page, text });

for (const [, , sha, primaryKey, sidecarKey] of rows) {
  const meta = sidecarKey === 'source-gap'
    ? {}
    : JSON.parse(fs.readFileSync(path.join(corpusDir, path.basename(sidecarKey)), 'utf8'));
  const sourceUrl = String(meta.sourceUrl || meta.url || '');
  const rawRef = primaryKey;
  const sourceId = `source-${city}-${sha.slice(0, 16)}`;
  const sourceEvidenceId = `ev-source-${city}-${sha.slice(0, 16)}`;
  const sourceCitation = citationFor(sourceEvidenceId, rawRef, 1, `CAS document ${sha}`);
  nodes.push({
    id: sourceId,
    label: `CAS document ${sha.slice(0, 12)}`,
    file_type: 'document',
    source_file: rawRef,
    node_type: 'Source',
    status: 'candidate',
    citations: [sourceCitation],
    evidence_refs: [sourceEvidenceId],
    properties: {
      docSha: sha, rawRef, sourceUrl, municipality: city,
      format: path.extname(primaryKey).slice(1), fetchedAt: meta.fetchedAt || '',
      ingestion_manifest_sha: batchSha,
    },
  });
  evidence.push({ id: sourceEvidenceId, text: `CAS document ${sha}`, source_file: rawRef, city, page: 1 });

  const findingPattern = new RegExp(`^${sha}\\.\\d+\\.json$`, 'u');
  const findingFiles = fs.readdirSync(findingsDir).filter((name) => findingPattern.test(name)).sort();
  let findingIndex = 0;
  for (const findingFile of findingFiles) {
    const payload = JSON.parse(fs.readFileSync(path.join(findingsDir, findingFile), 'utf8'));
    for (const finding of payload.findings || []) {
      findingIndex += 1;
      const suffix = `${sha.slice(0, 16)}-${findingIndex}`;
      const eventId = `event-${city}-cas-${suffix}`;
      const signalId = `signal-${city}-cas-${suffix}`;
      const evId = `ev-${city}-${suffix}`;
      const page = Number.isInteger(finding.page) && finding.page > 0 ? finding.page : 1;
      const citation = citationFor(evId, rawRef, page, String(finding.citation));
      const common = {
        description: finding.description, kind: finding.kind,
        municipality: city, docSha: sha, rawRef, sourceUrl, citation: finding.citation,
        page, etape: finding.etape,
        ingestion_manifest_sha: batchSha,
      };
      if (finding.date) {
        common.date = finding.date;
        common.etape_date = finding.date;
      }
      for (const key of optional) if (finding[key]) common[key] = finding[key];
      nodes.push({
        id: eventId, label: finding.label, file_type: 'document', source_file: rawRef,
        node_type: 'DesignationEvent', status: 'candidate', citations: [citation],
        evidence_refs: [evId], properties: { ...common },
      });
      nodes.push({
        id: signalId, label: `Signal : ${finding.label}`, file_type: 'document', source_file: rawRef,
        node_type: 'Signal', status: 'candidate', citations: [citation], evidence_refs: [evId],
        properties: { ...common, category: finding.category, status: 'candidate' },
      });
      for (const [source, target, relation] of [
        [sourceId, eventId, 'supports'], [sourceId, signalId, 'supports'], [eventId, signalId, 'raises_signal'],
      ]) edges.push({ source, target, relation, status: 'candidate', confidence: 'EXTRACTED',
        source_file: rawRef, citations: [citation], evidence_refs: [evId] });
      evidence.push({ id: evId, text: finding.citation, source_file: rawRef, city, page });
    }
  }
}

fs.writeFileSync(outputPath, JSON.stringify({ nodes, edges, evidence, input_tokens: 0, output_tokens: 0 }, null, 2));
