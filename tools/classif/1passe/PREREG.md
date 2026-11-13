# Pré-enregistrement B+C — étape 0 du 13 novembre 2026

Conduite : i-cond. État : préparation, aucun appel de modèle autorisé ici.
Ce texte et les manifestes doivent être committés avant tout appel futur.
Les recommandations D4 et D5 restent soumises à l’owner.

## Population et compte exact

La source est `origin/main`, au SHA inscrit dans `split.json`.
L’oracle contient **676 actes présents et distincts**, sur 93 des 100 documents.
Les **43 cas non résolus sont séparés**, sans identifiant commun avec ces actes.
Ce ne sont pas 676 actes dont 43 à retrancher. Le support B reste 676.
Les 100 documents du manifeste v101b incluent certains ordres du jour.

Le chiffre 672 se retrouve dans les compteurs historiques : 641 unanimes + 31 arbitrés.
Il ne décrit pas le tableau corrigé. Celui-ci contient 636 unanimes, 31 arbitrés,
7 fusions souples et 2 ajouts #725, soit 676. Le correctif passe de 674 à 676.
Il retire aussi quatre représentations des 47 cas non résolus : il en reste 43.
Le solde est donc +4 par rapport à 672, mais les quatre ne sont pas quatre ajouts.
Les 85 citations non réancrées restent une limite publiée de B.

## Unité et appariement

L’unité est l’acte, à une étape donnée, dans un PV donné.
Deux étapes du même règlement sont deux actes. Deux sites du même acte ne le sont pas.
Un identifiant stable combine le PV et l’identifiant d’acte B, ou une ancre nouvelle.
On compare uniquement dans le même PV, vérifié par empreinte du texte.
Le numéro du règlement cible, son objet et son étape doivent être compatibles.
La normalisation retire espaces, points et tirets du numéro ; elle garde les lettres.
Un numéro de règlement parent ne vaut pas numéro cible.
La citation doit être contiguë et présente dans le texte. La page doit correspondre.
Les sites alternatifs B sont admis. Un simple chevauchement de 12 caractères ne suffit pas.
On résout un appariement biparti de cardinalité maximale, strictement un à un.
À égalité : numéro explicite, citation exacte, puis ordre lexical des identifiants.
Un signal vague ne valide jamais plusieurs actes. Les doublons restent au dénominateur de précision.
Un appariement contesté est soumis au gardien avant calcul, sans retoucher les critères.

## Correspondance B → C

B atteste une présence. B ne contient aucun verdict C. Aucune conversion automatique n’est valide.
Chaque acte est donc annoté selon les critères de Steve et le guide FINAL de C.
Le pack privé est figé par empreintes dans `annotation.json`.

| Classe | Règle | Motifs |
|---|---|---|
| Pertinent, P | Habitation, ouverture, capacité accrue, règle générale et stade final prouvés | Les huit codes `P-*` de C |
| À surveiller, S | Stade précoce, contrainte ou information insuffisante selon le guide | Les huit codes `S-*` de C |
| Écarté, N | Exclusion prouvée par citation | Les onze codes `N-*` et `V2-PRECEDENT` |
| Non classé | Absence de verdict valide, incident ou désaccord résiduel | `execution_failure`, `missing_annotation`, `residual_disagreement` |

Non classé est un état technique supplémentaire. Ce n’est pas un nouveau code du registre C.
Il est montré par défaut. On ne transforme jamais son absence de preuve en exclusion.
Les 43 cas neutres de B gardent ce statut. Ils ne deviennent ni vrais ni faux positifs.
Une prédiction appariée seulement à un cas neutre est exclue des dénominateurs principaux.
Le rapport donne leur nombre, leur affichage et les extrêmes de sensibilité.

## Annotation indépendante et arbitrage

D2 : Astra `gpt-6-astra`, medium ; Opus `claude-opus-5-5`, medium.
Chaque annotateur lit le PV complet, inventorie les actes et fournit classe, motif et citation.
Il ne reçoit ni les réponses de l’autre, ni les verdicts B, ni leurs provenances.
Le gardien rapproche ensuite les actes. Il vérifie aussi la couverture des 676 actes B.
Une omission d’un annotateur est un désaccord. Un acte ajouté exige la même preuve.
Le même pack est utilisé des deux côtés. Aucun amendement issu de l’aveugle ne retourne au tuning.

D3 : après arrêt des deux annotateurs, Argon `gemini-4-argon-high` arbitre les désaccords.
Il reçoit les deux avis anonymisés et les seules preuves du PV. Un appel par acte disputé.
Son choix doit être valide et motivé par une citation. Pas de vote majoritaire implicite.
Un arbitrage non concluant, invalide ou en échec donne Non classé, **à montrer**.
Un refus de compte arrête tout le run avant le prochain lancement.
Les cas restants gardent ce repli. Ils ne sont pas présentés comme des arbitrages réussis.
L’échantillon humain est en attente de validation. Aucun envoi à Steve n’est fait ici.
Deux IA au plus participent à une itération. L’arbitre intervient dans une phase distincte.

## Découpage et pare-feu

La graine a été committée avant le tirage. Aucun retirage après lecture des résultats.
Tri par SHA-256 de `graine|PV`, puis alternance dans chaque strate de présence B.
La strate suivante commence du côté le moins rempli. Les moitiés font exactement 50 PV.
Une ville par PV dans ce corpus : aucune ville commune aux deux moitiés.

