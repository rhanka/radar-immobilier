# Chiffres mesurés en prod (radar_postgres, 2026-07-17) — À NE PAS RECOMPTER

- Total signaux (Signal + DesignationEvent) : 7221
- PIIA : 191, dont 23 seulement avec nb_unites_max renseigné (168 sans)
- Dérogations (toutes) : 333
- Dérogations mineures : 1622
- Vivier A (z∩m∩p, filtre historique) : 32 signaux / 31 villes
- Transition z|p (zonage∩précoce, sans multi4) : 849 signaux / 259 villes → retirer `m` ajoute 817 signaux
- Vivier B qualifié (zonage∩résidentiel, contrat vivier_v2) : ~914 signaux / 341 villes

# Le corpus fourni (3 strates)
- strate1_qualified.json : 732 signaux du vivier B (zonage∩résidentiel) — le cœur.
- strate2_rescue_ok.json : 29 PIIA/dérogations AVEC nb_unites_max (la preuve de logements existe en champ).
- strate3_gisement.json : 120 signaux ÉCHANTILLON du gisement à trancher (40 PIIA sans champ + 80 dérogations mineures). C'est un ÉCHANTILLON de 1622 dérog. mineures + 168 PIIA sans champ — ne pas extrapoler un compte total depuis l'échantillon, dire "sur l'échantillon".
