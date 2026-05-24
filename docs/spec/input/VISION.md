CHOIX DE LA VILLE : 
Salaberry-de-Valleyfield

RADAR IMMOBILIER IA — CAHIER DE VISION COMPLET



1. Vision générale du projet
Le projet vise à développer un radar immobilier intelligent automatisé capable de surveiller quotidiennement les documents municipaux publiés par les villes afin d’identifier rapidement des opportunités de densification immobilière résidentielle.
L’objectif est de détecter, le plus tôt possible, les signaux indiquant :
des changements réglementaires; 
des assouplissements urbanistiques; 
des ouvertures municipales à la densification; 
des expansions futures du tissu urbain. 
Le système doit agir comme un outil de veille avancé permettant d’identifier des opportunités avant qu’elles deviennent visibles pour le marché.






2. Structure du projet
Phase 1 — Radar immobilier automatisé (priorité actuelle)
Développer un moteur IA capable de :
Scanner automatiquement les documents municipaux; 
Lire et analyser les contenus (texte, PDF, etc.); 
Analyser les vidéos municipales lorsque disponibles; 
Détecter les éléments liés à la densification résidentielle; 
Relier les informations entre elles (règlements, avis, PV); 
Classer les opportunités selon un système de score; 
Générer des alertes et fiches d’opportunités; 
Construire une mémoire des dossiers dans le temps. 

Phase 2 — Carte interactive (future phase)
Intégration des données dans une carte interactive; 
Visualisation des opportunités par ville et par zone; 
Suivi des secteurs en transformation; 
Identification des zones à fort potentiel de densification. 


















3. Objectif central
DENSIFICATION URBAINE
Le système doit détecter tout ce qui indique qu’une ville :
augmente la densité permise; 
assouplit son zonage; 
permet plus de logements; 
transforme des secteurs existants; 
étend son périmètre urbain; 
ou ouvre de nouvelles zones de développement. 































4. Sources de données à analyser
Le système doit collecter et analyser plusieurs sources municipales.

4.1 Avis publics
Premiers signaux de changements potentiels.
Contiennent :
changements de zonage; 
PPCMOI; 
dérogations; 
projets de règlements; 
modifications de grilles de zonage; 
consultations publiques; 
projets résidentiels. 

4.2 Procès-verbaux et conseils municipaux
Permettent de :
suivre les discussions; 
comprendre les intentions; 
analyser l’évolution des dossiers; 
relier les décisions dans le temps. 
Un dossier peut évoluer sur plusieurs séances avant approbation finale.

4.3 Vidéos YouTube des conseils municipaux
Certaines villes publient les séances en vidéo avant la transcription officielle.
Importance :
accès plus rapide à l’information; 
contenu plus détaillé que les PV; 
discussions non filtrées. 
Le système doit être capable de :
détecter les vidéos; 
les transcrire; 
extraire les sujets liés à la densification; 
relier les discussions aux dossiers officiels. 

4.4 Documents réglementaires et numéros de dossiers
Très important :
Les villes utilisent souvent :
numéros de règlements; 
codes administratifs; 
références de dossiers. 
Un changement majeur peut être caché derrière un simple numéro.
Exemple :
“Règlement 2024-58”
peut contenir : 
un changement de zonage; 
une augmentation de densité; 
une modification de la grille. 
Le système doit être capable de :
relier les documents entre eux; 
reconstruire le contexte complet; 
comprendre l’impact réel des règlements. 

4.5 Historique des données (rétroanalyse)
Le système doit analyser au minimum 2 ans en arrière pour :
identifier les dossiers encore actifs; 
comprendre les tendances; 
enrichir l’entraînement du modèle; 
détecter les évolutions urbaines déjà en cours. 











































5. Compréhension du langage municipal
Le système ne doit pas fonctionner uniquement par mots-clés.
Il doit comprendre :
le vocabulaire urbanistique; 
les synonymes; 
les formulations indirectes; 
les codes administratifs; 
les intentions politiques derrière les textes. 
































6. Types d’opportunités et scoring

PRIORITÉ 1 — Changements de zonage résidentiel (10/10)
Inclut :
changement de zonage; 
modification de grille; 
refonte réglementaire; 
augmentation de densité; 
conversion vers résidentiel; 
augmentation de hauteur; 
réduction des stationnements; 
ajout de multifamilial; 
maisons en rangée / jumelés; 
densification générale. 
L’IA doit reconnaître aussi les formulations indirectes :
amendement au règlement; 
révision urbanistique; 
modification réglementaire; 
requalification de secteur. 

PRIORITÉ 2 — PPCMOI (7/10)
Définition
Le PPCMOI (Projet particulier de construction, de modification ou d’occupation d’un immeuble) est un mécanisme permettant à une municipalité d’autoriser un projet dérogeant au zonage existant.
Importance
Permet des exceptions ciblées; 
Indique une ouverture municipale; 
Peut annoncer une future densification du secteur; 
Sert souvent de précédent réglementaire. 

PRIORITÉ 3 — Dérogations mineures (densification)
À filtrer :
cabanons; 
clôtures; 
petits éléments non pertinents. 
À retenir :
densité; 
hauteur; 
marges; 
stationnements; 
nombre de logements; 
multifamilial; 
usages. 

PRIORITÉ 4 — Demandes CPTAQ (8/10)
Définition
La CPTAQ (Commission de protection du territoire agricole du Québec) autorise ou refuse les demandes visant à retirer des terrains de la zone agricole pour des usages non agricoles.
Importance stratégique
Une demande CPTAQ indique :
une future expansion urbaine probable; 
un changement de vocation du sol; 
une transition agricole → résidentiel; 
un développement souvent structurant à long terme. 
Ce que le système doit détecter :
demandes de dézonage agricole; 
résolutions municipales d’appui; 
soustraction à la zone agricole; 
projets résidentiels sur terres agricoles. 
Logique d’interprétation
Une demande CPTAQ est souvent :
le premier signal d’un futur développement majeur; 
un indicateur d’urbanisation future; 
un projet à horizon long terme (1 à 10 ans). 




































7. Intelligence attendue du système
Le radar doit être capable de :
comprendre le contexte global; 
relier les documents entre eux; 
détecter les signaux faibles; 
suivre les dossiers dans le temps; 
reconstruire les intentions municipales; 
anticiper les zones en transformation. 

































8. Approche technique du projet
Étape 1 — Proof of Concept (une ville)
Valider la logique sur une seule municipalité; 
Tester extraction + analyse + scoring; 
Construire la base du modèle. 

Étape 2 — Collecte multi-sources
sites municipaux; 
PDF; 
avis publics; 
procès-verbaux; 
vidéos YouTube; 
transcription automatique; 
OCR si nécessaire. 

Étape 3 — Moteur IA
classification des opportunités; 
scoring; 
détection de densification; 
reconnaissance des règlements; 
liaison entre documents. 

Étape 4 — Dashboard
liste des opportunités; 
score; 
localisation; 
historique des dossiers; 
accès aux sources. 

9. Objectif final
Construire un système capable de :
détecter les zones de densification avant le marché; 
comprendre les intentions municipales; 
anticiper les changements de zonage; 
suivre l’évolution urbaine du Québec; 
identifier les opportunités immobilières structurelles à long terme.

