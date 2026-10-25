#!/usr/bin/env bash
set -euo pipefail
dir=tmp/base-preprod-evidence
delivery=$dir/delivery/pr920-delivery.json
head=$(git rev-parse HEAD)
jq -e --arg head "$head" '.head==$head and .base=="c100e6cc0897bebc42c94157d8cb94f28348cab2" and .verified==true' "$delivery" >/dev/null
bundle=$(jq -r .bundle "$delivery")
[[ $(sha256sum "$bundle" | cut -d' ' -f1) == "$(jq -r .sha256 "$delivery")" ]]
quality=$(find "$dir" -maxdepth 1 -type d -name '*-verify' | sort | tail -n1)
image=$(find "$dir" -maxdepth 1 -type d -name '*-build-image' | sort | tail -n1)
[[ $(cat "$quality/status") == 0 && $(cat "$image/status") == 0 ]]
[[ $(cat "$image/source-commit.txt") == "$head" ]]
jq -e '.numPassedTests>0 and .numFailedTests==0' "$quality/tests.json" >/dev/null
jq -Rsc 'split("\n")|map(fromjson? | select(type=="object"))' "$image/image-proof.log" > "$image/pr920-receipts.json"
jq -e --arg head "$head" 'any(.[];.inspection.releaseSha==$head)
  and ([.[]|select(has("deniedBeforeBarrier"))]|length==6)
  and any(.[];.status=="PASS image runtime and read-only inspection")' "$image/pr920-receipts.json" >/dev/null
rg -q 'PASS five runtime mutations' "$quality/verify.log"
rg -q 'offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1' "$dir/pr920-k8s-validate.log"
for path in "$dir/pr920-mutations/baseline.log" "$dir/pr920-mutations/restored.log"; do rg -q '^PASS operator' "$path"; done
report=RAPPORT-SOL-BASE-PREPROD-P1O1.md
[[ -f $dir/pr920-root-review.md ]] || cp "$report" "$dir/pr920-root-review.md"
cat "$dir/RAPPORT-SOL-BASE-PREPROD-P1O1.avant-revue-independante-c100e6cc.md" > "$report"
{
  printf '\n## Corrections revues astra PR920\n\n'
  printf -- '- SHA livré : %s.\n' "$head"
  printf -- '- Base du bundle : c100e6cc0897bebc42c94157d8cb94f28348cab2.\n'
  printf -- '- Bundle : %s.\n' "$bundle"
  printf -- '- SHA-256 : %s.\n' "$(jq -r .sha256 "$delivery")"
  printf -- '- Dépôt vierge audité : %s ; secours : %s.\n\n' "$(jq -r .audit "$delivery")" "$(jq -r .backup "$delivery")"
  cat <<'REPORT'
Les deux revues astra fournies ont été lues intégralement. Les quatre blocages
et le défaut de collecte sont corrigés :

- Initialisation : UUID nul, slug unique identique au binding avant mutation ;
  l'UUID retourné est résolu vers ce slug et contrôlé à la collecte.
  Les valeurs qui se confondent avec un flag de destination sont refusées.
- SQL : matrice par opération partagée, UPDATE distinct des verrous de table,
  cinq verrous dont facet_event_bindings, insertion des contextes, fonctions
  et propriété effective de l'index. Contrôle avant tout script mutateur,
  sans attribution automatique de droits.
- Image : SHA complet inscrit dans une couche de l'image, contrôle avant accès
  DB, preuves liées au digest et au SHA ; comparaison Job/pod/imageID/reçus.
- Q2 : reçu de redémarrage et identité de génération, template, pod, conteneur,
  compteur et horodatages ; toute nouvelle instance invalide l'ancienne Q2.
- Échecs : collecte aux deux terminaisons, conservation du reçu vérifié et du
  code d'échec, y compris reprise en attente ; collect-job ne relance rien.
- CI : 23 entrypoints = 19 existants + trois scripts P1 + wrapper O1 ;
  retrait successif de chacun des quatre nouveaux bundles détecté.

| Vérification | Preuve locale |
|---|---|
REPORT
  printf '| API complète | %s réussites, zéro échec, %s conditionnels ignorés ; %s/tests.json |\n' "$(jq -r .numPassedTests "$quality/tests.json")" "$(jq -r .numPendingTests "$quality/tests.json")" "$quality"
  printf '| Typechecks, lint, audit | Réussis ; %s/verify.log |\n' "$quality"
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
