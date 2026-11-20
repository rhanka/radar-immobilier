// Read-only SELECT against the preprod database through kubectl exec + psql.
// Every statement runs inside "BEGIN READ ONLY; ... ROLLBACK;": no write is possible.
import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const DB = {
  kubeconfig: process.env.CLASSIF_KUBECONFIG ?? path.join(os.homedir(), '.kube', 'radar-preprod-tenant.kubeconfig'),
  namespace: process.env.CLASSIF_NAMESPACE ?? 'radar-immobilier-preprod',
  pod: process.env.CLASSIF_DB_POD ?? 'radar-postgres-0',
  user: process.env.CLASSIF_DB_USER ?? 'radar',
  database: process.env.CLASSIF_DB_NAME ?? 'radar_next',
};

const FORBIDDEN = /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|vacuum|call|do|commit)\b/i;

/** Runs one SELECT that returns a single JSON value (json_agg / json_build_object) and parses it. */
export function selectJson(sql) {
  if (FORBIDDEN.test(sql.replace(/'[^']*'/g, "''"))) throw new Error('db: only SELECT statements are allowed');
  const script = `\\set ON_ERROR_STOP 1\nBEGIN READ ONLY;\n${sql};\nROLLBACK;\n`;
  const args = ['--kubeconfig', DB.kubeconfig, '-n', DB.namespace, 'exec', '-i', DB.pod, '--',
    'psql', '-U', DB.user, '-d', DB.database, '-At', '-q', '-v', 'ON_ERROR_STOP=1'];
  // Read-only statement: retried on transient transport errors (kubectl exec stream timeouts).
  let run;
  for (let attempt = 1; attempt <= 3; attempt++) {
    run = spawnSync('kubectl', args, { input: script, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
    if (run.status === 0 || /ERROR:/.test(String(run.stderr))) break;
  }
  if (run.status !== 0) throw new Error(`db: psql failed (${run.status}): ${String(run.stderr).slice(-400)}`);
  const out = run.stdout.trim();
  const start = out.search(/^[[{]/m);
  if (start < 0) throw new Error('db: no JSON row returned');
  return JSON.parse(out.slice(start));
}

/** SQL string literal for a value already restricted to a safe alphabet. */
export function lit(value) {
  const s = String(value);
  if (!/^[A-Za-z0-9._:\-/ àâçéèêëîïôûùüÿœÀÂÇÉÈÊËÎÏÔÛÙÜŸŒ']*$/.test(s)) throw new Error(`db: unsafe literal ${JSON.stringify(s.slice(0, 40))}`);
  return `'${s.replace(/'/g, "''")}'`;
}

export const arr = (values) => (values.length ? `ARRAY[${values.map(lit).join(',')}]::text[]` : 'ARRAY[]::text[]');

/** Fetches graph nodes by id (id, type, label, city_slug, props). */
export function fetchNodes(ids) {
  if (!ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    out.push(...selectJson(`select coalesce(jsonb_agg(t), '[]'::jsonb) from (select id, type, label, city_slug, props from graph_nodes where id = any(${arr(chunk)})) t`));
  }
  return out;
}
