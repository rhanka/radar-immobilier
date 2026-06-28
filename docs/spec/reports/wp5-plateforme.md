# WP5 — Plateforme & Scale : plans prêts à exécuter

Baseline lecture : `f678149`. Document de planification (lecture seule Track, aucun commit, aucune
branche, aucune modification produit). Deux sujets indépendants : **A) MCP immo (à construire)** et
**B) Auth durable (diagnostic + fix)**.

---

## A) MCP IMMO — plan de build (mock-first, stdio)

### A.0 État constaté

- Le provider MCP immo **n'a jamais été réalisé**. Unique artefact : le cadrage
  `docs/spec/mcp/immo-mcp-provider-v0.md`. Diagnostic confirmé par
  `docs/spec/reports/immo-mcp-drumbeat-2026-06-28.md` : 0 fichier `@modelcontextprotocol/sdk`,
  0 `new McpServer`, 0 occurrence de `search_lots`/`ImmoMcpAuthContext`, 0 dépendance,
  bloc `mcpServers` projet = `{}`.
- Le repo est un monorepo npm workspaces : `package.json` racine
  `"workspaces": ["api","ui","packages/*"]`. Trois packages existent déjà :
  `packages/radar-domain` (`@radar/domain`), `packages/radar-scoring`, `packages/radar-sources`.
  Convention package : `type: module`, `main: ./src/index.ts`, `tsconfig.json` qui `extends`
  `../../tsconfig.base.json`, build/typecheck via `tsc`, tests `vitest`.
- L'API expose déjà les routes qui adosseront les tools (cf. mapping §A.4) :
  `GET /api/geo/:city/lots`, `GET /api/opportunites`, `GET /api/graph-signals/:city`,
  `GET /api/signals/:city/detail`, `GET /api/documents/raw`. API dev : host `8803` → conteneur `:3000`.

### A.1 Objectif v0

Serveur MCP **stdio**, **read-only**, **mock-first**, exposant les **6 tools** du cadrage, avec
contexte d'auth imposé hors arguments LLM, hooks audit/redaction, et schémas d'E/S Zod. Démontrable
par `list tools` + un appel réel (`search_lots`/`search_signals`). Branchable ensuite sur l'API
radar locale sans changer la signature des tools.

### A.2 Les 3 arbitrages à trancher (avec préco)

| # | Arbitrage | Options | **Préco** | Raison |
|---|-----------|---------|-----------|--------|
| 1 | **Périmètre données** : mock vs API réelle (PII/auth) | (a) mocks figés ; (b) API radar locale `:3000` ; (c) mock-first avec bascule `RADAR_API_BASE_URL` | **(c) mock-first + seam de bascule** | Démo sûre et offline mardi, zéro PII en sortie tant que la redaction/policy n'est pas durcie ; un seul `data-source.ts` à rebrancher quand l'API + classification PII sont prêtes. |
| 2 | **Auth** : stub vs OAuth `@sentropic/mcp` | (a) stub local (claims env/fixe) ; (b) intégration OAuth/Resource-Server `@sentropic/mcp` | **(a) stub pour v0, interface OAuth-ready** | `@sentropic/mcp` n'existe pas dans ce repo ; le cadrage l'exige seulement pour le chemin distant (Claude.ai). On code `ImmoMcpAuthContext` + un `resolveAuthContext()` injectable : stub maintenant, OAuth branché plus tard sans toucher les tools. |
| 3 | **Repo cible** : radar vs sentropic | (a) `radar-immobilier/packages/immo-mcp` ; (b) repo `sentropic` (où vit le track item + couche `@sentropic/mcp`) | **(a) radar-immobilier** pour le provider domaine v0 ; **(b) sentropic** réservé à la future couche transverse `@sentropic/mcp` | La sémantique domaine (lots/signaux/opportunités) et l'API à appeler vivent ici → chemin le plus court vers une démo. La couche OAuth/RS réutilisable reste un chantier sentropic ultérieur. **Note** : le track item `01KW1S7E7WQKPAVKJX18RZ8116` du cadrage n'est PAS dans le track radar → tracer un item radar local pour le build. |

### A.3 Repo cible & fichiers à créer (chemins exacts)

**Repo cible préco : `radar-immobilier`**, nouveau workspace `packages/immo-mcp` (`@radar/immo-mcp`).

**Les 6 fichiers cœur à créer :**

1. `packages/immo-mcp/package.json` — manifeste workspace (`@radar/immo-mcp`, `type: module`,
   dep `@modelcontextprotocol/sdk` + `zod`, dep interne `@radar/domain`, bin `immo-mcp`, scripts
   `build`/`typecheck`/`test`).
