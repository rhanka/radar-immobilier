# SPEC_EVOL — Domaine collaboratif multi-utilisateur

> **Statut** : EVOL de cadrage, 2026-08-15. Les invariants D1–D10 ci-dessous
> sont le contrat proposé pour D02. Les décisions O1–O5 restent à ratifier par
> le propriétaire avant implémentation.
>
> **Portée** : cibles adressables, paniers de sélection, archive/masquage,
> annotations et threads, intégration Sentropic, identité/autorisation,
> confirmation humaine du feedback MCP et migration de l'existant.
>
> **Contrainte d'autorité** : cette évolution ne crée pas un second domaine de
> commentaires ou de marques. Elle généralise et réconcilie
> `prospect_marks`, `prospect_notes`, `prospect_contacts`,
> `prospect_contact_access_log` et les tables `account_*` existantes.
> Les faits non prouvés par le dépôt sont déclarés comme inconnus.

## 1. Contexte, intention et état réel vérifié

### 1.1 Intention owner et sources

La source d'intention est la section 2 de
[`SPEC_RAW_USER_REVIEW_2026-08-12.md`](SPEC_RAW_USER_REVIEW_2026-08-12.md#2-collaborative-annotation-domain-and-ui),
complétée par les vagues D02, C01–C04, M01–M02 et SNT1 de
[`PLAN_USER_REVIEW_2026-08-12.md`](PLAN_USER_REVIEW_2026-08-12.md).
L'objectif est de permettre à plusieurs personnes de sélectionner, masquer,
annoter et discuter les mêmes objets métier sans fuite entre espaces, sans
perte d'historique et sans écriture autonome par un modèle.

Le terme **cible** désigne ici l'objet métier adressé. Le terme **portée**
désigne la frontière d'autorisation d'un acte collaboratif. Une portée ne
change jamais l'identité de la cible.

### 1.2 État réel du dépôt au 2026-08-15

| Sous-système vérifié | État réel | Écart avec §2 |
| --- | --- | --- |
| `prospect_marks` | La migration `0005_prospect_marks.sql` crée des marques sur `lot_version_id` **uniquement**, avec `no_lot` et `city_slug` dénormalisés, auteur `account_users.id`, dimensions `pipeline` / `marche`, statuts `favori`, `ecarte`, `sollicite`, `lettre_envoyee` et `en_vente`, mode `real` / `simulation`, prix et lien d'annonce. Les lignes forment une chaîne `supersedes` / `superseded_by`. L'index partiel garantit un seul head par `(lot_version_id, dimension)`. `0006` rend la FK `superseded_by` différable. Le service applique un LWW serveur. Malgré l'étiquette « append-only », il modifie `superseded_by` sur l'ancien head avant l'insertion; les FK seules ne garantissent ni même lot/dimension entre maillons, ni réciprocité, ni absence de cycle. | Une seule cible, aucune portée tenant/workspace/groupe, et la dimension pipeline rend `favori` et `ecarte` mutuellement exclusifs alors que sélection et archive doivent devenir deux états distincts. L'intégrité réelle des chaînes doit être mesurée, pas présumée. |
| `prospect_notes` | Notes en texte libre, insérées sans mise à jour, multi-auteurs, ancrées par `(no_lot, city_slug)` sans FK de version. L'API limite le corps à 10 000 caractères. La fiche lot les lit et en ajoute. | Aucun type, Markdown canonique, target ref, thread, réponse, follow, ancre UI, visibilité, révision, suppression ou tombstone. |
| `prospect_contacts` | Couche PII séparée, lot-only, avec chaîne de versions et champs propriétaire. La migration déclare une finalité de prospection et une durée de conservation encore à définir. | Ne doit jamais être fusionnée dans les commentaires. Il lui manque une portée workspace/membership explicite. |
| `prospect_contact_access_log` | Journal existant des lectures d'un contact connu, avec acteur, action, date et contexte JSON. Le service sait l'alimenter, mais la route de lecture contact est encore un stub HTTP 501. Une tentative sans contact trouvé n'insère pas de ligne malgré le commentaire du service. | Précédent d'audit utile, mais pas un audit collaboratif général ni une preuve que tous les accès PII sont aujourd'hui couverts. |
| `account_users` | Principal Radar global : UUID interne, `sub` OIDC unique, email/nom, statut, `is_admin`. Les statuts SQL atteignent `pending`, `approved`, `rejected`, `suspended` et `invited` après 0008/0009. | Aucun tenant, workspace, groupe ou membership persistant. Le compte approuvé est nécessaire, mais insuffisant pour une autorisation par cible. |
| Audit et invitations de compte | Le fichier `0008_account_status_audit.sql` crée en réalité la table `account_user_status_events`, append-only, avec acteur, raison et date. `0009_account_invitations.sql` crée `account_invitations`. Il n'existe pas de table nommée `account_status_audit`. La route admin met à jour le statut puis insère l'événement sans transaction commune. | Les invitations et transitions ne portent aucune portée workspace/groupe; une panne intermédiaire peut aujourd'hui séparer changement de statut et événement d'audit. |
| Suivi des migrations | Les fichiers SQL 0004 à 0010 existent, mais `api/drizzle/meta/_journal.json` ne référence pas 0009 et passe de 0008 à 0010. Des scripts de backfill indiquent que 0004 et 0009 ont été appliquées manuellement dans un environnement de production, mais cette affirmation et les données vivantes n'ont pas été vérifiées pendant cette spécification. | La migration collaborative doit tester un schéma propre **et** des variantes production-shaped avec DDL déjà présent et tracking absent; elle ne peut pas supposer une histoire Drizzle uniforme. |
| API et temps réel prospect | Les routes et services existants écrivent réellement marques et notes. Quand l'auth globale est activée, le middleware protège l'application, mais la route prospect ne consomme pas l'identité bearer posée dans le contexte Hono : sans cookie, elle peut retomber sur `authorId` fourni dans le body. Marques et notes publient sur le stream global `prospect-marks`; le bus mémoire rejoue tous les streams et diffuse à tous les abonnés. | L'acteur et la portée peuvent être contournés sur le chemin bearer; le flux n'est pas isolé par utilisateur/workspace/visibilité. |
| Sélection cartographique | `ui/src/lib/maps/selection-bucket.ts` possède un état UI en mémoire pour `municipality`, `signal`, `zone` et `lot`. Il sert au focus, hover et rendu de carte; il n'inclut pas `reglement` et n'est ni persistant ni autorisé. | Ce bucket visuel n'est pas le panier collaboratif. Il peut devenir son adaptateur d'affichage, pas une deuxième source de vérité. |
| Chat Sentropic | `ui/package.json` déclare `@sentropic/chat-ui:^0.5.0` et le lockfile résout 0.5.0. Le widget est monté dans `App.svelte`; le client, le layout, le contexte, `ChatWidgetHost` et `RadarChatPanel` importent réellement le paquet. `ChatWidgetHost` passe `showCommentsTab={false}`. Les tours sont conservés dans une clé `localStorage` globale `radar-chat-turns`. | Il faut réintégrer/mettre à niveau l'existant, non reconstruire un chat. Le tab commentaires est désactivé et le stockage local n'est pas scoped par principal. |
| Commentaires/TipTap | Aucune dépendance ni aucun import `@sentropic/comments` ou TipTap n'est présent dans Radar. | La version, l'API et la sémantique publiées doivent être vérifiées avant C04/SNT1. |
| MCP actuel | `@radar/immo-mcp` expose dix outils en lecture. Le contexte possède déjà `tenantId`, `workspaces` et le scope `immo:notes:write`, mais les écritures ne sont pas câblées. En HTTP, l'absence de claims peut retomber sur `radar` / `default`. L'identité/bearer est capturée à l'initialisation de session. L'audit courant est une ligne STDERR pré-appel, non un journal durable de mutation et résultat. | Les fallbacks et la session actuelle ne sont pas acceptables pour une écriture. Une confirmation doit être liée au principal, à la portée, à la cible/version et au digest exact, puis consommée une seule fois. |

Le chat actuel contient par ailleurs un chemin de tool-calling qui demande au
modèle d'ajouter ou traiter une demande de backlog puis appelle directement
l'API. Ce précédent ne satisfait pas §2.5 et ne doit pas être réutilisé pour le
feedback : le feedback exige un gate structurel de confirmation.

### 1.3 Décisions d'évolution

- **D1 — Un seul domaine canonique.** Les IDs, auteurs, contenus et chaînes
  existants sont migrés en place ou par un cutover atomique sans dual-write.
  Une nouvelle table de commentaires métier concurrente est interdite.
- **D2 — Référence cible unique.** Sélection, archive et annotation utilisent
  la même `TargetRef` typée, scoped et version-aware.
- **D3 — États orthogonaux.** Sélection, archive, pipeline commercial et état
  marché sont des facettes distinctes. Une archive ne remplace plus une
  sélection dans une enum commune.
- **D4 — Historique sans perte.** Aucun événement, note, mode, prix, lien,
  acteur ou lien de supersession historique n'est supprimé ou réécrit pour
  faciliter la migration.
- **D5 — Commentaires Sentropic réutilisés.** Le threading et le host contract
  doivent venir du modèle Sentropic dont la version publiée aura passé le gate
  SNT1/C04. `prospect_notes` est son jeu de données de migration, non une
  branche parallèle.
- **D6 — Responsabilités hôte.** Sentropic porte les contrats/modules
  génériques; Radar porte identité, membership, authz, persistence, politiques
  de rétention et validation des cibles.
- **D7 — Autorisation fail-closed.** Un principal ou une portée incomplets,
  ambigus, expirés ou non membres produisent un refus. Aucun fallback
  `radar/default` et aucun `authorId` client ne sont admis sur une écriture.
- **D8 — PII séparée.** Contacts propriétaires et leurs logs restent dans la
  couche PII. Copier leur contenu dans une sélection, annotation, notification,
  trace MCP ou audit générique est interdit.
- **D9 — MCP en deux temps.** Une suggestion proactive reste sans effet métier;
  seule une intention exacte explicitement confirmée et passée à l'état
  `resumed` peut écrire.
- **D10 — Inconnu honnête.** Aucun tenant, workspace, groupe, raison d'archive,
  type de note, version cible ou identité canonique manquants ne sont fabriqués
  par un backfill.

### 1.4 Rattachement au plan

| Plan | Responsabilité de cette évolution |
| --- | --- |
| D02 | Le présent contrat : cibles, RBAC, groupes, visibilité, historique, suppression, audit, Sentropic/chat-ui et confirmation MCP. |
| C01 | Persister la frontière tenant/workspace, memberships et groupes, puis fermer tous les fallbacks d'identité. |
| C02 | Généraliser les références, facettes et audits **à partir** de `prospect_*`; définir concurrence et migration. |
| C03 | Livrer paniers et archives sur le schéma C02, sans migration concurrente. |
| C04 | Faire évoluer `prospect_notes` vers le host/comment model Sentropic et réactiver l'intégration chat-ui. |
| M01 | Fournir la machine de confirmation liée au principal et le gate atomique `resumed`. |
| M02 | Exposer le feedback proactif et écrire, après confirmation, dans le même domaine d'annotations. |
| SNT1 | Branche Sentropic conditionnelle seulement si l'audit prouve qu'un contrat générique ou une version publiée manque. |

## 2. Cibles adressables

### 2.1 Contrat `TargetRef`

Les noms ci-dessous décrivent le contrat logique; ils ne figent pas encore les
noms SQL ou TypeScript :

| Champ | Invariant |
| --- | --- |
| `tenant_id` | Non nul pour toute donnée collaborative. Ne vient jamais des arguments LLM ou d'un body non vérifié. |
| `workspace_id` | Frontière de collaboration et de l'expression « tous les utilisateurs ». Le principal doit y avoir un membership actif. |
| `target_type` | Enum fermée initiale : `city`, `signal`, `zone`, `lot`, `reglement`. |
| `target_authority` | Namespace de l'autorité qui émet l'identifiant stable; empêche de confondre une ligne relationnelle, un nœud graphify ou une clé UI. |
| `target_stable_id` | Identité durable opaque dans `(target_type, target_authority)`. Un libellé, un index de tableau ou un code affiché ne suffit pas. |
| `target_version_id` | Nullable seulement si l'objet n'est pas versionné ou si la version historique est honnêtement inconnue. |
| `observed_at` | Instant auquel le résolveur a validé la cible/version, utile quand la cible évolue. |

La référence complète est stockée avec l'acte collaboratif. L'identité logique de
la cible est `(tenant_id, target_type, target_authority, target_stable_id)`;
`target_version_id` décrit la version observée et ne crée pas à elle seule une
seconde cible. Le serveur résout la cible, contrôle son existence et l'accès du
workspace avant toute lecture ou écriture. La possession d'une `TargetRef` ne
confère aucun droit.

Une annotation reste rattachée à l'identité stable si une nouvelle version
apparaît, mais conserve la version observée. L'UI affiche « créée sur la
version … » et un état `version-obsolete` si nécessaire. Un changement de
canonical ID ne retargete jamais silencieusement les actes : il exige une
réconciliation explicite et auditée.

### 2.2 Mapping vérifié par type

| Type | Identité exploitable | Version | Limite/gate anti-invention |
| --- | --- | --- | --- |
| `city` | Le contrat `Municipality` déclare `slug` unique au Québec; `OntoMunicipality` expose aussi un UUID. | Non versionnée dans le schéma actuel. | C02 doit choisir et tester le résolveur de registre; le dépôt SQL courant n'expose pas de table `municipalities`. |
| `signal` | `graph_nodes.id` est la clé primaire du flux courant, tandis que `signals.id` et des IDs UI synthétiques existent aussi. | Aucun contrat de version unique n'est matérialisé pour le flux courant. | Le choix d'autorité est bloquant. Les IDs `gn-<city>-<index>` générés côté UI sont interdits comme identité collaborative. |
| `zone` | `zone_versions.canonical_id`. `code_affiche` est explicitement un alias daté. | `zone_versions.id`, avec fenêtres de validité/connaissance. | Un code de zone seul ne crée pas une cible. |
| `lot` | `lot_versions.canonical_id`; `no_lot` reste une clé cadastrale utile, mais pas l'ancre versionnée existante. | `lot_versions.id`. | Le backfill des marques part obligatoirement de la FK `lot_version_id`. |
| `reglement` | Le domaine `OntoBylaw` porte `recon.canonicalId` et `regulatory_stages` porte `bylaw_canonical_id`. | Lifecycle/stage connu, mais aucune table de versions de règlement n'est prouvée ici. | L'UI courante agrège des numéros depuis les signaux. Le numéro normalisé n'est pas une identité suffisante; l'action reste désactivée si aucun canonical ID ne peut être résolu. |

Les cinq types sont obligatoires dans le contrat et les tests. Un type dont
l'autorité stable n'est pas résolue doit produire un état indisponible
explicite, jamais une cible approximative.

### 2.3 Mapping depuis l'existant lot-only

Pour chaque ligne de `prospect_marks` :

1. joindre `prospect_marks.lot_version_id = lot_versions.id`;
2. écrire `target_type=lot`,
   `target_stable_id=lot_versions.canonical_id` et
   `target_version_id=prospect_marks.lot_version_id`;
3. conserver `no_lot` et `city_slug` comme provenance dénormalisée,
   les comparer à `lot_versions` et rapporter tout écart;
4. refuser le cutover si la FK ne se résout pas. Il est interdit de reconstruire
   une cible à partir des valeurs client dénormalisées.

L'unicité active actuelle est par `lot_version_id`. Si plusieurs versions du
même `canonical_id` portent chacune un head, la migration conserve toutes les
chaînes et signale un conflit de projection; elle ne choisit ni le head le plus
récent ni une version dite courante. La projection stable ne devient active
qu'après une résolution déterministe ou humaine auditée.

Pour `prospect_notes` et `prospect_contacts`, qui n'ont pas de FK
version, le backfill groupe les `lot_versions` par
`(no_lot, city_slug)` :

- un seul canonical ID à travers les versions : stable ID résolu, version
  historique laissée inconnue;
- zéro ou plusieurs canonical IDs : ligne conservée avec
  `legacy_resolution=unresolved`, valeurs originales intactes, et entrée
  de rapport; aucune version « courante » n'est choisie par défaut;
- une ligne non résolue reste consultable par un rôle de migration autorisé,
  mais ne peut pas recevoir de nouvelle réponse ou mutation avant résolution.

## 3. Panier de sélection

### 3.1 Entité panier et tag

Un panier est une collection collaborative identifiée, distincte de l'état de
focus cartographique. Il appartient à un tenant/workspace et possède :

- un propriétaire `account_users.id`;
- une visibilité `private` ou `shared`;
- des grants par UUID de personne et/ou de groupe; les noms sont des libellés,
  jamais des clés d'autorisation;
- une politique d'édition explicite pour chaque grant;
- un historique des changements de partage.

Le tag de sélection est un événement de la facette `selection` dans
l'évolution de `prospect_marks`. Une même cible peut être sélectionnée
dans plusieurs paniers autorisés. Il ne peut exister qu'un head actif par
`(basket_id, identité stable de la cible)`; la version observée reste attachée
à la transition.

Le tag peut porter une annotation Markdown optionnelle. Le Markdown nettoyé
est la représentation canonique; TipTap est l'éditeur, pas une seconde source
de vérité. Le serveur :

- limite la taille selon un seuil à fixer avant C03;
- refuse ou nettoie HTML brut, URLs dangereuses et attributs exécutables;
- produit le même rendu nettoyé en lecture, export et notification;
- conserve le texte historique lors d'une révision.

Les anciennes valeurs `favori` ne sont affectées à aucun panier privé ou
partagé tant que la portée historique « équipe unique » n'a pas été mappée par
une décision owner/workspace. L'auteur historique ne prouve pas que la marque
était privée.

### 3.2 Transitions, concurrence et temps réel

- Ajouter, modifier ou retirer une sélection insère une transition; aucun
  DELETE ne sert de raccourci.
- Une mutation d'un head partagé fournit `expected_head_id`. Un head
  différent retourne 409 avec la version courante; le LWW silencieux actuel
  n'est pas conservé pour les nouvelles facettes collaboratives.
- Toute commande porte une clé d'idempotence scoped par acteur/workspace.
- Les événements temps réel sont filtrés avant fan-out par tenant, workspace,
  grants et visibilité. Aucun `replayAll` global n'est autorisé.
- Le bucket cartographique courant peut refléter les tags autorisés, mais son
  état `selectedKeys` ne persiste jamais directement le panier.

## 4. Archive et masquage

### 4.1 État distinct et portées

L'archive est la facette `archive`, orthogonale à `selection`. Elle
supporte :

1. **personnelle** : visible/effective pour l'acteur seulement;
2. **partagée restreinte** : personnes ou groupes nommés;
3. **tous les utilisateurs** : tous les membres actifs du workspace, jamais
   implicitement tous les tenants.

Une archive active masque la cible dans les vues couvertes. Elle ne réécrit
pas le tag de sélection. Si l'utilisateur choisit aussi « désélectionner »,
l'API exécute dans la même transaction une transition de sélection séparée et
audite les deux effets. Restaurer l'archive ne recrée pas automatiquement une
sélection supprimée.

Le **signal** est le premier cas vertical obligatoire de C03 : archive
personnelle, partagée et workspace; disparition des listes/cartes concernées;
accès direct honnête indiquant l'archive; restauration.

### 4.2 Raison, visibilité et réversion

Toute nouvelle activation d'archive exige une raison Markdown non vide après
nettoyage. L'API et la contrainte de données doivent refuser l'absence de
raison, y compris via batch, chat ou MCP.

L'UI montre, selon les droits :

- acteur;
- portée et destinataires;
- raison;
- date;
- cible/version d'origine;
- éventuel effet de désélection;
- état actif/restauré et acteur/date de la réversion.

La restauration est une nouvelle transition qui supersède le head d'archive.
L'ancien acte et sa raison restent auditables selon la politique de rétention.

### 4.3 Réconciliation de `ecarte`

`ecarte` est le précurseur historique d'archive/masquage, mais les
données existantes ne portent ni raison ni scope.

- Chaque événement `ecarte` est conservé et classé
  `legacy-archive`.
- Un head pipeline actif `ecarte` produit un head d'archive importé.
- Sa raison est `legacy-unknown` avec contenu nul; l'UI affiche « raison
  historique indisponible ». La chaîne, l'auteur et la date sont la preuve;
  une raison synthétique est interdite.
- L'exception à la raison obligatoire est bornée aux IDs importés et marquée
  par la provenance de migration. Toute nouvelle archive, y compris une
  nouvelle version d'une archive héritée, exige une raison.
- `favori`, `sollicite`, `lettre_envoyee` et `en_vente`,
  ainsi que `real/simulation`, prix et lien, sont eux aussi préservés.
  `favori` alimente la sélection seulement lorsque la portée historique
  est résolue; les deux statuts de sollicitation restent dans la facette
  pipeline et `en_vente` dans la facette marché.

L'attribution de l'archive workspace reste soumise à O2. Dans tous les cas,
elle exige une capability dédiée; elle ne découle jamais du simple droit de
lecture.

## 5. Annotations et threads

### 5.1 Contrat d'annotation

Une annotation est une note racine typée autour d'une seule `TargetRef`.
Elle peut porter une ancre UI optionnelle :

- identifiant stable du composant ou de la région fonctionnelle;
- section/élément métier stable dans la cible;
- version du contrat d'ancre;
- libellé de repli.

Un sélecteur DOM, une position écran ou une géométrie seule ne constitue pas
une ancre durable. Si le composant disparaît, l'annotation reste accessible au
niveau de la cible et affiche « ancre indisponible ».

### 5.2 Réutilisation Sentropic, sans second store

C04 doit :

1. vérifier la version réellement publiée de `@sentropic/comments` et le
   host contract de la version chat-ui retenue;
2. faire évoluer `prospect_notes` en place, ou effectuer un cutover
   atomique qui conserve les mêmes IDs et un seul writer;
3. implémenter un adaptateur Postgres/Radar du contrat Sentropic avec
   `TenantContext` et `TargetRef` version-aware;
4. conserver les politiques Radar d'authz, de visibilité, de rétention et
   d'audit autour du module générique;
5. retirer l'ancien endpoint/reader de notes au cutover. Aucun dual-write,
   fallback durable ou table `radar_comments` indépendante.

La voie canonique est unique : panel/host Sentropic → API Radar → adaptateur
Postgres du port Sentropic → données `prospect_notes` réconciliées. Les tables
additives nécessaires aux ACL, révisions, follows ou tombstones enrichissent
la même identité de commentaire/thread; elles ne constituent pas un second
store. L'UI, le chat et le feedback MCP confirmé empruntent la même commande.

Les notes existantes sont importées avec :

- ID, auteur, body, mode et date inchangés;
- format `legacy-plain-text`, sans réinterprétation Markdown;
- type technique `legacy-unclassified`, non sélectionnable pour les
  nouvelles annotations;
- thread racine autonome;
- visibilité historique non inventée, à résoudre avec le workspace legacy.

### 5.3 Taxonomie initiale à valider

Les six valeurs candidates de §2.4 sont :

1. `reported-data-problem`;
2. `field-visit-report`;
3. `validation-request`;
4. `regulatory-follow-up`;
5. `acquisition-lead`;
6. `internal-note`.

Avant activation, l'architecture/propriétaire doit valider pour chacune :
définition, cibles permises, champs requis, risque PII, visibilité maximale,
rétention, modération et capacité MCP. Le type ne se déduit jamais du texte.

### 5.4 Thread, follow et cycle de vie

- Une réponse appartient au même tenant, workspace, target et scope que sa
  racine; répondre ne peut élargir la visibilité.
- La structure exacte parent/racine/profondeur vient du contrat Sentropic
  vérifié. L'adaptateur empêche les réponses orphelines et cross-target.
- Follow/unfollow est un état persistant par utilisateur/thread. Le realtime
  technique n'est pas un follow métier.
- Les notifications ne contiennent que ce que le destinataire peut encore
  lire au moment de l'envoi. La révocation d'un membership coupe lecture et
  notifications immédiatement.
- Une édition crée une révision avec auteur, date et lien de supersession; le
  contenu précédent suit la politique de rétention.
- La suppression ne cascade ni n'orpheline silencieusement un thread. Le choix
  hard-delete/tombstone est O1; aucune suppression n'est activée en production
  avant cette décision et ses tests.
- L'audit durable couvre création, réponse, édition, changement de visibilité,
  follow/unfollow, suppression/restauration et refus d'autorisation. Les bodies
  sensibles ne sont pas dupliqués dans le journal d'audit.

Les contacts propriétaires restent exclus des annotations. Une
`acquisition-lead` n'autorise pas à recopier une identité ou un moyen de
contact PII hors de `prospect_contacts`.

## 6. Chat-ui et feedback MCP

### 6.1 Réintégration chat-ui

« Réintégrer » signifie faire évoluer le widget réellement monté :

1. inventorier les breaking changes entre le 0.5.0 verrouillé et la version
   publiée retenue, puis mettre à jour explicitement manifest et lockfile;
2. préserver l'adaptateur mince Radar, le streaming, le sélecteur de modèle et
   les context chips;
3. remplacer `showCommentsTab={false}` par le panel/host commentaires
   Sentropic autorisé, alimenté par le même store/adaptateur que les vues
   métier;
4. étendre le contexte chat aux cinq `TargetRef` sans générer d'ID UI;
5. scoper ou purger la clé locale de conversation par principal/workspace; un
   utilisateur ne doit jamais restaurer les tours d'un autre;
6. isoler le SSE par principal/workspace/stream et interdire le replay global.

La mise à niveau ne prouve ni la disponibilité d'un CommentsPanel, ni la
compatibilité de `@sentropic/comments` : ces points sont des gates
SNT1/C04.

### 6.2 Endpoint de feedback

Le feedback MCP utilise la même commande de création d'annotation que l'UI.
Il ne possède ni table de contenu, ni taxonomy, ni autorisation séparées.

Le contrat logique expose deux temps :

- **suggestion/préparation** : le MCP détecte une donnée manquante ou un
  problème, retourne une proposition structurée et une preview; aucune
  annotation, archive, sélection ou notification n'est créée;
- **soumission reprise** : après confirmation humaine explicite, l'adaptateur
  fournit un reçu `resumed` à usage unique et l'endpoint tente la même
  écriture autorisée que le Web.

La proposition contient au minimum : `capability_ref`, outil, session MCP,
client vérifié, acteur attendu, tenant/workspace, `TargetRef` et version, type
proposé, Markdown exact, portée/destinataires, source du problème, digest
canonique de l'action, expiration et clé d'idempotence. Le digest couvre tous
ces champs. Tout changement de l'un d'eux invalide la confirmation.

### 6.3 Machine de confirmation

| État | Effet permis |
| --- | --- |
| `suggested` | Résultat proactif éphémère, lecture seule. Aucune écriture de domaine. |
| `pending_confirmation` | Intention immuable et preview affichée. Seuls le ledger de contrôle et l'audit peuvent être écrits. |
| `resumed` | Atteignable uniquement par une action UI explicite du même principal sur le payload exact. Autorise une tentative unique. |
| `committed` | Annotation écrite atomiquement; ID et audit corrélés. Terminal. |
| `failed` | Tentative reprise mais refusée/échouée, sans succès partiel. Terminal; une nouvelle intention exige une nouvelle confirmation. |
| `rejected` / `denied` / `expired` / `timed_out` / `cancelled` / `stale` | Terminaux sans écriture de feedback. |

Un booléen `confirmed=true`, un état `resumed` ou un actor ID fourni
dans les arguments du tool sont non fiables et rejetés. Le modèle ne peut pas
appeler lui-même la transition humaine.

### 6.4 Authz, audit et idempotence MCP

- Le scope OAuth d'écriture est nécessaire mais non suffisant; l'API revalide
  compte approuvé, membership, groupe, capability, cible et visibilité au
  commit.
- Pour une écriture, `tid` et workspace doivent provenir de claims
  vérifiés et correspondre aux memberships Radar. Les fallbacks
  `radar/default` sont interdits.
- La session MCP est liée à `(sub, tenant, workspace, client)`. Chaque
  requête authentifiée vérifie qu'elle appartient à la session; un session ID
  d'un autre utilisateur est refusé.
- Le reçu de confirmation est en plus lié à la capability, à l'outil et au
  `mcpSessionId` exacts. Il ne peut pas être déplacé vers une autre session,
  un autre client ou une autre capability, même pour le même principal.
- L'expiration du bearer, une suspension, un retrait de groupe, un changement
  de head/version cible ou de payload entre confirmation et commit produit
  `stale` ou un refus, jamais une écriture.
- La consommation du reçu, l'écriture d'annotation et l'audit de résultat sont
  atomiques. Un replay avec la même idempotency key retourne le même résultat
  sans seconde annotation.
- Le journal durable relie suggestion, confirmation/refus, outil, acteur,
  cible, digest, scopes évalués, résultat et correlation ID. Le STDERR actuel
  reste un log d'exploitation, pas la preuve d'audit.
- « Zéro écriture avant confirmation » signifie zéro écriture dans les tables
  collaboratives et zéro effet utilisateur. Le ledger minimal de confirmation
  et l'audit de sécurité sont autorisés, sans rendre la suggestion visible à
  d'autres utilisateurs.

## 7. Modèle de données, identité et migration

### 7.1 Hiérarchie d'identité

Le modèle cible est :

- **tenant** : frontière d'isolation maximale;
- **workspace** : espace de collaboration et portée de « tous les
  utilisateurs »;
- **account user** : principal Radar interne, relié à une identité externe
  vérifiée;
- **workspace membership** : statut et rôle d'un compte dans un workspace;
- **groupe nommé** : objet du workspace identifié par UUID;
- **group membership** : relation temporelle compte–groupe;
- **grant/visibility scope** : personnes/groupes autorisés sur un panier,
  archive ou thread.

Même si O4 retient un seul workspace, les IDs tenant/workspace restent
obligatoires et aucun code ne hardcode `default`.

### 7.2 RBAC minimal

| Capability | Condition minimale |
| --- | --- |
| `collaboration:read` | Compte approuvé, membership actif, cible accessible et scope visible. |
| `selection:write:self` | Membership actif; panier possédé par l'acteur. |
| `selection:share` | Droit de gestion du panier et destinataires membres du même workspace. |
| `archive:self` | Membership actif et accès à la cible. |
| `archive:shared` | Capability explicite et grants bornés au workspace. |
| `archive:workspace` | Capability dédiée; mapping contributor/moderator soumis à O2. |
| `annotation:create/reply/follow` | Membership actif, type/cible permis et visibilité accessible. |
| `annotation:moderate` | Capability explicite; ne confère pas implicitement la lecture du body privé. |
| `collaboration:audit:read` | Rôle auditeur/admin explicite et journal filtré par tenant/workspace. |
| `prospect:pii:read` | Capability séparée, finalité autorisée et accès journalisé. |

Un rôle de lecteur, contributeur, modérateur ou admin est un bundle de ces
capabilities, non un test dispersé de `is_admin`. L'admin de workspace
n'obtient pas implicitement l'accès aux bodies privés ou à la PII.

L'acteur est toujours dérivé du contexte serveur et traduit en
`account_users.id`. Tous les champs `authorId`/`actorId` client
sont ignorés ou refusés. Un statut `approved` sans membership produit 403.

### 7.3 Évolution des données existantes

| Existant | Évolution canonique, sans perte |
| --- | --- |
| `prospect_marks` | Ajouter TargetRef, tenant/workspace, facette, opération, portée/basket, raison/annotation, idempotency key et concurrence. Conserver IDs, `dimension`, `statut`, `mode`, auteur, prix, lien, dates et chaîne legacy. Les nouvelles chaînes sont facette-scoped; tout maillon legacy incohérent est conservé comme provenance mais placé en quarantaine, jamais normalisé silencieusement dans une nouvelle chaîne. |
| `prospect_notes` | Ajouter TargetRef, contexte tenant/workspace, métadonnées du host Sentropic, type, format, thread/ancre/visibilité/révisions selon le contrat vérifié. Conserver body exact, ID, auteur, mode et date. |
| `prospect_contacts` | Ajouter workspace et TargetRef lot résolue lorsque possible; garder la table et sa finalité PII séparées. Aucun élargissement automatique aux cinq cibles. |
| `prospect_contact_access_log` | Préserver toutes les lignes et FKs; ajouter le snapshot de portée résolu ou `legacy-scope-unknown`, jamais un membership historique inventé. |
| `account_users` | Reste le principal interne. Ajouter les relations de membership au lieu de dupliquer les comptes. |
| `account_user_status_events` | Reste le journal des transitions globales de compte; relier sans réécrire les acteurs historiques. |
| `account_invitations` | Ajouter la portée d'invitation pour les nouveaux actes. Les invitations historiques sans workspace gardent un état de résolution inconnu; les tokens restent secrets et exclus des audits. |

Un audit collaboratif durable peut être ajouté comme journal transversal; il
ne remplace ni les événements métier ni le journal PII et n'en copie pas les
contenus sensibles.

### 7.4 Séquence de migration additive

1. **Inventaire** : row counts, IDs, hashes de contenu, chaînes, heads,
   incohérences dénormalisées, état Drizzle et variantes 0004/0009.
2. **C01** : ajouter tenant/workspace/membership/group/grants, sans modifier le
   writer prospect. Faire ratifier le mapping du legacy « équipe unique ».
3. **Expand C02** : ajouter les colonnes nullable, résolveurs, facettes et
   audit; aucun nouveau writer parallèle.
4. **Backfill déterministe** : marks par FK; notes/contacts par résolution
   prudente; toutes les ambiguïtés dans un rapport et un état legacy conservé.
5. **Sentropic C04** : vérifier le contrat et adapter `prospect_notes`;
   tester lossless avant activation.
6. **Validation** : contraintes tenant/workspace/target, unicité par facette,
   graphes de supersession, grants, raisons et checksums. Les exceptions ne
   concernent que les lignes legacy explicitement marquées.
7. **Cutover unique** : basculer API, UI, SSE et MCP dans une fenêtre contrôlée.
   Un seul writer et un seul reader métier deviennent autorisés; l'ancien code
   est retiré dans le même changement applicatif.
8. **Contract** : après acceptation et rollback window, retirer les colonnes ou
   routes legacy devenues inutiles. Les données non résolues ne sont jamais
   supprimées pour permettre ce nettoyage.

Une application rollback après le premier write nouveau doit savoir relire le
schéma étendu; revenir à un binaire qui ignore les nouvelles facettes est
interdit. Le rollback DDL destructif n'est pas une stratégie.

À défaut d'un mécanisme de capture online testé qui reste à writer unique, la
fenêtre de cutover suspend les écritures prospect. Un dual-write temporaire
non prouvé n'est pas une stratégie de migration.

### 7.5 Preuves de non-perte

La migration échoue si l'une des preuves suivantes manque :

- chaque ligne source reliée exactement une fois à son identité canonique ou à
  un état `unresolved`, avec les mêmes IDs et une provenance immuable;
- bodies, prix, liens, modes, auteurs et dates identiques par checksum;
- chaque `prospect_marks.lot_version_id` résolu par FK;
- chaînes sans cycle, liens réciproques cohérents et heads attendus;
- chaque anomalie notes/contacts/portée dans un rapport exhaustif;
- aucun `ecarte` enrichi d'une raison inventée;
- aucune invitation ou transition de statut perdue;
- logs PII toujours reliés au même contact et au même accessor;
- deuxième exécution du backfill sans changement;
- scénarios migration propre, 0004/0009 déjà appliquées mais non trackées, et
  schéma mixte testé sur fixtures nettoyées production-shaped.

## 8. Critères d'acceptation

### AC-01 — Réconciliation, pas duplication

Après migration, les APIs Web/chat/MCP lisent et écrivent un seul domaine.
Une inspection du schéma et des imports prouve l'absence de second store de
marques/notes/commentaires et l'absence de dual-write. Les IDs legacy restent
résolvables.

### AC-02 — Cinq cibles typées et version-aware

Un utilisateur autorisé annote, sélectionne et archive une city, un signal,
une zone, un lot et un règlement avec une TargetRef complète. Un alias, ID UI
synthétique, code seul, target type incohérent ou version d'une autre cible est
refusé. Zone/lot affichent la version d'origine après publication d'une version
plus récente.

### AC-03 — Mapping lot exact

Un corpus contenant incohérences `no_lot/city_slug`, plusieurs versions
et notes ambiguës prouve que marks suivent uniquement la FK, que notes/contacts
ambiguës restent unresolved et qu'aucune cible n'est devinée.

### AC-04 — Panier privé et partagé

L'utilisateur A voit son panier privé; B ne le voit pas. A partage un panier
avec un utilisateur et un groupe nommés; seuls leurs membres actifs le voient
et seuls les grants éditeur le modifient. Retirer B du groupe coupe lecture,
temps réel et notification sans effacer l'historique.

### AC-05 — Markdown sûr

TipTap édite et rend le Markdown canonique. Scripts, event handlers, URLs
dangereuses et HTML non permis sont neutralisés côté serveur et restent
neutralisés après export/rechargement. Le texte legacy est rendu comme plain
text, sans interprétation nouvelle.

### AC-06 — Archive distincte et premier cas signal

Sur un signal sélectionné, A crée une archive personnelle avec raison : la
sélection persiste et seul A voit le masquage. A choisit ensuite une archive +
désélection : deux événements distincts sont audités. Une archive workspace
est refusée sans capability. La restauration montre acteur, portée, raison,
dates et ne recrée pas silencieusement la sélection.

### AC-07 — Héritage `ecarte`

Les heads `ecarte` deviennent archives legacy actives avec raison
indisponible explicite. Les événements supersédés restent historiques. Une
nouvelle archive sans raison est refusée sur tous les transports.

### AC-08 — Threads Sentropic

Une annotation de chacun des six types validés peut recevoir une ancre, une
réponse et un follow. Une réponse cross-target/workspace/tenant est refusée.
Une ancre devenue invalide retombe sur la cible sans perdre le thread. Les
notes legacy apparaissent comme `legacy-unclassified`, jamais
`internal-note` inventé.

### AC-09 — Historique, suppression et rétention

Les scénarios edit, tombstone/hard-delete retenu, suppression de racine avec
réponses, restauration, export d'audit et expiration démontrent exactement la
politique O1 ratifiée. Aucun comportement de cascade du paquet n'est adopté
implicitement.

### AC-10 — Authz non contournable

La matrice utilise au moins deux tenants, deux workspaces, deux groupes, un
membre retiré, un compte suspendu et un non-membre. Les mêmes deny sont testés
par appel API direct, bearer MCP direct, SSE/replay et UI. Cacher un bouton
n'est pas une preuve. `authorId`, tenant, workspace, groupe, capability
ou `resumed` fournis par le client ne modifient jamais la décision.

### AC-11 — Temps réel isolé

Un abonné ne reçoit/rejoue que ses streams et événements visibles. Les
événements privés de A n'apparaissent ni en live ni au reconnect de B. Un
changement de membership ferme ou revalide le flux.

### AC-12 — PII séparée

Aucune réponse de sélection, archive, commentaire, chat, MCP, notification ou
audit générique ne contient les champs de `prospect_contacts`. Un accès
PII autorisé écrit le log dédié; un accès non autorisé est refusé et audité
sans exposer la PII. Les exports et recherches sans résultat sont eux aussi
traçables; l'absence de `contact_id` ne permet pas d'abandonner la trace de
sécurité.

### AC-13 — Chat-ui réellement réintégré

La version publiée retenue et ses breaking changes sont consignés. Le widget
actuel reste monté, son panel commentaires consomme le même host/store que les
vues cible, les context chips portent des TargetRef valides et le stockage
local/SSE ne fuit pas entre deux connexions successives sur le même navigateur.

### AC-14 — Zéro feedback avant confirmation

Pour une suggestion MCP, les row counts des tables collaboratives et les
notifications restent inchangés dans `suggested` et
`pending_confirmation`. Rejet, timeout et expiration n'écrivent rien.
Un texte « je confirme » produit par le modèle et un argument
`confirmed=true` échouent.

### AC-15 — Confirmation liée, revalidée et idempotente

Le payload exact confirmé passe à `resumed` puis écrit une annotation.
Modifier target, version, scope, body ou type invalide le reçu. Suspension,
retrait de groupe, bearer expiré, version/head changé et détournement d'un
session ID par un autre utilisateur sont refusés. Deux soumissions identiques
concurrentes créent une seule annotation et un audit corrélé. Le reçu est
consommé une seule fois : rejouer la même clé retourne le même résultat, et
rejouer la confirmation avec une autre clé n'autorise pas une seconde écriture.
Le même principal ne peut pas déplacer le reçu vers une autre session, un
autre client, outil ou `capability_ref`.

### AC-16 — Gate SNT1 et inconnues

C04/M01/M02 ne démarrent pas sur une API supposée. La disponibilité et le
contrat publiés de comments/chat-ui/MCP sont prouvés; si un manque générique
est confirmé, SNT1 le fournit. Sinon SNT1 n'est pas créée. Les décisions
O1–O5 et les durées de rétention sont signées avant activation production.

## 9. Décisions ouvertes et dissents

### O1 — Hard-delete Sentropic ou tombstone/rétention Radar

Le plan rapporte un comportement Sentropic de hard-delete/cascade qui n'est
pas vérifiable depuis les dépendances Radar présentes. Le choix affecte
réponses, droit à l'effacement, audit et restauration. **Aucun défaut
implicite** : suppression production bloquée jusqu'à preuve du contrat,
politique owner et tests AC-09.

### O2 — Archive « tous les utilisateurs »

Options à ratifier :

- capability accordable aux contributeurs;
- capability réservée au rôle modérateur.

Dans les deux cas, la portée maximale est le workspace, l'acte exige une
raison et reste réversible/auditable. La spec retient fail-closed tant que le
bundle de rôle n'est pas décidé.

### O3 — Source d'identité

Options : IdP/Sentropic comme source de tenant/workspace/group claims, ou
Radar comme registre de memberships autour du `sub` IdP. Le code courant
ne tranche pas et ne persiste que `account_users`. La décision doit
définir provisioning, désactivation, renommage, claims stale et autorité de
groupe. Radar reste l'autorité d'autorisation au commit tant que ces mappings
ne sont pas prouvés.

### O4 — Multi-tenant réel ou workspace unique

Un workspace unique réduit le provisioning initial mais ne justifie ni colonnes
nulles ni valeurs hardcodées. Un multi-tenant réel exige isolation, ownership
et opérations admin supplémentaires. Le mapping des données « équipe unique »
et invitations legacy dépend de cette décision; aucun backfill de portée ne la
précède.

### O5 — `@sentropic/comments` direct ou adaptateur Radar

Deux options conformes à D5 :

- consommation directe si le contrat publié couvre TargetRef, host,
  subscriptions et extensions nécessaires;
- adaptateur Radar mince implémentant le port Sentropic sur
  `prospect_notes`/Postgres et injectant authz/versioning.

Un système maison qui imite les commentaires est exclu. SNT1 n'est justifiée
que pour un manque générique prouvé; les politiques Radar ne doivent pas être
déplacées dans Sentropic.

## 10. Hors périmètre, résumé et inconnues

### 10.1 Hors périmètre

- implémenter migrations, routes, composants, packages ou manifests;
- choisir une durée légale de rétention sans décision owner/juridique;
- modifier le canon Geo/graphify pour fabriquer des identités manquantes;
- fusionner la PII CRM dans le domaine collaboratif;
- définir des canaux email/push au-delà du contrat follow/notification;
- autoriser un déploiement production ou contourner les gates du plan;
- refondre les outils backlog du chat, sauf pour garantir qu'ils ne deviennent
  pas le chemin du feedback.

### 10.2 Résumé

Le domaine demandé existe déjà sous une forme lot-only : marques versionnées,
notes multi-auteurs, contacts PII et audits de compte/PII. L'évolution consiste
à **généraliser ce socle** vers une TargetRef à cinq types, séparer les facettes
sélection/archive/pipeline/marché, introduire baskets et scopes
tenant/workspace/group, puis adapter `prospect_notes` au modèle Sentropic.
Le feedback MCP écrit dans ce même domaine uniquement après une confirmation
humaine liée au payload et revalidée au commit. Aucun second store, aucune
raison/type/version inventée et aucun writer autonome ne sont permis.

### 10.3 Inconnues consolidées

- versions **réellement publiées et compatibles** de
  `@sentropic/comments`, du dernier `@sentropic/chat-ui` et d'un
  éventuel `@sentropic/mcp-platform`; le dépôt prouve seulement
  `chat-ui` 0.5.0 verrouillé et `@sentropic/mcp-auth` déclaré;
- contrat réel de thread, follow, hard-delete, cascade, tombstone,
  subscriptions et extensions de ces versions;
- source canonique finale de l'identité `signal` et matérialisation
  résoluble de `reglement`;
- table/registre persistant qui fait autorité pour `city`;
- nombre, contenu et anomalies réels des lignes en production; aucun accès à
  la base vivante n'a été effectué;
- intégrité effective des chaînes `supersedes` / `superseded_by` et nombre de
  heads concurrents après regroupement par canonical;
- état exact de tracking de 0004/0009 dans chaque environnement;
- mapping owner du legacy « équipe unique » vers tenant/workspace/basket;
- source d'identité, mode multi-tenant et rôle autorisé à archiver pour tous;
- durées de rétention des annotations, audits, confirmations et contacts PII;
- version TipTap, sérialiseur Markdown, sanitizer et limite de taille;
- politique de notification par type et comportement lors d'une suppression;
- sémantique de version des signaux et règlements quand leur canon évolue.

### 10.4 Tables existantes à réconcilier

| Table existante | Traitement obligatoire |
| --- | --- |
| `account_users` | Conserver principal/UUID/sub/statut; relier aux memberships. |
| `account_user_status_events` | Conserver le journal réel créé par le fichier `0008_account_status_audit.sql`; aucune table `account_status_audit` n'existe. |
| `account_invitations` | Préserver invitations/statuts et résoudre la future portée sans exposer les tokens. |
| `prospect_marks` | Généraliser en événements multi-cibles/facettes en conservant toute la chaîne, tous les statuts, modes et champs marché. |
| `prospect_notes` | Migrer lossless vers le host/comment model Sentropic, avec legacy non typé explicite. |
| `prospect_contacts` | Conserver comme couche PII lot-only, ajouter scope/TargetRef résolue sans copier le contenu. |
| `prospect_contact_access_log` | Conserver toutes les traces et FKs; compléter la portée sans inventer l'historique. |
| `lot_versions` | Autorité de résolution du mapping historique `lot_version_id` → canonical/version. |
| `zone_versions` | Autorité de résolution des cibles zone canonical/version. |
| `graph_nodes`, `signals`, `regulatory_stages` | Tables de résolution à auditer pour fixer les autorités signal/règlement; elles ne sont pas remplacées par le domaine collaboratif. |
