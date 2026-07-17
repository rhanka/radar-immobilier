Tu es analyste produit. On te donne les critères de veille de Steve (client final d'un radar immobilier québécois) et un corpus de signaux réels détectés par le système. Ta mission N'EST PAS de scorer ou classer les signaux. Elle est de répondre à UNE question :

  « Qu'est-ce que Steve cherche, que ces signaux ne permettent pas encore de voir — et qu'est-ce qui est du bruit ? »

C'est une analyse de MANQUES et de BRUIT, pas un tri.

## Entrées (fichiers joints)
- vision_steve.md : les critères de Steve, verbatim. C'est la référence.
- contexte_chiffres.md : chiffres mesurés en prod. NE LES RECOMPTE PAS, cite-les.
- strate1_qualified.json : 732 signaux du vivier B (zonage∩résidentiel) = le cœur.
- strate2_rescue_ok.json : 29 PIIA/dérogations AVEC nb_unites_max (preuve de logements présente en champ).
- strate3_gisement.json : 120 signaux ÉCHANTILLON (40 PIIA sans champ + 80 dérogations mineures), tiré de 168 PIIA-sans-champ + 1622 dérog. mineures. C'est un échantillon : dis « sur l'échantillon », n'extrapole pas de total.

Champs d'un signal : id, ville, category, etape, nb_unites_max, intensite, descr, citation.

## RÈGLES DURES (non négociables)
1. Chaque affirmation chiffrée doit être soit tirée de contexte_chiffres.md, soit COMPTÉE par toi sur le corpus fourni (précise « sur les N du corpus »).
2. Chaque constat porte AU MOINS un `id` de signal réel en preuve. Zéro affirmation sans exemple.
3. Interdiction d'inventer ou d'estimer. Si tu ne peux pas mesurer, écris "non_mesuré".
4. Distingue toujours « l'info est absente » de « l'info est dans le texte mais pas dans un champ structuré » — c'est le cœur du sujet (levier graphify).

## SORTIE — un seul bloc JSON, ce schéma exact, rien d'autre autour :
{
  "couverture_criteres": [
    {"critere_steve": "<verbatim court>", "capte": "oui|partiel|non",
     "ou": "<champ ou mécanisme>", "n_avec": <int|"non_mesuré">, "n_sans": <int|"non_mesuré">,
     "preuve_ids": ["..."], "commentaire": "<1 phrase>"}
  ],
  "angles_morts": [
    {"critere_steve": "<verbatim>", "pourquoi_non_capte": "<...>", "preuve_ou_absence": "<...>"}
  ],
  "elements_complementaires": [
    {"quoi": "<donnée/champ/source à ajouter>", "pourquoi": "<...>",
     "deja_dans_le_texte": true|false, "cible": "graphify 3.4|geo|scraping|autre",
     "preuve_ids": ["<signaux où l'info est dans descr/citation mais pas en champ>"],
     "gain_estime": "<qualitatif, ex: débloque le rescue sur ~168 PIIA>"}
  ],
  "bruit": [
    {"type": "<catégorie de bruit>", "sur_echantillon": "<ex: 55/80 dérog. mineures>",
     "recuperable_par": "<graphify 3.4|jamais|autre>", "exemples_ids": ["..."]}
  ],
  "verdict_gisement": "<2-3 phrases: les PIIA-sans-champ et dérog. mineures sont-ils du bruit ou des vrais projets illisibles ? tranché sur preuves>",
  "top_3_leviers": ["<les 3 actions à plus fort impact, ordonnées>"]
}
