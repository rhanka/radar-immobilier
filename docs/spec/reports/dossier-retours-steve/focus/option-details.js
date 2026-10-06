// Option descriptions (what is concretely proposed: what is built or not, where, what the
// user or the jeu de référence sees, an example from Steve's data) and, where a picture helps, a
// small entity-relationship diagram per option (D2, D3 ; schémas en annexe III du dossier). Merged into choices.js by key.

export const DESCRIPTIONS = {
  D2: {
    a: 'Immo ne crée aucune table d’annotation. Il écrit son profil de domaine (schéma d’étiquettes : verdict Pertinent / À surveiller / Non pertinent, 28 motifs reliés aux critères K1 à K9 et aux exclusions, sens, règle de promotion D13) et branche @sentropic/annotations sur son Postgres et son S3 : le classeur de Steve est importé une fois, Steve annote et l’équipe valide dans l’application, chaque révision est immuable et liée à son hash. Les annotations validées partent, en instantané haché, vers un jeu de référence engram.',
    b: 'Immo construit d’abord les six tables de la version précédente du dossier (retours_fichiers, annotations, validations, motifs, annotation_cibles, reference_set_versions), les utilise, puis les migre vers @sentropic/annotations et engram quand ils seront prêts : annotations → annotation_revisions, validations → annotation_validations, annotation_cibles → annotation_targets, motifs → profil, reference_set_versions → ReferenceSetVersion.',
    c: 'On crée une seule table de contrôle qui recopie le classeur pour mesurer le radar, sans aucun lien vers ce qui est affiché. Le nom de table est indicatif. Rien n’apparaît dans le panneau du signal : Steve ne retrouve pas son verdict sur le signal qu’il a trié ; seul le jeu de référence lit la table.',
    d: 'On ne construit rien côté immo et on attend que @sentropic/annotations et engram soient livrés, sans délai convenu. En attendant, le classeur reste un fichier hors de l’outil et Steve ne peut ni annoter ni valider dans l’application.',
  },
  D3: {
    a: 'On stocke la cible sous forme de texte (« radar.signal:<ville>:<id> ») dans annotation_targets (ville + id texte du graphe), sans clé étrangère vers le graphe, avec un instantané de ce que Steve a vu (ville, date, type, verbatim). B0 corrige l’API pour accepter cet identifiant texte. Si une ré-extraction supprime le signal, l’ancre passe « disparue » et le panneau montre l’instantané au lieu de perdre le retour.',
    b: 'On n’ancre rien tant qu’une clé métier stable (dossier réglementaire, étape) n’existe pas dans une ontologie du radar. Aucun lot B0 : l’annotation de signal reste en échec 400 et les retours de Steve ne s’affichent sur aucun signal.',
    c: 'On garde le contrat v1 : une annotation de signal pointe vers l’UUID de la table signals. Mais aucun code de main n’écrit dans signals : il n’existe aucun UUID à viser pour les 124 lignes de Steve. L’ancre ne peut pas être créée.',
  },
  D4: {
    a: 'Les commentaires de l’équipe utilisent les cibles et la lecture du module comments, sans modifier le paquet. Les retours importés sont immuables : aucun bouton de suppression. Les annotations, révisions et validations relèvent de G2, G3 et D2 (annotation_validations du paquet), pas de D4 ; un fil de commentaires sentropic pourra s’ajouter avec le port complet. On demande à sentropic une version avec tombstone, puis on adopte le port complet.',
    b: 'On écrit un adaptateur CommentStore côté radar dont le delete pose une marque (tombstone) au lieu d’effacer. Les commentaires de l’équipe passent tout de suite par le port complet. Mais le delete du port ne supprime plus vraiment : sa sémantique diffère de celle du paquet.',
    c: 'On attend que sentropic publie un paquet avec tombstone et rétention, puis on branche tout dessus. Aucun commentaire de l’équipe n’est ouvert avant cette version, sans date connue.',
  },
  D9: {
    1: 'Le jeu « steve-source » (verdict de Steve) est comparé à la classification du radar : B′ reconstituée à la date du relevé, puis C. Exemple : sur la passe 1, Steve juge 24 signaux sur 73 Non pertinent alors que B les affiche ; c’est cet écart que l’on mesure ligne par ligne.',
    2: 'On compare deux grilles humaines de Steve : son classement actuel (P/S/N, motif) et un nouvel étiquetage selon les critères C. Steve repasse sur les mêmes lignes ; le jeu de référence mesure l’évolution de ses critères, pas le radar.',
    3: 'On rapproche le jeu de référence d’extraction (676 unités sur 100 procès-verbaux) et le jeu de référence de Steve (124 lignes). Le pont passe par les documents communs, probablement peu nombreux (non vérifié).',
    4: 'D9 n’est plus une décision séparée : le jeu de référence C v2 garde, pour chaque champ, la provenance de son étiquette (steve_v1 historique, steve_v2a réannotation sans arguments IA, steve_v2 adjudication, steve_test, annotations IA individuelles et majorité IA). La « double annotation » devient une propriété du manifeste, décidée avec D10.',
  },
  D10: {
    a: 'Les 121 lignes sont redécoupées par ville, une moitié servant de test aveugle pour toute la suite, sans annotation neuve. Les résultats portent les mentions exploratory, pilot-exposed et test-informed-schema : les tags, consignes et propositions de règle dérivent déjà de ces lignes, et aucune mesure n’est admissible pour D13.',
    b: 'Les 121 lignes servent à la mise au point des règles (R′) et des tags avec les 3 IA ; elles sont aussi découpées de façon homogène par ville (stratifié au moins sur Passe × Classement, puis sur les tags) en train et test aveugle exploratoire pour les premiers prompts. L’extension à de nouvelles villes vient après la clarification avec Steve des points listés au §4.8. Le test confirmatoire est un échantillon neuf de villes hors registre d’exposition, annoté par Steve et, sur au moins 50 cas, par un second annotateur humain.',
    c: 'On lance une campagne d’annotation neuve, conçue pour le ciblage C, sur un nouveau corpus. Les 124 lignes de Steve servent seulement d’exemples ; la comparaison avec l’historique se fait à part.',
  },
  D17: {
    a: 'L’entrée d’un cas est le signal et le contexte d1 de sa ville (autres signaux, métadonnées des documents), reconstruit par une procédure déterministe appliquée à tous les cas et coupé à la date du signal : rien de postérieur. Les colonnes L à T du classeur (textes de l’assistant, hors P, Q, R) et les décisions de Steve (colonnes B, P, Q et R : passe, sens, classement, code de motif) ne sont jamais en entrée ; d2 reste hors entrée.',
    b: 'Le contexte d1 est coupé à la date à laquelle Steve a relu le signal (au plus tard le 21 septembre 2026 pour le relevé), et à la date d’annotation pour le test. L’entrée est plus proche de ce que Steve savait ; l’évaluation devient rétrospective et doit être annoncée comme telle.',
    c: 'Chaque cas n’est évalué que sur le texte et les métadonnées de son signal, sans autre signal ni document de la ville. C’est la condition la plus simple ; la relation rattache_a et toute règle qui regroupe les étapes d’un même dossier y sont not covered.',
  },
  D11: {
    a: 'Le rapport du benchmark #782 garde son tableau d’extraction inchangé et ajoute un tableau « ciblage » : précision et rappel de l’historique, de B, puis de C, sur le jeu de référence C. Le prompt gelé immo-pv-extraction-v9 n’est pas modifié ; l’enrichir serait une nouvelle version, décidée à part.',
    b: 'Un seul tableau et un seul score mêlent l’extraction (étape et citation) et le ciblage (fallait-il montrer le signal).',
  },
  D1: {
    a: 'On importe seulement la feuille Triage : 124 lignes, 51 villes. Les 121 contrôles d’exclusion (dont 3 faux négatifs « écartés à tort »), les 77 constats et les 26 règles restent dans le fichier.',
    b: 'On importe les 7 feuilles et l’analyse du 21 septembre, sans rien modifier : 124 lignes de triage, 121 contrôles d’exclusion, 77 constats, 26 règles, 28 codes, et la Synthèse avec ses formules et leurs valeurs mémorisées. L’analyse est conservée à part, comme annotation distincte.',
    c: 'Chaque ligne devient une note de texte libre sur une ville ou un signal, dans l’UI des notes actuelle. Le classement, le motif et le sens ne sont plus des champs : ils sont dans le texte.',
  },
  D5: {
    a: 'Chaque retour importé affiche « Steve Chaperon — importé par <nom> ». Steve est un auteur externe (ext:chaperon:steve) sans compte ; l’importateur réel est enregistré à part. Steve ne peut pas annoter lui-même tant que cette identité externe est utilisée.',
    b: 'Le retour est affiché comme écrit par la personne qui a lancé l’import ; le nom de Steve n’apparaît que dans la provenance (fichier, feuille, ligne).',
    c: 'On crée et vérifie un compte pour Steve. Ses décisions importées (colonnes B, P, Q et R) sont attribuées à ce compte ; les textes de l’assistant du triage (colonnes L à T hors P, Q, R) gardent leur auteur documentaire, et l’importateur est tracé avec la source de l’import (annotation_sources, §9.1). Ses annotations, triages et réponses aux contestations dans l’application portent le même compte.',
  },
  D6: {
    a: 'Tout utilisateur approuvé voit tous les retours, verbatims compris, comme pour les notes actuelles (règle 0011). Aucun masquage.',
    b: 'Seuls les administrateurs et Steve voient les retours ; le reste de l’équipe ne les voit pas dans le panneau.',
    c: 'Tout utilisateur approuvé voit les retours, mais les noms de particuliers sont masqués avant affichage, dans les verbatims importés comme dans les résumés de signaux (constat C-79). Une colonne pii_status trace le traitement.',
  },
  D7: {
    S: 'C n’affiche que les signaux qui réunissent les trois critères de façon établie. Exemple : sur la passe 1, seuls 22 signaux sur 73 resteraient ; les 12 Pertinent dont le sens n’est pas donné disparaîtraient.',
    K: 'C applique les critères K1 à K9 (§5.1) avec trois états : confirmé (critères étayés), à instruire (sens ou effet non déterminable, reste visible), exclu prouvé (masqué, raison affichée). Deux compteurs distincts « confirmés » et « à instruire ». Aucun seuil de taille de projet ni filtre sur l’origine privée.',
    T: 'La sélection affichée reste B ; les critères de Steve servent seulement à trier la liste (les « trois critères » en premier). Aucun signal n’entre ni ne sort.',
  },
  D8: {
    a: 'Steve et Mathieu examinent sur exemples et preuves les cas listés au §4.8 (Saint-Victor, CPTAQ, seconds projets, ODJ, labels contraires à ses règles) et le cas Amos du 2026-10-03, hors de cette liste. Tant qu’un cas n’est pas tranché, il garde son étiquette du relevé, porte le statut contested et les résultats sont publiés avec et sans ces cas (§4.8) ; la lecture principale et son dénominateur sont à fixer par cette décision.',
    b: 'L’équipe tranche elle-même chaque cas à partir de l’analyse et des règles de Steve, puis lui présente le résultat.',
    c: 'Les cas restent dans le jeu de référence avec l’étiquette du tableur, sans statut particulier, même quand le tableur et l’analyse se contredisent.',
  },
  D12: {
    a: 'Steve et l’équipe continuent de voir B, sans sélecteur. C est calculée en parallèle par le backend ; une page de comparaison B / C n’est accessible qu’en recette UAT et aux administrateurs. Le jour où le seuil D13 est franchi et que Farid décide, C remplace B à l’écran (scène affichage-abc, §8.1).',
    b: 'Un sélecteur A / B / C apparaît dans le rail pour tous les utilisateurs, avec un mode comparatif ; le choix est porté dans l’URL (filter.targeting=a|b|c).',
    c: 'On n’expose pas C comme un tout : on ajoute à B, un par un, les critères de C (sens, plein droit, second projet), chacun livré quand il est prêt.',
    d: 'On construit une seconde application dédiée à C, avec sa propre carte, ses filtres et ses notes ; Steve choisit l’une ou l’autre application.',
  },
  D13: {
    a: 'C remplace B seulement si, sur le test neuf : aucun cas classé Pertinent par Steve n’est entièrement masqué (k_max = 0, unité du §5.4) et la borne supérieure exacte du taux de Pertinent masqués est sous X ; puis la différence de précision P ∪ S entre C et B′ passe 1, sur les mêmes cas, a une borne inférieure positive (bootstrap par ville) ; l’API, le rail, la carte et le panneau montrent les mêmes ensembles ; Farid fait la recette.',
    b: 'Farid écrit d’autres chiffres dans le commentaire (par exemple une précision minimale ou un rappel minimal), mesurés par le même jeu de référence.',
    c: 'La bascule se décide sur la recette de Farid seule, sans mesure chiffrée par le jeu de référence.',
  },
  D14: {
    a: 'Dans le panneau du signal, un badge « Retour de Steve » (vert, jaune, rouge) ouvre une section « Retour du relevé de Steve » en deux blocs : « Décision de Steve » (passe, sens, classement, code de motif) et « Texte de l’assistant du triage » (colonnes L à T hors P, Q, R), avec provenance et état du rattachement. Dans le rail, des compteurs P / S / N par ville. Les 3 composants d’annotation passent au design system. Rien sur la carte au premier lot.',
    b: 'En plus du panneau, des pastilles colorées sur la carte Signaux actuelle (composant local MapLibre de 2 761 lignes) dès le lot U1, premier lot d’affichage (§9.6).',
    c: 'On termine d’abord la migration de la carte vers les composants geo partagés (Porte 2), puis on affiche les retours sur la nouvelle carte et dans le panneau.',
    d: 'Un écran séparé liste tous les retours de Steve (filtrable par ville, motif, statut de rattachement), sans rien afficher sur les objets du radar.',
  },
  D15: {
    a: 'B0, l’import (L1) et le jeu de référence de ciblage (O1) démarrent en parallèle de #703, car ils ne touchent pas la chaîne de rafraîchissement, dès que leurs prérequis sont levés (§9.6) : D3 pour B0 ; D5 et, si G7 (b), le lot générique G-L2 pour L1 ; L1 et D10 pour O1. Le classifieur C (C1) attend que le rafraîchissement soit stable.',
    b: 'Tout le travail de ce dossier attend la clôture de #703 (rafraîchissement quotidien en production).',
  },
  D16: {
    a: 'Mathieu et Farid envoient à Steve la définition réelle des cinq filtres (§2.5, lue dans le code) et la table qui relie ses 28 codes de motif aux critères C (table à établir, not run, §9.1), pour qu’il la corrige avant le développement de C.',
    b: 'On ne répond pas à la question posée en R-16 avant que C soit développée ; il reçoit alors directement la nouvelle sélection.',
  },
};

