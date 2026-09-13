# Rapport architecture et livraison — 10 août → 13 septembre 2026

Statut : rapport D8, **pas une facture fournisseur ni une preuve de déploiement
des cibles**. Fenêtre America/Toronto : `2026-08-10T00:00:00-04:00` inclus à
`2026-09-14T00:00:00-04:00` exclus, soit **35 jours / 840 heures**.

## 1. Jointure avec la période précédente

Le dernier rapport de coûts fusionné sur `origin/main`,
`docs/reports/couts-2026-07-13_2026-08-09.md`, finit le **9 août**. Le présent
rapport commence donc le **10 août**, sans trou ni recouvrement. Un brouillon
hors main n’est pas utilisé comme précédent. Aucune facture externe plus récente n’est présente
dans le dépôt; cette réserve n’empêche pas d’établir la jointure des rapports Git.

## 2. Architecture — AVANT / APRÈS

Le [Focus HTML daté](architecture-before-after-2026-09-13.html) compare
exactement deux vues principales : **Architecture AVANT → Architecture APRÈS**.
Les deux graphes sont produits à partir des Mermaid commités sous deux formes :
SVG rendu et SvelteFlow natif complet avec sous-flows `parentId`. Chaque
nœud/boîte affiche une icône de service et sa provenance
`radar-immobilier`, `geo`, `poc-k8s` ou externe; URL utilisateurs et SSO sont
inclus. La [version PDF](report-through-2026-09-13.pdf) copie les deux graphes
natifs complets sur pages A3 paysage; quatre zones recouvrantes par graphe
reprennent les mêmes sous-flows, icônes et labels `repo:` à taille lisible.

| Vue | État au 13 septembre | Lecture |
| --- | --- | --- |
| Architecture AVANT | API raw/documents MinIO, graphe OVH, LLM depuis poste | Capture de référence |
| Architecture APRÈS | RAW/DOCS OVH, refresh autonome, Immo+Geo sur un b3-8 existant | Cible non déployée; NO-GO actuel |

Les faits de transition (RAW OVH actif, T1 arrêté avant le LLM, T2 préprod
accepté et T2 production en cours) expliquent le delta dans le texte. Ils ne
constituent pas un troisième graphe d’architecture.

## 3. Travaux réalisés et vérifiés dans la fenêtre

- Graphify **0.18.0** a été intégré dans le refresh Immo; **Luna high** est le
  modèle sélectionné.
- Une première validation Kubernetes a été exécutée. Elle a échoué **avant tout
  appel LLM** : l’objet d’entrée était `.html`, alors que le profil exige un PDF.
  Cela prouve le fail-closed d’entrée, pas un Signal ni T1 accepté.
- Le rôle RAW préprod a passé la parité et l’API a été rebound vers
  `PP-RAW-OVH`; l’ancienne identité raw est fenced/recovery-only.
- T2 préprod est accepté : DOCS OVH contient exactement **59,017 objets /
  12,534,514,457 octets**, manifeste canonique SHA-256 `52646a7b…0425`, avec
  **failed=0**. Le surplus MinIO préprod n’a pas été promu comme canonique.
- Le StatefulSet, Pod et Service MinIO, le PVC data de 40 Gi et six
  NetworkPolicies ont été retirés. Le PVC de migration/checkpoint reste; la
  consommation quota passe de 4 PVC/47 Gi à 3 PVC/7 Gi. API/MCP/UI restent 1/1.
- L’implémentation est poussée sur `chore/scw-final-sweep` à `2ccabfc8`, mais
  n’est pas encore sur `origin/main` dans ce snapshot.
- Les URL Immo prod/préprod, leurs issuers SSO et les responsabilités des trois
  repos sont conservés dans les vues de référence.

## 4. Travaux en cours — aucune anticipation comptée comme acquise

- T1 : corriger la sélection vers un PDF réel, atteindre Luna high, puis prouver
  Signal typé + PDF exact, rejeu idempotent et schedule autonome.
- T2 production est en cours. La source SCW actuelle reste la **référence
  initiale exacte** et OVH production doit atteindre les mêmes **59,017 keys et hashes**
  déjà acceptés en préprod. Les 85,176 objets de surplus préprod sont non-canoniques
  et n’ont pas été migrés.
- La gate production reste indépendante : copie conditionnelle → égalité des
  comptes/keys/hashes → preuve de reprise → fence/rebind → retrait MinIO.
