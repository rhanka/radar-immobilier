**Version de travail \| 2026-05-20**

+-----------------------------------------------------------------------+
| **Principe directeur**                                                |
|                                                                       |
| Le radar ne cherche pas seulement des terrains vacants. Il cherche    |
| des asymétries : un changement réglementaire, un lot sous-exploité,   |
| une contrainte mal comprise ou un catalyseur public qui peut          |
| transformer un terrain ordinaire en opportunité constructible.        |
+=======================================================================+
+-----------------------------------------------------------------------+

# 1. Vue d'ensemble du pipeline

Le pipeline fonctionne comme un entonnoir. Les signaux réglementaires
créent les hypothèses, l'ancrage foncier les relie à des lots concrets,
les contraintes filtrent les faux positifs, puis le marché et le
contexte stratégique déterminent si le timing justifie une action.

*La donnée foncière au Québec circule à travers cinq couches successives
avant d'atteindre l'analyse de potentiel :*

  -----------------------------------------------------------------------
  **Terrain physique réel** --- Le bien-fonds tel qu'il existe sur le sol

  **↓**

  **Cadastre** --- Numéro officiel du terrain (lot cadastral)

  **↓**

  **Registre foncier** --- Propriété et droits légaux

  **↓**

  **Municipalité** --- Zonage, taxes, permis

  **↓**

  **Développeur / acheteur** --- Analyse de potentiel
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  **Phase**           **Utilisation dans le radar**
  ------------------- ---------------------------------------------------
  **1. Signal         **Objectif :** Détecter les endroits où le cadre
  réglementaire**     municipal bouge ou devient négociable.\
                      **Sources :** Zonage, PPCMOI, avis publics,
                      procès-verbaux municipaux\
                      **Sortie :** Liste de zones ou dossiers chauds,
                      nature du changement, horizon politique.\
                      **Décision :** Le signal est-il assez concret pour
                      justifier un ancrage foncier?

  **2. Ancrage        **Objectif :** Relier le signal à des lots précis,
  foncier**           propriétaires, superficies et adresses.\
                      **Sources :** Cadastre, lots, adresses, rôles
                      d'évaluation, registre foncier\
                      **Sortie :** Fiche lot normalisée, géométrie,
                      propriétaire, usage, valeur municipale.\
                      **Décision :** Le lot est-il réel, localisable et
                      exploitable dans une hypothèse de projet?

  **3. Contraintes**  **Objectif :** Éliminer ou qualifier les lots
                      bloqués par des contraintes majeures.\
                      **Sources :** CPTAQ, zones inondables,
                      hydrographie, servitudes, contraintes MRC\
                      **Sortie :** Carte de contraintes, niveau de
                      blocage, conditions de mitigation.\
                      **Décision :** Le risque rend-il le lot non
                      constructible, négociable ou simplement plus
                      coûteux?

  **4. Enrichissement **Objectif :** Mesurer la traction réelle et la
  marché**            valeur économique autour du site.\
                      **Sources :** Transactions, permis, Centris/MLS,
                      JLR, évaluations\
                      **Sortie :** Comparables, dynamique de prix,
                      activité permis, pression de demande.\
                      **Décision :** Le marché soutient-il le potentiel
                      réglementaire détecté?

  **5. Contexte       **Objectif :** Situer le lot dans une trajectoire
  stratégique**       de croissance ou de requalification.\
                      **Sources :** StatCan, transport, infrastructures,
                      schémas MRC, plans municipaux\
                      **Sortie :** Narratif d'opportunité, catalyseurs de
                      valeur, horizon 3-10 ans.\
                      **Décision :** Existe-t-il un facteur de timing qui
                      peut créer une asymétrie d'information?

  **6. Scoring**      **Objectif :** Prioriser les terrains selon
                      potentiel, risque, timing, faisabilité et valeur.\
                      **Sources :** Tous les signaux consolidés\
                      **Sortie :** Score radar, recommandation d'action,
                      prochaines vérifications.\
                      **Décision :** Acheter, surveiller, qualifier avec
                      un expert, ou rejeter?
  -----------------------------------------------------------------------

# 2. Processus opérationnel

## Étape 1 --- Signal réglementaire

-   Surveiller les avis publics, projets de règlements, consultations,
    PPCMOI et procès-verbaux.

