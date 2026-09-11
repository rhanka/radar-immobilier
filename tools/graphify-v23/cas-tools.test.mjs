/* global process */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));

test('CAS conversion grounds an empty document and exclusions remove incident edges', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'graphify-cas-test-'));
  try {
    const sha = 'a'.repeat(64);
    const manifest = path.join(work, 'manifest.tsv');
    const corpus = path.join(work, 'corpus');
    const findings = path.join(work, 'findings');
    fs.mkdirSync(corpus);
    fs.mkdirSync(findings);
    fs.writeFileSync(manifest, [
      'source_id\tcity_slug\tsha\trepresentation_key\tsidecar_key',
      `proces-verbaux-test-ville\ttest-ville\t${sha}\traw/proces-verbaux-test-ville/cas/${sha}.txt\tsource-gap`,
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(findings, `${sha}.1.json`), '{"findings":[]}\n');

    const extraction = path.join(work, 'extraction.json');
    execFileSync(process.execPath, [
      path.join(toolsDir, 'cas_findings_to_extraction_v23.js'),
      'test-ville', manifest, corpus, findings, 'batch-sha', extraction,
    ]);
    const converted = JSON.parse(fs.readFileSync(extraction, 'utf8'));
    assert.equal(converted.nodes.length, 1);
    assert.equal(converted.nodes[0].node_type, 'Source');
    assert.equal(converted.nodes[0].citations[0].source_file,
      `raw/proces-verbaux-test-ville/cas/${sha}.txt`);
    assert.equal(converted.nodes[0].citations[0].page, 1);

    const graph = path.join(work, 'graph.json');
    const exclusions = path.join(work, 'exclusions.tsv');
    const filtered = path.join(work, 'filtered.json');
    fs.writeFileSync(graph, JSON.stringify({
      nodes: [{ id: 'keep' }, { id: 'drop' }],
      edges: [{ source: 'keep', target: 'drop' }, { source: 'keep', target: 'keep' }],
    }));
    fs.writeFileSync(exclusions, 'city_slug\tnode_id\tnode_type\treason\ntest-ville\tdrop\tSignal\tsource gap\n');
    execFileSync(process.execPath, [
      path.join(toolsDir, 'apply_exclusions_v23.js'), graph, 'test-ville', exclusions, filtered,
    ]);
    const result = JSON.parse(fs.readFileSync(filtered, 'utf8'));
    assert.deepEqual(result.nodes.map((node) => node.id), ['keep']);
    assert.equal(result.edges.length, 1);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
