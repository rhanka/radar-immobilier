# Drumbeat MCP immo — diagnostic & relance (2026-06-28)

**Statut final : BLOQUÉ.** Le provider MCP « immo » **n'est pas down/perdu : il n'a jamais
été réalisé**. Le seul artefact existant est le cadrage v0. Il n'y a aucun binaire, aucune
config, aucun process à relancer. Le passer en UP suppose une décision de **build** (pas un
simple redémarrage). Voir « Action faite » et « Comment l'interroger » pour le repli.

---

## 1. Définition trouvée

- **Spec de cadrage (unique artefact) :** `docs/spec/mcp/immo-mcp-provider-v0.md`
  - Track item cité : `01KW1S7E7WQKPAVKJX18RZ8116` (n'appartient PAS au track de ce repo — voir §état).
  - Nature : **cadrage v0 read-only / mock-first**, pas une implémentation.
  - Architecture cible : couche réutilisable `@sentropic/mcp` (transport/serveur MCP, OAuth/RS,
    validation claims, audit) + provider domaine radar au-dessus.
  - Tools v0 prévus : `search_lots`, `get_lot_card`, `search_signals`,
    `get_opportunity_dossier`, `list_documents`, `read_document_excerpt`.
  - Auth : `ImmoMcpAuthContext` (claims token, jamais args LLM), scopes `immo:read`, `immo:search`,
    `immo:documents:read`, etc.
  - Critère d'acceptation v0 = « Provider contract TS **ou scaffold minimal compilable** ».
    → Ce critère n'est **pas** atteint dans ce repo.

- **Implémentation : INTROUVABLE.** Recherche exhaustive (arbre principal + tous les worktrees
  `.claude/worktrees/`, `.worktrees/`, `tmp/`, hors `node_modules`) :
  - Aucun fichier important `@modelcontextprotocol/sdk`, aucun `new McpServer(...)`.
  - Aucune occurrence des noms d'outils (`search_lots`, `get_lot_card`,
    `get_opportunity_dossier`) ni du type `ImmoMcpAuthContext` dans le code source.
  - Aucun package `@sentropic/mcp` ni dépendance `@modelcontextprotocol/sdk` dans un
    `package.json` du repo.
  - Aucune branche git, aucun commit, aucun stash, aucune entrée d'historique mentionnant un MCP immo.
  - Aucune route API MCP (`api/src/` ne contient rien de MCP).

## 2. Commande de lancement

**Il n'existe aucune commande de lancement** : rien n'a été scaffoldé.
- Pas de script `mcp`/`immo` dans `package.json` (racine, `api/`, `packages/*`).
- Pas d'entrée `mcpServers."immo"` dans une config Claude (`~/.claude.json`, `.mcp.json`).
- Donc rien à invoquer (ni stdio, ni HTTP).

À titre de comparaison, les MCP réellement déclarés/actifs sur la box sont `h2a` et `track`
(globaux dans `~/.claude.json`), définis ainsi :
```jsonc
// ~/.claude.json (mcpServers global) — exemple track (stdio)
"track": { "type": "stdio", "command": "node",
           "args": ["/home/antoinefa/.npm-global/lib/node_modules/@sentropic/track/dist/mcp/cli.js"] }
```
Le bloc `mcpServers` du projet `/home/antoinefa/src/radar-immobilier` est **vide** (`{}`).

## 3. État avant

- **Process :** `ps aux | grep -iE 'mcp|immo'` → uniquement `track-mcp` (plusieurs) et
  `h2a mcp-serve`. **Aucun** process immo.
- **Ports en écoute (`ss -ltnp`) :** aucun port dédié à un MCP immo. Ports node actifs =
  UI/preview de la démo (5320 et 5332 répondent HTTP 200 ; 5310/5321/5331 ouverts mais
  non-HTTP). Le MCP n'expose rien.
- **Config MCP :** aucun serveur « immo » enregistré (ni global, ni projet, ni `.mcp.json`).
- **Track :** l'item `01KW1S7E7WQKPAVKJX18RZ8116` du cadrage **n'est pas** dans le track de
  radar-immobilier (110 items inspectés au baseline `f678149`, aucun MCP). Il vit dans un autre
  workspace track (vraisemblablement `sentropic`, cohérent avec la couche `@sentropic/mcp`).
