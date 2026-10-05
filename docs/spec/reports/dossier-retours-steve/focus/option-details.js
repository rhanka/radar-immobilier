// Option descriptions (what is concretely proposed: what is built or not, where, what the
// user or the jeu de référence sees, an example from Steve's data) and, where a picture helps, a
// small entity-relationship diagram per option (D2, D3). Merged into choices.js by key.

export const DESCRIPTIONS = {
  D2: {
    a: 'Immo ne crée aucune table d’annotation. Il écrit son profil de domaine (schéma d’étiquettes : verdict Pertinent / À surveiller / Non pertinent, 28 motifs reliés aux critères K1 à K9 et aux exclusions, sens, règle de promotion D13) et branche @sentropic/annotations sur son Postgres et son S3 : le classeur de Steve est importé une fois, Steve annote et l’équipe valide dans l’application, chaque révision est immuable et liée à son hash. Les annotations validées partent, en instantané haché, vers un jeu de référence engram.',
    b: 'Immo construit d’abord les six tables de la version précédente du dossier (retours_fichiers, annotations, validations, motifs, annotation_cibles, reference_set_versions), les utilise, puis les migre vers @sentropic/annotations et engram quand ils seront prêts : annotations → annotation_revisions, validations → annotation_validations, annotation_cibles → annotation_targets, motifs → profil, reference_set_versions → ReferenceSetVersion.',
    c: 'On crée une seule table de contrôle qui recopie le classeur pour mesurer le radar, sans aucun lien vers ce qui est affiché. Le nom de table est indicatif. Rien n’apparaît dans le panneau du signal : Steve ne retrouve pas son verdict sur le signal qu’il a trié ; seul le jeu de référence lit la table.',
    d: 'On ne construit rien côté immo et on attend que @sentropic/annotations et engram soient livrés, sans délai convenu. En attendant, le classeur reste un fichier hors de l’outil et Steve ne peut ni annoter ni valider dans l’application.',
  },
  D3: {
    a: 'On stocke la cible sous forme de texte (« radar.signal:<ville>:<id> ») dans annotation_cibles (ville + id texte du graphe), sans clé étrangère vers le graphe, avec un instantané de ce que Steve a vu (ville, date, type, verbatim). B0 corrige l’API pour accepter cet identifiant texte. Si une ré-extraction supprime le signal, l’ancre passe « disparue » et le panneau montre l’instantané au lieu de perdre le retour.',
    b: 'On n’ancre rien tant qu’une clé métier stable (dossier réglementaire, étape) n’existe pas dans une ontologie du radar. Aucun lot B0 : l’annotation de signal reste en échec 400 et les retours de Steve ne s’affichent sur aucun signal.',
    c: 'On garde le contrat v1 : une annotation de signal pointe vers l’UUID de la table signals. Mais aucun code de main n’écrit dans signals : il n’existe aucun UUID à viser pour les 124 lignes de Steve. L’ancre ne peut pas être créée.',
  },
  D4: {
    a: 'Les annotations utilisent les cibles et la lecture du module comments, sans modifier le paquet. Les retours importés sont immuables : aucun bouton de suppression. Les validations et contestations vivent dans les tables du radar (validations) ; un fil de commentaires sentropic pourra s’ajouter avec le port complet. On demande à sentropic une version avec tombstone, puis on adopte le port complet.',
    b: 'On écrit un adaptateur CommentStore côté radar dont le delete pose une marque (tombstone) au lieu d’effacer. Les retours et réponses passent tout de suite par le port complet. Mais le delete du port ne supprime plus vraiment : sa sémantique diffère de celle du paquet.',
    c: 'On attend que sentropic publie un paquet avec tombstone et rétention, puis on branche tout dessus. Aucun retour de Steve n’est affiché avant cette version, sans date connue.',
  },
  D9: {
    1: 'Le jeu « steve-source » (verdict de Steve) est comparé à la classification du radar : B′ reconstituée à la date du relevé, puis C. Exemple : sur la passe 1, Steve juge 24 signaux sur 73 Non pertinent alors que B les affiche ; c’est cet écart que l’on mesure ligne par ligne.',
    2: 'On compare deux grilles humaines de Steve : son classement actuel (P/S/N, motif) et un nouvel étiquetage selon les critères C. Steve repasse sur les mêmes lignes ; le jeu de référence mesure l’évolution de ses critères, pas le radar.',
    3: 'On rapproche le jeu de référence d’extraction (676 unités sur 100 procès-verbaux) et le jeu de référence de Steve (124 lignes). Le pont passe par les documents communs, probablement peu nombreux (non vérifié).',
  },
  D10: {
    a: 'Les 124 lignes du tableur deviennent l’unique jeu de référence, à la place de la version 674/676. Rapide à constituer, mais il ne contient que ce que l’écran montrait à Steve : les sept dossiers manqués (« l’information existait dans la base ») n’y figurent pas.',
    b: 'Deux jeux de référence versionnés et gelés par empreinte. E reste le jeu de référence d’extraction (676 unités). C est construit à partir des évaluations et ancres de Steve, adjugées et étayées. Développement sur ses 51 villes, test sur les 52 suivantes, jamais vues ; toutes les unités d’un même dossier dans la même partition.',
    c: 'On lance une campagne d’annotation neuve, conçue pour le ciblage C, sur un nouveau corpus. Les 124 lignes de Steve servent seulement d’exemples ; la comparaison avec l’historique se fait à part.',
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
    c: 'On crée et vérifie un compte pour Steve. Ses retours importés sont attribués à ce compte (l’importateur est tracé dans importe_par), et ses annotations, triages et réponses aux contestations dans l’application portent le même compte.',
  },
  D6: {
    a: 'Tout utilisateur approuvé voit tous les retours, verbatims compris, comme pour les notes actuelles (règle 0011). Aucun masquage.',
    b: 'Seuls les administrateurs et Steve voient les retours ; le reste de l’équipe ne les voit pas dans le panneau.',
    c: 'Tout utilisateur approuvé voit les retours, mais les noms de particuliers sont masqués avant affichage, dans les verbatims importés comme dans les résumés de signaux (demande C-79 de Steve). Une colonne pii_status trace le traitement.',
  },
  D7: {
    S: 'C n’affiche que les signaux qui réunissent les trois critères de façon établie. Exemple : sur la passe 1, seuls 22 signaux sur 73 resteraient ; les 12 Pertinent dont le sens n’est pas donné disparaîtraient.',
    K: 'C applique les critères K1 à K9 (§9.2) avec trois états : confirmé (critères étayés), à instruire (sens ou effet non déterminable, reste visible), exclu prouvé (masqué, raison affichée). Deux compteurs distincts « confirmés » et « à instruire ». Aucun seuil de taille de projet ni filtre sur l’origine privée.',
    T: 'La sélection affichée reste B ; les critères de Steve servent seulement à trier la liste (les « trois critères » en premier). Aucun signal n’entre ni ne sort.',
  },
  D8: {
    a: 'Steve et Mathieu examinent les cas listés au §9.2 sur exemples et preuves (Saint-Victor, Amos, CPTAQ, seconds projets, ODJ, trois S-RESTRICTIF). Tant qu’un cas n’est pas tranché, il est marqué « abstention » dans le jeu de référence : il ne compte ni pour ni contre.',
    b: 'L’équipe tranche elle-même chaque cas à partir de l’analyse et des règles de Steve, puis lui présente le résultat.',
    c: 'Les cas restent dans le jeu de référence avec l’étiquette du tableur, sans statut particulier, même quand le tableur et l’analyse se contredisent.',
  },
  D12: {
    a: 'Steve et l’équipe continuent de voir B, sans sélecteur. C est calculée en parallèle par le backend ; une page de comparaison B / C n’est accessible qu’en recette UAT et aux administrateurs. Le jour où le seuil D13 est franchi et que Farid décide, C remplace B à l’écran (scène 5).',
    b: 'Un sélecteur A / B / C apparaît dans le rail pour tous les utilisateurs, avec un mode comparatif ; le choix est porté dans l’URL (filter.targeting=a|b|c).',
    c: 'On n’expose pas C comme un tout : on ajoute à B, un par un, les critères de C (sens, plein droit, second projet), chacun livré quand il est prêt.',
    d: 'On construit une seconde application dédiée à C, avec sa propre carte, ses filtres et ses notes ; Steve choisit l’une ou l’autre application.',
  },
  D13: {
    a: 'C remplace B seulement si, sur le jeu test des 52 villes : aucun signal que Steve juge Pertinent n’est masqué ; la précision P ∪ S de C dépasse celle de B (67,1 % sur la passe 1) ; l’API, le rail, la carte et le panneau montrent les mêmes ensembles ; Farid fait la recette.',
    b: 'Farid écrit d’autres chiffres dans le commentaire (par exemple une précision minimale ou un rappel minimal), mesurés par le même jeu de référence.',
    c: 'La bascule se décide sur la recette de Farid seule, sans mesure chiffrée par le jeu de référence.',
  },
  D14: {
    a: 'Dans le panneau du signal, un badge « Retour de Steve » (vert, jaune, rouge) ouvre une section « Avis de Steve » : classement, motif, sens, analyse, provenance, état du rattachement. Dans le rail, des compteurs P / S / N par ville. Les 3 composants d’annotation passent au design system. Rien sur la carte au premier lot.',
    b: 'En plus du panneau, des pastilles colorées sur la carte Signaux actuelle (composant local MapLibre de 2 761 lignes) dès le lot L3.',
    c: 'On termine d’abord la migration de la carte vers les composants geo partagés (Porte 2), puis on affiche les retours sur la nouvelle carte et dans le panneau.',
    d: 'Un écran séparé liste tous les retours de Steve (filtrable par ville, motif, statut de rattachement), sans rien afficher sur les objets du radar.',
  },
  D15: {
    a: 'B0, l’import (L1) et le jeu de référence de ciblage (O1) démarrent maintenant, en parallèle de #703, car ils ne touchent pas la chaîne de rafraîchissement. Le classifieur C (C1) attend que le rafraîchissement soit stable.',
    b: 'Tout le travail de ce dossier attend la clôture de #703 (rafraîchissement quotidien en production).',
  },
  D16: {
    a: 'Mathieu et Farid envoient à Steve la définition réelle des cinq filtres (§5.7, lue dans le code) et la table qui relie ses 28 codes de motif aux critères C, pour qu’il la corrige avant le développement de C.',
    b: 'On ne répond pas à sa question R-16 avant que C soit développée ; il reçoit alors directement la nouvelle sélection.',
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
  D10: {
    a: {
      colGap: 180,
      layers: ['Source', 'Jeu de référence unique', 'Benchmark #782'],
      placement: { annotations: { col: 0, row: 0 }, jeu_ref_tableur: { col: 1, row: 0 }, jeu_ref_e_v3: { col: 1, row: 1 }, benchmark: { col: 2, row: 0 } },
      existing: ['jeu_ref_e_v3'],
      labels: { remplace: 'remplace', note_tout: 'note tout' },
      er: `erDiagram
    annotations ||--|| jeu_ref_tableur : remplace
    jeu_ref_tableur ||--|| benchmark : note_tout
    annotations {
      text source "124 lignes de Steve"
    }
    jeu_ref_tableur {
      text unite "ce que l'écran montrait"
      text biais "7 dossiers manqués absents"
    }
    jeu_ref_e_v3 {
      text statut "retiré, historique perdu"
    }
    benchmark {
      text tableau "un seul, extraction et ciblage"
    }`,
    },
    b: {
      colGap: 180,
      layers: ['Sources', 'Deux jeux de référence gelés', 'Benchmark #782, deux volets'],
      placement: { consensus_modeles: { col: 0, row: 0 }, annotations: { col: 0, row: 1 }, jeu_ref_e_v3: { col: 1, row: 0 }, jeu_ref_c_v1: { col: 1, row: 1 },
        volet_extraction: { col: 2, row: 0 }, volet_ciblage: { col: 2, row: 1 } },
      existing: ['consensus_modeles', 'jeu_ref_e_v3', 'volet_extraction'],
      labels: { adjugees_gelees: 'adjugées, gelées', note_b_puis_c: 'note B puis C' },
      er: `erDiagram
    consensus_modeles ||--|| jeu_ref_e_v3 : construit
    annotations ||--|| jeu_ref_c_v1 : adjugees_gelees
    jeu_ref_e_v3 ||--|| volet_extraction : note
    jeu_ref_c_v1 ||--|| volet_ciblage : note_b_puis_c
    consensus_modeles {
      text methode "7 passes, 3 familles"
    }
    annotations {
      text source "verdicts de Steve"
    }
    jeu_ref_e_v3 {
      int taille "674 / 100 documents"
    }
    jeu_ref_c_v1 {
      text jeux "dev 51 villes, test 52"
    }
    volet_extraction {
      text mesure "inchangée"
    }
    volet_ciblage {
      text mesure "précision, rappel"
    }`,
    },
    c: {
      colGap: 180,
      layers: ['Nouvelle campagne', 'Jeu de référence C neuf', 'Benchmark #782'],
      placement: { campagne_c: { col: 0, row: 0 }, annotations: { col: 0, row: 1 }, jeu_ref_c_neuf: { col: 1, row: 0 }, volet_ciblage: { col: 2, row: 0 } },
      existing: [],
      labels: { exemples: 'exemples seulement' },
      er: `erDiagram
    campagne_c ||--|| jeu_ref_c_neuf : construit
    annotations }o..o| jeu_ref_c_neuf : exemples
    jeu_ref_c_neuf ||--|| volet_ciblage : note
    campagne_c {
      text corpus "nouveau, conçu pour C"
    }
    annotations {
      text role "124 lignes, exemples"
    }
    jeu_ref_c_neuf {
      text comparaison "historique à part"
    }
    volet_ciblage {
      text mesure "précision, rappel"
    }`,
    },
  },
  D3: {
    a: {
      colGap: 260,
      layers: ['Ancre proposée', 'Graphe existant'],
      placement: { annotation_cibles: { col: 0, row: 0 }, graph_nodes: { col: 1, row: 0 } },
      existing: ['graph_nodes'],
      labels: { cle_texte_sans_fk: 'clé texte, sans FK' },
      er: `erDiagram
    annotation_cibles }o..o| graph_nodes : cle_texte_sans_fk
    annotation_cibles {
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
      placement: { annotation_cibles: { col: 0, row: 0 }, cle_metier_stable: { col: 1, row: 0 } },
      existing: [],
      labels: {},
      er: `erDiagram
    annotation_cibles }o..o| cle_metier_stable : attend
    annotation_cibles {
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