2. `packages/immo-mcp/tsconfig.json` — `extends ../../tsconfig.base.json`, émet `dist/` (pour le bin
   exécuté par le client MCP).
3. `packages/immo-mcp/src/server.ts` — bootstrap `McpServer` + `StdioServerTransport`,
   enregistre les 6 tools, branche audit/auth ; point d'entrée du bin.
4. `packages/immo-mcp/src/auth-context.ts` — `ImmoMcpAuthContext` (cf. cadrage), `resolveAuthContext()`
   (stub env-driven, OAuth-ready), `assertScope()`, et les hooks `auditToolCall()` + `redact()`.
5. `packages/immo-mcp/src/data-source.ts` — interface `ImmoDataSource` (6 méthodes) + impl
   `MockDataSource` (défaut) et seam `HttpDataSource` (bascule via `RADAR_API_BASE_URL`).
6. `packages/immo-mcp/src/tools.ts` — les **6 tools** (schémas Zod d'entrée/sortie + handlers) :
   `search_lots`, `get_lot_card`, `search_signals`, `get_opportunity_dossier`, `list_documents`,
   `read_document_excerpt`.

**Fichiers d'accompagnement (hors « 6 cœur » mais nécessaires au gate) :**

7. `packages/immo-mcp/src/mocks.ts` — fixtures déterministes (lots, signaux, opportunités, documents).
8. `packages/immo-mcp/src/server.test.ts` — gate vitest : `list tools` renvoie 6 tools + 1 appel
   (`search_lots`) renvoie un résultat conforme au schéma.
9. `.mcp.json` (racine repo) — enregistrement MCP stdio (cf. §A.5).

### A.4 Mapping tool → source (mock v0 → API réelle ensuite)

| Tool | Scope requis | Source réelle cible (phase 2) |
|------|--------------|-------------------------------|
| `search_lots` | `immo:search` | `GET /api/geo/:city/lots` |
| `get_lot_card` | `immo:read` | `GET /api/geo/:city/lots` (filtre `no_lot`) + rôle/zone |
| `search_signals` | `immo:search` | `GET /api/graph-signals/:city` |
| `get_opportunity_dossier` | `immo:read` | `GET /api/opportunites` + `GET /api/signals/:city/detail` |
| `list_documents` | `immo:documents:read` | `GET /api/documents/raw` |
| `read_document_excerpt` | `immo:documents:read` | `GET /api/documents/raw` (extrait borné, redaction) |

Mutations (`notes`, `ProspectMark`, `decisions:propose`) = **hors v0** : non enregistrées (ou
stub refusant avec `not_implemented`), scopes `immo:notes:write` / `immo:decisions:propose` gated.

### A.5 Enregistrement MCP (modèle « track » → entrée « immo »)

Modèle de référence (serveur `track` stdio dans `~/.claude.json`) :

```jsonc
"track": { "type": "stdio", "command": "node",
           "args": ["/home/antoinefa/.npm-global/lib/node_modules/@sentropic/track/dist/mcp/cli.js"] }
```

Entrée `immo` à écrire dans `.mcp.json` à la racine du repo (projet-local, greppable, sans secret) :

```jsonc
{
  "mcpServers": {
    "immo": {
      "type": "stdio",
      "command": "node",
      "args": ["packages/immo-mcp/dist/server.js"],
      "env": {
        "IMMO_MCP_DATA_MODE": "mock",          // "mock" (défaut) | "http"
        "RADAR_API_BASE_URL": "http://127.0.0.1:8803",  // utilisé seulement si DATA_MODE=http
        "IMMO_MCP_AUTH_STUB_SUB": "demo-user",
        "IMMO_MCP_AUTH_STUB_TENANT": "radar",
        "IMMO_MCP_AUTH_STUB_SCOPES": "immo:read immo:search immo:documents:read"
      }
    }
  }
}
```

### A.6 Squelette de code prêt à coller

**`src/server.ts`** (bootstrap + enregistrement) :

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveAuthContext } from "./auth-context.js";
import { createDataSource } from "./data-source.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  const auth = resolveAuthContext(process.env);        // stub now, OAuth-ready
  const data = createDataSource(process.env);          // mock | http seam
  const server = new McpServer({ name: "immo", version: "0.0.1" });

  registerTools(server, { auth, data });               // wires the 6 tools

  const transport = new StdioServerTransport();
  await server.connect(transport);                     // stdio: never log to stdout
}