import { STEVE_MODEL, SIX_TABLES } from './steve-model.js';

// Small entity-relationship diagrams (Mermaid erDiagram subset of parse-er.mjs), laid out
// by erLayout. `existing`: tables present on main; the others are proposed or indicative.
export const DIAGRAMS = {
  D2: {
    a: STEVE_MODEL,
    c: {
      colGap: 180,
      layers: ['Mesure seule', 'Affichage, sans lien'],
      placement: { steve_control_rows: { col: 0, row: 0 }, graph_nodes: { col: 1, row: 0 } },
      existing: ['graph_nodes'],
      labels: {},
      er: `erDiagram
    steve_control_rows {
      uuid id PK
      text sheet
      int sheet_row
      jsonb cells "toutes les cellules"
      text verdict "classement, motif, sens"
    }
    graph_nodes {
      text id PK "signal-…"
      text city_slug
    }`,
    },
    b: SIX_TABLES,
    d: {
      colGap: 180,
      layers: ['Paquet sentropic : aucune table radar'],
      placement: { sentropic_comments: { col: 0, row: 0 } },
      existing: ['sentropic_comments'],
      labels: {},
      er: `erDiagram
    sentropic_comments {
      text id PK
      text target_kind "record"
      text target_id
      text author_id
      text body "ni classement ni provenance"
    }`,
    },
  },
  D3: {
    a: {
      colGap: 260,
      layers: ['Ancre proposée', 'Graphe existant'],
      placement: { annotation_targets: { col: 0, row: 0 }, graph_nodes: { col: 1, row: 0 } },
      existing: ['graph_nodes'],
      labels: { cle_texte_sans_fk: 'clé texte, sans FK' },
      er: `erDiagram
    annotation_targets }o..o| graph_nodes : cle_texte_sans_fk
    annotation_targets {
      uuid id PK
      text city_slug "ville"
      text cible_id "signal-… (texte)"
      jsonb vu_par_steve "ville, date, verbatim"
      text resolution "résolue … disparue"
    }
    graph_nodes {
      text id PK "signal-… (texte)"
    }`,
    },
    b: {
      colGap: 180,
      layers: ['Ancre en attente', 'Clé métier'],
      placement: { annotation_targets: { col: 0, row: 0 }, cle_metier_stable: { col: 1, row: 0 } },
      existing: [],
      labels: {},
      er: `erDiagram
    annotation_targets }o..o| cle_metier_stable : attend
    annotation_targets {
      uuid id PK
      text business_key "à définir"
    }
    cle_metier_stable {
      text key PK "n'existe pas encore"
    }`,
    },
    c: {
      colGap: 180,
      layers: ['Note existante', 'Table signals'],
      placement: { prospect_notes: { col: 0, row: 0 }, signals: { col: 1, row: 0 } },
      existing: ['prospect_notes', 'signals'],
      labels: { signal_id: 'signal_id, UUID' },
      er: `erDiagram
    prospect_notes }o--o| signals : signal_id
    prospect_notes {
      uuid id PK
      uuid signal_id FK "UUID exigé par l'API"
    }
    signals {
      uuid id PK "table vide sur main"
    }`,
    },
  },
};
