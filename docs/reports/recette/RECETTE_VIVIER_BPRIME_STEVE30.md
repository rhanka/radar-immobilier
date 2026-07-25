# Recette de réception — Vivier B′ × éval Steve (30 villes)

**Statut** : **CIBLE — QA prod requise ville par ville.** Cette table est l'**attendu de
réception** de la sélection B′, PAS une validation acquise. Elle ne peut PAS être déclarée
« verte » hors-ligne : la validation finale se fait **ville par ville en QA prod** sur les
données réelles servies par l'endpoint.

**Prouvable HORS-LIGNE aujourd'hui** (nœuds de graphe réels committés) :
- **Sutton** (10/10) — la seule ligne ≥6/10 **entièrement** prouvable offline (✓2, refonte via
  périmètre permissif, sans gate). Preuve exécutable : `api/src/services/graph/bprime-recette.test.ts`.
- **Coaticook** — **✓1 prouvé** offline (1 nœud réel) ; le **✓2** du contrat (2ᵉ nœud en prod)
  reste un **gap QA prod**.

**Tout le reste = gap QA prod** (aucun nœud committé), déclaré explicitement et EXCLU des
assertions vertes : voir `BPRIME_RECETTE_OFFLINE_GAPS` (partition exhaustive des 30 lignes,
testée). **Anti-invention** : aucune donnée de ville n'est fabriquée pour « verdir » la table.

**Cibles ✗0 NON atteignables côté immo — EN ATTENTE d'un marquage sémantique geo** :
- **Rosemère** (✗0) : le vrai PV 801-71 est un *« Règlement de concordance … relatif au pôle
  régional »* — **sans** marqueur franc-commercial ni « pôle **commercial** régional ». Le filtre
  déterministe le classe honnêtement `indéterminé`. On **REFUSE de fabriquer** un marqueur pour
  forcer ✗0 ; l'exclusion relève d'un **marquage sémantique geo** (pôle régional/commercial) à venir.
- **Saint-Charles-Borromée** (✗0) : le pattern « zone résidentielle → commerciale » est prouvé
  exclu au niveau lexical (`b-prime.test.ts`), mais **aucun texte de PV réel** de la ville n'est
  committé et la distinction directionnelle fine relève du **marquage sémantique geo** → **EN ATTENTE geo**.

**Principe** : ce qu'on a conçu doit être vérifié comme atteint — mais la vérification est une
**QA prod par ville**, pas une déclaration offline. La colonne **B′ (cible)** est l'attendu, pas un acquis.

## Table de recette (A / B actuel / B′ cible)