- SCW TEM reste en place jusqu’à validation de son remplacement.

## 5. Projection d’aboutissement

Préprod a atteint sa tranche T2. Après la gate production, les deux
environnements porteront le corpus canonique DOCS dans OVH et aucun MinIO ne
restera actif. Après T1, le refresh est autonome en K8s. T3 reste gated : les
4,095m/8,442 Mi de requests mesurés avant cleanup ne tenaient pas dans
1,840m/5,907.82 Mi allouables. La nouvelle base, dont préprod est maintenant à
3 PVC/7 Gi, doit être re-mesurée; une étape deux nœuds vérifiée précède tout
essai un nœud.

## 6. Coûts — méthode conservée, résultat non forcé

### Infrastructure

La seule projection facturable demandée est **un b3-8 BHS5** au tarif déjà
observé de `0.082 CAD/h` :

`1 × 840 h × 0.082 CAD/h = 68.88 CAD`.

Les coûts de deux ou trois nœuds observés sont des coûts plateforme
pass-through/internes : ils sont explicitement exclus. Les 68.88 CAD sont une
projection cible, pas une consommation fournisseur mesurée sur la fenêtre.

### LLM

L’[audit JSON](token-audit-2026-08-10_2026-09-13.json) parcourt les sessions
locales sur les bornes exactes. Claude est dédoublonné par `(fichier,message.id)`,
avec maximum composante par composante pour 20 divergences; Codex par signature
exacte `(sessionId,timestamp,usage)`. Les dates sont ramenées en America/Toronto.
La collecte a été figée le **2026-09-13T21:09:35.483Z** : les sessions du 13
postérieures à ce cutoff ne sont donc pas inventées, tandis que la projection
infra couvre contractuellement les 840 heures complètes.

La méthode et les unités du rapport précédent sont conservées : pic capacité
global glissant de sept jours par fournisseur; deux sièges Claude et un ChatGPT
Pro à 200 USD/mois; USD→CAD 1.37; marge LLM ×1.15. La plateforme n’entre pas dans
les numérateurs immo/geo.

| Produit | Claude | Codex | Allocation CAD | Allocation avec marge ×1.15 |
| --- | ---: | ---: | ---: | ---: |
| immo | 14,009,998,961 | 1,426,882,082 | 121.163246 | **139.337732** |
| geo | 11,194,704,885 | 1,376,664,354 | 97.284961 | **111.877705** |
| **immo + geo** | **25,204,703,846** | **2,803,546,436** | **218.448207** | **251.215438 CAD** |

Capacités retenues : Claude **15,138,897,392 tokens / 7 j** (30 août→5
septembre, pic rafraîchi) et Codex **32,217,805,325 / 7 j** (4→10 mai, pic
historique audité resté supérieur au pic courant).

Le résultat LLM n’est pas abaissé artificiellement. Par rapport au brouillon de
30 jours (214.743159 CAD), la fenêtre correcte de 35 jours donne 251.215438 CAD;
le taux journalier passe de 7.1581 à **7.1776 CAD/j**, soit +0.27 %. L’écart
absolu vient principalement des cinq jours réintégrés. Forcer une baisse serait
contraire aux journaux mesurés.

La ratification de cette allocation LLM reste **ouverte et non critique**. Sans
réponse propriétaire, le montant demeure indicatif et ne bloque ni le dossier
d’architecture ni les gates T1–T3.

### Synthèse indicative non ratifiée pour le LLM

| Poste | Montant |
| --- | ---: |
| Projection infra, un b3-8 | **68.880000 CAD** |
| Allocation LLM immo+geo, non ratifiée | **251.215438 CAD** |
| **Somme indicative** | **320.095438 CAD** |

## 7. Sources, incertitudes et rejeu

- Les tokens viennent de journaux locaux : l’allocation n’est pas une ligne de
  facture fournisseur. Les tarifs/change sont repris, pas re-mesurés.
- Le corpus de capacité historique Codex vient de l’audit dédoublonné du
  11 septembre; la nouvelle fenêtre l’aurait remplacé si son pic avait été plus
  élevé. Claude a été rescanné sur toute la fenêtre.
- Les résultats runtime T1/T2 proviennent des branches de réalisation et des
  faits owner datés; aucune symétrie production non observée n’est inventée.

Rejeu documentaire et preuve :

```sh
make -f docs/architecture/focus/Makefile tokens test build browser clipboard ENV=test-architecture
```
