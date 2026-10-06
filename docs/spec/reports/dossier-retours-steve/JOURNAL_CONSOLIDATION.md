# Journal de consolidation du dossier « retours de Steve » : convergence entre les deux auteurs

- **Objet** : historique de rédaction du dossier de décision [DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md](DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md), consolidé le 2026-10-03 à partir de deux dossiers rédigés indépendamment (auteur A et auteur B).
- **Statut** : journal versionné avec le dossier (sorti du rapport le 2026-10-05, ancienne annexe A, contenu inchangé). Il n'a aucun effet sur les décisions ; les points laissés à la décision (A.4) sont repris et mis à jour au §10.4 du dossier.
- **Renvois** : les numéros de section cités ci-dessous (§5.3, §6.6, etc.) suivent la numérotation du 2026-10-03 ; la correspondance avec la numérotation actuelle est en annexe I.6 du dossier.

Légende : **=** convergence · **≈** convergence de fond, forme différente · **≠** divergence. Colonne « Arbitrage » : la source qui tranche, ou le décideur (Farid ou Fabien) si les sources ne suffisent pas.

## A.1 Chiffres

| Point | Auteur A | Auteur B | État | Arbitrage et preuve |
|---|---|---|---|---|
| Volumétrie (124 / 121 / 77 / 26 / 28) | identique | identique | = | Recompté sur `workbook-full.json` |
| Classement × passe (34/15/24 …) | identique | identique | = | Recompté sur `triage-rows.json` |
| Sens (55/38/14/10/7) | par passe | × classement | ≈ | Les deux tableaux sont repris (§5.3) |
| Codes employés 24/28 | = | = | = | Feuille Synthèse et Triage |
| Verdicts d'exclusion (102 …) | = | = | = | Feuille Écartés |
| Périmètre des constats | 67 V1, 5 Info, 4 « V2 — pour mémoire », 1 V2 | 67 / 5 / 5 V2 | ≈ | Auteur A plus fin, recompté colonne B |
| Valeurs mémorisées de la Synthèse | 45 formules avec valeurs | « formules sans valeur en cache » | ≠ | **Auteur A** : 45 formules sur 45 portent une valeur (`workbook-full.json`, ex. B4 = 40) |
| Qualité du filtrage | 5 comptes = 123 | 88/25/8/3 normalisé contre 88/25/7/3 | ≈ | Synthèse : 88/25/7/3/0 ; l'écart d'une ligne tient au regroupement de B |
| Identifiants candidats | colonne L : 121/124, 148 distincts, 27 multiples | 121/124, 33 multiples, 172 mentions, 227 distincts sur 3 feuilles | ≈ | Recompte : colonne L 121/148/27 ; toutes colonnes 121/150/30 ; 3 feuilles 227–237 selon la règle. Publier par le rapport d'import, avec la règle |
| Reconstitution 22/12/15/24 | « l'écart 34−22 n'établit pas quels enregistrements changent » | correspondance exacte | ≈ | **Effectifs vérifiés** (Pertinent ∧ Assouplissement = 22 en passe 1, etc.) ; règle de passage non énoncée par Steve → D8 |
| Jeu de référence 676 | 674/47 committé (`dd0561f6`) ; 676/43 copie locale par sha256 | 676 « introuvable sur les branches distantes » | ≈ | Les deux exacts ; la 676 doit être committée et gelée |
| Contrôles HTML bruts | 132 `<button>` / 37 fichiers | 125 / 35 | ≈ | 132/37 reproduit sur tous les `.svelte` hors tests ; 125/35 exclut stubs et harnais |
| Cellule la plus longue | 17 114 caractères vs corps de note 10 000 | — | = | `NOTE_BODY_MAX = 10_000` (`prospect-marks.ts:91`), cellule Constats E57 |

## A.2 Constats

