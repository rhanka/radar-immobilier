# Connecter le Radar immobilier à claude.ai (connecteur MCP)

Guide utilisateur — 5 minutes. Prérequis : un compte claude.ai **Pro, Max, Team ou Enterprise**
(sur Team/Enterprise, l'ajout de connecteur se fait par un **admin** dans les réglages d'organisation).

## Paramètres à avoir sous la main

| Champ | Production | Préprod |
|---|---|---|
| URL du serveur MCP | `https://immo.sent-tech.ca/mcp` | `https://preprod.immo.sent-tech.ca/mcp` |
| OAuth Client ID | *(fourni par l'équipe — client public)* | `immo-mcp-preprod` (client public) |
| Client Secret | **aucun** (laisser vide — flux PKCE) | **aucun** (laisser vide — flux PKCE) |
| Scopes accordés au login | `immo:read`, `immo:search`, `immo:documents:read` | identiques |

Pour la préprod, suivre les mêmes étapes avec les valeurs de la colonne
**Préprod** (nom suggéré : `Radar immobilier (préprod)`). Le guide illustré
[`docs/guides/connecteur-mcp/guide-connecteur-claude-ai.md`](../../guides/connecteur-mcp/guide-connecteur-claude-ai.md)
(et son PDF) détaille les outils, l'exemple de génération d'artefact et, en
annexe A, les erreurs typées en préprod.

> **Connecteur préprod déjà en place ?** Rien ne change avec la nouvelle version
> du MCP : le connecteur existant continue de fonctionner tel quel. Il faut
> seulement le recréer si l'on change de compte Claude.

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
- **Le connecteur n'apparaît pas dans une conversation** : l'activer dans
  **Search & tools** (il est désactivé par défaut par conversation).

## Références

- Doc officielle Anthropic : *Getting started with custom connectors using
  remote MCP* (centre d'aide support.claude.com).
- Runbook interne serveur : `docs/spec/mcp/immo-mcp-remote-deploy.md`
  (déploiement, OAuth RS, manifests k8s).
- Guide illustré (outils, artefacts, annexe A préprod) :
  `docs/guides/connecteur-mcp/guide-connecteur-claude-ai.md` et son PDF.
