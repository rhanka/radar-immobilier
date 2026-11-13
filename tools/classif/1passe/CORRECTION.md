# Correction du rapprochement et du validateur

D3 reste arrêté. Aucun appel Argon lancé. Aucune fusion. Aucun `.env` lu.

Le calcul porte sur les 676 actes B. Il ne crée pas une référence C finalisée.

| Moitié / état | Non classé, votes | Paires valides | Accord de classe sur paires valides | Kappa | Accords de code / support | Désaccords D3 |
|---|---:|---:|---:|---:|---:|---:|
| tuning / avant, métrique comparable | 654 | 32/372 | 100.00 % | non défini | 8.60 % | 340 |
| tuning / correction seule | 0 | 99/372 | 90.91 % | 0.755957 | 23.12 % | 286 |
| tuning / après reprise | 0 | 127/372 | 91.34 % | 0.744933 | 30.11 % | 260 |

Ancien calcul tuning, incluant les doubles Non classé : accord 93.01 %, kappa 0.674036.

| Moitié / état | Non classé, votes | Paires valides | Accord de classe sur paires valides | Kappa | Accords de code / support | Désaccords D3 |
|---|---:|---:|---:|---:|---:|---:|
| blind / avant, métrique comparable | 519 | 27/304 | 100.00 % | 1.000000 | 7.89 % | 280 |
| blind / correction seule | 0 | 81/304 | 92.59 % | 0.776860 | 22.04 % | 237 |
| blind / après reprise | 0 | 102/304 | 94.12 % | 0.806084 | 28.95 % | 216 |

Ancien calcul blind, incluant les doubles Non classé : accord 88.49 %, kappa 0.550372.

Le changement de dénominateur interdit de comparer directement les anciens kappas aux nouveaux. Les lignes comparables excluent les votes invalides ou absents. Les désaccords D3 portent sur les codes. L’accord et le kappa portent sur P/S/N.

Total avant : 1173 votes Non classé ; accord ancien 90.98 %, kappa ancien 0.613265, 620 désaccords. Total après : zéro classe technique ; 229/676 paires valides, accord 92.58 %, kappa 0.770636, 476 désaccords.

Zéro Non classé ne signifie pas zéro cas à traiter. Les statuts techniques restent séparés. Un code connu est conservé même si sa preuve est invalide.

| Moitié | Valide | Invalide | Absent | Interrompu | Erreur | Collision | Ambiguïté, attribut |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| tuning | 311 | 5 | 286 | 0 | 0 | 142 | 88 |
| blind | 270 | 15 | 205 | 0 | 0 | 118 | 74 |

## Reprises

Seize appels document. Onze en mise au point : six Astra et cinq Opus. Cinq en aveugle : deux Astra et trois Opus. Seize réponses JSON valides. Concurrence totale : 10. Quota Codex : 43 % au départ, 45 % à la fin, maximum 45 %. Arrêt fixé à 90 %.

- astra-medium : bolton-est-2026-01-12
- astra-medium : beaupre-2026-03-02
- astra-medium : blue-sea-2026-02-03
- astra-medium : bedford--brome-missisquoi-2026-06-02
- astra-medium : beloeil-2026-03-23
- astra-medium : boisbriand-2026-05-05
- opus-5.5-medium : bolton-est-2026-01-12
- opus-5.5-medium : bedford--brome-missisquoi-2026-06-02
- opus-5.5-medium : brossard-2026-04-28
- opus-5.5-medium : beloeil-2026-03-23
- opus-5.5-medium : boisbriand-2026-05-05

## D3 restant

476 désaccords de code ou techniques après rapprochement. 465 demandent encore un arbitrage : 249 en mise au point et 216 en aveugle. 11 arbitrages sauvegardés restent réutilisables : même prompt et preuve valide. Les autres résultats D3 sont conservés, sans transfert à un prompt modifié.

97 fichiers D3 existants sont présents, dont 32 réponses finales. Ils n’ont pas été réécrits par le recalcul.

Estimation Argon high : 465 premiers appels. Maximum 505 avec le budget de reprises restant (40). Les 33 départs historiques restent comptés. i-cond décide de la suite. Aucun départ D3 dans cette correction.

Liste détaillée mise au point : /home/antoinefa/.local/share/radar-classif/1passe-bc/reference/tuning-d3-remaining.json et TUNING-D3-REMAINING.md dans le même dossier. Liste aveugle scellée : /home/antoinefa/.local/share/radar-classif/1passe-bc/reference/blind-d3-remaining.sealed.

## Module partagé

Module : tools/classif/1passe/matching.mjs. SHA-256 : af9a52f19d96bfe577a2c6c7a01b75e79dda5e88c86f5d5736acc2249059c648.

NFD, accents, casse et séparateurs normalisés. Recouvrement contigu de 30 caractères au minimum. Étape et numéro compatibles. Page physique à ±1. Une page est dérivée de la citation si son ancrage est unique. Le folio déclaré reste conservé. Seules les arêtes présentes dans toutes les affectations maximales sont retenues. Les collisions restent explicites.

## Recalcul des lanes de rappel

Commandes depuis ce worktree. Elles ne lancent aucun modèle. Les scores lisent les sorties sauvegardées. Le module et la contrainte globale d’unicité sont injectés en mémoire. Les sources des lanes restent inchangées. Les métriques produites restent dans chaque lane. Les anciens rapports de rappel doivent être remplacés après ce recalcul.

```sh
rtk make -f tools/classif/1passe/ops.mk shared-recalc LANE=recall ENV=test-classif-recall
rtk make -f tools/classif/1passe/ops.mk shared-recalc LANE=recall1099 ENV=test-classif-recall1099
rtk make -f tools/classif/1passe/ops.mk shared-recalc LANE=csets HALF=tuning ENV=test-classif-csets
rtk make -f tools/classif/1passe/ops.mk shared-recalc LANE=csets HALF=blind ENV=test-classif-csets
```

Les deux premières commandes traitent les deux moitiés. Pour csets aveugle, le dépositaire doit injecter son rôle test-executor et sa clé existante dans le processus. Aucun fichier de configuration d’environnement ne doit être chargé. Csets conserve son protocole PV documentaire ; le module partagé remplace le rapprochement de ses signaux.

Les trois adaptateurs ont été vérifiés en lecture seule. Leur recalcul effectif appartient aux lanes. Aucun scellé de ces lanes n’a été ouvert ici.