| Point | Auteur A | Auteur B | État | Arbitrage et preuve |
|---|---|---|---|---|
| Défaut UUID de l'ancre signal | oui | oui | = | `prospect-marks.ts:107` `signal_id: z.string().uuid()` |
| Défaut auteur `authorId` / `sub` | — | oui | + | **Confirmé** : `SignalAnnotations.svelte:30` retombe sur `$authStore.user.sub` ; aucun panneau ne passe `currentUserId` ; l'API résout `session.sub` → `account_users.id` |
| Stabilité des ids du graphe | non mesurée | non garantie, nœuds orphelins supprimés | ≈ | **Auteur B** : suppression des orphelins dans `graph-store.ts` |
| Table `signals` | UUID volatil | aucune insertion sur `main` | ≈ | Seule insertion : test d'intégration |
| `packages/focus` sentropic | lu en local (HEAD `97fe9f53`) | supprimé de `main` | ≠ | **Auteur B** : `6ca53d11a chore: delete packages/focus (focus is owned by h2a)` |
| Suppression `comments` 0.2.0 | physique | physique, écart avec O1 | = | `store.ts:47-48` |
| Routeur Hono `contextType` fermé | — | oui | + | `hono.ts:17` `z.enum([...])` |
| Sélecteur A/B retiré | oui | oui (`f2c20573`) | = | `f2c20573` 2026-08-22 |
| « Décision owner #787 de ne pas réintroduire de choix de viviers » | — | décision du 2026-10-01 | ≠ | **Nuancé** : phrase de l'item 4 du comportement attendu (grammaire d'URL), règles validées le 1er octobre ; absente de la liste « Décisions du propriétaire » |
| Période datée par le document | écart relatif / personnalisé à réconcilier | #793 fusionnée le 2026-10-02 | ≈ | `27891b10` = merge de #793 |
| DS : 39/69 ; collab 0/3 ; carte MapLibre locale ; moteur désactivé | = | = | = | `code-audit.mjs`, `geo-engine-flag.ts` |

## A.3 Options, recommandations et décisions

| Sujet | Auteur A | Auteur B | État | Consolidation |
|---|---|---|---|---|
| Stockage | D1b sources + assertions + ancres | D1(b) + couches | = | D1 (b) ; D2 : couches devenues l'option b, recommandé désormais (a) modèle minimal (§6.3) |
| Correctif ancre | branche `entity` + `target_ref` | colonne texte `signal_node_id` + B0 | ≈ | D3 : clé texte namespacée sans FK, B0 immédiat |
| Conformité sentropic | D2b sous-contrats + mutation Radar | D3(a) adaptateur PG à tombstone hôte | ≠ | **Tranché vers A** par COLLAB §2 (« le paquet porte l'intégrité », tombstone hôte = piège) ; demande de tombstone à sentropic (B) conservée — D4 |
| Auteur Steve | pas d'identité forgée, auteur = écrivain réel | `ext:chaperon:steve` auteur du fil | ≠ | **Synthèse** : auteur documentaire externe + importateur tracé, sans droit de mutation — D5 |
| Visibilité / données personnelles | risque C-79 | D5(c) caviardage | ≈ | D6 (c) |
| Définition de C | D3b confirmés + à instruire | K1–K8 + asymétrie | ≈ | D7 : K1–K9 + trois états |
| Cas contradictoires | D3-cas | §9, §10 | = | D8 |
| Double annotation | 3 niveaux (source, référence, calcul) | `label_set` (radar B′ / Steve / prédiction) | ≈ | §6.6 ; sens laissé à Fabien (Farid consulté) — D9 |
| Jeu de référence | D4b double jeu de référence, corpus indépendant | D9 jeu de référence C, 51 / 52 villes | ≈ | D10 : les deux mécanismes cumulés |
| Benchmark | colonnes séparées | volet séparé, contrat v10 sous décision | = | D11 |
| A/B/C | D5b sélecteur + comparatif, B défaut | V2 shadow puis remplacement | ≠ | **Farid** — D12 ; recommandation consolidée : shadow + comparatif UAT |
| Seuil de bascule | non chiffré | exemple proposé | ≈ | **Farid** — D13 |
| UI première livraison | D6a panneaux + badges carte | U1 panneau + rail ; carte après migration | ≠ (partiel) | D14 (a) : pastilles carte après migration de `GeoCityMapBase` (2 761 lignes locales) ; (b) reste une option |
| Séquencement | L4 en parallèle de L3 | D11 (a) | = | D15 |
| Retour à Steve | — | D12 | + | D16 |

## A.4 Points laissés à la décision (Farid ou Fabien)

1. **D9** (Fabien, Farid consulté) : sens exact de « double annotation ».
2. **D12** (Farid, Steve, Mathieu et Fabien consultés) : C en shadow avec comparaison UAT, ou sélecteur A/B/C visible.
3. **D13** (Farid, Steve, Mathieu et Fabien consultés) : seuil chiffré de bascule.
4. **D4, réserve** (Fabien) : statut du dossier COLLAB hors `main` ; s'il n'est plus valable, l'adaptateur à tombstone hôte redevient une option.
5. **D8** (Farid) : cas métier contradictoires, à faire trancher avec Steve.