-   Extraire les mentions de densité, usage, hauteur, lotissement,
    stationnement, TOD, requalification et exceptions.

-   Classer le signal : modification officielle, intention politique,
    exception accordée, pression citoyenne ou simple bruit.

## Étape 2 --- Ancrage foncier

-   Identifier les lots touchés : numéro de lot, adresse normalisée,
    municipalité, superficie, forme et accès.

-   Croiser cadastre, Adresses Québec, rôle d'évaluation et registre
    foncier pour éviter les erreurs d'identité foncière.

-   Créer une fiche lot avec propriétaire, usage actuel, valeur
    municipale terrain/bâtiment et potentiel d'assemblage.

## Étape 3 --- Contraintes

-   Intersections géospatiales : CPTAQ, zone inondable, hydrographie,
    contraintes MRC, servitudes connues.

-   Distinguer les contraintes bloquantes, coûteuses, négociables et
    informatives.

-   Documenter l'incertitude : source, date, niveau de confiance et
    vérification humaine requise.

## Étape 4 --- Enrichissement marché

-   Comparer ventes, permis et inscriptions pour repérer les secteurs où
    la demande précède la réglementation.

-   Mesurer l'écart entre valeur municipale, transactions récentes et
    valeur potentielle selon scénario constructible.

-   Repérer les lots sous-utilisés : stationnements, friches, bâtiments
    bas, terrains excédentaires, coins stratégiques.

## Étape 5 --- Contexte stratégique

-   Ajouter démographie, ménages, revenu, transport, infrastructures,
    écoles, plans MRC et projets publics.

-   Chercher les catalyseurs : nouvelle desserte, corridor de transport,
    investissement municipal, requalification annoncée.

-   Traduire le contexte en thèse d'investissement courte et vérifiable.

## Étape 6 --- Scoring et décision

-   Attribuer un score de 0 à 5 par critère, avec preuve associée et
    niveau de confiance.

-   Prioriser les lots où potentiel et timing sont élevés, mais où la
    compétition n'a pas encore intégré l'information.

-   Produire une décision : rejeter, surveiller, qualifier avec expert,
    approcher propriétaire ou monter un dossier d'acquisition.

# 3. Modèle de scoring

Le scoring doit rester simple au départ : assez robuste pour prioriser,
assez transparent pour être auditable. Chaque score doit pointer vers
une preuve, une date et une source.

  ---------------------------------------------------------------------------
  **Critère**            **Poids**   **Lecture opérationnelle**
  ---------------------- ----------- ----------------------------------------
  **Potentiel            **30 %**    Usages, densité, exceptions possibles,
  réglementaire**                    alignement avec les intentions
                                     municipales.

  **Risque de            **20 %**    CPTAQ, inondation, hydrographie,
  contrainte**                       servitudes, contamination ou blocages
                                     connus.

  **Timing**             **20 %**    Avis publics, PPCMOI, consultations,
                                     investissements publics, fenêtres de
                                     négociation.

  **Faisabilité          **15 %**    Forme du lot, accès, superficie,
  foncière**                         assemblage, propriétaire, morcellement.

  **Valeur marché**      **15 %**    Comparables, permis, absorption, rareté,
                                     écart entre valeur municipale et valeur
                                     projetée.
  ---------------------------------------------------------------------------

+-----------------------------------------------------------------------+
| **Règle de décision**                                                 |
|                                                                       |
| Un lot devient une perle rare candidate lorsqu'il combine un score    |
| élevé de potentiel, un risque qualifiable, et un timing encore peu    |
| visible pour le marché. Un score élevé sans preuve récente doit être  |
| ramené en surveillance.                                               |
+=======================================================================+
+-----------------------------------------------------------------------+

# 4. Fiche opportunité minimale

Chaque opportunité qui passe le premier filtre devrait avoir une fiche
courte et standardisée :

-   Identité : lot, adresse, municipalité, propriétaire, superficie,
    usage actuel.

-   Signal : source réglementaire, date, extrait utile, niveau de
    confiance.

-   Potentiel : usages permis ou possibles, densité, assemblage,
    scénario constructible.

-   Contraintes : CPTAQ, inondation, hydrographie, servitudes, risques
    environnementaux.

-   Marché : comparables, permis récents, valeur municipale, prix
    demandé ou estimé.

