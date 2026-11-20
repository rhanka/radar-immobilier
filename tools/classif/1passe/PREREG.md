# Pré-enregistrement B+C — étape 0 du 13 novembre 2026

Conduite : i-cond. Étapes 0bis et 1 autorisées par l’owner le 13/11/2026.
Ce texte, le plan et les manifestes sont committés avant tout appel.
D1 à D4 sont actées. D5 est actée à titre provisoire.

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
Un Non classé issu de D3 reste une référence « à montrer » pour le contrôle des manqués.
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
L’échantillon humain contient 20 arbitrages de mise au point, ou tous si moins de 20.
Il ne contient aucun acte aveugle. Il est préparé pour l’owner, sans envoi externe.
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

## Métriques et succès acté D4

`TP` : acte de référence P∪S apparié un à un à une prédiction montrée.
`FN` : acte de référence P∪S sans prédiction montrée. `FP` : prédiction montrée sans tel acte.
Rappel P∪S = TP/(TP+FN). Précision = TP/(TP+FP), après exclusion des appariements neutres.
Publier en plus le rappel opérationnel sur P∪S et les Non classés de D3. D4 exige aussi zéro manqué sur ce support élargi.
Pour ces Non classés, publier la précision opérationnelle en les comptant positifs, puis la borne conservatrice en les comptant négatifs.
Publier aussi rappel P, rappel S, doublons, échecs et nombre montré par 100 PV.
Un échec ne disparaît pas des supports. Son repli montre les actes déjà connus.
Il ne prouve pas l’extraction des actes inconnus : ceux-ci restent manqués si non détectés.
Publier les bornes exactes Clopper–Pearson unilatérales à 95 %, comme l’annexe M.
À zéro manqué sur n positifs, la borne basse vaut `0,05^(1/n)`, donc reste inférieure à 1.
Un support inférieur à 30 est indéterminé. Un dénominateur nul n’est jamais un score de 1.
Les cas neutres sont exclus du résultat principal. Publier aussi les bornes extrêmes en les affectant tous dans chaque sens.
D4 actée : zéro manqué sur mise au point ET aveugle ; rappel ponctuel égal à 1.
Parmi les bras admissibles préfigés, retenir la meilleure précision aveugle ponctuelle.
À égalité : borne basse de précision, puis moindre coût mesuré en jetons, puis identifiant lexical.
Aucun plancher de précision inventé. Tous les bras et les échecs restent publiés.
L’aveugle ne peut modifier les prompts, les routes ou la prochaine itération.

## Point de départ arbitré par i-cond

La série 7 fournit P0. C’est la seule route à zéro manqué dans les deux moitiés.
P0 × Astra low atteint une précision aveugle de 0,752 dans cette étude historique.
La série 10, Ember, est écartée : 3 et 5 manqués en aveugle.
Ces résultats ne figurent jamais dans les prompts d’annotation.
D5 provisoire : Astra low et medium, Sol 6.1 medium et Opus 5.5 medium.
Deux IA au maximum participent à chaque itération de passe unique.

## Budget et garde-fous amendés le 13/11

