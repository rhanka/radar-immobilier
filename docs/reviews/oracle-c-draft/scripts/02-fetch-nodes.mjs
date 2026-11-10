#!/usr/bin/env node
// Step 2 — READ-ONLY fetch of the radar graph nodes that Steve's triage lines refer to.
// Runs one Node script inside a running radar-api pod through `kubectl exec -i ... node -`:
// a single SELECT on graph_nodes, in a session forced to default_transaction_read_only=on
// (asserted before the query). No write, no S3 access, nothing persisted in the pod.
// Requires: KUBECONFIG pointing at the tenant kubeconfig; namespace radar-immobilier.
// Output: work/nodes.json (git-ignored).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { WORK } from './lib/common.mjs';

const NS = process.env.RADAR_NS ?? 'radar-immobilier';
const triage = JSON.parse(fs.readFileSync(path.join(WORK, 'triage.json'), 'utf8'));
const ids = [...new Set(triage.rows.flatMap((r) => r.nodeIds))];

const podScript = `
const {Client}=require('/workspace/node_modules/pg');
(async()=>{
const c=new Client({host:process.env.POSTGRES_HOST,port:+process.env.POSTGRES_PORT,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,database:process.env.POSTGRES_DB,options:'-c default_transaction_read_only=on'});
await c.connect();
await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
const ro=await c.query('show default_transaction_read_only');
if(ro.rows[0].default_transaction_read_only!=='on') throw new Error('session is not read-only');
const q=await c.query('select id,type,label,city_slug,props,created_at,now() as read_at from graph_nodes where id = any($1)',[${JSON.stringify(ids)}]);
process.stdout.write(JSON.stringify(q.rows));
await c.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
`;

const pods = spawnSync('kubectl', ['-n', NS, 'get', 'pods', '-o', 'name'], { encoding: 'utf8' });
if (pods.status !== 0) { console.error(pods.stderr); process.exit(1); }
const pod = pods.stdout.split('\n').find((l) => /^pod\/radar-api-/.test(l));
if (!pod) { console.error('no radar-api pod found'); process.exit(1); }
const run = spawnSync('kubectl', ['-n', NS, 'exec', '-i', pod.replace('pod/', ''), '--', 'node', '-'], {
  input: podScript, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
if (run.status !== 0) { console.error(run.stderr); process.exit(1); }
const nodes = JSON.parse(run.stdout);
fs.writeFileSync(path.join(WORK, 'nodes.json'), JSON.stringify({ pod, requested: ids.length, nodes }, null, 1));
console.log(JSON.stringify({ requested: ids.length, found: nodes.length, readAt: nodes[0]?.read_at }));
