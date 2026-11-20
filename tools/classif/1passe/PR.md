Le rapprochement perdait les citations dont les sauts de ligne étaient aplatis. Le validateur effaçait aussi les votes ambigus. Le module partagé normalise les citations, vérifie l’étape, le numéro et la page, puis conserve les affectations univoques. Les collisions sont signalées. L’ambiguïté devient un attribut. Les états techniques restent distincts des classes P/S/N.

Les sorties sauvegardées ont été recalculées. Seuls les appels document interrompus ont été repris. D3 reste arrêté. Aucune fusion.

| Mesure globale | Avant | Après correction et reprise |
|---|---:|---:|
| Votes artificiellement Non classé | 1 173 | 0 |
| Paires valides | 59/676 | 229/676 |
| Accords de code / support | 8,28 % | 29,59 % |
| Désaccords D3 | 620 | 476 |

Après : accord de classe 92,58 %, kappa 0,770636 sur les 229 paires valides. L’ancien calcul incluait les états techniques : accord 90,98 %, kappa 0,613265. Ces dénominateurs diffèrent. Les tableaux comparables figurent dans [CORRECTION.md](https://github.com/rhanka/radar-immobilier/blob/feat/classif-1passe-bc/tools/classif/1passe/CORRECTION.md).

Seize reprises : onze en mise au point et cinq en aveugle. Seize JSON valides. Concurrence 10. Quota Codex 43 → 45 %. Les 97 fichiers D3 sont conservés. Onze réponses D3 restent réutilisables avec le même prompt. Il reste 465 arbitrages potentiels : 249 en mise au point et 216 en aveugle. Estimation : 465 premiers appels, jusqu’à 505 avec le budget de reprises restant. Aucun lancé.

Module partagé : `tools/classif/1passe/matching.mjs`.
SHA-256 : `af9a52f19d96bfe577a2c6c7a01b75e79dda5e88c86f5d5736acc2249059c648`.

Validation : 12 tests unitaires réussis. Syntaxe de tous les modules vérifiée. Adaptateurs recall, recall1099 et csets vérifiés sans ouvrir leurs scellés. Commandes exactes dans le rapport. Le recalcul de leurs métriques appartient à ces lanes. La référence C reste en attente de la décision d’i-cond.

Les détails de mise au point restent dans le dossier privé `reference/`. Les détails aveugles restent scellés. Aucun `.env` lu. Aucun nouvel appel hors des reprises autorisées.