| Moitié | PV | Actes B | Cas neutres B | Actes P∪S de C |
|---|---:|---:|---:|---|
| Mise au point | 50 | 372 | 26 | Inconnus avant annotation |
| Aveugle | 50 | 304 | 17 | Inconnus avant annotation |

**Écart ouvert : la stratification P∪S demandée n’est pas réalisée.**
La présence B sert uniquement de proxy. On ne la rebaptise pas présence P∪S.
Après annotation, publier les supports C agrégés sans changer cette affectation.
Si une stratification C exacte est exigée, i-cond doit ouvrir un amendement avant le tuning.
Cette étape ne peut donc pas être déclarée entièrement acceptée sur ce point.

Le sceau privé suit REFC1 : AES-256-GCM, IV 12 octets, tag 16 octets.
Le contenu contient les actes B, les cas neutres et le manifeste des PV aveugles.
Les textes complets ne sont pas présents dans le sceau : leurs empreintes et chemins y figurent.
Les labels C n’existent pas encore. Ils devront former un nouveau sceau après annotation.
Git ne reçoit que les identifiants de PV, les empreintes et des agrégats.
La clé est dans le dossier privé `1passe-bc/custody`, mode 600. Le gardien la conserve.
Il l’injecte uniquement dans l’environnement de l’exécuteur. Aucun .env n’est lu.
Le rôle `test-executor`, le journal d’accès et les gardes de prompt de `lib/blind.mjs` s’appliquent.
Les sorties aveugles restent privées et scellées. Seuls les agrégats vont à l’owner.
Le tuning n’accède ni aux textes, ni aux votes, ni aux erreurs détaillées de l’aveugle.
Le corpus B a déjà été utilisé. Cette séparation ne prouve pas une absence d’exposition passée.

## Métriques et succès provisoire D4

`TP` : acte de référence P∪S apparié un à un à une prédiction montrée.
`FN` : acte de référence P∪S sans prédiction montrée. `FP` : prédiction montrée sans tel acte.
Rappel P∪S = TP/(TP+FN). Précision = TP/(TP+FP), après exclusion des appariements neutres.
Publier aussi rappel P, rappel S, doublons, échecs et nombre montré par 100 PV.
Un échec ne disparaît pas des supports. Son repli montre les actes déjà connus.
Il ne prouve pas l’extraction des actes inconnus : ceux-ci restent manqués si non détectés.
Publier les bornes exactes Clopper–Pearson unilatérales à 95 %, comme l’annexe M.
À zéro manqué sur n positifs, la borne basse vaut `0,05^(1/n)`, donc reste inférieure à 1.
Un support inférieur à 30 est indéterminé. Un dénominateur nul n’est jamais un score de 1.
Les cas neutres sont exclus du résultat principal. Publier aussi les bornes extrêmes en les affectant tous dans chaque sens.
D4 proposée : zéro manqué sur mise au point ET aveugle ; rappel ponctuel égal à 1.
Parmi les bras admissibles préfigés, retenir la meilleure précision aveugle ponctuelle.
À égalité : borne basse de précision, puis moindre coût mesuré en jetons, puis identifiant lexical.
Aucun plancher de précision inventé. Tous les bras et les échecs restent publiés.
L’aveugle ne peut modifier les prompts, les routes ou la prochaine itération.

## Budget et points ouverts

Le plafond est en tentatives, y compris refus et sorties invalides. Aucune relance automatique.
Étape 0 : **0**. Annotation : **200** appels, deux lectures indépendantes de chacun des 100 PV.
Arbitrage : **776** au maximum, soit 676 actes B et réserve de 100 actes nouveaux disputés.
Mise au point D5 : **200**, deux itérations de deux routes, 50 PV par route.
Aveugle final : **100**, au plus deux finalistes figés, 50 PV chacun, une seule lecture.
Total futur maximal : **1 276**. Au-delà, arrêt et amendement avant tout nouvel appel.
Ce budget suppose un PV complet par appel. Aucun chunk, retry ou optimiseur caché.
Un PV trop long arrête le lot avant appel. Les jetons, latences et quotas sont publiés séparément.
Concurrence globale maximale : 2. Concurrence par compte : 1. Argon : 1.
Petits lots de 5 appels au plus. Espacement minimal de 30 secondes entre départs.
Sur 401, 403, refus de compte, compte désactivé ou accès modèle refusé : arrêt global immédiat.
Sur 429 ou quota épuisé : arrêt global, aucune rotation de compte ou de transport.
Le refus 403 observé sur agy/Gemini interdit toute rafale et toute reprise automatique.
La reprise exige un contrôle du compte par son responsable et une décision tracée d’i-cond.

| Point | Proposition | État |
|---|---|---|
| D4 | Zéro manqué sur les deux moitiés, puis précision aveugle | À confirmer |
| D5 | Astra low/medium, Sol 6.1 medium, Opus 5.5 medium | À confirmer, effort Opus inclus |
| Audit humain | 20 arbitrages, ou tous si moins de 20 ; moitié tuning, moitié aveugle ; tirage par SHA ; priorité aux replis | Taille et calendrier à confirmer |
| Audit aveugle | Owner/Steve et gardien seulement, après gel final ; aucun retour aux optimiseurs | À confirmer |
| Stratification | Affectation B actuelle conservée ; supports C encore inconnus | Arbitrage owner requis |
