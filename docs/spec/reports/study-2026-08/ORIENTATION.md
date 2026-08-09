# Orientation proposée — rapport de période Radar Immobilier

Période : 2026-07-13 → 2026-08-09  
Statut : proposition à valider avant consolidation du rapport final.  
Périmètre : **IMMO** (produit radar client) et **GEO** (données, extraction, zonage,
lots, grilles et réconciliation).

## Angle de synthèse proposé

**Présenter la période comme le passage d'un socle large à une chaîne de décision plus
crédible, visible et honnête en production.**

Le récit ne serait pas une chronologie de commits. Il montrerait les classes de problèmes
fermées et les capacités désormais disponibles :

1. **La donnée est davantage qualifiable et auditable.** GEO a élargi et structuré les
   couches utiles — zonage, lots, normes, provenance — pendant qu'IMMO a renforcé les
   contrats de preuve, l'affichage des limites et la réconciliation. Le passage de
   l'ontologie v2.3 à la fondation v3.4 doit être raconté comme un durcissement de la
   chaîne de vérité, pas comme une succession de versions.
2. **Le radar devient un outil de navigation client concret.** La carte relie désormais
   ville → zone → lot selon un parcours strict, conserve la zone active, retire un score
   de potentiel non fondé et fonctionne mieux sur mobile. Ce palier est effectivement
   servi sur `immo.sent-tech.ca` au 9 août.
3. **La valeur est démontrée sur deux axes qui restent indissociables.** La couverture
   compare toujours le **Focus 30** à la **Province ≈1104**, sans addition; la profondeur
   compare les **~33 opportunités témoins [effectif — banc de référence]** suivies
   signal → document → zone → grille → lot à la cible **>5000 couples ville×signal
   [projeté]**.
4. **La transparence est elle-même un acquis produit.** Les chiffres non remesurés restent
   datés ou marqués `[en attente]`; une collection présente n'est pas assimilée à une
   donnée complète, et un signal sans preuve n'est pas promu en opportunité acquise.

Le titre éditorial suggéré est :

> **Du signal au lot : un radar client désormais navigable, appuyé sur une chaîne de
> preuve qui se consolide**

Le rapport devrait rester équilibré : environ la moitié sur la capacité client IMMO et
la moitié sur le substrat et la preuve GEO, avec les chiffres en appui plutôt qu'en fil
conducteur. Le 9 août serait présenté comme un **palier de mise en production vérifié**,
pas comme le premier lancement de l'application.

## Questions directrices à trancher

1. **Quel message doit ouvrir le rapport : le palier produit du 9 août ou la consolidation
   de la chaîne de preuve?** Proposition : ouvrir sur l'expérience client désormais
   navigable, puis montrer que sa crédibilité vient des travaux GEO et de preuve.

2. **Jusqu'où détailler le passage v2.3 → v3.4?** Proposition : un encadré court sur la
   finalité — préserver les propriétés métier, rendre les entrées et sorties rejouables,
   transporter la provenance — sans détailler les phases, scripts et incidents de jobs.

3. **Quel équilibre IMMO/GEO souhaite-t-on rendre visible?** Proposition : 50/50 dans le
   corps du rapport, mais une synthèse exécutive organisée autour d'une seule chaîne
   signal → preuve → zone → lot → décision client, afin d'éviter deux bilans juxtaposés.

4. **Met-on en avant le 9 août comme un « go-live »?** Proposition : parler de **palier
   produit vérifié en production**. Les PR #499–#501 sont fusionnées et le bundle servi
   porte le SHA de #501, mais l'application et son CD existaient déjà avant cette date.

5. **Quelle place donner aux deux bancs E2E?** Proposition : conserver un bloc visible
   dès le résumé — Focus 30 vs Province ≈1104 pour la couverture ; ~33 témoins
   **[effectif — banc de référence]** vs >5000 ville×signal **[projeté]** pour la profondeur —
   puis rattacher chaque limite au banc qu'elle touche.

6. **Quelles limites assumer explicitement plutôt que les diluer?** Proposition : nommer
   en priorité la qualité variable des grilles et de leur millésime, la provenance exacte
   encore incomplète, le rappel/précision signal↔zone non remesuré sur toute la fenêtre,
   l'absence de propriétaire par gouvernance, et l'écart entre présence d'une collection
   et complétion réglementaire réelle.

## Socle factuel déjà vérifié pour le premier jet

- Track global au 2026-08-09 : **92/176 (52 %) [effectif]**, 9 workpackages, baseline
  `43c873e0d2cf`; la fenêtre contient **256/800 événements [effectif]**.
- Historique GitHub Radar sur la fenêtre : **95 PR fusionnées [effectif]**.
- Historique `geo/origin/main` sur la fenêtre : **1668 commits [effectif]**.
- API GEO, mesure exacte par slug canonique au 2026-08-09 : zonage **29/30** vs
  **868/1104**; lots **30/30** vs **1102/1104**; collection canonique de normes
  présente **29/30** vs **596/1104** **[effectif]**. La présence d'une collection ne
  préjuge ni de sa complétude ni du bon millésime.
- Production IMMO au 2026-08-09 : `build.json` sert `e27baeb`, merge de la PR #501;
  les PR #499 et #500 la précèdent dans l'historique de `main` **[effectif]**.

Les mesures PV/signaux/citations et rappel/précision qui n'ont pas pu être relues sur la
production authentifiée resteront datées de leur dernière mesure ou porteront un TODO de
remesure explicite dans le brouillon.
