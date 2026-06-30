# @radar/immo-mcp

Provider **MCP (stdio)**, **read-only**, **mock-first** exposant les fonctions
immobilières de radar-immobilier à tout client MCP standard (Claude.ai,
Claude Desktop, mcp-wave, etc.).

Cadrage : `docs/spec/mcp/immo-mcp-provider-v0.md` · plan : `docs/spec/reports/wp5-plateforme.md` (§A).

## Les 6 tools v0 (read-only)

| Tool | Scope requis | Source réelle cible (phase 2) |
|------|--------------|-------------------------------|
| `search_lots` | `immo:search` | `GET /api/geo/:city/lots` |
| `get_lot_card` | `immo:read` | `GET /api/geo/:city/lots` (filtre `no_lot`) |
| `search_signals` | `immo:search` | `GET /api/graph-signals/:city` |
| `get_opportunity_dossier` | `immo:read` | `GET /api/opportunites` + `GET /api/signals/:city/detail` |
| `list_documents` | `immo:documents:read` | `GET /api/documents/raw` |
| `read_document_excerpt` | `immo:documents:read` | `GET /api/documents/raw` (extrait borné + redaction) |

Mutations (`notes`, `ProspectMark`, `decisions:propose`) = **hors v0**, non
enregistrées. Les scopes `immo:notes:write` / `immo:decisions:propose` /
`immo:admin` sont définis mais non exposés.

## Principes

- **Auth imposée hors arguments LLM** : `resolveAuthContext()` (`src/auth-context.ts`)
  lit les claims depuis l'environnement (stub v0, **OAuth-ready** : phase 2
  remplace le corps de la fonction sans toucher aux tools). Les arguments de
  tool ne sont que des paramètres de requête non fiables.
- **Scope-gating** : chaque tool appelle `assertScope()` depuis le contexte
  d'auth ; refus → `scope_denied:<scope>`.
- **Audit** : chaque appel écrit une ligne structurée sur **STDERR**
  (tenant/sub/tool/inputHash/correlationId) — jamais de payload brut.
- **Anti-PII** : `redact()` scrub emails / téléphones / tokens d'invitation /
  identifiants de session ; `read_document_excerpt` y passe tout extrait.
- **Mock-first + seam** : `createDataSource()` renvoie `MockDataSource` par
  défaut ; `IMMO_MCP_DATA_MODE=http` + `RADAR_API_BASE_URL` sélectionnera
  `HttpDataSource` (non câblé en v0).

## Build / test / preuve

```bash
npm run -w @radar/immo-mcp build       # tsc -> dist/
npm run -w @radar/immo-mcp typecheck   # tsc --noEmit
npm run -w @radar/immo-mcp test        # vitest (in-memory transport)
npm run -w @radar/immo-mcp proof       # build + appel stdio réel (tools/list + tools/call)
```

## Enregistrement MCP

### Projet-local (greppable, sans secret) — `.mcp.json` à la racine du repo

```jsonc
{
  "mcpServers": {
    "immo": {
      "type": "stdio",
      "command": "node",
      "args": ["packages/immo-mcp/dist/server.js"],
      "env": {
        "IMMO_MCP_DATA_MODE": "mock",
        "IMMO_MCP_AUTH_STUB_SUB": "demo-user",
        "IMMO_MCP_AUTH_STUB_TENANT": "radar",
        "IMMO_MCP_AUTH_STUB_SCOPES": "immo:read immo:search immo:documents:read"
      }
    }
  }
}
```

### Sur le modèle du serveur `track` (config client, ex. `~/.claude.json`)

Le serveur `track` est enregistré ainsi :

```jsonc
"track": { "type": "stdio", "command": "node",
           "args": ["/.../@sentropic/track/dist/mcp/cli.js"] }
```

L'entrée `immo` suit exactement le même contrat stdio :

```jsonc
"immo": { "type": "stdio", "command": "node",
          "args": ["/ABS/PATH/radar-immobilier/packages/immo-mcp/dist/server.js"] }
```

> Le bin doit être **buildé** (`dist/server.js`) avant enregistrement.
> Le serveur n'écrit **jamais** sur STDOUT hors protocole MCP (logs → STDERR).

## Variables d'environnement