main().catch((err) => {
  process.stderr.write(`[immo-mcp] fatal: ${String(err)}\n`);
  process.exit(1);
});
```

**`src/auth-context.ts`** (contexte d'auth imposé hors args LLM + audit) :

```ts
export interface ImmoMcpAuthContext {
  sub: string; userId?: string; tenantId: string; orgId?: string;
  roles: string[]; scopes: string[]; workspaces: string[];
  dataMode: "real" | "simulation"; audience: string;
}

/** v0 stub: claims from env, NEVER from tool arguments. OAuth-ready (phase 2 swaps the body). */
export function resolveAuthContext(env: NodeJS.ProcessEnv): ImmoMcpAuthContext {
  return {
    sub: env.IMMO_MCP_AUTH_STUB_SUB ?? "demo-user",
    tenantId: env.IMMO_MCP_AUTH_STUB_TENANT ?? "radar",
    roles: ["viewer"],
    scopes: (env.IMMO_MCP_AUTH_STUB_SCOPES ?? "immo:read immo:search immo:documents:read").split(/\s+/),
    workspaces: ["default"],
    dataMode: env.IMMO_MCP_DATA_MODE === "http" ? "real" : "simulation",
    audience: "mcp/immo",
  };
}

export function assertScope(auth: ImmoMcpAuthContext, scope: string): void {
  if (!auth.scopes.includes(scope)) throw new Error(`scope_denied:${scope}`);
}

/** Audit hook: tenant/user/tool/input-hash/redacted summary, NO raw sensitive payload. */
export function auditToolCall(auth: ImmoMcpAuthContext, tool: string, inputHash: string): void {
  process.stderr.write(JSON.stringify({
    at: new Date().toISOString(), tenant: auth.tenantId, sub: auth.sub, tool, inputHash,
  }) + "\n");
}
```

**`src/tools.ts`** — 1 tool prêt à coller (`search_lots`) :

```ts
import { z } from "zod";
import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertScope, auditToolCall, type ImmoMcpAuthContext } from "./auth-context.js";
import type { ImmoDataSource } from "./data-source.js";

