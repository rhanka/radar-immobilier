/* global process */
import fs from 'node:fs';

const [graphPath, city, exclusionsPath, outputPath] = process.argv.slice(2);
if (!graphPath || !city || !exclusionsPath || !outputPath) {
  process.stderr.write('Usage: apply_exclusions_v23.js <graph> <city> <exclusions.tsv> <output>\n');
  process.exit(1);
}

const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const rows = fs.readFileSync(exclusionsPath, 'utf8').trim().split(/\r?\n/u).slice(1);
const excluded = new Set(rows.map((row) => row.split('\t')).filter((row) => row[0] === city).map((row) => row[1]));

graph.nodes = (graph.nodes || []).filter((node) => !excluded.has(String(node.id)));
graph.edges = (graph.edges || []).filter((edge) => !excluded.has(String(edge.source)) && !excluded.has(String(edge.target)));
fs.writeFileSync(outputPath, JSON.stringify(graph, null, 2));
process.stderr.write(`[exclusions] ${city}: removed ${excluded.size} declared node(s)\n`);
