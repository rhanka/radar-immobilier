# Mes propres vues sur la même API

**Dossier #861 · 15 octobre 2026 · v12 — toutes tes décisions intégrées, aucune question ouverte.**

Enabler P1 à prioriser ; cible à réaliser. Tu as tranché l'hébergement, la continuité du MCP, les usages des données et, le 15 octobre, l'appel du MCP vers Radar (choix C : attendre l'échange de jetons de Sentropic). Les choix sont consignés sur [la carte #861](https://github.com/rhanka/radar-immobilier/issues/861#issuecomment-6174447767).

## 1. Le résultat retenu

**Tu pourras personnaliser l'interface Radar et publier ta propre vue sur la même API de préproduction.** Une branche de développement pourra publier sa variante de la même façon. Le MCP que ton agent utilise déjà fournira le guide de l'API, la publication et la gestion des accès. Une branche qui modifie l'API elle-même n'est pas couverte : les vues travaillent devant l'API existante.

**Immo fera tourner son propre nœud cluster-mesh.** Ce nœud enveloppera le MCP Immo actuel et contiendra la gestion des vues : modèle en base, stockage de fichiers, publication et cycle de vie. Sentropic fournira la bibliothèque commune, sa façon d'écrire les données et ses interfaces. Les fonctions métier resteront dans Immo. Le premier pilote ne dépendra pas d'un service central Sentropic séparé.

**Tu garderas la même adresse MCP, la même connexion et les mêmes comptes, sans reconnexion ni réglage.** Les outils existants garderont leurs noms, leurs paramètres et leurs réponses. Les outils de publication et de gestion s'y ajouteront. Cette continuité fait partie du premier pilote.

**Les vues permettront les usages métier de l'interface, écritures comprises**, avec les droits de la personne qui ouvre la vue. L'interface officielle et les variantes travailleront sur la même préproduction : une note enregistrée dans une variante sera une vraie note de cet environnement.

## 2. Le parcours à rendre possible

Farid prépare « Mes villes à suivre », puis partage cette vue avec Steve. Ce scénario suppose leurs comptes approuvés en préproduction ; il ne constate pas leurs accès actuels.

**Deux façons de créer une vue, selon l'outil dont tu disposes.**

1. **Depuis ton chat, une page simple.** Ton agent, déjà connecté au MCP Immo, demande le guide de l'API et écrit une page autonome « Mes villes à suivre ». Il l'envoie au même MCP. Tu obtiens une vue privée et son lien. C'est le chemin rapide pour maquetter.
2. **Le remplacement complet de l'interface.** Il demande le dépôt, ses dépendances et de quoi construire les fichiers. Il se fait donc avec un agent de code sur un poste ou sur une branche, ou par la construction automatique du dépôt. Il utilise le même MCP pour publier le résultat. Une piste pour l'équipe, sans promesse au pilote : partir de l'interface officielle et n'y ajouter qu'un petit fichier de personnalisation, pour offrir ce remplacement complet depuis le chat.

**Utiliser, partager, retrouver.**

3. **Utiliser et partager.** Farid autorise Steve à ouvrir une version. Steve voit son auteur, se connecte avec son propre compte si nécessaire et ajoute ses notes. Il conserve ses droits habituels ; il ne peut pas modifier une note réservée à son auteur. Les autres vues retrouvent les données enregistrées.
4. **Retrouver et corriger.** « Mes vues » permettra de republier, de revenir à une version disponible, de partager, de récupérer les sources autorisées ou de supprimer. Une copie indépendante deviendra une vue privée séparée.

Le serveur attribue un **identifiant unique (UUID)**, adresse stable de la vue, puis un autre identifiant à chaque version publiée. Un nom facile à retenir, le reçu de publication et « Mes vues » permettront de les retrouver. Une branche pourra utiliser un nom stable composé du dépôt, de la branche et de la vue ; aucune graine à conserver ne sera nécessaire au pilote.

La base gardera le propriétaire, les droits et la version courante. Le stockage de fichiers gardera les fichiers : `artifacts/<portée>/<identifiant-vue>/releases/<identifiant-version>/manifest.json`. Ce manifeste reliera les chemins de la page aux empreintes des fichiers. Des fichiers identiques pourront être réutilisés sans partager les droits des vues. Les sources modifiables seront conservées séparément sous le même identifiant de vue. L'équipe devra fournir un nom de domaine dédié aux vues, son adresse et son certificat couvrant toutes les vues ; c'est un prérequis du pilote, distinct du domaine de l'interface officielle pour qu'une vue ne puisse pas atteindre ta session officielle.

## 3. Ce qui existe et ce qui change

Radar possède déjà son interface officielle, sa carte et ses appels aux API Radar et Geo. Le schéma « Aujourd'hui » les montre avec une capture locale datée. La [PR #837](https://github.com/rhanka/radar-immobilier/pull/837), fusionnée le 9 octobre, décrit le point d'entrée MCP de préproduction et la connexion depuis claude.ai. Ces éléments sont établis par les sources ; leur fonctionnement réel sera vérifié au démarrage du travail.

La cible ajoute **plusieurs interfaces personnelles devant les mêmes API** et une bibliothèque de gestion des vues composée par cluster-mesh dans Immo. Elle ne crée ni une API ni une base métier par branche. Douze outils sont déclarés dans le MCP Immo étudié, dont cinq répondent encore `not_wired_yet` : les envelopper conservera aussi ce comportement, sans prétendre les avoir achevés.

Le code d'une vue pourra lire les données autorisées et déclencher des actions au nom de son lecteur. L'accès restera donc limité à son compte, à la vue et à la version ouverte. Les contrôles devront empêcher d'emprunter les droits de l'auteur ou d'atteindre les fonctions d'administration. Chaque écriture notera la vue et la version qui l'ont déclenchée, ainsi que leur lecteur : on pourra retrouver ce qu'une vue défectueuse a écrit au nom de Steve et l'annuler par les fonctions métier habituelles. Retirer une vue arrêtera les accès futurs ; cela ne rappellera pas les données déjà reçues ni les écritures faites.

## 4. Tes décisions

Ces décisions sont prises. Les fiches ci-dessous consignent leur sens confirmé, sans demander une nouvelle réponse.

### Hébergement — Cluster-mesh dans Immo dès le premier pilote

Tu as précisé que **le nœud cluster-mesh tourne au sein d'Immo**, avec la gestion des vues, la base et le stockage de fichiers qui lui sont dédiés. Le modèle et la bibliothèque sont fournis par Sentropic. Le MCP Immo permettra de publier dès le pilote ; aucun service central Sentropic séparé ne sera à attendre.

Tu as coché B ; ton commentaire et ta clarification décrivent l'option A de la v9, complétée par l'enveloppement du MCP Immo et la continuité. L'export original reste conservé dans la trace, sans correction rétroactive.

### Continuité — Même connexion, mêmes outils

« Conserver les identifiants et les tools actuels sans impact » couvre **les deux** : la même adresse MCP, la même connexion et les mêmes comptes, sans reconnexion ni réglage ; et les mêmes noms, paramètres et réponses pour les outils existants.

Cluster-mesh enveloppera le MCP Immo et ajoutera les outils de publication et de cycle de vie. La recette devra vérifier un client déjà connecté et les contrats existants avant la bascule. Reporter cette compatibilité après le pilote ne répondrait pas au choix confirmé.

### Données — Les usages métier de l’UI, écritures comprises

Tu retiens l'option C. Auteur et destinataire pourront utiliser les fonctions métier de l'interface avec **leurs propres droits**, y compris enregistrer notes et marques. Les modifications porteront sur la préproduction partagée. Les droits sur les notes resteront ceux déjà décidés : lecture partagée, modification par leur auteur.

L'équipe devra vérifier les appels et les refus correspondants. Cette vérification mettra en œuvre le choix ; elle ne réintroduira pas une étape de lecture seule ni une nouvelle question sur le principe des écritures. L'administration restera hors du périmètre des vues, comme dans l'option C présentée.

## 5. Comment le MCP appelle Radar — tu as choisi C

**Ta décision du 15 octobre : C, attendre l'échange de jetons de Sentropic.** Le pilote dépend donc de cette livraison. Sentropic l'a prise en urgence : l'émetteur de jetons et l'échange dans cluster-mesh sont en cours de construction. Radar a aussi sa part. Son API cessera d'accepter le jeton destiné au MCP. Elle n'acceptera plus que le jeton échangé, qui porte la mention « agit pour le compte de : MCP Immo ». Sans ce changement, un jeton MCP volé ouvrirait toujours l'API en direct. Ce travail Radar se fait sur une branche isolée, sans fusion ni déploiement. La bascule, coordonnée avec Sentropic, attendra ton feu vert. Jusque-là, rien ne change pour Farid et Steve.

Le contexte et les trois choix présentés sont conservés ci-dessous pour la trace.

**Situation.** Tu as décidé d'envelopper le MCP Immo dans cluster-mesh sans rien changer pour ses utilisateurs. Aujourd'hui, quand ton agent utilise un outil Immo, par exemple « chercher les signaux », le MCP transmet à l'API Radar le jeton de connexion de la personne qui demande. Radar sait ainsi qui demande et applique ses droits. Une règle de sécurité de la bibliothèque MCP de Sentropic interdit cette transmission. Le moyen conforme prévu par cette bibliothèque, l'échange de jetons, existe dans cluster-mesh mais reste verrouillé : il n'est pas livré.

**Ce que ta réponse change.** Elle détermine si le pilote peut démarrer sans attendre Sentropic, et si Radar doit modifier sa façon de reconnaître les appels du MCP. Les trois choix ci-dessous gardent la même adresse, la même connexion et les mêmes réponses pour les outils actuels.

- **A. Garder la transmission actuelle pendant le pilote.** C'est une exception écrite, limitée au nœud Immo et à l'API Radar. Rien ne change pour les utilisateurs ni dans les réponses, et le risque reste celui d'aujourd'hui. L'exception prendra fin quand l'échange de jetons sera livré. *La v11 recommandait A : rien à attendre, rien qui change pour l'utilisateur, sans risque nouveau par rapport à aujourd'hui. Tu as retenu C.*
- **B. Faire reconnaître par Radar un appel du MCP « au nom de » la personne vérifiée.** C'est conforme à la règle, mais cela modifie la façon dont l'API Radar reconnaît les appels, avec un risque d'usurpation à encadrer. Ce travail côté Radar passerait avant le pilote.
- **C. Attendre l'échange de jetons de Sentropic.** C'est conforme, mais le pilote dépendrait alors d'une livraison Sentropic, ce que ta décision d'hébergement voulait éviter.

## 6. Les réglages de préparation

Ces réglages restent réversibles et distincts de tes décisions. Ils reprennent la préparation du 13 octobre ; leur réalisation devra les éprouver.

| Sujet | Fonctionnement prévu |
|---|---|
| Premiers utilisateurs | Comptes déjà approuvés en préproduction. L'accueil d'autres organisations reste une extension. |
| Accès | Vue privée à la création ; partage nominatif ; droit de récupérer les sources distinct du droit d'ouvrir la vue. Publier, partager et supprimer ne demanderont pas de nouveau droit de connexion : le serveur vérifiera chaque vue, une par une, avec ta connexion actuelle. Le partage et la suppression seront présentés comme sensibles, pour que ton agent demande confirmation (à vérifier pendant la réalisation). « Public » au pilote signifiera *tous les comptes approuvés de la préproduction*, sans exposition sans connexion. L'accès sans connexion reste demandé pour la suite, hors du premier pilote. |
| Liens | Une adresse par vue pour l'usage courant, et un lien fixe vers une version précise pour la retrouver exactement. Changer de version demandera au destinataire d'activer la nouvelle version. Le domaine des vues sera séparé de celui de l'interface officielle. |
| Connexion aux vues | Auteur et version visibles, activation de la version sur une page de confiance. Une nouvelle version pourra demander une activation et une connexion à sa page ; les préférences locales ne suivront pas automatiquement. Cela concerne les vues publiées, pas la continuité du MCP Immo imposée ci-dessus. |
| Applications | Fichiers construits ailleurs ; racine `/` et routes de l'application conservées. Le pilote accueillera les applications statiques ; un serveur ou une base métier par branche demandera un autre service. |
| Suppression | Tu pourras annuler une suppression avant l'effacement définitif des fichiers. Après effacement, les fichiers encore nécessaires à une copie indépendante seront conservés. Les copies déjà téléchargées ne pourront pas être rappelées. |

Les durées, quotas, certificats et modalités d'approbation de la configuration sont des travaux d'équipe. Leur réglage ne devra pas imposer aux utilisateurs un changement d'adresse, de compte ou de connexion MCP. Au pilote, la configuration des outils sera écrite dans le code d'Immo, validée par relecture et embarquée dans le nœud : aucun appel au registre Sentropic pendant le fonctionnement n'arrêtera les outils actuels.

## 7. La première livraison et ses preuves

**Le résultat à livrer est un parcours complet depuis le MCP Immo habituel.** L'enveloppement par cluster-mesh, les outils actuels et la gestion des vues font partie de la même cible de pilote.

**Ce que le pilote attend de Sentropic, sans attendre un service central.** La bibliothèque cluster-mesh catalogue aujourd'hui ses modules MCP comme non livrés dans sa version étudiée, et la bibliothèque de gestion des vues reste à créer. Le socle MCP commun et son autorisation restent à qualifier avec Immo. Ce sont des bibliothèques à fournir et à composer dans Immo, pas un service central à exploiter. S'y ajoutent, côté Immo, le domaine dédié aux vues avec son certificat, et le réglage de l'adresse de découverte de la connexion pour que les clients déjà connectés la retrouvent sans réglage.

| Résultat attendu | Preuve à produire pendant la réalisation |
|---|---|
| Tu continues à travailler sans te reconnecter | Même client, même adresse, même compte et connexion conservée ; aucune reconfiguration ni reconnexion imposée par la bascule. La connexion elle-même (émetteur, public concerné, droits, adresse de découverte) reste valide ; les sessions rouvertes automatiquement par le client, comme aujourd'hui à chaque redémarrage, ne comptent pas comme une reconnexion imposée. |
| Les outils actuels restent compatibles | Comparaison des noms, schémas de paramètres, réponses et erreurs avant/après, sur les transports actuellement pris en charge. Les cinq réponses `not_wired_yet` restent inchangées. |
| Ton agent publie et retrouve une vue | Guide récupérable ; page simple publiée depuis le chat et remplacement complet publié depuis un poste ou une branche ; identifiant retrouvé depuis une autre session ; nouvelle version et copie indépendante. |
| Plusieurs vues utilisent les mêmes données | Interface officielle, carte de Farid, liste partagée et aperçu de branche vers la même API de préproduction ; notes et marques attribuées à leur utilisateur, avec la vue et la version à l'origine de chaque écriture. |
| Le partage et le retrait fonctionnent | Steve agit avec ses droits ; un tiers non autorisé est refusé ; suppression annulable avant effacement, puis retrait effectif mesuré et effacement respectant les copies indépendantes. |
| La bascule est maîtrisée | Une seule exécution par action, données conservées, retour à la version précédente éprouvé. |

Les essais techniques pourront être réalisés dans l'ordre utile à l'équipe. Une première publication isolée ne suffira pas à déclarer le pilote terminé. Les estimations en jours ont été retirées à ta demande. La priorisation de #861 reste à faire ; ce dossier ne déclenche aucun déploiement.

## 8. Tes demandes, point par point

| Demande | Réponse dans cette version |
|---|---|
| Maquetter, remplacer l'interface et publier depuis une branche · message 1 | Deux chemins distingués : page simple depuis le chat, remplacement complet depuis un poste, une branche ou la construction automatique ; plusieurs vues, même API de préproduction, écritures métier retenues. Une branche qui modifie l'API n'est pas couverte. |
| Trois formes d'adresse proposées · message 1 | L'adresse en sous-domaine avec identifiant, sur un domaine séparé, est retenue : une adresse par vue, un lien fixe par version. Le préfixe sur le domaine principal est écarté car les vues y partageraient la session de l'interface officielle ; le suffixe ne servira au mieux qu'à retrouver une vue, pas à faire fonctionner toute application. |
| MCP, sources, guide API, accès, suppression · message 1 | Ajouts au MCP Immo existant dès le pilote ; privé à la création et partage nominatif. « Public » au pilote : tous les comptes approuvés de la préproduction ; sans connexion pour la suite. Suppression annulable avant effacement. |
| Enregistrement et carte · message 1 | Déjà faits : enregistrement Track et carte #861 ouverte, P1, « À prioriser ». Cette reprise ne change ni son statut ni sa priorité. |
| Préfigurer Sentropic · messages 2 et 6 | Bibliothèque commune pour la base et les fichiers, leur écriture et leurs interfaces, composée par cluster-mesh ; nœud dans Immo. |
| Aucun Python · message 3 | Reconstruction et vérification en Node/Svelte, avec les outils déjà présents. |
| Schémas habituels · message 4 | Kit Focus conservé : zones, gauche → droite, zoom, déplacement, minimap et taille réelle. Cinq vues seulement, sans codes internes non expliqués. |
| UI existante, variantes et rangement S3 · message 5 | Vue actuelle, plusieurs interfaces vers une API, identifiant attribué par le serveur et organisation des fichiers explicités. |
| Dossier lisible, décisions utiles · messages 7 à 9 | Un parcours, tes choix pris, une seule question restante avec contexte complet et recommandation ; pas de questionnaire à remplir. |
| Cluster-mesh dans Immo et continuité · messages 10 et 11 | Même adresse, connexion, comptes, noms, paramètres et réponses ; compatibilité exigée dès le pilote. |
| Retirer les estimations · message 10 | Étapes exprimées par leur résultat et leur preuve. |
| Garder la carte ouverte · message 11 | Décisions déjà commentées sur #861 ; aucune clôture ni changement de statut dans cette reprise. |
| Appel du MCP vers Radar · 15 octobre | Choix C inscrit au §5 et commenté sur #861 ; travail Radar sur branche isolée, sans fusion ni déploiement avant ton feu vert. |

## 9. Traçabilité et portée de cette reprise

Tes [décisions et leur texte d'origine](DECISIONS-OWNER.md) relient l'export v9, tes clarifications et le commentaire déjà publié. Les [réglages suivis](SUIVI-ARBITRAGES.md) restent distincts de tes choix. Les anciennes versions et les avis contradictoires sont conservés localement ; ils ne valent pas approbation rétroactive de cette mise à jour et ne sont pas embarqués dans la page publiée.

**Ce qui change depuis la v9.** L'hébergement est fixé dans Immo avec enveloppement du MCP et continuité complète dès le pilote. Le parcours distingue la page simple depuis le chat du remplacement complet depuis un poste ou une branche. Les estimations et le formulaire ont disparu. La v12 inscrit ton choix C sur l'appel du MCP vers Radar : il ne reste aucune question ouverte.

Les schémas montrent une **cible décidée, à construire**. L'ancienne architecture centralisée est classée comme historique, hors du pilote, et n'apparaît plus dans les vues. La bibliothèque commune permettra d'autres usages sans imposer cette centralisation à Immo. Les contrôles du livrable portent sur le document et ses schémas ; ils ne prouvent pas encore le fonctionnement du service ni la continuité réelle des connexions : ces preuves font partie de la réalisation. Les dépôts applicatifs restent en lecture seule ; cette reprise écrit uniquement dans le dossier de travail.
