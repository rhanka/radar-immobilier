---
status: selection-failed
target-ref: ad6bba295687094b23ed1ec873635e1f3bb44b50
review-author:
  host: codex
  model: unknown
  effort: unknown
observed-failure: Exact author metadata unavailable; h2a_run MCP unavailable.
---

# État de revue

Le skill [harness/review](/home/antoinefa/.codex/skills/harness/review/SKILL.md) exige :
« Unknown author means no acceptable review » et « Launch only through the installed h2a MCP server's h2a_run tool ».
Les conditions de sélection ne sont pas réunies. La revue formelle s’arrête à cette sélection. Aucun verdict de consensus n’est émis.
Cela laisse la PR draft révisable. Aucun GO prod n’en découle.

Deux lectures techniques complémentaires, distinctes, ont été réalisées par les agents review_data et review_ops.
Elles ne satisfont pas les critères de complémentarité de host du skill. Elles ne sont pas présentées comme ses legs.

Corrections retenues : précontrôles bloquants, 44 empreintes/timestamps exacts, SQL et images épinglés, reçus liés à l’identité physique,
archive et drain, retrait du mot de passe destination côté source, umask privé, reprise d’upload, hook compatible avec les bundles,
grants par le migrateur candidat après vérification des 44 migrations, garde de durée interne au conteneur,
restauration complète puis ACL originales, reprise de copie déjà migrée sans l’écraser.

Correction de la revue indépendante : fenêtre opérateur sous le verrou cutover existant.
Capture avant drain. Configuration, rollout privé et réouverture séparée sous ce même verrou.
Le tag vient après recette et réouverture. Une promotion concurrente refuse.
Le GO porte les empreintes exactes du roster et du plan 6H. Les reçus conservent ces empreintes.
La copie produit son reçu backup.json. Le rollback conserve propriétaires et ACL.

Tests isolés : neuf gardes et deux scénarios du contrôleur. Succès et échec du smoke public couverts.
Intégration PostgreSQL : vraie archive synthétique, 13 → 44 → 13, reprise sans DDL et deux rollbacks.
Données, propriétaires, ACL et accès legacy sont comparés. Les droits ajoutés au candidat sont retirés.
Ces preuves portent sur des données synthétiques et des frontières cluster simulées.

Limites conservées : aucune répétition sur copie prod. Sauvegarde/S3 et hook 6H candidats non exécutés.
Drain réel à prouver par k8s. ACL et rôles prod à valider sur copie.
Recette authentifiée et refresh réels non exécutés.
La décision de production reste NO-GO jusqu’à ces preuves et à la revue requise.
