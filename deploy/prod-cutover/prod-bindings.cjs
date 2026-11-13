/* global require, module, process */
const secret = (name, object, key = name) => ({ name, valueFrom: { secretKeyRef: { name: object, key } } });
const shared = [secret('ARTIFACTS_S3_ACCESS_KEY', 'radar-artifacts-prod'),
  secret('ARTIFACTS_S3_SECRET_KEY', 'radar-artifacts-prod'),
  secret('ARTIFACTS_UPLOAD_PAGE_SECRET', 'radar-artifacts-upload-page-prod', 'secret')];
const reader = [secret('ARTIFACTS_READER_GRANT_SECRET', 'radar-artifacts-reader-prod'),
  secret('ARTIFACTS_READER_SESSION_SECRET', 'radar-artifacts-reader-prod')];
const bindings = {
  'radar-api': { container: 'api', env: [...shared, ...reader,
    secret('CLASSIFICATION_CURSOR_SECRET', 'radar-classification-cursor-prod')] },
  'radar-immo-mcp': { container: 'mcp', env: [...shared,
    secret('IMMO_MCP_ACCOUNT_DATABASE_URL', 'immo-mcp-account-reader'),
    secret('IMMO_MCP_ARTIFACT_DATABASE_URL', 'immo-mcp-artifact-writer'),
    secret('IMMO_MCP_DATABASE_NAME', 'radar-db-credentials', 'POSTGRES_DB'),
    secret('IMMO_MCP_WORKLOAD_CLIENT_SECRET', 'immo-mcp-workload'),
    ...['SUB', 'CLIENT_ID'].map(s => ({ name: `IMMO_MCP_WORKLOAD_${s}`, valueFrom: {
      configMapKeyRef: { name: 'radar-mcp-receiver', key: `STRICT_RECEIVER_WORKLOAD_${s}` } } }))] },
};
if (require.main === module) process.stdout.write(JSON.stringify(bindings));
module.exports = { bindings };
