# Décisions de Fabien — trace du 14 octobre 2026

## Sens confirmé

Cluster-mesh tourne dans Immo. Le nœud compose le MCP actuel et la bibliothèque
Sentropic de gestion des artefacts, avec ses ressources DB/S3. Même adresse MCP,
même connexion et mêmes comptes, sans reconnexion ni réglage ; mêmes noms,
paramètres et réponses des outils existants. Les outils artefacts s’y ajoutent.
Les vues permettent les usages métier de l’UI, écritures comprises, avec les
droits de leur lecteur. Les estimations en jours sont retirées.

**L’export B n’est pas réinterprété seul :** son commentaire puis la clarification
fixent l’hébergement dans Immo. La v9 et son export restent inchangés dans les archives.

## Message 10 — export et phrase d’origine

```yaml
dossier: >-
  Artefacts UI · #861 · v9 · brouillon local non ratifié
fichier: DOSSIER-DECISION.md
version: source SHA-256:85babc548e6b992decbfd246b21eee329439dc3a42efd243a0e5d7c026d4d464
decideur: Fabien
date: 2026-10-14T07:37:34-04:00
coller_dans: https://github.com/rhanka/radar-immobilier/issues/861
decisions:
  - id: Hebergement
    titre: Hebergement — Par où publier d’abord ?
    role: decide
    decide: Fabien
    consulte: selon les appuis de la fiche
    option: B
    option_libelle: Héberger au nœud Sentropic dès le départ
    statut: tranchee
    commentaire: |
      cluster-mesh au sein de immo, pour clarifier - le mcp immo doit être wrappé par cluster-mesh. on doit conserver les identifiants et les tools actuels sans impact.
  - id: Donnees
    titre: Donnees — Que pourront faire les vues avec les données de préproduction ?
    role: decide
    decide: Fabien
    consulte: selon les appuis de la fiche
    option: C
    option_libelle: Les usages métier de l’UI, écritures comprises
    statut: tranchee
    commentaire: |
```


tes estimés de charge ne me servent a rien...

## Message 11 — clarification fournie par le conducteur

Réponses de l’owner (AskUserQuestion, 2026-10-14), libellés choisis tels quels :

- Hébergement : « Cluster-mesh dans Immo (Recommandé) » — description présentée : Immo fait tourner son propre nœud cluster-mesh qui contient la gestion des vues (base, stockage S3, publication). Le MCP Immo actuel est enveloppé par cluster-mesh sans changement pour l'utilisateur ; les outils de publication et de cycle de vie s'y ajoutent. Pas de service central Sentropic à attendre : Farid peut publier depuis Immo dès le pilote.
- Identifiants : « Les deux (Recommandé) » — même adresse MCP, même connexion, mêmes comptes, sans reconnexion ni réglage ; outils existants : mêmes noms, mêmes paramètres, mêmes réponses.
- Issue #861 : « Oui, après tes réponses (Recommandé) » — poster un commentaire en français avec les deux choix, le commentaire brut et ces réponses ; ne pas fermer la carte ni changer son statut.

## Commentaire déjà publié

[Commentaire #6174447767](https://github.com/rhanka/radar-immobilier/issues/861#issuecomment-6174447767). Le texte ci-dessous provient de la
copie locale fournie par le conducteur, pas d’une nouvelle publication par cette reprise.

## Décisions de l'owner sur le dossier « artefacts UI », 14/10/2026

Les deux décisions portent sur le dossier v9 (empreinte de la source : `85babc54…`). Décideur : Fabien.

### 1. Où tourne la gestion des vues
**Choix : cluster-mesh tourne dans Immo.**

Commentaire de l'owner, tel quel :
> cluster-mesh au sein de immo, pour clarifier - le mcp immo doit être wrappé par cluster-mesh. on doit conserver les identifiants et les tools actuels sans impact.

Ce que cela implique (lecture confirmée par l'owner) :
- Immo fait tourner son propre nœud cluster-mesh. Ce nœud contient la gestion des vues : la base, le stockage S3 et la publication. Le modèle et la bibliothèque viennent de Sentropic.
- Le MCP Immo actuel est enveloppé par cluster-mesh. Les outils de publication et de cycle de vie des vues s'y ajoutent.
- Il n'y a pas de service central Sentropic séparé à attendre : la publication depuis Immo est possible dès le pilote.
- **Rien ne change pour les utilisateurs actuels.** Ils gardent la même adresse du MCP, la même connexion et les mêmes comptes, sans se reconnecter ni refaire de réglage dans claude.ai. Les outils existants gardent leurs noms, leurs paramètres et leurs réponses à l'identique.

### 2. Ce que les vues peuvent faire avec les données de préproduction
**Choix : C.** Les vues peuvent faire les usages métier de l'UI, écritures comprises, avec les droits de la personne qui ouvre la vue.

---
La carte reste ouverte et son statut ne change pas.

## Conservation et portée

Source v9 : SHA-256 85babc548e6b992decbfd246b21eee329439dc3a42efd243a0e5d7c026d4d464.
Export brut : SHA-256 d3d3281bcb6b9532fb18d97d8cfc9e270a65d07a7fd507db0af81088d186cdb8.
Copie du commentaire : SHA-256 3221b5e1dcd1b15875b6e094763e150415c98c15b56823320a1d47879e637eda.

Archive supplémentaire avant reprise : versions/v9-avant-reprise-decisions-11/source.tar,
SHA-256 0d85b38f92fe062e43c0ddfd9ca83346e66c8a043753fffdc2ef4ab98ced67cf.
Les archives antérieures restent conservées. Cette trace ne crée ni signature,
attestation h2a, écriture Track, nouveau commentaire GitHub ni preuve de déploiement.

## Message 13 — appel du MCP vers Radar (15 octobre 2026)

Réponse de l'owner (AskUserQuestion) à la question du §5 de la v11 : « C. Attendre Sentropic ». On attend que Sentropic livre l'échange de jetons ; le pilote dépend de cette livraison.

## Message 14 — suites du choix C (15 octobre 2026)

Réponses de l'owner (AskUserQuestion), libellés choisis tels quels :

- Code Radar (récepteur de l'échange de jetons côté API et correctif de découverte OAuth côté MCP et ingress, sur une branche isolée, PR en brouillon, ni fusion ni déploiement) : « Oui, les deux (Recommandé) ».
- Photo des 12 outils dans packages/immo-mcp/src/fixtures/, sur la même branche : « Oui, même branche (Recommandé) ».
- Choix C : commentaire sur #861 et mise à jour de la page au même lien : « Oui, les deux (Recommandé) ».
