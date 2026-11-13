# Annotation C — point de reprise durable

L’annotation indépendante est terminée. D3 reste en cours.
La référence finale ne doit pas être annoncée avant la fin de D3 et ses contrôles.

- Début initial : 13/11/2026, 21:26:20 UTC.
- Reprise : 21:54:42 UTC environ.
- Fin de l’annotation : 22:12:55 UTC.
- Durée écoulée : 46 min 35 s, interruption comprise.
- Durée de la reprise : environ 18 min 14 s.
- Astra medium : 100 départs, 92 réponses, 8 interruptions sans rejeu.
- Opus 5.5 medium : 100 départs, 92 réponses, 8 interruptions sans rejeu.
- Aucune reprise de quota. Aucun refus de compte pendant l’annotation.
- Quota hebdomadaire Codex : 27 % au départ, 27 % à la reprise, 29 % à dix minutes, 31 % après.
- Quota hebdomadaire Claude après : 62 %. La mesure avant départ manque.

Le rapprochement porte sur les 676 actes B. Les 43 cas neutres restent séparés.
Il donne 620 désaccords D3 : 340 en mise au point et 280 en aveugle.
Ils incluent les omissions, les votes invalides et les codes différents.
Les inventaires hors B restent privés et hors du support D1.

Le kappa conventionnel vaut 0,613265. L’accord brut vaut 90,9763 %.
Il inclut 556 doubles Non classés. L’accord validé ne vaut que 8,2840 %.
Un double Non classé reste un désaccord D3. Ce n’est pas un consensus utilisable.

| Classe | Astra | Opus | Même classe | Accord symétrique |
|---|---:|---:|---:|---:|
| P | 1 | 1 | 1 | 100 % |
| S | 2 | 3 | 2 | 80 % |
| Écarté | 109 | 63 | 56 | 65,1163 % |
| Non classé | 564 | 609 | 556 | 94,7997 % |

Les contrôles relèvent 1 046 votes à citation ou page invalide, et 481 ambiguïtés.
Ces compteurs concernent l’inventaire complet. Ils ne sont pas des supports B.
Les motifs peuvent se cumuler sur le même vote.

Incident de reprise : le staging Git a échoué. Le dispatcher a été lancé avant
le commit de reprise. Le commit a ensuite été enregistré après escalade.
Cet écart de séquencement est déclaré. Aucun prompt d’annotation n’a changé.

Suivi : `make -f tools/classif/1passe/ops.mk status ENV=test-classif-1passe`.
Les données par acte restent privées. Les actes aveugles restent scellés REFC1.
