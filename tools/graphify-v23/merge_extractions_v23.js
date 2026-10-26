/* global process */
import fs from 'node:fs';

const [baselinePath, freshPath, outputPath] = process.argv.slice(2);
if (!baselinePath || !freshPath || !outputPath) process.exit(2);
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const fresh = JSON.parse(fs.readFileSync(freshPath, 'utf8'));

const unique = (items, key) => [...new Map(items.map((item) => [key(item), item])).values()];
const merged = {
  nodes: unique([...(baseline.nodes || []), ...(fresh.nodes || [])], (node) => node.id),
  edges: unique([...(baseline.edges || []), ...(fresh.edges || [])],
    (edge) => `${edge.source}\u0000${edge.target}\u0000${edge.relation}`),
  evidence: unique([...(baseline.evidence || []), ...(fresh.evidence || [])], (item) => item.id),
  input_tokens: Number(baseline.input_tokens || 0) + Number(fresh.input_tokens || 0),
  output_tokens: Number(baseline.output_tokens || 0) + Number(fresh.output_tokens || 0),
};
fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2));
