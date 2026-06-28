# Immo MCP provider v0 — cadrage build

Track item: `01KW1S7E7WQKPAVKJX18RZ8116`

## Objectif produit

Permettre à Steve/Antoine d'activer et utiliser les fonctions immo depuis Claude.ai, mcp-wave, Claude Desktop ou tout client MCP standard via un provider MCP user-facing.

`remote` est hors chemin produit: pas owner, pas watcher, pas fallback.

## Architecture cible

- Sentropic fournit une couche réutilisable type `@sentropic/mcp`:
  - transport/server MCP
  - OAuth/resource-server integration
  - validation claims tenant/user/workspace/scopes/audience
  - hooks audit/provenance
  - redaction helpers
  - ressources/tools Sentropic partagés
- radar/immo fournit le provider domaine construit au-dessus:
  - modèle domaine
  - policy d'autorisation métier
  - sémantique des tools/resources immo
  - classification données/PII

## V0 read-only/mock-first

Tools proposés:

- `search_lots`
- `get_lot_card`
- `search_signals`
- `get_opportunity_dossier`
- `list_documents`
- `read_document_excerpt`

Mutations hors v0 sauf stubs/gates:

- notes
- ProspectMark / marks
- annotations
- decision proposals

## Auth context minimal

Les valeurs d'auth sont issues du token/session validé, jamais des arguments LLM/tool.

```ts
interface ImmoMcpAuthContext {
  sub: string;
  userId?: string;
  tenantId: string;
  orgId?: string;
  roles: string[];
  scopes: string[];
  workspaces: string[];
  dataMode: 'real' | 'simulation';
  audience: 'mcp/immo' | string;
}
```

Scopes initiaux:

- `immo:read`
- `immo:search`
- `immo:documents:read`
- `immo:notes:write` — gated, hors v0 mutation réelle
- `immo:decisions:propose` — gated, hors v0 mutation réelle
- `immo:admin` — owner-gated

## Audit/redaction v0

- Journaliser appels tools avec tenant/user/workspace, scope decision, tool name, input hash, summary redacted, output hash/summary redacted, correlationId.
- Ne pas mettre de payload brut sensible dans Track/H2A.
- Profils PII provisoires: owner_contact, user_identity, commercial_note, property_owner_identity_if_private, auth_invite_token, session_identifier, precise_user_action_trace.

## Critères d'acceptation v0

- Provider contract TS ou scaffold minimal compilable.
- Tools read-only/mock-first disponibles avec schémas d'entrée/sortie.
- Auth context imposé hors arguments LLM.
- Audit/redaction interfaces présentes.
- Test/typecheck documenté.
- Compatibilité client MCP générique prévue; validation Claude.ai/client MCP standard si faisable.
