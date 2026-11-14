/* global require, module, process, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports */
const r = require('./runtime.cjs');
const settings = require('./prod-settings.json');
const base = 'https://recette.localhost:15321';
function compose(privateDir, auth) {
  const release = r.json(r.path.join(__dirname, 'release.json'));
  const mount = name => `${privateDir}/${name}:/private/${name}:ro`;
  const common = { NODE_ENV: 'production', DOTENV_CONFIG_PATH: '/dev/null', LOG_LEVEL: 'silent',
    NODE_EXTRA_CA_CERTS: '/private/ca.crt', ...settings.shared,
    POSTGRES_HOST: 'postgres', POSTGRES_PORT: '5432', POSTGRES_USER: 'radar',
    POSTGRES_PASSWORD: auth.database, POSTGRES_DB: 'radar_cutover_owner_20261113',
    S3_ENDPOINT: 'https://minio.localhost:15400', S3_REGION: 'us-east-1', S3_BUCKET: 'radar-immobilier-raw',
    S3_ACCESS_KEY: 'rehearsal', S3_SECRET_KEY: auth.storage, S3_FORCE_PATH_STYLE: 'true',
    SCRAPE_S3_BUCKET: 'radar-immobilier-docs', GRAPH_S3_BUCKET: 'radar-immobilier-docs',
    GEO_DOCUMENTS_REPOINT: '0', ARTIFACTS_S3_ENDPOINT: 'https://minio.localhost:15400', ARTIFACTS_S3_REGION: 'us-east-1',
    ARTIFACTS_S3_ACCESS_KEY: 'rehearsal', ARTIFACTS_S3_SECRET_KEY: auth.storage,
    ARTIFACTS_S3_FORCE_PATH_STYLE: 'true', ARTIFACTS_CONTENT_BASE: 'pages.localhost',
    ARTIFACTS_UPLOAD_PAGE_SECRET: auth.upload, ARTIFACTS_READER_GRANT_SECRET: auth.grant,
    ARTIFACTS_READER_SESSION_SECRET: auth.reader, ARTIFACTS_READER_ISSUER: base,
    ARTIFACTS_READER_AUDIENCE: `${base}/reader`, ARTIFACTS_READER_TIER: 'preprod',
    CLASSIFICATION_CURSOR_KEY_ID: 'rehearsal-v1', CLASSIFICATION_CURSOR_SECRET: auth.cursor,
    SESSION_SECRET: auth.session, SENTROPIC_IDP_ISSUER: `${base}/oidc`,
    SENTROPIC_OAUTH_CLIENT_ID: 'radar-rehearsal', SENTROPIC_OAUTH_CLIENT_SECRET: auth.client,
    SENTROPIC_OAUTH_REDIRECT_URI: `${base}/api/v1/auth/oauth/callback`, AUTH_CALLBACK_BASE_URL: base,
    MCP_SIGNAL_SEARCH_ENABLED: '1', STRICT_RECEIVER_ARMED: '0',
  };
  const app = (entrypoint, environment) => ({ image: release.apiImage, pull_policy: 'never',
    user: `${process.getuid()}:${process.getgid()}`, entrypoint, environment,
    networks: ['copy-only'], volumes: [mount('ca.crt')], read_only: true, tmpfs: ['/tmp'],
    cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'] });
  const databaseUrl = (role, password) => `postgresql://${role}:${password}@postgres:5432/${common.POSTGRES_DB}`;
  const health = (port, route) => ({ test: ['CMD', 'node', '-e',
    `fetch('http://127.0.0.1:${port}${route}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`],
  interval: '1s', timeout: '3s', retries: 30 });
  return { services: {
    api: { ...app(['node', 'api/dist/index.js'], common),
      volumes: [mount('ca.crt'), `${r.ROOT}/deploy/prod-cutover:/run-controller:ro`],
      networks: { 'copy-only': { aliases: ['radar-api'] } },
      ports: ['127.0.0.1:18821:3000'], healthcheck: health(3000, '/livez') },
    mcp: { ...app(['node', 'packages/immo-mcp/dist/server-http.js'], { ...common, ...settings.mcp,
      IMMO_MCP_OAUTH_ISSUER: `${base}/oidc`, IMMO_MCP_OAUTH_RESOURCE: `${base}/mcp`,
      IMMO_MCP_API_AUDIENCE: base, IMMO_MCP_EXCHANGE_TOKEN_ENDPOINT: `${base}/oidc/token`,
      IMMO_MCP_EXCHANGE_ENV: 'preprod', RADAR_API_BASE_URL: 'http://api:3000', RADAR_PUBLIC_BASE_URL: base,
      IMMO_MCP_DATA_MODE: 'http', IMMO_MCP_HTTP_PORT: '8848',
      IMMO_MCP_ACCOUNT_DATABASE_URL: databaseUrl('immo_mcp_account_reader', auth.account),
      IMMO_MCP_ARTIFACT_DATABASE_URL: databaseUrl('immo_mcp_artifact_writer', auth.artifact),
      IMMO_MCP_DATABASE_NAME: common.POSTGRES_DB, IMMO_MCP_WORKLOAD_CLIENT_ID: 'immo-mcp-workload',
      IMMO_MCP_WORKLOAD_SUB: 'immo-mcp-workload', IMMO_MCP_WORKLOAD_CLIENT_SECRET: auth.workload }),
    healthcheck: health(8848, '/mcp/.well-known/oauth-protected-resource') },
    idp: { ...app(['node', '/run-idp.cjs'], {}), healthcheck: health(8080, '/.well-known/openid-configuration'), volumes: [mount('auth.json'), mount('roster.json'),
      mount('idp.key'), mount('idp.pub'), `${r.ROOT}/deploy/prod-cutover/rehearsal-idp.cjs:/run-idp.cjs:ro`] },
    ui: { image: release.uiImage, pull_policy: 'never', networks: {
      'copy-only': { aliases: ['recette.localhost', 'minio.localhost'] }, 'copy-entry': {} },
      ports: ['127.0.0.1:15321:15321', '127.0.0.1:15400:15400', '127.0.0.1:443:443'],
      volumes: [`${privateDir}/nginx.conf:/etc/nginx/conf.d/default.conf:ro`, mount('ca.crt'), mount('tls.key')] },
    minio: { image: 'adobe/s3mock@sha256:9da9c179bc0d1cb6986a40fd7ffbbc6deee11522b3892217ca350d65596126fa', pull_policy: 'never', networks: ['copy-only'],
      environment: { COM_ADOBE_TESTING_S3MOCK_HTTPPORT: '9000', root: '/data', retainFilesOnExit: 'true',
        initialBuckets: 'radar-immobilier-raw,radar-immobilier-docs,radar-immobilier-artifacts' },
      volumes: ['copy-objects:/data'] },
  }, networks: { 'copy-entry': {} }, volumes: { 'copy-objects': {} } };
}
function nginx() {
  return `server {
  listen 15321 ssl; server_name recette.localhost;
  ssl_certificate /private/ca.crt; ssl_certificate_key /private/tls.key;
  root /usr/share/nginx/html;
  location / { try_files $uri $uri/ /index.html; }
  location /api/ { proxy_pass http://radar-api:3000; proxy_set_header Host $http_host; proxy_set_header X-Forwarded-Proto https; }
  location = /health { proxy_pass http://radar-api:3000; }
  location /mcp { proxy_pass http://mcp:8848; proxy_buffering off; proxy_read_timeout 60s; }
  location = /.well-known/oauth-protected-resource/mcp { proxy_pass http://mcp:8848/mcp/.well-known/oauth-protected-resource; }
  location /oidc/ { proxy_pass http://idp:8080/; }
}
server {
  listen 15400 ssl; server_name minio.localhost;
  ssl_certificate /private/ca.crt; ssl_certificate_key /private/tls.key;
  client_max_body_size 30m;
  location / { proxy_pass http://minio:9000; proxy_set_header Host $http_host; }
}
server {
  listen 443 ssl; server_name .pages.localhost;
  ssl_certificate /private/ca.crt; ssl_certificate_key /private/tls.key;
  location / { proxy_pass http://radar-api:3000; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto https; }
}
`;
}
module.exports = { compose, nginx, base };
