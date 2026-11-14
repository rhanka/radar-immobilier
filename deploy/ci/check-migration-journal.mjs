import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

export function validateJournal({ entries }) {
  let previous;
  for (const [index, entry] of entries.entries()) {
    const number = Number(entry.tag.match(/^(\d{4})_/)?.[1]);
    const expected = previous ? previous.number + (previous.number === 8 ? 2 : 1) : 0;
    // 0009 was never registered. Preserve this historical gap only.
    if (number !== expected || entry.idx !== index) {
      throw new Error(`Missing or unordered migration before ${entry.tag} (expected ${expected}, idx ${index})`);
    }
    // These exact deployed timestamps predate the monotonic journal policy.
    // Do not rewrite them: Drizzle persists them in existing databases.
    const legacy = previous?.tag === '0001_wp5v1_ontology_bitemporal'
      && previous.when === 1780000000000 && entry.tag === '0002_graph_store'
      && entry.when === 1749524400000;
    if (!Number.isSafeInteger(entry.when) || (previous && entry.when <= previous.when && !legacy)) {
      throw new Error(`Non-increasing migration timestamp: ${entry.tag}`);
    }
    previous = { ...entry, number };
  }
  if (!previous) throw new Error('Empty migration journal');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateJournal(JSON.parse(readFileSync(process.argv[2] ?? 'api/drizzle/meta/_journal.json', 'utf8')));
  console.log('Migration journal: contiguous numbers and increasing timestamps');
}
