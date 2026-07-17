# Analyse vivier B × critères de Steve — 2026-07-17

Synthèse de l'analyse des signaux du vivier B (zonage ∩ résidentiel) contre la vision de
Steve, pour identifier **les manques de données et le bruit** — pas pour scorer/classer.
Analyse produite par **Sonnet 5**, double-relue en adversaire par **codex gpt-5.6-sol xhigh**.

## Artefacts

- `analyse_steve_sonnet5.json` — sortie brute de l'analyse (Sonnet 5), schéma imposé.
- `revue_adverse_sol56.md` — revue adverse (codex 5.6-sol) : verdict par constat + reversement geo/immo.
- `prompt_analyse.md` — la consigne exacte donnée à Sonnet 5.
- `corpus_contexte.md` — chiffres de contexte + description du corpus (3 strates).

## ⚠️ Limites de rigueur — À LIRE AVANT DE CITER TOUT CHIFFRE

La revue adverse a établi que **les chiffres précis de l'analyse ne sont pas fiables**, pour
des raisons de **construction du corpus** (côté conducteur immo, pas côté modèle) :

1. **Dénominateur faux.** Le corpus dit « 881 signaux » mais ne contient que **836 `id`
   distincts** : la strate 2 est entièrement incluse dans la strate 1, et 16/120 de la strate 3
   aussi → 45 doublons inter-strates. Tout ratio « sur 881 » est erroné.
2. **Champ `intensite` absent des strates 2 et 3.** Leurs 149 lignes ont été comptées « nulles »
   à tort. Le vrai taux `intensite` est 123/**732** (strate 1 seule), pas 123/881.
3. **Filtre résidentiel du corpus → faux angle mort CPTAQ.** La strate 1 a été filtrée sur le
   résidentiel ; le CPTAQ (agricole) est donc exclu **par construction**. L'analyse conclut
   « CPTAQ = 0, angle mort » — c'est un **artefact**, la vraie base a **48 `category=cptaq`**.
4. **Buckets « bruit / à retenir » lexicaux, pas terrain.** Le tri du gisement (dérogations
   mineures) repose sur des mots-clés ; il compte des faux positifs (une dérogation d'enseigne
   classée « à retenir »). Le « verdict gisement en 3 blocs » n'est **pas** une partition mesurée.
5. Écarts ponctuels : ventilation des dates (96,6 % pas 99,8 %), P2 (22,2 % pas 23,8 %),
   un `id`-preuve tronqué dans le texte.

## Ce qui SURVIT (direction, pas chiffres) — vérifié indépendamment sur PG

- **`nb_unites_max` manquant alors que le nombre de logements est dans le texte** — réel
  (ex. `event-contrecoeur-piia-2026-008-lot-6546172` : « 28 logements », champ null ;
  `event-lassomption-ppcmoi-15-2026` : « 6 logements », champ null).
- **Les `DesignationEvent` quasi jamais classés** — vérifié sur PG : **3914/3927 sans
  `category` (99,7 %)**, contre 51,7 % côté `Signal`.
- **Aucune liaison structurée entre étapes d'un même dossier** (pas de `dossier_ref`/
  `reglement_number` structuré) — le « caché derrière un numéro » de Steve.
- **Le vivier a besoin de la donnée géo** (zone, diff, effet densifiant).

## Reversement geo/immo (post-décision de frontière du 2026-07-17)

L'analyse a tourné **avant** la décision de frontière geo/immo ; elle étiquetait tout en
« graphify 3.4 ». Reversement corrigé (validé par la revue adverse) :

| Élément | Attribution |
|---|---|
| Backfill `nb_unites_max` | extraction/émission → **geo** ; écriture au graphe → **immo** |
| `reglement_number` / `dossier_ref` | **partagé** — geo extrait la référence, immo résout l'identité dossier |
| Classer les événements | geo = taxonomie **source neutre** ; immo = qualification **produit Steve** |
| Dédup event/signal | **partagé** (dépend d'une clé stable versionnée côté geo) |
| Retour PV source (stubs PIIA) | **geo** (acquisition) |

## 3 trous du contrat servi (à combler avant de figer `qc-zoning-events`)

1. **Périmètre source fermé** (décision principal) : geo détecte AUSSI le **CPTAQ** et le
   **YouTube** (transcription via graphify), pas seulement avis-publics + PV. immo garde le
   filtrage de pertinence Steve.
2. **Identité + révision** : `reglement_number` ne suffit pas comme clé. Chaque événement servi
   doit porter `event_id` canonique + `version`/`supersedes` + `state` (active|corrected|
   retracted) — pour que l'écrivain unique (immo, projecteur destructif par ville) ingère les
   updates de façon idempotente.
3. **Taxonomie à deux niveaux** : geo émet la taxonomie **source neutre** uniquement ; immo
   **dérive** la qualification Steve. Provenance de champ sur `nb_unites_max`, refs dossier,
   diff densité. Si l'un empiète sur l'autre, le transfert est fictif.

## Méthode

- Modèle analyse : **Sonnet 5** (raisonnement sur corpus ~113k tokens).
- Revue adverse : **codex gpt-5.6-sol xhigh**, read-only (a recompté sur le corpus ; les
  chiffres full-base marqués « non-vérifiable-depuis-le-corpus » ont été vérifiés séparément
  sur PG par le conducteur).
- Arbitrage : conducteur immo (Opus).
