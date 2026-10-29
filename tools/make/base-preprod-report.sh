  printf '| Mutations | Huit opérateur + cinq runtime, baseline/restauration réussies ; %s/pr920-mutations/ et %s/mutation-*.json |\n' "$dir" "$quality"
  printf '| Image | %s ; %s/image-proof.log et pr920-receipts.json |\n' "$(cat "$image/image-id.txt")" "$image"
  printf '| Rôle SQL non propriétaire | Six refus avant barrière, puis activation qualifiée ; même dossier image |\n'
  printf '| CI reproduite | make k8s-validate : succès ; %s/pr920-k8s-validate.log |\n\n' "$dir"
  cat <<'REPORT'
Les recettes racine de validation K8s sont exécutées telles quelles après
suppression de leur seule inclusion .env, y compris dans le sous-Make.
Les mutations travaillent sur des copies jetables. Le compte de cas opérateur
est enregistré dans les journaux baseline/restored. L'image finale porte le
SHA livré ; son identifiant local ne constitue pas un digest de distribution.

Les nouveaux commits sont dans tmp/base-preprod-evidence/corrections.git,
branche feat/base-preprod-operator, repris du secours c100e6cc. Les métadonnées
Git partagées étaient en lecture seule. L'audit a reçu uniquement le prérequis,
vérifié l'absence du SHA final avant import, puis validé le bundle, le SHA,
l'arbre et fsck. Commits ≤150 lignes, sujets Conventional en anglais, sans corps
ni trailer. Aucun push ni accès préprod ; une seule campagne Docker, attente
des autres piles/builds, seuil de 8 Gio surveillé et nettoyage
down -v --remove-orphans des seules ressources possédées.

Le contrôle de types a d'abord refusé une ligne potentiellement absente ; la
correction et les relances sont conservées. La campagne finale complète la
première campagne réussie après les derniers tests et gardes.
Le premier build de correction a rencontré le cache Buildx en lecture seule ;
son état est désormais dans le dossier de preuves autorisé. L'attente Docker
est sérialisée par le verrou partagé, puis par le contrôle des consommateurs.
Les données et droits réels du cluster, le digest publié, l'historique peuplé
et les observations réseau préprod ne sont pas qualifiés par ces essais.
La sélection d'une revue croisée supplémentaire reste selection-failed faute
d'identifiant exact du modèle auteur ; voir tmp/base-preprod-evidence/pr920-review.md
et l'instruction citée de harness-review/SKILL.md. Aucun nouveau consensus déclaré.

Le rapport original et l'avis qui l'avait remplacé sont préservés dans les
preuves. Ce rapport final est hors du payload afin d'éviter une autoréférence
entre son contenu, le SHA du commit et l'empreinte du bundle.
REPORT
} >> "$report"
printf 'Report: %s\nDelivered SHA: %s\n' "$report" "$head"
