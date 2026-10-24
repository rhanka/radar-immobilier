# Rapport — acceptation fournisseur artifacts

Statut : terminé. Base : `71f41b72`, fournisseur verrouillé
`@sentropic/artifacts@0.1.2`, branche de livraison `test/861c-provider-acceptance`.

## Résultats par cas

| Cas | Sans activation | Avec activation, fournisseur actuel |
|---|---|---|
| 1. Révocation pendant un verrou PostgreSQL | Ignoré | Échec attendu : `[missing-contract] provider.finalizeAuthorization` |
| 2. Timeout S3 sous HTTP | Ignoré | Échec attendu : `[missing-contract] provider.typedCause` |
| 3. Connexion perdue contenant « lost » | Ignoré | Échec attendu : `[missing-contract] provider.typedCause` |
| 4. Rejeu HTTP→MCP et MCP→HTTP, deux instances | Ignoré | Échec attendu : `[missing-contract] provider.selectCapabilities` |
| 5. Même clé, contenu ou ordre différent | Ignoré | Échec attendu : `[missing-contract] provider.selectCapabilities` |
| 6. Quatre opérations, clés appelant et identité dérivée | Ignoré | Échec attendu : `[missing-contract] provider.selectCapabilities` |

Les cas 4/5 exigent le profil sélectionné avant dispatch : les compensations
existantes de la façade Radar ne qualifient pas ce contrat fournisseur.
Les assertions situées après les gardes ne sont pas exécutées sur 0.1.2.
Aucun passage au vert d'une future livraison n'est affirmé ici.

Suite API complète : **218 fichiers / 2 830 tests réussis**, 23 fichiers / 80 tests
ignorés, dont les six cas d'acceptation. Commande identique au script API de CI,
via l'entrée Make isolée existante ; sortie `api-full.log`, code 0.

Campagne activée finale : **6 échecs de contrat attendus**, aucun échec de hook
ni incident d'infrastructure, 2,74 s ; code Make 2 / Vitest 1 attendu,
sortie `provider-final.log`. Le passage précédent confirme les mêmes six échecs
en 4,57 s. Contrôles statiques finaux : **tous réussis**, code 0,
sortie `quality-final.log` : tests et workspaces typés, lint, build API et
présence des déclarations vérifiée. `inspect.log` confirme zéro conteneur,
volume et réseau résiduel pour ce projet après le nettoyage final.

## Corrections et adaptation r2

- Les trois sondes de présence deviennent des liaisons vérifiées : callback
  d'autorisation appelé par le fournisseur, cause privée consommée par la façade,
  sélection exactement `ensure`, `publish`, `meta`, `list`.
- Tous les noms provisoires et signatures de ces points d'extension résident dans
  `api/tests/integration/artifacts-provider-contract.helpers.ts`. Le renommage r2
  se fait dans ce seul module ; aucun remplacement fournisseur n'est simulé.
- Le test S3 n'utilise plus le registre de secours Radar : celui-ci pouvait
  masquer l'absence de cause typée fournisseur. Les injections sont vérifiées.
- Chaque hôte est fermé même en cas de contrat absent. Nettoyage conditionnel des
  ressources créées et traces de progression de préparation/nettoyage.
- Révocation : callback vérifié, absence de release/pointeur/idempotence/objet,
  nouvelle publication après réautorisation. Rejeu : reçu et état PostgreSQL/S3.
- Conflits : octets, chemin, MIME, profil et ordre ; absence d'effets supplémentaires.
  Sélection : appels directs refusés, clés invalides sur les deux mutations et
  l'adaptateur MCP, frontière UTF-16, séparation clé appelant/clé interne.
- Le tsconfig API exclut les tests : une cible supplémentaire les vérifie.
  `verify-provider-acceptance` regroupe ce contrôle, les typechecks workspaces,
  le lint et le build API avec vérification de `api/dist/index.d.ts`.

## Commandes exactes et archives

Depuis le worktree, sans lecture de `.env`, données synthétiques uniquement :

```sh
rtk make -f tools/artifact-host.mk test-api API_PORT=18986 UI_PORT=15986 MAILDEV_UI_PORT=11986 ENV=test-861c-provider-acceptance > tmp/861c-provider-acceptance/api-full.log 2>&1
rtk make -f tools/artifact-host.mk test-provider-acceptance ARTIFACTS_PROVIDER_ACCEPTANCE=1 API_PORT=18986 UI_PORT=15986 MAILDEV_UI_PORT=11986 ENV=test-861c-provider-acceptance > tmp/861c-provider-acceptance/provider-final.log 2>&1
rtk make -f tools/artifact-host.mk verify-provider-acceptance API_PORT=18986 UI_PORT=15986 MAILDEV_UI_PORT=11986 ENV=test-861c-provider-acceptance > tmp/861c-provider-acceptance/quality-final.log 2>&1
rtk make -f tools/artifact-host.mk down API_PORT=18986 UI_PORT=15986 MAILDEV_UI_PORT=11986 ENV=test-861c-provider-acceptance
rtk make -f tools/artifact-host.mk inspect API_PORT=18986 UI_PORT=15986 MAILDEV_UI_PORT=11986 ENV=test-861c-provider-acceptance
```

Chaque cible installe les dépendances verrouillées en conteneur et supprime la
pile via `down -v --remove-orphans`, y compris lors de l'échec attendu. Sans
`ARTIFACTS_PROVIDER_ACCEPTANCE=1`, la cible dédiée ignore les six cas.
Pour un candidat, actualiser ses dépendances/liaisons dans son checkout avant
d'exécuter ces mêmes commandes. Une mise à jour de version seule ne démontre pas
que la composition hôte a intégré les contrats.

Disque vérifié avant campagne : 28–30 Go disponibles ; arrêt sous 10 Gio.
Le nettoyage reste accessible sous ce seuil. Aucun port hôte n'est publié.
Deux passages initiaux ont atteint le délai de hook de 20 s ; sorties conservées
dans `provider-enabled.log` et `provider-diagnostic.log`. Le passage instrumenté
`provider-diagnostic2.log` termine en 4,57 s avec les seuls six échecs de contrat ;
aucun délai n'a été augmenté. `pg-diagnostic.log` conserve l'observation d'une
attente PostgreSQL `DataFileImmediateSync`. La première erreur de typage du paquet
est conservée dans `typecheck-suite.log` ; le calcul de statut a été corrigé.

## Livraison et limites

Commits atomiques anglais, sujets ≤72 caractères, ≤150 lignes, sans corps/trailer.
Les métadonnées Git partagées sont hors du périmètre inscriptible : les commits
résident dans `tmp/861c-provider-acceptance/git` ; les refs partagées ne changent pas.
Le bundle est la livraison à importer, pas un commit déjà installé dans ces refs.

```sh
rtk make -f tmp/861c-provider-acceptance/ops.mk audit-delivery bundle ENV=test-861c-provider-acceptance
```

Bundle : `tmp/861c-provider-acceptance/provider-acceptance.bundle`, prérequis
`71f41b72`. Rapport Muse conservé sans modification et non commité.
Relecture directe et vérifications exécutables effectuées. Pas de consensus
multi-pairs revendiqué : les identifiants exacts des auteurs ne sont pas fournis
par les surnoms du mandat ; `tmp/861c-provider-acceptance/review.md` consigne
`selection-failed` conformément au skill harness-review. Aucun merge ni déploiement.