-   Action : prochaine vérification, expert requis, stratégie de
    contact, échéance.

# 5. Gouvernance des données

+-----------------------------------------------------------------------+
| **Contrôle qualité**                                                  |
|                                                                       |
| Ne jamais laisser un score élevé sans trace de preuve. Les sources    |
| publiques peuvent être partielles, caviardées, désynchronisées ou     |
| présentées en PDF. Chaque donnée utilisée pour une décision doit      |
| conserver sa source, sa date de collecte et son mode d'obtention.     |
+=======================================================================+
+-----------------------------------------------------------------------+

-   Séparer les données publiques gratuites, les données privées
    payantes et les informations à vérifier manuellement.

-   Automatiser fortement les couches stables : Données Québec, StatCan,
    géocodage, permis et intersections géospatiales.

-   Garder une étape humaine pour les décisions lourdes : registre
    foncier, interprétation réglementaire, servitudes, avis juridique.

-   Utiliser OCR + LLM pour accélérer la lecture des PDF municipaux,
    mais conserver l'extrait source et la page.

# Annexe A --- Rôle des sources dans le radar

  -----------------------------------------------------------------------
  **Source**          **Phase            **Rôle dans le radar**
                      d'utilité**        
  ------------------- ------------------ --------------------------------
  **Cadastre /        Base foncière      Identifier les lots, formes,
  Infolot**                              superficies, limites

  **Registre          Due diligence /    Propriétaires, actes,
  foncier**           ownership          hypothèques, droits

  **Données Québec**  Enrichissement     Couches ouvertes : inondation,
                      géospatial         zonage, adresses, rôles, permis

  **Rôles             Pré-scoring        Valeur municipale, usage,
  d'évaluation        financier          bâtiments, terrain
  foncière**                             

  **Zonage            Signal             Usages permis, densité,
  municipal**         réglementaire      contraintes
                      principal          

  **Plans de zonage / Analyse            Comprendre le potentiel réel par
  grilles**           réglementaire      zone
                      détaillée          

  **PPCMOI**          Signal faible /    Détecter secteurs où la ville
                      opportunité        accepte des exceptions

  **Procès-verbaux    Veille stratégique Détecter intentions politiques,
  municipaux**                           changements futurs

  **Avis publics      Détection de       Alertes sur règlements,
  municipaux**        changement         consultations, modifications

  **Permis de         Validation marché  Voir où l'activité immobilière
  construction**      / traction         accélère

  **CPTAQ / zone      Filtre de          Exclure ou qualifier les lots
  agricole**          contrainte majeure agricoles protégés

  **Décisions CPTAQ** Signal de          Repérer autorisations,
                      déverrouillage     exclusions, usages permis

  **Zones inondables  Filtre de risque   Identifier les terrains à risque
  BDZI**                                 ou non développables

  **Hydrographie      Contrainte         Proximité cours d'eau, bandes
  GRHQ**              environnementale   riveraines potentielles

  **Adresses Québec** Géocodage /        Relier adresses, lots,
                      normalisation      bâtiments, municipalités

  **Orthophotos /     Validation         Voir occupation réelle, friches,
  imagerie**          visuelle           stationnements, terrains vacants

  **Transactions      Analyse valeur     Comparables, tendances de prix,
  immobilières**      marché             timing d'achat

  **JLR**             Enrichissement     Historique de ventes,
                      transactionnel     hypothèques, propriétaires
                                         enrichis

  **Centris / MLS**   Analyse marché     Prix demandé, absorption,
                      résidentiel        concurrence

  **StatCan**         Contexte           Démographie, revenus,
                      socio-économique   croissance, ménages

  **Transport /       Catalyseur de      Proximité transport, routes,
  infrastructures**   valeur             REM, projets publics

  **Schémas           Vision long terme  Identifier secteurs de
  d'aménagement MRC**                    croissance et requalification
  -----------------------------------------------------------------------

# Annexe B --- Accès, coût et automatisation des sources