- **Conclusion d'état :** non pas « tombé », mais **jamais mis debout**.

## 4. Action faite

- Diagnostic complet (localisation spec, recherche code/branches/stash/worktrees, process, ports,
  config MCP, track). **Aucune relance possible** : il n'y a pas d'exécutable.
- Conformément à la contrainte « ne force pas si décision requise » : **rien lancé, rien déployé,
  rien committé, aucune branche**. Le blocage est en amont (build manquant), pas un secret/port.

## 5. Test de réponse réel

**Impossible — aucun serveur à appeler.** Je ne déclare donc PAS d'état « UP » : aucune preuve
d'appel (liste d'outils / requête) ne peut être produite tant que le provider n'existe pas.

## 6. Statut final

**BLOQUÉ.** Livrable « MCP immo » = **non construit** (seul le cadrage v0 existe). Présentable
mardi uniquement si on décide de scaffolder un serveur minimal d'ici là (voir §8).

## 7. Comment interroger la donnée (repli immédiat, sans MCP)

En attendant le MCP, la donnée radar reste interrogeable via l'**API/UI HTTP locale** (la stack
démo tourne) :
- UI démo : servies sur `127.0.0.1:5320` / `127.0.0.1:5332` (HTTP 200). Cf. mémoire
  « Demo bring-up » (localhost:5301 en stack `make` dev) pour relancer proprement.
- API dev (compose `docker-compose.dev.yml`) : `API_PORT` host `8803` → conteneur `:3000`
  (non exposé à l'instant ; `make` dev pour l'ouvrir). Routes data sous `api/src/routes`.
- C'est un accès HTTP direct, **pas** un accès MCP standard (donc pas utilisable tel quel depuis
  Claude.ai/Claude Desktop/mcp-wave comme le voulait le cadrage).

## 8. Blocages & chemin de déblocage (préco)

**Blocage :** le scaffold MCP immo n'a jamais été produit dans le repo. Ce n'est pas un incident
runtime, c'est un travail de réalisation manquant.

**Préco pour rendre « UP » et démontrable mardi (option minimale, raisonnable) :**
1. Décider de viser un **scaffold stdio mock-first** (le plus court chemin vers une démo MCP) :
   un petit serveur Node `@modelcontextprotocol/sdk` exposant les 6 tools read-only du cadrage,
   branchés d'abord sur des mocks puis sur l'API radar locale (`:3000`/`:8803`).
2. L'enregistrer comme MCP stdio dans le projet (`.mcp.json` du repo, ou
   `mcpServers."immo"` du projet dans `~/.claude.json`), sur le modèle du serveur `track`
   ci-dessus (`type: stdio`, `command: node`, `args: [<dist/serveur>]`).
3. Prouver l'UP par un appel réel (list tools + un `search_signals`/`search_lots`).

**Décisions à trancher avant build** (raison pour laquelle je n'improvise pas) :
- Périmètre mardi : **mock-first** (rapide, sûr) vs branché sur l'API réelle (auth/PII à gérer).
- Auth/scopes : le cadrage impose un `ImmoMcpAuthContext` issu d'un token validé. Pour une démo
  locale, un stub d'auth suffit ; pour Claude.ai distant, il faut l'intégration OAuth/RS
  `@sentropic/mcp` (non disponible ici → hors scope d'un drumbeat).
- Localisation du build : ce repo (`packages/` ou `api/`) vs le repo `sentropic` (où vit le track
  item et la couche `@sentropic/mcp`).

---

### Annexe — preuves de diagnostic (commandes)
- `grep -rIl '@modelcontextprotocol/sdk|new McpServer|ImmoMcpAuthContext|search_lots|get_lot_card' .`
  (hors node_modules) → **0 résultat**.
- `git log --all --oneline | grep -i mcp` → **0**. `git branch -a | grep -i mcp` → **0**.
  `git stash list` → aucun stash MCP.
- `ps aux | grep -iE 'mcp|immo'` → seulement `track-mcp` + `h2a mcp-serve`.
- `ss -ltnp` → aucun port MCP immo.
- `~/.claude.json` : `mcpServers` global = { h2a, track } ; projet radar-immobilier = {}.
- `mcp__track__track_query` (baseline `f678149…`) : item `01KW1S7E7WQKPAVKJX18RZ8116` absent.
