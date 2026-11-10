# Classement des signaux — spec (2026-11-08)

Classement manuel d'un signal en quatre classes (Pertinent, À surveiller,
Écarté, Non classé), chacune avec un motif du profil `immo-steve-2026-09`
(`facet_reason_codes`, migration `api/drizzle/0014_facets_signal.sql`).
Aucune persistance nouvelle : la classe et le code de motif restent portés
par les facettes existantes.

## Libellés des motifs — à valider par Steve/owner

La table `facet_reason_codes` ne porte aucun libellé (colonnes
`profile_id`, `code`, `verdict` seulement). L'UI affiche donc un libellé
lisible tiré d'un dictionnaire fr/en côté UI
(`ui/src/lib/signals/signal-reason-labels.ts`), clé par code, français
d'abord. Le code technique reste en infobulle discrète (`title` de la puce
de la carte ; valeur d'item du menu). Un code absent du dictionnaire
retombe sur le code lui-même.

Source de chaque libellé : ligne du dossier
`docs/spec/reports/dossier-retours-steve/DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md`
qui donne le sens du code, ou « proposé » quand le dossier ne donne pas de
glose (libellé dérivé du nom du code, à valider).

### Pertinent (P-*)

| Code | Libellé FR | Libellé EN | Source |
|---|---|---|---|
| P-VILLE-TERRITOIRE | Planification ville et territoire | City and territory planning | proposé (dossier l.268, sans glose) |
| P-NOUV-ZONE | Nouvelle zone résidentielle | New residential zone | proposé (dossier l.270, sans glose) |
| P-PERIM-URB | Périmètre urbain | Urban perimeter | proposé (dossier l.270, sans glose) |
| P-DENSITE | Hausse de densité | Increased density | dossier l.119 « hausse de densité » |
| P-USAGE-MULTI | Multilogement autorisé | Multi-unit housing allowed | dossier l.119 « multilogement » |
| P-TYPO-INTERM | Typologie résidentielle intermédiaire | Missing-middle housing | proposé (dossier l.272, jamais employé) |
| P-PROJ-INTEGRE | Projet intégré résidentiel | Integrated residential project | proposé |
| P-NORMES | Normes assouplies | Relaxed standards | proposé |

### À surveiller (S-*)

| Code | Libellé FR | Libellé EN | Source |
|---|---|---|---|
| S-MANDAT-AMONT | Mandat d'urbaniste amont | Early planner mandate | dossier l.625 « mandat d'urbaniste » (étape) |
| S-PLANIFIE | Changement planifié | Planned change | proposé |
| S-PORTEE-FLOUE | Portée floue | Unclear scope | dossier l.269 (compté, sans glose) ; sens l.122 « portée ou ampleur non identifiables » |
| S-CONTRAINTE | Contrainte à vérifier | Constraint to verify | proposé (dossier l.630, projection non tranchée) |
| S-RESTRICTIF | Resserrement à surveiller | Tightening to watch | dossier l.261 « Trois restrictions sont À surveiller (S-RESTRICTIF) » |
| S-INFO-MANQUANTE | Information manquante | Missing information | dossier l.270 (compté, sans glose) |
| S-PPCMOI-SERIE | PPCMOI répétés | Repeated minor exemptions | proposé (dossier l.630, projection non tranchée ; contexte l.126) |
| S-PREEMPTION | Droit de préemption | Right of pre-emption | proposé (dossier l.630, projection non tranchée) |

### Non pertinent (N-*)

| Code | Libellé FR | Libellé EN | Source |
|---|---|---|---|
| N-ACCESSOIRE | Accessoire sans unités | Accessory, no units | dossier l.120 « sans effet sur la capacité » |
| N-RETIRE | Point retiré | Withdrawn item | dossier l.624 « un point retiré est mort » (K7) |
| N-FORME | Forme seulement | Form only | dossier l.120 « sans effet sur la capacité » |
| N-ODJ-SEUL | Ordre du jour seulement | Agenda item only | dossier l.125 « point d'ordre du jour seulement, pas une décision » |
| N-NON-RES | Non résidentiel | Non-residential | dossier l.90 « zonage non résidentiel » |
| N-ADMIN | Acte administratif | Administrative act | dossier l.120 ; contexte l.618 (K1) |
| N-RESTRICTIF | Resserrement | Tightening | dossier l.110 « N-RESTRICTIF (resserrement) » |
| N-UNIFAM | Unifamilial seulement | Single-family only | dossier l.120 « sans effet sur la capacité » |
| N-DOUBLON | Doublon | Duplicate | proposé (dossier l.272, jamais employé) |
| N-HORS-TERR | Hors territoire visé | Outside target territory | proposé (dossier l.272, jamais employé) |
| N-FAUX-POSITIF | Pas un règlement d'urbanisme | Not a planning bylaw | dossier l.91 « pas un règlement d'urbanisme » |

La base tient 13 codes `non_pertinent` : les 11 N-* ci-dessus plus
`V2-PRECEDENT` (profil `immo-steve-2026-09`) et `legacy-unknown`
(profil `lot-import-v1`, provenance d'import seulement). Tous deux ont
un libellé du dictionnaire :

| Code | Libellé FR | Libellé EN | Source |
|---|---|---|---|
| V2-PRECEDENT | Autorisation individuelle | Individual authorization | dossier l.126 « autorisation individuelle » |
| legacy-unknown | Motif hérité inconnu | Legacy unknown reason | proposé (migration `0021_facet_lot_history.sql`, provenance d'import) |