Le plafond principal est en lectures, sans relance des réponses invalides.
Les reprises de quota ont un budget séparé de 40 tentatives, au plus 2 par PV et bras.
Elles attendent 60 puis 300 secondes, ou la remise à zéro indiquée si plus tardive.
Un quota ne devient jamais un refus ni un vote. Aucun changement de compte.
Étape 0 : **0**. Annotation : **200** appels, deux lectures indépendantes de chacun des 100 PV.
Arbitrage : **776** au maximum, soit 676 actes B et réserve de 100 actes nouveaux disputés.
Mise au point D5 : **200**, deux itérations de deux routes, 50 PV par route.
Aveugle final : **100**, au plus deux finalistes figés, 50 PV chacun, une seule lecture.
Total principal maximal : **1 276**, plus 40 reprises de quota, soit **1 316** tentatives.
Au-delà, arrêt et amendement avant tout nouvel appel.
Ce budget suppose un PV complet par appel. Aucun chunk ni optimiseur caché.
Un PV trop long arrête le lot avant appel. Les jetons, latences et quotas sont publiés séparément.
Les deux bras d’annotation tournent simultanément, à concurrence 8 chacun.
Argon reste dans une phase distincte, à concurrence 1, jamais plus de 2.
Lecture du quota hebdomadaire codex avant départ et toutes les 10 minutes.
À 90 % utilisés, arrêt des nouveaux départs codex. Mesure finale publiée.
Sur 401, 403, disabled, terms ou refus de compte : arrêt immédiat du bras concerné.
Argon s’arrête au premier refus. Les actes restants deviennent Non classés, à montrer.
Sur 429 ou quota : pause du compte, puis reprise après attente, sans rotation.
Objectif de durée de l’annotation : environ 30 minutes, sans contourner ces gardes.
Un appel reçoit un PV complet et le pack C, sans résultat candidat ni oracle B.
Surface CLI : cwd vide hors dépôt ; MCP et skills désactivés ; aucun outil accepté.
Claude : --tools vide, --max-turns 1, aucune persistance de session.
Codex : configuration isolée, web désactivé, fonctions outils désactivées.
Le CLI codex peut encore exposer unified_exec. Toute invocation invalide la réponse.
Un seul tour demandé ; aucun tour d’outil accepté. Cette limite CLI est déclarée.
Les réponses aveugles sont scellées REFC1 dès leur réception, avant toute publication.
Le kappa porte sur P, S, N et Non classé. Les omissions sont des désaccords.
L’accord par classe publie les effectifs et l’accord symétrique 2n_ii/(n_i.+n_.i).
Le tirage humain est déterministe par SHA-256 de graine|identifiant, replis prioritaires.

| Point | Proposition | État |
|---|---|---|
| D4 | Zéro manqué sur les deux moitiés, puis précision aveugle | Actée le 13/11 |
| D5 | Astra low/medium, Sol 6.1 medium, Opus 5.5 medium | Provisoire, actée le 13/11 |
| Audit humain | 20 arbitrages de mise au point au plus ; aucun aveugle | Acté le 13/11 |
| Audit aveugle | Agrégats seulement ; aucun retour aux optimiseurs | Acté le 13/11 |
| Stratification | Affectation B actuelle conservée ; supports C encore inconnus | Arbitrage owner requis |

## Reprise après interruption

Le journal initial contient 33 départs : 17 réponses reçues et 16 appels interrompus.
Les réponses reçues sont conservées. Les 16 absences restent des échecs techniques.
Aucun de ces appels n’est rejoué. Ils comptent dans les 200 lectures prévues.
Leurs actes B absents passent en désaccord, puis à l’arbitre selon D3.
Le quota hebdomadaire Codex est à 27 % au contrôle de reprise.
La durée publiée distinguera le temps écoulé et la pause entre les deux lanes.
Le gel version 3 conserve les compteurs de départs déjà engagés.

## Exécution du rapprochement et de D3

Le support final reste les 676 actes B de D1. Les inventaires supplémentaires sont
conservés à part, sans ajout automatique. Leur existence n’est pas une présence validée.
Le rapprochement est prudent : numéro cible compatible, étape compatible et preuve.
Une citation exacte partagée ou un numéro cible et un objet corroborés sont requis.
Les appariements incertains restent des omissions et passent à D3.
Une citation de vote doit être exacte, contiguë et sur la page annoncée.
Un code invalide, une ambiguïté ou un motif invalide donne Non classé pour ce vote.
Deux votes valides de même code suffisent. Tout autre cas passe à l’arbitre.
Le kappa conventionnel utilise quatre classes. Deux omissions occupent sa diagonale
Non classé. L’accord validé est donc publié séparément : ces omissions restent des désaccords D3.
L’arbitre reçoit les avis anonymes et l’acte, sans provenance ni verdict de B.
Sa CLI agy n’expose pas de drapeau de suppression globale des outils ou de plafond
de tours. Slash et skills sont désactivés. Tout événement d’outil invalide sa réponse.
Cette limite est déclarée. La concurrence reste fixée à un.
