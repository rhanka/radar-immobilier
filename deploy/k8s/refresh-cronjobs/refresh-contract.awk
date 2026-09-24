# refresh-contract.awk — projette le CONTRAT COMMUN d'un rendu refresh.
#
# Entrée  : un rendu `kubectl kustomize` de l'un des deux overlays refresh
#           (deploy/k8s/refresh-cronjobs ou deploy/k8s/refresh-cronjobs-prod).
# Sortie  : des lignes `clé = valeur`, comparées TRIÉES entre les deux rendus
#           par la cible `verify-renders`. Toute ligne présente d'un côté et
#           pas de l'autre est une divergence d'overlay, et fait rougir la CI.
#
# Pourquoi une projection plutôt qu'un `diff` des deux rendus : les deux
# overlays DOIVENT diverger sur trois points, et sur trois seulement :
#   1. `namespace` — radar-immobilier-preprod contre radar-immobilier ;
#   2. l'enveloppe mémoire — `memory:` des requests/limits et le
#      `--max-old-space-size` de NODE_OPTIONS (la prod tient dans une marge
#      plus basse ; cette valeur reste épinglée à part dans `verify-renders`) ;
#   3. la liaison de stockage S3 — la préprod pointe son propre seau, la prod
#      hérite du ConfigMap `radar-api` (la garde dédiée est
#      deploy/ci/check-object-storage-bindings.sh).
# Ces trois points ne sont PAS projetés. Tout le reste — schéma d'exécution,
# échéances, commande `--all`, variables de balayage, PVC keyring, CPU,
# contexte de sécurité — l'est, et doit coïncider au caractère près.
#
# La projection ne fige AUCUNE valeur : elle exige qu'un réglage changé d'un
# côté le soit de l'autre. Un ajustement d'exploitation reste une modification
# unique de la base 34-refresh-cronjob.yaml, qui alimente les deux overlays.

function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }

function emitEnv() {
  if (envName != "") {
    # NODE_OPTIONS porte le plafond de tas, divergence voulue ; SCRAPE_S3_*
    # porte la liaison de stockage, divergence voulue.
    if (envName != "NODE_OPTIONS" && envName !~ /^SCRAPE_S3_/)
      print "env " envName " = " trim(envBuf)
    envName = ""
    envBuf = ""
  }
}

BEGIN { kind = ""; envName = ""; envBuf = ""; inEnv = 0; inCmd = 0; cmdBlock = 0 }

/^---[ \t]*$/ { emitEnv(); kind = ""; inEnv = 0; inCmd = 0; next }
/^kind:[ \t]/ { emitEnv(); kind = trim(substr($0, 6)); inEnv = 0; inCmd = 0; next }

# Le PVC keyring est court et entièrement contractuel : classe, mode d'accès,
# taille. Seul le namespace en est retiré.
kind == "PersistentVolumeClaim" {
  if ($0 ~ /^[ \t]*namespace:/) next
  print "pvc " trim($0)
  next
}

kind != "CronJob" { next }

# --- commande des conteneurs ------------------------------------------------
# C'est ici que se joue #734 : `--all` doit rester dans les DEUX rendus, et
# aucun slug ne doit apparaître d'un seul côté.
/^[ ]+(- )?command:[ \t]*$/ {
  emitEnv(); inEnv = 0; inCmd = 1; cmdBlock++; cmdIndex = 0; next
}
inCmd {
  if ($0 ~ /^[ ]+- /) {
    cmdIndex++
    print "command[" cmdBlock "][" cmdIndex "] = " trim(substr($0, index($0, "- ") + 2))
    next
  }
  inCmd = 0
}

# --- variables d'environnement ----------------------------------------------
/^[ ]+(- )?env:[ \t]*$/ { emitEnv(); inEnv = 1; envIndent = match($0, /[^ ]/); next }
inEnv {
  if ($0 ~ /^[ ]+- name: /) {
    emitEnv()
    envName = trim(substr($0, index($0, "name:") + 5))
    envBuf = ""
    next
  }
  if (match($0, /[^ ]/) <= envIndent && $0 ~ /^[ ]*[A-Za-z]/) { emitEnv(); inEnv = 0 }
  else { envBuf = envBuf " " trim($0); next }
}

# --- scalaires du contrat ---------------------------------------------------
# `memory` est délibérément absent : c'est la divergence voulue n°2.
/^[ ]+(- )?(schedule|timeZone|concurrencyPolicy|startingDeadlineSeconds|successfulJobsHistoryLimit|failedJobsHistoryLimit|suspend|backoffLimit|activeDeadlineSeconds|ttlSecondsAfterFinished|restartPolicy|terminationGracePeriodSeconds|serviceAccountName|workingDir|imagePullPolicy|claimName|secretName|defaultMode|mountPath|sizeLimit|storage|cpu|readOnlyRootFilesystem|allowPrivilegeEscalation|runAsNonRoot|runAsUser|runAsGroup|fsGroup|type):[ \t]/ {
  print "spec " trim($0)
}

END { emitEnv() }
