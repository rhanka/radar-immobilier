# Validation exhaustive — couverture des champs lot par ville

Mesure LIVE de l'API geo OGC (2026-07-05), échantillon 20 lots/collection (estimé).
Collections qc-lots mesurées : **187** sur 1102 listées (914 en erreur/timeout, 1 vides).
Collections de grilles servies `qc-zonage-norms-*` : **519** (batch geo en cours).


> ⚠️ **PORTÉE / HONNÊTETÉ.** Ce rapport est un balayage CLIENT (curl) des collections
> geo. L'API geo **limite les rafales** : sur 1102 collections, seules **187 ont
> répondu de façon fiable** (914 timeouts) — donc ces agrégats sont **INDICATIFS,
> PAS exhaustifs** (échantillon biaisé vers les collections rapides).
>
> **La vraie couverture exhaustive par ville se lit dans la vue Sources** (indicateurs
> Superficie/Adresse/CP/Normes, PR #353) : ils calculent la couverture de CHAQUE ville
> **côté serveur, à la demande**. Pour un agrégat province fiable en un coup, la bonne
> voie = un **batch serveur** (l'API `source-coverage` itérant QC_MUNICIPALITIES) ou un
> **agrégat fourni par geo**, pas un balayage client. Recommandation : ne pas se fier aux
> chiffres ci-dessous comme vérité province, mais aux indicateurs par ville.

## Agrégats (INDICATIFS — échantillon 187/1102)
| Champ | ≥90% | ≥50% | =0% |
|---|---:|---:|---:|
| Superficie (surface_m2) | 55 | 55 | 132 |
| Adresse | 44 | 55 | 132 |
| Code postal | 55 | 55 | 132 |
| Normes lot (hauteur_max) | 6 | 11 | 176 |

**Lecture** : sur les 187 collections ayant répondu, la plupart sont à 0% (non encore enrichies côté geo) ; les 4 villes cibles + focus sont à ~100%.

## Villes à 0% de superficie — backlog d'enrichissement geo

abercorn, alleyn-et-cawood, alma, ange-gardien, aumond, baie-johan-beetz, bearn, begin, belcourt, belleterre, beloeil, bethanie, blanc-sablon, boileau, saint-luc-de-vincennes, saint-ludger-de-milot, saint-magloire, saint-majorique-de-grantham, saint-malachie, saint-malo, saint-marc-de-figuery, saint-marc-des-carrieres, saint-marc-sur-richelieu, saint-marcel, saint-marcel-de-richelieu, saint-marcellin, saint-martin, saint-mathias-sur-richelieu, saint-mathieu-de-rioux, saint-mathieu-dharricana, saint-mathieu-du-parc, saint-maurice, saint-maxime-du-mont-louis, saint-medard, saint-michel, saint-michel-de-bellechasse, saint-michel-des-saints, saint-modeste, saint-moise, saint-narcisse, saint-narcisse-de-beaurivage, saint-narcisse-de-rimouski, saint-nazaire, saint-nazaire-dacton, saint-nazaire-de-dorchester, saint-neree-de-bellechasse, saint-noel, saint-norbert, saint-norbert-darthabaska, saint-octave-de-metis, saint-omer, saint-onesime-dixworth, saint-ours, saint-pacome, saint-pamphile, saint-pascal, saint-patrice-de-beaurivage, saint-patrice-de-sherrington, saint-paul, saint-paul-dabbotsford, saint-paul-de-la-croix, saint-paul-de-lile-aux-noix, saint-paul-de-montminy, saint-paulin, saint-philemon, saint-philibert, saint-philippe-de-neri, saint-pie, saint-pie-de-guire, saint-pierre, saint-pierre-baptiste, saint-pierre-de-broughton, saint-pierre-de-la-riviere-du-sud, saint-pierre-de-lile-dorleans, saint-pierre-les-becquets, saint-placide, saint-polycarpe, saint-prime, saint-prosper, saint-prosper-de-champlain, saint-raphael, saint-raymond, saint-remi, saint-remi-de-tingwick, saint-rene, saint-rene-de-matane, saint-robert, saint-roch-de-lachigan, saint-roch-de-mekinac, saint-roch-de-richelieu, saint-roch-des-aulnaies, saint-roch-ouest, saint-rosaire, saint-samuel, saint-sebastien--le-granit, saint-sebastien--le-haut-richelieu, saint-severe, saint-severin--mekinac, saint-simeon--bonaventure, saint-simeon--charlevoix-est, saint-simon, saint-simon-de-rimouski, saint-simon-les-mines, saint-sixte, saint-stanislas--des-chenaux, saint-stanislas--maria-chapdelaine, saint-stanislas-de-kostka, saint-sulpice, saint-sylvere, saint-sylvestre, saint-telesphore, saint-tharcisius, saint-theodore-dacton, saint-theophile, saint-thomas, saint-thomas-didyme, saint-thuribe, saint-tite-des-caps, saint-ubalde, saint-ulric, saint-urbain, saint-urbain-premier, saint-valentin, saint-valere, saint-valerien, saint-valerien-de-milton, saint-vallier, saint-venant-de-paquette, saint-vianney, saint-wenceslas, saint-zenon, saint-zenon-du-lac-humqui

## Détail par ville

| Ville | Superficie | Adresse | CP | Normes lot |
|---|---:|---:|---:|---:|
| abercorn | 0% | 0% | 0% | 0% |
| alleyn-et-cawood | 0% | 0% | 0% | 0% |
| alma | 0% | 0% | 0% | 0% |
| ange-gardien | 0% | 0% | 0% | 0% |
| aumond | 0% | 0% | 0% | 0% |
| baie-johan-beetz | 0% | 0% | 0% | 0% |
| bearn | 0% | 0% | 0% | 0% |
| begin | 0% | 0% | 0% | 0% |
| belcourt | 0% | 0% | 0% | 0% |
| belleterre | 0% | 0% | 0% | 0% |
| beloeil | 0% | 0% | 0% | 0% |
| bethanie | 0% | 0% | 0% | 0% |
| blanc-sablon | 0% | 0% | 0% | 0% |
| boileau | 0% | 0% | 0% | 0% |
| saint-luc-de-vincennes | 0% | 0% | 0% | 0% |
| saint-ludger-de-milot | 0% | 0% | 0% | 0% |
| saint-magloire | 0% | 0% | 0% | 0% |
| saint-majorique-de-grantham | 0% | 0% | 0% | 0% |
| saint-malachie | 0% | 0% | 0% | 0% |
| saint-malo | 0% | 0% | 0% | 0% |
| saint-marc-de-figuery | 0% | 0% | 0% | 0% |
| saint-marc-des-carrieres | 0% | 0% | 0% | 0% |
| saint-marc-sur-richelieu | 0% | 0% | 0% | 0% |
| saint-marcel | 0% | 0% | 0% | 0% |
| saint-marcel-de-richelieu | 0% | 0% | 0% | 0% |
| saint-marcellin | 0% | 0% | 0% | 0% |
| saint-martin | 0% | 0% | 0% | 0% |
| saint-mathias-sur-richelieu | 0% | 0% | 0% | 0% |
| saint-mathieu-de-rioux | 0% | 0% | 0% | 0% |
| saint-mathieu-dharricana | 0% | 0% | 0% | 0% |
| saint-mathieu-du-parc | 0% | 0% | 0% | 0% |
| saint-maurice | 0% | 0% | 0% | 0% |
| saint-maxime-du-mont-louis | 0% | 0% | 0% | 0% |
| saint-medard | 0% | 0% | 0% | 0% |
| saint-michel | 0% | 0% | 0% | 0% |
| saint-michel-de-bellechasse | 0% | 0% | 0% | 0% |
| saint-michel-des-saints | 0% | 0% | 0% | 0% |
| saint-modeste | 0% | 0% | 0% | 0% |
| saint-moise | 0% | 0% | 0% | 0% |
| saint-narcisse | 0% | 0% | 0% | 0% |
| saint-narcisse-de-beaurivage | 0% | 0% | 0% | 0% |
| saint-narcisse-de-rimouski | 0% | 0% | 0% | 0% |
| saint-nazaire | 0% | 0% | 0% | 0% |
| saint-nazaire-dacton | 0% | 0% | 0% | 0% |
| saint-nazaire-de-dorchester | 0% | 0% | 0% | 0% |
| saint-neree-de-bellechasse | 0% | 0% | 0% | 0% |
| saint-noel | 0% | 0% | 0% | 0% |
| saint-norbert | 0% | 0% | 0% | 0% |
| saint-norbert-darthabaska | 0% | 0% | 0% | 0% |
| saint-octave-de-metis | 0% | 0% | 0% | 0% |
| saint-omer | 0% | 0% | 0% | 0% |
| saint-onesime-dixworth | 0% | 0% | 0% | 0% |
| saint-ours | 0% | 0% | 0% | 0% |
| saint-pacome | 0% | 0% | 0% | 0% |
| saint-pamphile | 0% | 0% | 0% | 0% |
| saint-pascal | 0% | 0% | 0% | 0% |
| saint-patrice-de-beaurivage | 0% | 0% | 0% | 0% |
| saint-patrice-de-sherrington | 0% | 0% | 0% | 0% |
| saint-paul | 0% | 0% | 0% | 0% |
| saint-paul-dabbotsford | 0% | 0% | 0% | 0% |
| saint-paul-de-la-croix | 0% | 0% | 0% | 0% |
| saint-paul-de-lile-aux-noix | 0% | 0% | 0% | 0% |
| saint-paul-de-montminy | 0% | 0% | 0% | 0% |
| saint-paulin | 0% | 0% | 0% | 0% |
| saint-philemon | 0% | 0% | 0% | 0% |
| saint-philibert | 0% | 0% | 0% | 0% |
| saint-philippe-de-neri | 0% | 0% | 0% | 0% |
| saint-pie | 0% | 0% | 0% | 0% |
| saint-pie-de-guire | 0% | 0% | 0% | 0% |
| saint-pierre | 0% | 0% | 0% | 0% |
| saint-pierre-baptiste | 0% | 0% | 0% | 0% |
| saint-pierre-de-broughton | 0% | 0% | 0% | 0% |
| saint-pierre-de-la-riviere-du-sud | 0% | 0% | 0% | 0% |
| saint-pierre-de-lile-dorleans | 0% | 0% | 0% | 0% |
| saint-pierre-les-becquets | 0% | 0% | 0% | 0% |
| saint-placide | 0% | 0% | 0% | 0% |
| saint-polycarpe | 0% | 0% | 0% | 0% |
| saint-prime | 0% | 0% | 0% | 0% |
| saint-prosper | 0% | 0% | 0% | 0% |
| saint-prosper-de-champlain | 0% | 0% | 0% | 0% |
| saint-raphael | 0% | 0% | 0% | 0% |
| saint-raymond | 0% | 0% | 0% | 0% |
| saint-remi | 0% | 0% | 0% | 0% |
| saint-remi-de-tingwick | 0% | 0% | 0% | 0% |
| saint-rene | 0% | 0% | 0% | 0% |
| saint-rene-de-matane | 0% | 0% | 0% | 0% |
| saint-robert | 0% | 0% | 0% | 0% |
| saint-roch-de-lachigan | 0% | 0% | 0% | 0% |
| saint-roch-de-mekinac | 0% | 0% | 0% | 0% |
| saint-roch-de-richelieu | 0% | 0% | 0% | 0% |
| saint-roch-des-aulnaies | 0% | 0% | 0% | 0% |
| saint-roch-ouest | 0% | 0% | 0% | 0% |
| saint-rosaire | 0% | 0% | 0% | 0% |
| saint-samuel | 0% | 0% | 0% | 0% |
| saint-sebastien--le-granit | 0% | 0% | 0% | 0% |
| saint-sebastien--le-haut-richelieu | 0% | 0% | 0% | 0% |
| saint-severe | 0% | 0% | 0% | 0% |
| saint-severin--mekinac | 0% | 0% | 0% | 0% |
| saint-simeon--bonaventure | 0% | 0% | 0% | 0% |
| saint-simeon--charlevoix-est | 0% | 0% | 0% | 0% |
| saint-simon | 0% | 0% | 0% | 0% |
| saint-simon-de-rimouski | 0% | 0% | 0% | 0% |
| saint-simon-les-mines | 0% | 0% | 0% | 0% |
| saint-sixte | 0% | 0% | 0% | 0% |
| saint-stanislas--des-chenaux | 0% | 0% | 0% | 0% |
| saint-stanislas--maria-chapdelaine | 0% | 0% | 0% | 0% |
| saint-stanislas-de-kostka | 0% | 0% | 0% | 0% |
| saint-sulpice | 0% | 0% | 0% | 0% |
| saint-sylvere | 0% | 0% | 0% | 0% |
| saint-sylvestre | 0% | 0% | 0% | 0% |
| saint-telesphore | 0% | 0% | 0% | 0% |
| saint-tharcisius | 0% | 0% | 0% | 0% |
| saint-theodore-dacton | 0% | 0% | 0% | 0% |
| saint-theophile | 0% | 0% | 0% | 0% |
| saint-thomas | 0% | 0% | 0% | 0% |
| saint-thomas-didyme | 0% | 0% | 0% | 0% |
| saint-thuribe | 0% | 0% | 0% | 0% |
| saint-tite-des-caps | 0% | 0% | 0% | 0% |
| saint-ubalde | 0% | 0% | 0% | 0% |
| saint-ulric | 0% | 0% | 0% | 0% |
| saint-urbain | 0% | 0% | 0% | 0% |
| saint-urbain-premier | 0% | 0% | 0% | 0% |
| saint-valentin | 0% | 0% | 0% | 0% |
| saint-valere | 0% | 0% | 0% | 0% |
| saint-valerien | 0% | 0% | 0% | 0% |
| saint-valerien-de-milton | 0% | 0% | 0% | 0% |
| saint-vallier | 0% | 0% | 0% | 0% |
| saint-venant-de-paquette | 0% | 0% | 0% | 0% |
| saint-vianney | 0% | 0% | 0% | 0% |
| saint-wenceslas | 0% | 0% | 0% | 0% |
| saint-zenon | 0% | 0% | 0% | 0% |
| saint-zenon-du-lac-humqui | 0% | 0% | 0% | 0% |
| acton-vale | 100% | 100% | 100% | 0% |
| adstock | 100% | 100% | 100% | 0% |
| albanel | 100% | 100% | 100% | 0% |
| albertville | 100% | 90% | 100% | 100% |
| amherst | 100% | 100% | 100% | 0% |
| amos | 100% | 100% | 100% | 0% |
| amqui | 100% | 90% | 100% | 0% |
| armagh | 100% | 95% | 100% | 0% |
| arundel | 100% | 100% | 100% | 75% |
| ascot-corner | 100% | 80% | 100% | 0% |
| aston-jonction | 100% | 90% | 100% | 0% |
| auclair | 100% | 90% | 100% | 0% |
| audet | 100% | 100% | 100% | 0% |
| authier | 100% | 100% | 100% | 0% |
| authier-nord | 100% | 100% | 100% | 0% |
| ayers-cliff | 100% | 90% | 100% | 0% |
| baie-comeau | 100% | 95% | 100% | 0% |
| baie-des-sables | 100% | 85% | 100% | 0% |
| baie-du-febvre | 100% | 95% | 100% | 0% |
| baie-durfe | 100% | 100% | 100% | 0% |
| baie-saint-paul | 100% | 100% | 100% | 0% |
| baie-sainte-catherine | 100% | 85% | 100% | 10% |
| baie-trinite | 100% | 100% | 95% | 100% |
| barkmere | 100% | 100% | 100% | 0% |
| barnston-ouest | 100% | 85% | 100% | 0% |
| barraute | 100% | 80% | 100% | 0% |
| batiscan | 100% | 100% | 100% | 0% |
| beaconsfield | 100% | 85% | 100% | 0% |
| beauceville | 100% | 75% | 100% | 0% |
| beauharnois | 100% | 95% | 100% | 0% |
| beaulac-garthby | 100% | 95% | 100% | 0% |
| beaumont | 100% | 85% | 100% | 0% |
| beaupre | 100% | 95% | 100% | 40% |
| becancour | 100% | 100% | 100% | 0% |
| bedford--brome-missisquoi | 100% | 90% | 100% | 0% |
| bedford--brome-missisquoi--2 | 100% | 100% | 100% | 0% |
| berry | 100% | 85% | 100% | 0% |
| berthier-sur-mer | 100% | 90% | 100% | 0% |
| berthierville | 100% | 95% | 100% | 35% |
| biencourt | 100% | 90% | 100% | 0% |
| bois-des-filion | 100% | 100% | 100% | 0% |
| bois-franc | 100% | 95% | 100% | 0% |
| saint-lucien | 100% | 100% | 100% | 0% |
| saint-ludger | 100% | 90% | 100% | 0% |
| saint-mathieu | 100% | 100% | 100% | 100% |
| saint-mathieu-de-beloeil | 100% | 100% | 100% | 0% |
| saint-michel-du-squatec | 100% | 80% | 100% | 0% |
| saint-odilon-de-cranbourne | 100% | 100% | 100% | 25% |
| saint-philippe | 100% | 100% | 100% | 40% |
| saint-pierre-de-lamy | 100% | 85% | 100% | 0% |
| saint-robert-bellarmin | 100% | 90% | 100% | 0% |
| saint-romain | 100% | 90% | 100% | 0% |
| saint-sauveur | 100% | 100% | 100% | 100% |
| saint-severin--beauce-centre | 100% | 90% | 100% | 0% |
| saint-tite | 100% | 90% | 100% | 70% |
