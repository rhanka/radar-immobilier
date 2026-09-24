# refresh-window.awk — cohérence TEMPORELLE d'un rendu refresh.
#
# Le balayage `--all` occupe désormais UN processus pendant des heures, et le
# CronJob est en `concurrencyPolicy: Forbid`. Trois durées doivent donc rester
# emboîtées, sans quoi la prod perd des passages ou tue une ville en plein vol :
#
#   REFRESH_SWEEP_DEADLINE_MS  <  activeDeadlineSeconds  <  écart entre créneaux
#
#   1. le balayage s'arrête de LUI-MÊME (curseur écrit, registre à jour) avant
#      que le contrôleur n'envoie son SIGTERM sur activeDeadlineSeconds ; la
#      marge doit couvrir au moins terminationGracePeriodSeconds ;
#   2. un passage doit être TERMINÉ, arrêt gracieux compris, avant le créneau
#      suivant : en `Forbid`, un passage encore en vol fait SAUTER le suivant,
#      silencieusement.
#
# La garde est RELATIONNELLE : elle ne fige aucune des trois valeurs, elle
# exige qu'elles restent emboîtées. Passer de quatre à deux passages par jour,
# ou rallonger l'échéance, reste une modification unique et libre de la base
# 34-refresh-cronjob.yaml — tant que l'emboîtement tient.
#
# L'écart entre créneaux n'est calculé que pour la forme de planification
# réellement utilisée ici : `<minute> <liste d'heures> * * *`. Toute autre
# forme est signalée et l'écart n'est pas vérifié (l'emboîtement 1. l'est
# toujours) : mieux vaut une garde partielle annoncée qu'une arithmétique
# cron muette et fausse.

function fail(msg) { print "refresh-window: " msg > "/dev/stderr"; bad = 1 }

/^kind:[ \t]/ { kind = $2 }
kind != "CronJob" { next }

/^[ ]+schedule:[ \t]/ { sched = substr($0, index($0, "schedule:") + 10); gsub(/"/, "", sched) }
/^[ ]+activeDeadlineSeconds:[ \t]/ { ads = $2 + 0 }
/^[ ]+terminationGracePeriodSeconds:[ \t]/ { grace = $2 + 0 }
/^[ ]+- name: REFRESH_SWEEP_DEADLINE_MS[ \t]*$/ { want = "sweep"; next }
want == "sweep" && /^[ ]+value:[ \t]/ {
  v = $2; gsub(/"/, "", v); sweepMs = v + 0; want = ""
}

END {
  if (ads <= 0) { fail("activeDeadlineSeconds introuvable dans le rendu"); exit 1 }
  if (sweepMs <= 0) { fail("REFRESH_SWEEP_DEADLINE_MS introuvable dans le rendu"); exit 1 }
  if (sched == "") { fail("schedule introuvable dans le rendu"); exit 1 }

  margin = ads - sweepMs / 1000
  if (margin <= 0)
    fail("REFRESH_SWEEP_DEADLINE_MS (" sweepMs " ms) n'est pas STRICTEMENT avant " \
         "activeDeadlineSeconds (" ads " s) : le balayage serait tué en plein document")
  else if (margin < grace)
    fail("marge d'arrêt " margin " s < terminationGracePeriodSeconds " grace " s : " \
         "le balayage n'a pas le temps de fermer sa ville avant le SIGKILL")

  n = split(sched, f, / +/)
  supported = (n == 5 && f[3] == "*" && f[4] == "*" && f[5] == "*" \
               && f[1] ~ /^[0-9]+$/ && f[2] ~ /^[0-9]+(,[0-9]+)*$/)
  if (!supported) {
    print "refresh-window: écart entre créneaux NON vérifié — planification « " sched \
          " » hors de la forme « <minute> <liste d heures> * * * »"
  } else {
    slots = split(f[2], h, ",")
    if (slots == 1) gap = 24 * 3600
    else {
      gap = 24 * 3600
      for (i = 1; i <= slots; i++) {
        best = 24
        for (j = 1; j <= slots; j++) {
          if (i == j) continue
          d = (h[j] - h[i] + 24) % 24
          if (d > 0 && d < best) best = d
        }
        if (best * 3600 < gap) gap = best * 3600
      }
    }
    if (ads + grace > gap)
      fail("un passage (activeDeadlineSeconds " ads " s + grâce " grace " s) peut " \
           "déborder sur le créneau suivant (écart " gap " s) : en concurrencyPolicy " \
           "Forbid le passage suivant serait SAUTÉ")
    printf "refresh-window: ok — balayage %d s < job %d s (marge %d s, grâce %d s) < créneau %d s\n", \
           sweepMs / 1000, ads, margin, grace, gap
  }
  exit bad
}
