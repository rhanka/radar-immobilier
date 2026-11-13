---
status: selection-failed
target-ref: 1a7ab5332d2f6c3645d656624119db7d86ecb713
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

Limites conservées : aucune répétition sur copie prod ; sauvegarde/S3/rollback complet et hook 6H réels non exécutés ; attestation de drain déclarative à joindre par k8s ;
ACL et rôles originaux à valider sur copie ; recette authentifiée et refresh réels non exécutés.
La décision de production reste NO-GO jusqu’à ces preuves et à la revue requise.