| # | Ville | Note Steve | A | B (actuel) | B′ (cible) | Cause de l'écart B (prouvée) | Ce que B′ change |
|---|---|---|---|---|---|---|---|
| 1 | Saint-Stanislas-de-Kostka | 10 | ✓1 | ✗0 | ✓2 | refonte 451-2025 = avis_motion (précoce ✓) ; exclue car résidentiel=indéterminé | R2 repêche la refonte |
| 2 | Sutton | 10 | ✓1 | ✗0 | ✓2 | refonte 358 = projet_reglement (précoce ✓) ; double verrou : résidentiel=indéterminé + dérive d'étape → consultation | R2 + R1 |
| 3 | Saint-Raphaël | 10 | ✓1 | ✗0 | ✓2 | refonte 2026-244 = projet_reglement (précoce ✓) ; exclue car résidentiel=indéterminé | R2 repêche la refonte |
| 4 | Saint-Raymond | 9 | ✓1 | ✓4 | ✓4 | — (HC-13/14/15 rés=oui, projet) | rien |
| 5 | Saint-Boniface | 8 | ✓1 | ✓1 | ✓1 | — (zone 317 rés=oui, projet) | rien |
| 6 | Coaticook | 8 | ✓1 | ✓2 | ✓2 | — (PPCMOI RD-104, 12 log.) | rien |
| 7 | Saint-Mathieu-de-Beloeil | 7 | ✓1 | ✓2 | ✓2 | — (avis motion, logement abordable) | rien |
| 8 | Saint-Amable | 7 | ✓1 | ✓3 | ✓3 | — (712-46/47, avis motion) | rien |
| 9 | Mont-Saint-Hilaire | 0 et 7 | ✓1 | ✓2 | ✓2 | — (S2 habitation dans B ; S1 « sur mesure » 0/10 hors B, correct) | rien |
| 10 | Saint-Gilbert | 6 | ✓1 | ✓1 | ✓2 | U-161 rés=oui ; 2ᵉ signal avis motion perdu par dérive d'étape | R1 récupère le 2ᵉ |
| 11 | Neuville | 4 | ✓1 | ✗0 | ✗0 | CPTAQ rés=non (agricole) ; zone Pa-4 indét | rien (souhaité <6) |
| 12 | Saint-Côme-Linière | 3 | ✓1 | ✓1 | ✓1 | dev. résidentiel, avis motion, rés=oui | rien — limite : 3/10 = « ville propriétaire », hors signal |
| 13 | Rosemère | 2 | ✓1 | ✓1 | ✗0 | dans B via « densification commerciale » lu comme résidentiel | R3+R4 le sortent |
| 14 | Petite-Rivière-St-François | 2 | ✓1 | ✓3 | ✓3 | densification U-24 multilog. 10 unités — signal intrinsèquement excellent | rien — assumé : 2/10 = propriétaire (firme immo), axe S17 hors signal |
| 15 | Stratford | 0 | ✓1 | ✗0 | ✗0 | RU-13 indét | rien (souhaité) |
| 16 | Mont-Tremblant | non pertinent | ✓2 | ✓3 | ✓3 | 2 PIIA bien exclus ; « espaces naturels » rés=oui + vrai signal rue Léonard (post-éval) | cas limite documenté |
| 17 | Saint-Frédéric | non rés. | ✓2 | ✓1 | ✓2 | I-93/A-16 bien exclus ; reste densif. zone Rf51 | R1 ajoute l'event |
| 18 | Saint-Charles-Borromée | non pertinent | ✓1 | ✓1 | ✗0 | dans B via « densification commerciale » = le faux positif exact que Steve dénonce | R3 le sort |
| 19 | Sainte-Cécile-de-Milton | pas d'opp. | ✓1 | ✓1 | ✓2 | 4-logements lot 6367606, projet | R1 ajoute l'event |
| 20 | Cowansville | promoteur | ✓1 | ✓2 | ✓2 | Rc-23 26 log. ; note basse = propriétaire | rien (axe propriétaire manquant) |
| 21 | Champlain | assouplissement | ✓1 | ✓2 | ✓2 | Belvédère 64 terrains ; éolien bien exclu | rien |
| 22 | Sainte-Catherine | bug « indispo » | ✓1 | ✗0 | ✗0 | 16 signaux ; seul qualifié = adoption ; reste indét | rien |
| 23 | Hemmingford (×3 slugs) | bug | 0/0/1 | 0/0/1 | 0/0/1 | slug ambigu, 3 doublons DB | — à assainir |
| 24 | Plaisance | bug | ✓1 | ✓3 | ✓3 | 43-Rid bi/multifamiliale, projet | rien |
| 25 | Notre-Dame-de-Lourdes (×2 slugs) | bug | 0/1 | 2/1 | 2/2 | slug ambigu (Joliette vs L'Érable) ; U-41 multifam. | R1 (lérable) |
| 26 | Chelsea | bug | ✓1 | ✓2 | ✓2 | RES-CV-13/15 densif., projet | rien |
| 27 | Alma | bug | ✓1 | ✓2 | ✓2 | Beauvoir multifam. ; Cc11 bien exclus | rien |
| 28 | Preissac | bug | ✓1 | ✗0 | ✗0 | rezonage église indét ; dérog. riveraine exclue | rien |
| 29 | Rimouski | bug | ✓1 | ✓2 | ✓1 | SPAR 328 log. + « pôle commercial régional » | R4 retire le « pôle » ; SPAR reste |
| 30 | La Sarre | bug | ✓1 | ✓1 | ✓1 | CV-2 16 log., projet | rien |

## Règle de recette (assertions de réception — CIBLES, validées en QA prod)

> Ces assertions sont l'**attendu de réception**. Sauf mention « prouvé offline », chacune est une
> **CIBLE à valider en QA prod ville par ville** ; elle n'est PAS acquise hors-ligne.

1. **Toutes les villes notées ≥6/10 doivent être présentes dans B′** — en particulier les **3× 10/10
   refontes** (Saint-Stanislas-de-Kostka, Sutton, Saint-Raphaël). **Prouvé offline : Sutton (✓2)**
   uniquement ; Saint-Stanislas, Saint-Raphaël et les autres ≥6/10 = **gap QA prod** (aucun nœud committé).
2. **Faux positifs à exclure** : **Rosemère (2/10)** et **Saint-Charles-Borromée**. **Cible ✗0 NON
   atteignable côté immo hors-ligne** : sur le PV réel, aucun marqueur franc-commercial → le filtre
   déterministe classe honnêtement `indéterminé`. **On ne fabrique PAS** l'exclusion ; elle est **EN
   ATTENTE d'un marquage sémantique geo** (pôle régional/commercial). Le pattern lexical
   « résidentiel→commercial » est néanmoins prouvé exclu en unitaire (`b-prime.test.ts`).
3. **Exceptions assumées, documentées** (restent dans B′ car la note basse tient au PROPRIÉTAIRE,
   axe S17/PII hors signal, pas au signal) : **Saint-Côme-Linière 3/10**, **Petite-Rivière-St-François 2/10**.
4. **Synthèse cible** : parmi les villes notées ≥6/10, **B = 7/10 → B′ = 10/10** — **cible**, mesurée
   en QA prod (offline, seule Sutton est prouvée).
5. Les comptes par ville de la colonne **B′ (cible)** sont l'attendu de réception (ex. Saint-Stanislas ✓2,
   Rimouski ✓1 après retrait du « pôle », Saint-Gilbert ✓2 via R1, etc.) — **à valider en QA prod**.
