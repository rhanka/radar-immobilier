# Choix acquis et réglages de préparation

**14 octobre 2026 · v11.** Les réponses de Fabien sont acquises et déjà publiées
sur [#861](https://github.com/rhanka/radar-immobilier/issues/861#issuecomment-6174447767).
Trois décisions sont prises ; une seule question reste ouverte (appel du MCP vers Radar, §5 du dossier), posée avec contexte complet et recommandation. Elle ne rouvre pas les décisions ci-dessous.

## Décisions de Fabien

| Sujet | Sens confirmé | Conséquence dans la cible |
|---|---|---|
| Hébergement | Cluster-mesh dans Immo ; modèle et bibliothèque Sentropic | Instance artefacts, DB/S3 et publication côté Immo dès le pilote. Aucun service central à attendre. |
| Identifiants et outils | Même adresse MCP, connexion, comptes ; mêmes noms, paramètres et réponses | Continuité sans reconnexion ni réglage ; enveloppement des outils existants dans le premier pilote. |
| Données | Usages métier de l’UI, écritures comprises, droits du lecteur | Notes et marques dans la préprod commune ; refus de l’administration et des accès hors droits. |
| Estimations | « tes estimés de charge ne me servent a rien... » | Aucun chiffrage en jours dans le dossier courant ; livrables et preuves à la place. |
| Carte GitHub | Commenter après clarification, garder ouverte et sans changement de statut | Commentaire déjà publié par le conducteur ; cette reprise ne le duplique pas. |

Le **B de l’export v9** ne suffit pas à identifier l’hébergement. Son libellé
centralisé a été précisé par le commentaire brut puis par « Cluster-mesh dans
Immo ». Les [pièces d’origine](DECISIONS-OWNER.md) sont conservées sans correction
rétroactive. Le choix enregistré dans le dossier porte ce sens confirmé, pas
une conversion silencieuse de B vers A.

## Réglages réversibles de l’équipe

| Sujet | Préparation conservée | Limite à vérifier |
|---|---|---|
| Population | Comptes approuvés en préprod | Accueil d’autres organisations hors pilote. |
| Partage | Privé initial, partage nominatif, droit source distinct ; aucun nouveau droit de connexion pour publier (vérification vue par vue) ; partage et suppression sensibles | Auteur et version visibles ; compte propre du destinataire. « Public » au pilote = tous les comptes approuvés ; sans connexion pour la suite. Suppression annulable avant effacement. |
| Identité des vues | UUID serveur + nom stable + catalogue + reçu | Même nom retrouve la même vue dans la portée autorisée ; nouvelle vue après suppression explicite. |
| Liens | Fiche stable, exécution par vue et lien fixe par version ; domaine dédié aux vues avec certificat couvrant toutes les vues (prérequis) | Activation de chaque nouvelle version à qualifier ; cette réserve ne s’applique pas à la continuité du MCP existant. |
| Contenu | Application statique sur domaine distinct, sous-domaine UUID | Racine et navigation préservées ; ni serveur applicatif ni DB métier par branche. |
| Retrait | Autorisation courte, purge avec références | Délai mesuré avant engagement ; données déjà reçues et actions passées non rappelables. |
| Registre | Autorité Sentropic / cluster-mesh ; au pilote, configuration écrite dans le code Immo, relue et embarquée, sans appel pendant le fonctionnement | Réutiliser les composants et contrats existants ; une panne du registre n’arrête pas les outils. Copie signée expirante : piste ultérieure hors pilote. |

Les réglages hérités datent du 13 octobre ; leur portée est clarifiée le
14 octobre pour respecter les choix de Fabien. Ils ne deviennent pas des
décisions owner par leur présence dans cette table.

## Ce qui revient à la réalisation

Qualifier la composition cluster-mesh, la configuration embarquée, la validité de la connexion (émetteur, public, droits, découverte, y compris sa règle de routage), les droits gardés à l’entrée et l’appel du MCP vers Radar selon ta réponse à la question ouverte. Inventorier
les routes métier nécessaires à l’UI et vérifier leurs autorisations, écritures
comprises. Une lacune de bibliothèque est un travail à résoudre, pas une raison
de déplacer silencieusement le pilote vers Sentropic ou de demander à nouveau
le principe des écritures.

Les contrats plateforme existants restent applicables. Si un changement réel
d’adresse, de connexion, de contrat public ou de périmètre s’avère nécessaire,
le présenter comme un écart concret à la décision, avec son effet utilisateur.
Les anciens rendez-vous automatiques « budget puis données » et les questions
codées ne sont pas reconduits. Les choix actuels ne constituent pas un ordre
de déployer ou d’acheter une ressource.

## Traçabilité opérationnelle

Track et GitHub ne sont pas modifiés par cette reprise en lecture seule sur les
dépôts. L’item Track préexistant est `01M4SBA0GDPH5H7XE7MYGVMNRC` (workspace plateforme), enregistré par la PR #862.
Le conducteur pourra y rattacher la v11 et le commentaire owner sans marquer
le service réalisé ni changer sa priorité. Cette écriture n’est pas annoncée
comme effectuée.

Les seize anciens sujets, les comparaisons et les hypothèses de charge restent
dans la v9 archivée ; ils ne constituent plus une liste de questions en attente.