Cette annexe sert à planifier l'automatisation. Les sources à forte
automatisation alimentent le radar en continu; les sources à difficulté
élevée restent des points de contrôle ou des lots de traitement assisté.

  ------------------------------------------------------------------------------------------------------------------------------------------------
  **Source**          **URL / accès**              **API / données**   **Public / **Coût**            **Auto.**     **Méthode**        **Diff.**
                                                                       privé**                                                         
  ------------------- ---------------------------- ------------------- ---------- ------------------- ------------- ------------------ -----------
  **Cadastre /        Québec.ca / Infolot          Pas API publique    Public     Gratuit             Partielle     manuel + scraping  Élevée
  Infolot**                                        claire                         consultation                      prudent            

  **Registre          registrefoncier.gouv.qc.ca   Non API publique    Public     1,50 \$/doc depuis  Faible à      manuel /           Élevée
  foncier**                                                            payant     1 avr. 2026         moyenne       fournisseur privé  

  **Données Québec**  donneesquebec.ca             Oui                 Public     Gratuit             Forte         API + ETL          Faible
                                                   CKAN/API/fichiers                                                                   

  **Rôles             Données Québec               GeoJSON/SHP/ZIP     Public     Gratuit             Forte         téléchargement +   Moyenne
  d'évaluation                                                         caviardé                                     géospatial         
  foncière**                                                                                                                           

  **Zonage            Données Québec + villes      Variable            Public     Gratuit             Moyenne       API si dispo,      Moyenne à
  municipal**                                                                                                       sinon scraping/PDF élevée

  **Plans de zonage / Sites municipaux             Rarement API        Public     Gratuit             Moyenne       scraping + OCR +   Élevée
  grilles**                                                                                                         LLM                

  **PPCMOI**          Sites municipaux / PV / avis Rarement API        Public     Gratuit             Moyenne       veille web + LLM   Élevée
                      publics                                                                                                          

  **Procès-verbaux    Sites municipaux             Non standard        Public     Gratuit             Moyenne       scraping PDF + LLM Élevée
  conseils                                                                                                                             
  municipaux**                                                                                                                         

  **Avis publics      Sites municipaux             Variable            Public     Gratuit             Forte si      scraping + alertes Moyenne
  municipaux**                                                                                        HTML/RSS                         

  **Permis de         Données Québec / villes      CSV/JSON/GeoJSON    Public     Gratuit             Forte         API/fichiers       Faible à
  construction**                                   selon ville                                                                         moyenne

  **CPTAQ / zone      CPTAQ + Données Québec       SHP / moteur        Public     Gratuit             Forte pour    géospatial +       Moyenne
  agricole**                                       recherche                                          cartes        dossiers           

  **Décisions CPTAQ** CPTAQ / Données Québec       SHP + recherche     Public     Gratuit             Moyenne       download + LLM     Moyenne
                                                   dossiers                                                         décisions          

  **Zones inondables  Données Québec               Données             Public     Gratuit             Forte         intersection       Moyenne
  BDZI**                                           géospatiales                                                     géospatiale        

  **Hydrographie      Données Québec               Geo                 Public     Gratuit             Forte         géospatial         Faible
  GRHQ**                                                                                                                               

  **Adresses Québec** Données Québec / IGO         géocodage/API IGO   Public     Gratuit             Forte         géocodage          Faible

  **Orthophotos /     Données Québec               WMS/GPKG/FGDB selon Public     Gratuit             Moyenne       GIS / vision       Moyenne
  imagerie**                                       cas                                                                                 

  **Transactions      Registre / JLR /             Privé souvent       Mixte      Payant              Forte via     API/exports        Moyenne
  immobilières**      Centris-like                                                                    fournisseur   commerciaux        

  **JLR**             jlr.ca                       Données colligées   Privé      Payant              Forte si      API/export/BI      Faible à
                                                   RFQ                                                entente                          moyenne

  **Centris / MLS**   Centris / courtiers          Privé               Privé      Payant/restrictif   Faible sans   partenariat        Élevée
                                                                                                      entente                          

  **Données           StatCan                      API                 Public     Gratuit             Forte         API                Faible
  socio-éco**                                                                                                                          

  **Transport /       MTQ, ARTM, villes            Variable            Public     Gratuit             Moyenne       API/fichiers/PDF   Moyenne
  infrastructures**                                                                                                                    

  **Schémas           MRC / PDF                    Rarement API        Public     Gratuit             Moyenne       PDF + LLM          Élevée
  d'aménagement MRC**                                                                                                                  
  ------------------------------------------------------------------------------------------------------------------------------------------------
