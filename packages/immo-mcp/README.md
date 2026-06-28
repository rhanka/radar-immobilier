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
| `IMMO_MCP_AUTH_STUB_SUB` | `demo-user` | claim `sub` (stub) |
| `IMMO_MCP_AUTH_STUB_TENANT` | `radar` | claim `tenantId` (stub) |
| `IMMO_MCP_AUTH_STUB_SCOPES` | `immo:read immo:search immo:documents:read` | scopes accordés (stub) |
| `IMMO_MCP_AUTH_STUB_WORKSPACES` | `default` | workspaces (stub) |
