#!/usr/bin/env node
/**
 * WP6 — stub d'agent remote : émet un progress.jsonl de WorkEvents Track, prêt à
 * `track ingest <file> --workspace <slug>` par le writer désigné (conducteur / canal signé).
 *
 * Un agent remote NE TOUCHE JAMAIS .track directement (single-writer). Il produit
 * seulement ce flux ; la médiation h2a + l'ingest restent côté writer désigné.
 *
 * Usage :
 *   node wp6-remote-agent-stub.mjs --workspace wp1-data --item 01K... --agent agentA \
 *        [--out progress.jsonl]
 *
 * Notes binding gate (Track 0.19.2) :
 *   - item.realize:in-progress, acceptance.criterion, blocker.raise = NON-bloquants (OK canal ouvert).
 *   - item.realize:done / acceptance.run = SETTLING => refusés sauf canal authentifié (local-user|signed).
 *     => un agent non signé reste en in-progress/needs_review, jamais "fait" en silence.
 */
import { writeFileSync } from 'node:fs'

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const workspace = arg('workspace', 'wp1-data')
const item = arg('item', '01KTQP5F0D6PMGRFFHYP8CEFXX') // ex: A.2.2 Scraper PV
const agent = arg('agent', 'agentA')
const out = arg('out', 'progress.jsonl')
const stamp = Date.now()
const tok = (n) => `${agent}-${workspace}-${stamp}-${n}` // clientToken stable => idempotent

// Un cycle de rapport d'avancement typique d'un agent de scraping.
const events = [
  { kind: 'item.realize', itemId: item, to: 'in-progress', clientToken: tok('01') },
  {
    kind: 'acceptance.criterion',
    itemId: item,
    statement: 'PV scrapé + raw archivé sur S3 (CAS), manifeste de run écrit',
    clientToken: tok('02'),
  },
  // Exemple de blocage remonté honnêtement (devient un blocker, pas un "done").
  {
    kind: 'blocker.raise',
    target: item,
    blockerKind: 'dependency',
    reason: 'Source SPA 403/WAF — nécessite Obscura (anti-bot dur)',
    clientToken: tok('03'),
  },
  // NB: PAS de item.realize:done ici — settling refusé hors canal signé.
  //     Le conducteur/canal signé décide du done après revue (needs_review -> done).
]

const jsonl = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
writeFileSync(out, jsonl)
console.log(`[${agent}] wrote ${events.length} WorkEvents -> ${out} (workspace=${workspace})`)
console.log(`Writer désigné: track ingest ${out} --workspace ${workspace}`)
console.log('Rejoue idempotent: clientToken stable par étape (dédup (workspace, clientToken)).')