6. **Partition exhaustive** : chacune des **30 lignes** a soit une **source réelle committée**
   (Sutton ✓2, Coaticook ✓1), soit un **gap QA prod explicite** — testé
   (`bprime-recette.test.ts`, `BPRIME_STEVE30_CONTRACT_CITIES` × `BPRIME_RECETTE_OFFLINE_GAPS`).

## Règles B′ (rappel — R1–R4)

- **R1** — l'étape annotée fait autorité avant l'inférence texte (corrige la « dérive d'étape » qui
  fait perdre des signaux à Sutton, Saint-Gilbert, Sainte-Cécile, Saint-Frédéric…).
- **R2** — une **refonte complète** (rezonage/refonte) est **qualifiée** pour B′ (repêchée), pas
  éjectée sous prétexte de `résidentiel=indéterminé`. Un rezonage n'est pas filtré comme
  non-résidentiel par défaut. « Refonte détectée » = **rang, jamais porte** (cf. SPEC_EVOL_FILTRAGE_VIVIER_v2).
- **R3** — la densification **commerciale/industrielle** franche est exclue **SI et seulement si**
  aucune **preuve résidentielle FORTE** (logements/habitation/usage mixte/conversion « de commercial à
  résidentiel ») n'est présente — la preuve forte l'emporte (source unique partagée `classifyBPrime` ↔
  `vivier-v2`). Exclut lexicalement « usages commerciaux » (Lavaltrie C-8) et « densification
  commerciale » nue ; **conserve** « commercial→résidentiel, 12 logements ». Pour **Rosemère /
  Saint-Charles-Borromée**, le PV réel ne porte pas ce marqueur franc → ✗0 **EN ATTENTE geo** (cf. §2).
- **R4** — le **pôle commercial régional** est exclu par raison nommée (retire le « pôle » de Rimouski,
  garde SPAR).