| Var | Défaut | Rôle |
|-----|--------|------|
| `IMMO_MCP_DATA_MODE` | `mock` | `mock` (fixtures) \| `http` (API radar, phase 2) |
| `RADAR_API_BASE_URL` | — | requis seulement si `DATA_MODE=http` |
| `IMMO_MCP_AUTH_STUB_SUB` | `demo-user` | claim `sub` (stub, **stdio uniquement**) |
| `IMMO_MCP_AUTH_STUB_TENANT` | `radar` | claim `tenantId` (stub, **stdio uniquement**) |
| `IMMO_MCP_AUTH_STUB_SCOPES` | `immo:read immo:search immo:documents:read` | scopes accordés (stub, **stdio uniquement**) |
| `IMMO_MCP_AUTH_STUB_WORKSPACES` | `default` | workspaces (stub, **stdio uniquement**) |

## Mode REMOTE — Streamable HTTP + OAuth Resource Server (POC)

`src/server-http.ts` est un **second** entrypoint (le stdio `server.ts` est inchangé)
qui sert le même MCP sur **HTTP** derrière un **OAuth 2.1 Resource Server** :

- transport **MCP Streamable HTTP** (`WebStandardStreamableHTTPServerTransport` du MCP SDK,
  mode *stateful* + `enableJsonResponse`) monté sur `POST/GET/DELETE /mcp` ;
- garde **OAuth RS** via les packages **publiés** `@sentropic/mcp-auth` (+ `@sentropic/oauth-verify`) :
  - `createMcpAuth` + `requireMcpAuth` (export `@sentropic/mcp-auth/hono`) valident le **Bearer**
    (issuer / audience / scope) → sinon **401/403** avec `WWW-Authenticate` (RFC 6750 + RFC 9728 §5.1) ;
  - **PRM RFC 9728** servi sur `/.well-known/oauth-protected-resource` via `mcpAuthRoutes` ;
- les **claims** du token validé sont mappés vers `ImmoMcpAuthContext` (`authContextFromMcp`) —
  c'est l'équivalent HTTP de `resolveAuthContext(env)` du mode stdio ; le scope-gating par tool
  (`assertScope`) reste appliqué. **Aucun** claim ne vient des arguments LLM.
- **Données = mock** (la vraie API radar n'est PAS câblée dans ce POC).

> Écart vs brief assumé : le brief citait `createRequireServiceAuth`. C'est en réalité la
> variante **service-à-service** (injection de ports JWKS *in-process*). Pour un RS MCP **externe**
> validant des tokens d'un IdP distant via **JWKS URL**, la façade correcte est
> `createMcpAuth` + `requireMcpAuth` + `mcpAuthRoutes` — c'est ce qui est utilisé ici (vérifié sur les `.d.ts`).

### Variables d'environnement (mode HTTP)

| Var | Défaut | Rôle |
|-----|--------|------|
| `IMMO_MCP_OAUTH_ISSUER` | — (**requis**) | issuer IdP / authorization server (ex. `https://auth.sent-tech.ca`) |
| `IMMO_MCP_OAUTH_RESOURCE` | — (**requis**) | URI canonique de la ressource = `aud` attendu du token (ex. `https://immo-mcp.sent-tech.ca/mcp`) |
| `IMMO_MCP_OAUTH_JWKS_URI` | `<issuer>/.well-known/jwks.json` | override du JWKS de vérif |
| `IMMO_MCP_OAUTH_REQUIRED_SCOPE` | `immo:read` | gate de scope grossier sur la route `/mcp` |
| `IMMO_MCP_OAUTH_SCOPES_SUPPORTED` | `immo:read immo:search immo:documents:read` | scopes annoncés dans le PRM |
| `IMMO_MCP_HTTP_PORT` | `8848` | port d'écoute |

### Lancer le serveur HTTP

```bash
npm run -w @radar/immo-mcp build
IMMO_MCP_OAUTH_ISSUER=https://auth.sent-tech.ca \
IMMO_MCP_OAUTH_RESOURCE=https://immo-mcp.sent-tech.ca/mcp \
IMMO_MCP_DATA_MODE=mock \
npm run -w @radar/immo-mcp start:http
# → [immo-mcp-http] listening port=8848 resource=… issuer=… dataMode=simulation
# PRM:  GET  http://localhost:8848/.well-known/oauth-protected-resource
# MCP:  POST http://localhost:8848/mcp   (Authorization: Bearer <token IdP>)
```

### Ce qui reste pour l'enregistrement claude.ai (hors POC)

Le **gap est côté IdP**, pas côté ce package : claude.ai exige **Dynamic Client Registration
(RFC 7591)** et la découverte **Authorization Server Metadata (RFC 8414)** sur l'issuer.
Tant que `auth.sent-tech.ca` n'expose pas DCR 7591 + alias 8414, l'enregistrement end-to-end
sur claude.ai n'est pas possible (escaladé séparément). Ce POC fournit le côté **Resource
Server** (PRM 9728 + challenges 6750 + vérif token) prêt à consommer ces métadonnées.
