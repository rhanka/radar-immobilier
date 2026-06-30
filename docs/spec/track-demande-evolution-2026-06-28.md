# Demande d'évolution Track — retour terrain radar-immobilier (2026-06-28)

Émetteur : conducteur radar-immobilier (immo).
Destinataire : équipe Track (@sentropic/track).
Nature : retour d'usage + demande d'évolution produit. Aucune action attendue en urgence ; priorisation Track.

---

## 0. TL;DR — 4 demandes

1. **Reporting multi-échelle / multi-temporel NATIF** (`--since/--until/--scale`) + **rendu kanban 4 échelles natif** (En cours / Semaine / Mois / Global). Aujourd'hui reconstruit à la main côté radar.
2. **Décomposition Work Package STABLE dans le temps** : contrat d'immuabilité des codes WP/sous-items + **mode d'audit/restructuration** traçable qui n'efface pas l'historique.
3. **Lever/contourner l'invariant reparent cross-workspace** : pouvoir adopter des items hérités sous une nouvelle structure WP sans hand-edit ni projection externe.
4. **Délégation d'un WP à un agent dédié** (modèle sentropic) : owner/RACI par WP + protocole d'avancement agent→Track (h2a→ingest).

---

## 1. Restitution — ce qu'on a dû construire / contourner

Contexte : backlog Track **plat** (437 events / 111 items, **0 `role:workpackage`, 0 `parent`**), regroupé seulement par un champ `workspace` texte-libre à 14 valeurs incohérentes (4 générations de nommage). `track report` ne pouvait donc PAS produire de vue %·WP ni répondre aux 4 échelles temporelles. Pour rendre le suivi lisible et stable, on a dû, côté radar :

| # | Ce qu'on a dû faire | Pourquoi (manque Track) |
|---|---|---|
| R1 | Créer 6 WP parents `role:workpackage` + **29 sous-items WPx.y** via CLI | pas de hiérarchie WP exploitable nativement par le reporting |
| R2 | Créer les sous-items **dans le workspace de leur parent** (sinon refus) | `track item reparent` échoue cross-workspace : `cannot reparent across workspaces` (invariant containment 0.19.2, `workspace` immuable) |
| R3 | Maintenir une **projection externe `item→WP/sous-item`** (`wp6-item-subitem-map.json`) pour les 111 items hérités | impossible de reparenter physiquement les items existants (R2) |
| R4 | Écrire une **projection 4 échelles** (`wp6-projection.py` + `api/src/services/track/wp-projection.ts`) | pas de `report --since/--until/--scale` ; impossible de borner une période passée × une échelle |
| R5 | Bâtir un **kanban UI 4 échelles** (En cours/Semaine/Mois/Global × statut × swimlanes WP, sous-items repliables) | pas de rendu kanban/échelles natif Track |
| R6 | Implémenter les **axes de focus** (focus:30 / 1104 / 33 / 5000+) comme tags de projection + rollups par axe | pas de tag/rollup natif par axe de couverture |
| R7 | Reconstruire un **retro 4 semaines** fait/à-faire depuis les timestamps d'events | pas de rapport temporel borné natif |
| R8 | Appliquer la règle d'honnêteté **`AWAITED done` non signé → `needs_review`** dans la projection | pas de séparation native realization vs signoff dans les vues client |

Artefacts radar correspondants (candidats à remonter en primitives Track) :
`docs/spec/decision-tracking-structure-v1.md` (§8 taxonomie WPx.y figée), `docs/spec/reports/wp6-{focus-rollup,retro-hebdo,item-subitem-map,rollup}.*`, `api/src/services/track/wp-projection.ts`, `ui/src/lib/components/kanban/KanbanView.svelte`.

---

## 2. Demande A — Reporting multi-échelle/temporel + kanban natifs

- **`track report --since <iso> --until <iso> --scale now|week|month|project`** : bornage période (y compris **passée**) × échelle, rollup %·WP et %·sous-item calculé par Track (jamais à la main).
- **Échelles canoniques** : `now` (WIP), `week`, `month`, `project` (tout, incl. done/dropped — **le passé reste à sa place**).
- **Rendu kanban natif** (export JSON + HTML) : 4 échelles en niveaux primaires × statut × swimlanes WP/sous-items. C'est exactement ce qu'on a dû faire côté radar (R4/R5) ; ça devrait être une sortie Track consommable par n'importe quelle UI.
- **Projection lecture stable** + **queue d'intentions d'écriture** (UI→writer autorisé) pour que la source de vérité reste Track.

## 3. Demande B — Décomposition WP stable dans le temps

- **Contrat d'immuabilité** : un code WP (et ses sous-items `WPx.y`) est **stable** ; on ajoute/ferme/déplace des items dessous, jamais on ne renomme/recycle un code sans décision tracée. Track devrait **garantir et vérifier** cette stabilité (refus ou warning sur renommage d'un code WP référencé).
- **Mode d'AUDIT** : `track audit` qui détecte les dérives — items orphelins (sans WP), workspaces incohérents, doublons, items multi-homés, sous-items vides, codes WP divergents — et **chiffre** la dette de structure.
- **Mode de RESTRUCTURATION traçable** : proposer + appliquer une re-cartographie item→WP de façon append-only, **sans casser l'historique** (les done restent done à leur place), avec un diff revu avant écriture.

## 4. Demande C — Lever l'invariant reparent cross-workspace

L'invariant `parent.workspace === item.workspace` + `workspace` immuable a **bloqué** l'adoption des 111 items hérités sous la nouvelle structure (R2/R3). Demande : un **event natif** `item reassign-workspace` (ou un **parentage logique** indépendant du workspace) pour reparenter les items existants **sans hand-edit** et sans projection externe. À défaut, documenter le pattern « projection » comme 1ʳᵉ classe.

## 5. Demande D — Délégation d'un WP à un agent dédié (modèle sentropic)

- **Owner/RACI par WP** : assigner un WP (et ses sous-items) à un agent/instance dédié, déclaratif dans Track.
- **Protocole d'avancement agent→Track** : un agent délégué pousse son réalisation/signoff via **h2a → `track ingest`** (canal signé, idempotent, writer autorisé) — comme l'orchestration multi-agents de sentropic. On a déjà un stub côté radar (`wp6-remote-h2a-plan.md` + `wp6-remote-agent-stub.mjs`) ; ça gagnerait à être une primitive Track.

---

## 6. Bénéfice

Ces évolutions transforment Track de « log d'items » en **outil de pilotage portefeuille** : %·WP par échelle et par période, structure stable présentable client, audit/restructuration sans perte d'historique, et délégation native des WP à des agents. Ça supprime les ~8 contournements radar listés en §1.
