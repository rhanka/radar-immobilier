# Track report — sortie native par défaut

Baseline commit: `f67814901657d5f2607b7cc2794e63dde280d28e`

```text
SYNTHÈSE
fait   à-faire   attendus   dropped   décisions pending
────   ───────   ────────   ───────   ─────────────────
68     33        6          1         0                

DÉCISIONS/ACTIONS
scope/gate   sujet                                                                      préconisation                                          
──────────   ────────────────────────────────────────────────────────────────────────   ───────────────────────────────────────────────────────
AWAITED      WP B — Vertical profond geo (zone->lot), villes prioritaires               action (local/subagent): exécuter prochain incrément   
             opportunites<6mois x lots GeoJSON                                                                                                 

AWAITED      CS-L1 — Scoring visuel lots 4+∩TOD (carte Opportunités, couche lots        action (local/subagent): exécuter prochain incrément   
             coloriée data-driven)                                                                                                             

AWAITED      CS-L2 — Fiche lot complète (Évaluation): cadastre + rôle MAMH + zone +     action (local/subagent): exécuter prochain incrément   
             grille PDF + Google Maps + notes                                                                                                  

AWAITED      CS-L3 — Marquage d'équipe + notes par lot + filtres par marque avec        action (local/subagent): exécuter prochain incrément   
             compteurs (Opportunités/Évaluation)                                                                                               

AWAITED      CS-L4 — Export CSV lettres de sollicitation + export de sélection          action (local/subagent): exécuter prochain incrément   
             (Opportunités)                                                                                                                    

AWAITED      CS-L5 — Filtres combinés potentiel(exclusif) × usage actuel(additif) ×     action (local/subagent): exécuter prochain incrément   
             superficie min (Opportunités/Évaluation)                                                                                          

TO-DO        WP A.2 — Data: identification progressive 'easy first' + 4 agents remote   action (local/subagent): terminer ou expliciter blocage

TO-DO        A.2.4 Todo permanente + 4 agents background via remote                     action (local/subagent): exécuter prochain incrément   
             (download/Obscura) + MAJ track                                                                                                    

TO-DO        A.2.5 Captcha->Obscura pour identification proprietaire de lot             action (local/subagent): exécuter prochain incrément   
             (secondaire, rate-limite, role foncier public)                                                                                    

TO-DO        A.3.2 remote: orchestration des agents de scraping + suivi backlog         action (local/subagent): exécuter prochain incrément   
             (track)                                                                                                                           

FAIT RÉCENT / REPÈRES
type      sujet                                                                     acceptance
───────   ───────────────────────────────────────────────────────────────────────   ──────────
done      Header pas l'AppHeader canonique DS — écart structurel/visuel             unknown   

done      Police DS non chargée app-wide — font-family Inter en dur, 0 @font-face   unknown   

done      Filtre Signaux : les 3 filtres ne sont pas cochés par défaut              unknown   

done      Filtre Signaux : état non persisté (URL / store / localStorage)           unknown   

done      Filtre Signaux : taille de police des libellés trop grande                unknown   

info      63 autres done; utiliser --flat pour le détail complet                              

dropped   1; utiliser --flat pour audit
```
