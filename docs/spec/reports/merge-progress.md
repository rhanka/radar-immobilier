# Merge progress — intégration 4 branches dans feat/appheader-ds

Cible: feat/appheader-ds. Base HEAD au démarrage: 58e3865. HEAD final: **02c52eb**.

Constat: les branches 1/2/3 ont été intégrées par une instance concurrente/précédente
du même task via **cherry-pick du commit-tip** (PAS `git merge --no-ff`), produisant un
historique LINÉAIRE sans la chaîne e1b8fd1 (#297-#309). Reflog: abort de mon merge en cours,
puis cherry-pick 1→2→3 (16:25-16:27), tentative branche 4 → conflit → rollback `reset 02c52eb`.
J'ai validé l'état résultant (gate vert) et n'ai PAS refait 1/2/3 (déjà intégrés). La branche 4
est restée à réconcilier (l'instance précédente avait déjà calé dessus au même point).

| # | branche | sha tip | intégré comme | statut | gate |
|---|---------|---------|---------------|--------|------|
| 1 | worktree-agent-a5703a95c455976e4 | 5595384 | 618e256 (cherry-pick) | INTÉGRÉ | vert |
| 2 | worktree-agent-a69d0ee7acf25d9da | 9458b81 | f2484c7 (cherry-pick) | INTÉGRÉ | vert |
| 3 | worktree-agent-ae7aa854c9b176453 | 0e87794 | 02c52eb (cherry-pick) | INTÉGRÉ | vert |
| 4 | worktree-agent-ad05abe170c06ea26 | d10f138 | — | ABORTÉ → à réconcilier manuellement | n/a |

Gate sur HEAD 02c52eb (1/2/3 intégrés): UI svelte-check 0 ERREUR (l'erreur préexistante
`SignauxMapView:provisional` est résolue), API tsc OK, vitest ciblé maps/signals/auth/prospect
193/193 verts.

## Branche 4 — raison de l'abort (à réconcilier manuellement)
Cherry-pick d10f138 → 4 conflits: `prospect-marks-client.ts` (3 blocs, add/add),
`prospect-marks-client.test.ts` (add/add), `LotFichePanel.svelte` (4 blocs), `lots-client.ts` (1 bloc).

Cause de fond: `prospect-marks-client.ts` de la branche est une **réécriture incompatible** du
module committé sur HEAD, pas un simple ajout:
- HEAD (committé, consommé ailleurs): type `ProspectStatus`, champs `lotVersionId?`/`authorId?`
  optionnels, helpers `prospectStatusLabel`/`computeProspectCounters`/`activePipelineMark`/
  `ProspectCounters`/`ProspectLotState`, signature fetch `baseUrl`.
- d10f138: type `ProspectStatut` (pipeline/marche), champs requis + `prixDemande`/`lienAnnonce`/
  `supersededBy`, signature `ProspectClientOptions`/`credentials:same-origin`/`readError`, +
  écritures `createProspectMark`/`createProspectNote`. Pas de helpers labels/counters.

`LotFichePanel.svelte` câble l'UI d'écriture fiche-lot sur l'API client de d10f138 (incompatible
HEAD). La recette « garde le committé + ajoute createProspectMark/createProspectNote » donnerait
des exports morts, non testés et non câblés (l'UI vit dans LotFichePanel, design incompatible) —
donc pas la feature. L'intégration fidèle = re-câbler l'UI d'écriture sur la base HEAD + réconcilier
les deux jeux de types + porter les tests = ré-implémentation de feature nécessitant une QA
authentifiée, hors d'un merge mécanique sûr. À traiter à part (branche dédiée + harness test/verify).
