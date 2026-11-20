# Décision owner — refresh préprod à 1 run par jour (20/11/2026)

**Statut :** validée par l'owner le 20/11/2026.
**Portée :** CronJob `radar-refresh-pv` du namespace `radar-immobilier-preprod`. La prod ne change pas.

## Décision

Le refresh planifié en préprod passe de 4 runs par jour (`0 0,6,12,18 * * *`, Etc/UTC) à **1 run par jour (`0 6 * * *`, Etc/UTC)**.
Le refresh préprod n'est **pas suspendu**.
Pour un run à la demande, on utilise le workflow `bascule-refresh` (force preprod refresh).
La prod reste à 4 runs par jour (`0 5,11,17,23 * * *`).

## Motivation

1. **Réduire le coût.** Chaque run préprod consomme des appels LLM de détection, et de classification une fois B+C en deux étapes activé. Passer à un seul run par jour retire environ les trois quarts de ce coût.
2. **Ne pas suspendre, car la préprod n'a pas d'autre source de signaux frais.** La synchronisation quotidienne prod → préprod (workflow `bascule-preprod`) est désactivée à la main depuis fin octobre 2026. Dernier run planifié : 30/10, en échec. Elle a été coupée volontairement, pour deux raisons :
   - **les artefacts** : une restauration écraserait le catalogue d'artefacts préprod ;
   - **la qualification des évolutions** : la préprod doit garder ses propres données de recette, par exemple pour les évolutions EVO-1 à EVO-6 issues du retour de Farid (#861).
   Suspendre le refresh figerait la préprod sur des signaux de plus en plus anciens.
3. **Garder un banc de validation.** Tout changement de détection B ou de classification C se valide d'abord sur un run préprod, par exemple la PR #1143. Le run quotidien et le déclenchement à la demande suffisent pour cela.

## Options écartées

- **Suspendre le refresh préprod :** écarté. Sans synchronisation depuis la prod, la préprod n'aurait plus de signaux frais.
- **Réactiver la synchronisation prod → préprod :** écarté tant que la protection des artefacts et de la qualification n'est pas réglée.
- **Garder 4 runs par jour :** écarté, car c'est un coût sans usage.

## À revoir si

- la synchronisation prod → préprod est réactivée : on pourra alors suspendre le refresh préprod ;
- une recette demande des signaux plus frais qu'un run par jour : on utilise alors `bascule-refresh`.