export function registerTools(
  server: McpServer,
  ctx: { auth: ImmoMcpAuthContext; data: ImmoDataSource },
): void {
  server.registerTool(
    "search_lots",
    {
      title: "Search lots",
      description: "Recherche de lots par ville et critères (zone, no_lot, superficie min).",
      inputSchema: {
        city: z.string().min(1),
        zone: z.string().optional(),
        minArea: z.number().positive().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async (args) => {
      assertScope(ctx.auth, "immo:search");                       // auth from context, not args
      const inputHash = createHash("sha256").update(JSON.stringify(args)).digest("hex").slice(0, 12);
      auditToolCall(ctx.auth, "search_lots", inputHash);
      const lots = await ctx.data.searchLots(args);               // mock | http behind the seam
      return { content: [{ type: "text", text: JSON.stringify({ lots }, null, 2) }] };
    },
  );

  // ... get_lot_card, search_signals, get_opportunity_dossier, list_documents, read_document_excerpt
}
```

### A.7 Gate de réalisation (preuve mardi)

1. `npm i -w packages/immo-mcp @modelcontextprotocol/sdk zod` puis `npm run -w @radar/immo-mcp build`.
2. `npm run -w @radar/immo-mcp test` (vitest : 6 tools listés + 1 appel conforme).
3. Démo MCP : enregistrer `.mcp.json`, redémarrer le client, `list tools` (6) + `search_lots` réel.
4. Phase 2 (post-mardi) : `IMMO_MCP_DATA_MODE=http` → bascule API `:8803`, durcir redaction/PII +
   policy métier, puis brancher OAuth `@sentropic/mcp` pour le chemin distant Claude.ai.

---

## B) AUTH DURABLE — diagnostic & plan de fix

Track item de référence : **`01KW2KS65RKCSBNBEWQVSN7PH7`** — « Auth durable Sentropic — éviter
redemande permanente, session 15j, autorisation persistée » (workspace `frontA-infra`, bucket TO-DO,
realization in-progress). Item parent de recalage : `01KW2KS5K2D1Y7KGYF41ZAZGSW`.

### B.0 Le flux actuel (constaté dans le code)

- **RP OIDC** vers l'IdP sentropic `auth.sent-tech.ca` : `authorization_code` + PKCE, scopes
  `openid profile email` (`deploy/k8s/80-auth.yaml`, `api/src/services/auth/oidc.ts`).
- **Session radar = JWS HS256 stateless** (`api/src/services/auth/session.ts`), cookie HttpOnly
  `radar_session`, posé avec `maxAge = SESSION_TTL_SECONDS` et `exp = iat + ttlSeconds`.
- **TTL** : `SESSION_TTL_SECONDS` défaut **28800 s = 8 h** (`api/src/config.ts:136`). Aucune
  surcharge dans `deploy/` (grep `SESSION_TTL` → 0 résultat) ⇒ **8 h en production**.
- Le `protect` middleware (`api/src/routes/auth.ts`) vérifie le cookie à chaque requête mais
  **ne le re-signe jamais**. `/me` ne renouvelle pas non plus. Le token exchange récupère
  `id_token` (l'`access_token`/`refresh_token` sont **ignorés**, scope `offline_access` **absent**).
- Côté SPA, `auth-store.ts redirectToLogin()` envoie **systématiquement** `?prompt=login` (ligne
  131) ; `App.svelte` affiche `LoginView` (clic explicite « Se connecter ») dès que `/me` répond
  `authenticated:false`.

### B.1 Cause racine de la « redemande à chaque fois » (écran « Autoriser l'application »)

Trois facteurs cumulés, par ordre d'impact :

1. **Session courte (8 h) + AUCUN refresh silencieux ni sliding window.** Le cookie est un JWS
   figé : passé `exp`, il expire **durement**. Pas de re-signature sur activité, pas de
   `refresh_token` (jamais demandé via `offline_access`, jamais stocké). ⇒ Tout utilisateur actif
   repasse par l'IdP au moins toutes les 8 h. **C'est le moteur principal de la redemande.**

2. **`prompt=login` inconditionnel sur CHAQUE re-login (cause directe de l'écran qui revient).**
   À l'expiration de la session, le SPA montre `LoginView` ; au clic, `redirectToLogin()` force
   `prompt=login`. L'IdP **ré-authentifie** alors l'utilisateur (ré-affichage login + ré-octroi
   d'autorisation) **même si sa session SSO IdP (~7 j) est encore valide**, au lieu d'un re-issue
   SSO silencieux. ⇒ L'écran « Autoriser l'application » revient à chaque cycle. Ce `prompt=login`
   a été ajouté volontairement pour corriger un bug « reconnect = compte précédent » / fuite de lien
   d'invitation — mais il **rend la session durable inopérante** : tout re-login devient une
   ré-auth complète.

3. **Persistance du consentement côté IdP (dépendance externe à vérifier).** L'écran exact
   « Autoriser l'application » est le **consentement** IdP. Si l'IdP sentropic ne persiste pas le
   consentement par `(user, client=radar-immobilier, scopes)`, ou si `prompt=login` réinitialise le
   consentement, il est redemandé à chaque login. Le code IdP vit dans le repo `sentropic`
   (hors de ce repo) → à confirmer côté IdP : table `oauth_consents` écrite **et** honorée pour le
   client radar.

**Non-causes écartées :** le cookie *est* persistant (`maxAge` posé → survit au redémarrage
navigateur), HttpOnly/Secure/SameSite=Lax/host-only corrects ; `/me` est `no-store` (anti-cache OK).
Le symptôme n'est donc ni un cookie volatile, ni un cache `/me`, mais **TTL court + `prompt=login`
forcé + consentement non réutilisé**.

### B.2 Plan de fix concret et ordonné

**Fix prioritaire (P1) — Session durable 15 j + revalidation silencieuse (sliding).** Le plus haut
levier : si le cookie radar dure 15 j **et se renouvelle** sur activité, l'utilisateur actif ne
repasse quasi jamais par l'IdP → la redemande disparaît, indépendamment du comportement IdP.

1. **Étendre le TTL à 15 jours.** `api/src/config.ts` : `SESSION_TTL_SECONDS` défaut →
   **1 296 000** (15 j). Surcharger explicitement en prod : ajouter `SESSION_TTL_SECONDS: "1296000"`
   au ConfigMap api (`deploy/k8s/30-api.yaml`) pour rendre la valeur déclarative et greppable.
2. **Sliding session (re-mint).** Dans `protect` (et/ou `/me`), quand la session est valide et que
   l'on a dépassé la **moitié de vie** (`exp - now < ttl/2`), **re-signer** un nouveau cookie
   (`signSession` + `setCookie` mêmes attributs, `maxAge` plein). ⇒ Fenêtre glissante de 15 j tant
   que l'utilisateur revient au moins une fois par 15 j, **sans aucun retour IdP**.
   - Garde-fou : plafond absolu (ex. ne pas faire glisser au-delà de 30 j d'ancienneté via un claim
     `iat` d'origine), pour borner la durée d'une session compromise.

**Fix P2 — Anti-réauth : rendre `prompt=login` conditionnel.** Aujourd'hui il est systématique.
Le réserver aux cas où une ré-auth réelle est voulue, et l'omettre pour le re-login courant.

3. **Distinguer deux chemins de login dans `auth-store.ts` / `auth.ts` :**
   - **Re-login ordinaire** (session radar expirée) → `/api/v1/auth/login` **sans** `prompt`
     ⇒ l'IdP réutilise SSO + consentement mémorisé → **silencieux, pas d'écran**.
   - **Ré-auth explicite** (`/enroll` invitation, bouton « Changer de compte », logout→reconnect)
     → conserver `prompt=login`. C'est déjà la sémantique voulue par les commentaires du code ;
     il suffit de **ne plus forcer** `prompt=login` dans le `redirectToLogin()` par défaut.
   - Risque à couvrir : le fix `prompt=login` corrigeait une fuite (lien d'invitation réutilisant
     une session). Conserver `prompt=login` **uniquement** sur `/enroll` et le switch-account
     préserve la correction sans pénaliser le re-login normal. Tests `auth-store.test.ts` +
     `auth.test.ts` à mettre à jour en conséquence.

**Fix P3 — Persistance du consentement (dépendance IdP, repo sentropic).**

4. **Vérifier/garantir côté IdP** que le consentement du client `radar-immobilier` est **persisté
   et réutilisé** entre logins (table `oauth_consents` écrite et honorée ; ne pas re-prompter le
   consentement quand les scopes sont inchangés et déjà accordés). À tracer comme dépendance externe
   du item `01KW2KS65RKCSBNBEWQVSN7PH7`.
5. **(Option) Aligner la durée SSO de l'IdP** (~7 j) sur l'objectif 15 j, ou documenter que la
   session radar (15 j, P1) est la source de durabilité côté produit et que l'IdP n'est sollicité
   qu'aux bornes.

### B.3 Scénario de preuve (rouge → vert)

Pré-requis : auth activée (SESSION_SECRET + SENTROPIC_OAUTH_CLIENT_SECRET injectés),
`SESSION_TTL_SECONDS=1296000`, P1+P2 livrés.

1. **Login** : `/` → `LoginView` → « Se connecter » → IdP → callback → `radar_session` posé
   (`Max-Age≈1296000`, `Set-Cookie` HttpOnly/Secure/SameSite=Lax). `/me` → `authenticated:true`.
2. **Reload** (F5) : `/me` → `authenticated:true` **sans** retour IdP, **sans** écran « Autoriser ».
3. **Navigation** (signaux → opportunités → évaluation) : chaque requête protégée passe ; au
   franchissement de la mi-vie, `Set-Cookie` de re-mint observé (sliding), `exp` repoussé.
4. **Fermeture/réouverture navigateur** (< 15 j) : session restaurée, **aucune** redemande.
5. **Anti-régression sécurité** : clic « Changer de compte » / lien `/enroll` → `prompt=login`
   présent → l'IdP redemande bien l'authentification (la correction de fuite est préservée).

Preuves attendues : trace `Set-Cookie` (Max-Age + re-mint), absence de redirection 302 vers
`/api/v1/auth/login` sur reload/navigation, et présence de `prompt=login` **uniquement** sur les
chemins enroll/switch. Tests : `api/src/routes/auth.test.ts` (sliding re-mint, prompt conditionnel),
`ui/src/lib/auth/auth-store.test.ts` (re-login sans prompt par défaut), e2e Playwright authentifié
(login → reload → navigation → 0 redemande).

### B.4 Fichiers concernés (pour l'exécution)

- `api/src/config.ts` (TTL défaut 15 j) ; `deploy/k8s/30-api.yaml` (`SESSION_TTL_SECONDS` déclaratif).
- `api/src/routes/auth.ts` (`protect`/`/me` : sliding re-mint ; `/login` : prompt conditionnel).
- `api/src/services/auth/session.ts` (option : claim `iat0`/plafond absolu pour borner le sliding).
- `ui/src/lib/auth/auth-store.ts` (`redirectToLogin` : `prompt=login` réservé enroll/switch).
- Côté IdP (repo `sentropic`, dépendance externe) : persistance/réutilisation du consentement client.
