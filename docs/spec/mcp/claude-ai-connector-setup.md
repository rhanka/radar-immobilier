# Connecter le Radar immobilier à claude.ai (connecteur MCP)

Guide utilisateur — 5 minutes. Prérequis : un compte claude.ai **Pro, Max, Team ou Enterprise**
(sur Team/Enterprise, l'ajout de connecteur se fait par un **admin** dans les réglages d'organisation).

## Paramètres à avoir sous la main

| Champ | Valeur |
|---|---|
| URL du serveur MCP | `https://immo.sent-tech.ca/mcp` |
| OAuth Client ID | *(fourni par l'équipe — client public)* |
| Client Secret | **aucun** (laisser vide — flux PKCE) |
| Scopes accordés au login | `immo:read`, `immo:search`, `immo:documents:read` |
| Scopes artefacts (préproduction `https://preprod.immo.sent-tech.ca/mcp`) | `immo:artifacts:read` (`artifacts_list`, `artifacts_get`), `immo:artifacts:write` (`artifacts_ensure`, `artifacts_publish`) |

### Scopes artefacts et transition

- Les outils d'artefacts exigent un scope **explicite** ; `immo:read` ne permet
  jamais d'écrire. Sans `immo:artifacts:write`, `artifacts_ensure` et
  `artifacts_publish` répondent
  `{"error":"artifact_scope_denied","retryable":false,"requiredScope":"immo:artifacts:write"}`.
- Transition : drapeau serveur `IMMO_MCP_ARTIFACTS_LEGACY_READ_SCOPE` (défaut
  `false` ; `true` en préproduction pendant la transition). Actif, il laisse
  `immo:read` satisfaire **la lecture seule** (`artifacts_list`, `artifacts_get`)
  pour les connecteurs autorisés avant ces scopes. Il ne s'applique jamais à
  l'écriture. Retrait prévu quand les connecteurs ont été ré-autorisés.
- À la connexion préproduction, **accepter** `immo:artifacts:read` et
  `immo:artifacts:write` en plus des trois scopes de données. Prérequis : le
  catalogue de l'IdP préprod et le client `immo-mcp` déclarent ces deux scopes.

## Étapes

1. Ouvrir **claude.ai → ⚙️ Settings → Connectors**
   (raccourci : `https://claude.ai/settings/connectors`).
2. Cliquer **« Add custom connector »**.
3. Renseigner :
   - **Name** : `Radar immobilier`
   - **Remote MCP server URL** : `https://immo.sent-tech.ca/mcp`
4. Ouvrir **Advanced settings** dans la même boîte de dialogue :
   - **OAuth Client ID** : coller le client ID fourni ;
   - **Client Secret** : laisser **vide**.
5. Cliquer **Add**. Une fenêtre de connexion `auth.sent-tech.ca` s'ouvre :
   se connecter avec son compte sentropic, puis **accepter** les autorisations.
6. Dans une conversation : ouvrir le menu **Search & tools** (icône curseurs,
   en bas de la zone de saisie) → activer **Radar immobilier**.

## Utilisation

Poser des questions en langage naturel ; Claude appelle les outils du radar :

- « Quels signaux de rezonage récents à Sainte-Catherine ? »
- « Cherche les signaux PPCMOI dans Roussillon »
- « Montre-moi le procès-verbal source de ce signal »

## Dépannage

- **La fenêtre OAuth ne s'ouvre pas / erreur client** : vérifier le Client ID
  (Advanced settings) — champ exact, pas d'espace, secret vide.
- **401 après connexion** : les autorisations n'ont pas été accordées — refaire
  le flux et accepter les scopes.
- **`artifact_scope_denied`** (préproduction) : le scope `requiredScope` n'a pas
  été accordé — déconnecter puis reconnecter le connecteur et accepter les scopes
  artefacts.
- **Le connecteur n'apparaît pas dans une conversation** : l'activer dans
  **Search & tools** (il est désactivé par défaut par conversation).

## Références

- Doc officielle Anthropic : *Getting started with custom connectors using
  remote MCP* (centre d'aide support.claude.com).
- Runbook interne serveur : `docs/spec/mcp/immo-mcp-remote-deploy.md`
  (déploiement, OAuth RS, manifests k8s).
