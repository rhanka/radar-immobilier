import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { openImageClient } from './a5-image-client.mjs';
const require = createRequire('/workspace/packages/immo-mcp/package.json');
const { Pool } = require('pg');
const { S3Client, CreateBucketCommand } = require('@aws-sdk/client-s3');
const tuple = {};
for (const [name, version] of [['artifacts', '0.2.0'], ['cluster-mesh', '0.22.0'], ['mcp-auth', '0.2.1'], ['mcp-platform', '0.4.0']]) {
  const installed = ['/workspace/packages/immo-mcp/node_modules', '/workspace/node_modules']
    .map((base) => `${base}/@sentropic/${name}/package.json`).find(existsSync);
  assert.ok(installed, name); tuple[name] = JSON.parse(readFileSync(installed)).version;
  assert.equal(tuple[name], version);
}
const database = 'postgres://radar:synthetic-only@postgres:5432/radar';
const env = { POSTGRES_HOST: 'postgres', POSTGRES_USER: 'radar', POSTGRES_PASSWORD: 'synthetic-only', POSTGRES_DB: 'radar',
  LOG_LEVEL: 'silent', DOTENV_CONFIG_PATH: '/dev/null' };
execFileSync(process.execPath, ['/workspace/api/dist/db/migrate.js'], { cwd: '/workspace/api', env: { ...env, PATH: process.env.PATH }, stdio: 'inherit' });
const db = new Pool({ connectionString: database });
const workspace = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bucket = 'a5-runtime-proof';
const s3 = new S3Client({ endpoint: 'http://minio:9000', forcePathStyle: true, region: 'us-east-1',
  credentials: { accessKeyId: 'synthetic', secretAccessKey: 'synthetic' } });
let client;
try {
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  await db.query("INSERT INTO account_users (id, sub, status) VALUES ($1, 'alice', 'approved')", [workspace]);
  await db.query("INSERT INTO workspaces (id, slug, label) VALUES ($1, 'image', 'Image proof')", [workspace]);
  await db.query('INSERT INTO workspace_memberships (workspace_id, account_id) VALUES ($1, $1)', [workspace]);
  await db.query("INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('image_scope', 'image_org')");
  await db.query("INSERT INTO artifacts.host_quotas (storage_scope_id, operation_limit, byte_limit) VALUES ('image_scope', 10, 1000000)");
  client = await openImageClient({ ...env, IMMO_MCP_ACCOUNT_DATABASE_URL: database, IMMO_MCP_ARTIFACT_DATABASE_URL: database,
    ARTIFACTS_STORAGE_SCOPE: 'image_scope', ARTIFACTS_ORG_ID: 'image_org', ARTIFACTS_CONTENT_BASE: 'pages.example.test',
    ARTIFACTS_S3_BUCKET: bucket, ARTIFACTS_S3_ENDPOINT: 'http://minio:9000', ARTIFACTS_S3_REGION: 'us-east-1',
    ARTIFACTS_S3_ACCESS_KEY: 'synthetic', ARTIFACTS_S3_SECRET_KEY: 'synthetic', ARTIFACTS_CONTROL_MODE: 'validation',
    ARTIFACTS_VALIDATION_SUBJECTS: 'alice', ARTIFACTS_VALIDATION_UNTIL: new Date(Date.now() + 300000).toISOString(),
  }, workspace);
  const tools = await client.list();
  assert.equal(tools.length, 16);
  assert.deepEqual(tools.filter((tool) => tool.name.startsWith('artifacts_')).map((tool) => tool.name).sort(),
    ['artifacts_ensure', 'artifacts_get', 'artifacts_list', 'artifacts_publish']);
  const call = async (name, args) => {
    const result = await client.call(name, args); assert.notEqual(result.isError, true, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  const ensured = await call('artifacts_ensure', { bindingName: 'image', idempotencyKey: 'image-ensure' });
  const artifactId = ensured.artifactId; assert.ok(artifactId);
  const files = [{ path: 'index.html', mimeType: 'text/html', text: 'image publication' },
    { path: 'style.css', mimeType: 'text/css', text: 'body {}' }];
  const args = { artifactId, files, idempotencyKey: 'image-publish' };
  const published = await call('artifacts_publish', args);
  assert.ok(published.releaseId); assert.equal(published.stableUrl, `https://${artifactId}.pages.example.test/`);
  assert.deepEqual(await call('artifacts_publish', args), published);
  assert.equal((await call('artifacts_list', {})).total, 1);
  assert.equal((await call('artifacts_get', { artifactId })).currentReleaseId, published.releaseId);
  const conflict = await client.call('artifacts_publish', { ...args, files: [...files].reverse() });
  assert.equal(conflict.isError, true);
  assert.deepEqual(JSON.parse(conflict.content[0].text), { error: 'conflict', retryable: false });
  await client.restart();
  assert.equal((await client.list()).length, 16);
  assert.deepEqual(await call('artifacts_publish', args), published);
  await db.query("UPDATE account_users SET status='suspended' WHERE sub='alice'");
  assert.equal((await client.call('artifacts_publish', args)).isError, true);
  await db.query("UPDATE account_users SET status='approved' WHERE sub='alice'");
  await db.query("UPDATE workspace_memberships SET status='revoked', revoked_at=now()");
  assert.equal((await client.call('artifacts_publish', args)).isError, true);
  const durable = (await db.query(`SELECT (SELECT count(*) FROM artifacts.operation_receipts)::int AS receipts,
    (SELECT count(*) FROM artifacts.releases)::int AS releases, (SELECT operations_used FROM artifacts.host_quotas)::int AS quota`)).rows[0];
  assert.deepEqual(durable, { receipts: 2, releases: 1, quota: 2 });
  writeFileSync('/evidence/image-proof.json', JSON.stringify({ passed: true, imageSource: process.env.GIT_SHA, tuple, tools,
    durable, replayAfterRestart: true, orderedConflict: true, accountRevocationDenied: true, membershipRevocationDenied: true }, null, 2));
  writeFileSync('/evidence/runtime-config.json', JSON.stringify({ issuer: client.issuer, resource: client.resource,
    storageScope: 'image_scope', contentBase: 'pages.example.test', activation: 'validation', selectedTools: 16 }, null, 2));
} finally {
  if (client) { writeFileSync('/evidence/mcp-runtime.log', client.logs); await client.close(); }
  s3.destroy(); await db.end();
}
