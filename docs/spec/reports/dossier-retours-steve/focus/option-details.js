// Option descriptions (what is concretely proposed: what is built or not, where, what the
// user or the oracle sees, an example from Steve's data) and, where a picture helps, a
// small entity-relationship diagram per option (D2, D3). Merged into choices.js by key.

export const DESCRIPTIONS = {
  D2: {
    M1: 'On ajoute des colonnes à prospect_notes (migration 0011) et chaque ligne du classeur devient une note libre sur un lot ou un signal. Aucune nouvelle table ; l’UI des notes existante affiche le texte. Exemple : la ligne #7 du Triage, qui nomme deux événements, doit être dupliquée en deux notes ; la cellule E57 des Constats (17 114 caractères) ne rentre pas.',
    M2: 'On crée une seule table de contrôle qui recopie le classeur pour mesurer le radar, sans aucun lien vers ce qui est affiché. Le nom de table est indicatif. Rien n’apparaît dans le panneau du signal : Steve ne retrouve pas son verdict sur le signal qu’il a trié ; seul l’oracle lit la table.',
    M3: 'On crée les tables de la scène 2 : le fichier reçu (sha256), toutes ses lignes brutes, une évaluation versionnée par ligne, 1 à N ancres vers les objets du radar, et une projection vers les fils de commentaires sentropic. Exemple : la ligne #7 donne une évaluation et deux ancres (deux événements) ; une ligne agrégée « 13 signaux PIIA » donne une ancre sur la ville. Le panneau affiche le verdict, l’oracle lit les mêmes évaluations.',
    M4: 'On ne construit rien côté radar : on attend que le paquet comments de sentropic porte tout (cibles, verdict, provenance). En attendant, le classeur reste un fichier hors de l’outil. Même livré, le paquet ne porte ni classement, ni motif, ni sens : il faudrait encore des tables radar.',
  },
  D3: {
    a: 'On stocke la cible sous forme de texte (« radar.signal:<ville>:<id> ») dans annotation_anchors, sans clé étrangère vers le graphe, avec un instantané de ce que Steve a vu (ville, date, type, verbatim). B0 corrige l’API pour accepter cet identifiant texte. Si une ré-extraction supprime le signal, l’ancre passe « disparue » et le panneau montre l’instantané au lieu de perdre le retour.',
    b: 'On n’ancre rien tant qu’une clé métier stable (dossier réglementaire, étape) n’existe pas dans une ontologie du radar. Aucun lot B0 : l’annotation de signal reste en échec 400 et les retours de Steve ne s’affichent sur aucun signal.',
    c: 'On garde le contrat v1 : une annotation de signal pointe vers l’UUID de la table signals. Mais aucun code de main n’écrit dans signals : il n’existe aucun UUID à viser pour les 124 lignes de Steve. L’ancre ne peut pas être créée.',
  },
  D4: {
    a: 'Les annotations utilisent les cibles et la lecture du module comments, sans modifier le paquet. Les retours importés sont immuables : aucun bouton de suppression. Les réponses de l’équipe vont dans prospect_notes v1, qui sait déjà effacer logiquement. On demande à sentropic une version avec tombstone, puis on adopte le port complet.',
    b: 'On écrit un adaptateur CommentStore côté radar dont le delete pose une marque (tombstone) au lieu d’effacer. Les retours et réponses passent tout de suite par le port complet. Mais le delete du port ne supprime plus vraiment : sa sémantique diffère de celle du paquet.',
    c: 'On attend que sentropic publie un paquet avec tombstone et rétention, puis on branche tout dessus. Aucun retour de Steve n’est affiché avant cette version, sans date connue.',
  },
  D9: {
    1: 'Le jeu « steve-source » (verdict de Steve) est comparé à la classification du radar : B′ reconstituée à la date du relevé, puis C. Exemple : sur la passe 1, Steve juge 24 signaux sur 73 Non pertinent alors que B les affiche ; c’est cet écart que l’on mesure ligne par ligne.',
    2: 'On compare deux grilles humaines de Steve : son classement actuel (P/S/N, motif) et un nouvel étiquetage selon les critères C. Steve repasse sur les mêmes lignes ; l’oracle mesure l’évolution de ses critères, pas le radar.',
    3: 'On rapproche l’oracle d’extraction (676 unités sur 100 procès-verbaux) et l’oracle de Steve (124 lignes). Le pont passe par les documents communs, probablement peu nombreux (non vérifié).',
  },
  D10: {
    a: 'Les 124 lignes du tableur deviennent l’unique oracle, à la place de la version 674/676. Rapide à constituer, mais il ne contient que ce que l’écran montrait à Steve : les sept dossiers manqués (« l’information existait dans la base ») n’y figurent pas.',
    b: 'Deux oracles versionnés et gelés par empreinte. E reste l’oracle d’extraction (676 unités). C est construit à partir des évaluations et ancres de Steve, adjugées et étayées. Développement sur ses 51 villes, test sur les 52 suivantes, jamais vues ; toutes les unités d’un même dossier dans la même partition.',
    c: 'On lance une campagne d’annotation neuve, conçue pour le ciblage C, sur un nouveau corpus. Les 124 lignes de Steve servent seulement d’exemples ; la comparaison avec l’historique se fait à part.',
  },
  D11: {
    a: 'Le rapport du benchmark #782 garde son tableau d’extraction inchangé et ajoute un tableau « ciblage » : précision et rappel de l’historique, de B, puis de C, sur l’oracle C. Le prompt gelé immo-pv-extraction-v9 n’est pas modifié ; l’enrichir serait une nouvelle version, décidée à part.',
    b: 'Un seul tableau et un seul score mêlent l’extraction (étape et citation) et le ciblage (fallait-il montrer le signal).',
  },
  D1: {
    a: 'On importe seulement la feuille Triage : 124 lignes, 51 villes. Les 121 contrôles d’exclusion (dont 3 faux négatifs « écartés à tort »), les 77 constats et les 26 règles restent dans le fichier.',
    b: 'On importe les 7 feuilles et l’analyse du 21 septembre, sans rien modifier : 124 lignes de triage, 121 contrôles d’exclusion, 77 constats, 26 règles, 28 codes, et la Synthèse avec ses formules et leurs valeurs mémorisées. L’analyse est conservée à part, comme annotation distincte.',
    c: 'Chaque ligne devient une note de texte libre sur une ville ou un signal, dans l’UI des notes actuelle. Le classement, le motif et le sens ne sont plus des champs : ils sont dans le texte.',
  },
  D5: {
    a: 'Chaque retour importé affiche « Steve Chaperon — importé par <nom> ». Steve est un auteur externe (ext:chaperon:steve) sans compte ; l’importateur réel est enregistré à part (recorded_by). Personne ne peut modifier ni supprimer un retour importé.',
    b: 'Le retour est affiché comme écrit par la personne qui a lancé l’import ; le nom de Steve n’apparaît que dans la provenance (fichier, feuille, ligne).',
    c: 'On crée un compte pour Steve et ses retours importés sont rattachés à ce compte, comme s’il les avait saisis lui-même dans l’outil.',
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
    a: 'Steve et Mathieu examinent les cas listés au §9.2 sur exemples et preuves (Saint-Victor, Amos, CPTAQ, seconds projets, ODJ, trois S-RESTRICTIF). Tant qu’un cas n’est pas tranché, il est marqué « abstention » dans l’oracle : il ne compte ni pour ni contre.',
    b: 'L’équipe tranche elle-même chaque cas à partir de l’analyse et des règles de Steve, puis lui présente le résultat.',
    c: 'Les cas restent dans l’oracle avec l’étiquette du tableur, sans statut particulier, même quand le tableur et l’analyse se contredisent.',
  },
  D12: {
    a: 'Steve et l’équipe continuent de voir B, sans sélecteur. C est calculée en parallèle par le backend ; une page de comparaison B / C n’est accessible qu’en recette UAT et aux administrateurs. Le jour où le seuil D13 est franchi et que Farid décide, C remplace B à l’écran (scène 5).',
    b: 'Un sélecteur A / B / C apparaît dans le rail pour tous les utilisateurs, avec un mode comparatif ; le choix est porté dans l’URL (filter.targeting=a|b|c).',
    c: 'On n’expose pas C comme un tout : on ajoute à B, un par un, les critères de C (sens, plein droit, second projet), chacun livré quand il est prêt.',
    d: 'On construit une seconde application dédiée à C, avec sa propre carte, ses filtres et ses notes ; Steve choisit l’une ou l’autre application.',
  },
  D13: {
    a: 'C remplace B seulement si, sur le jeu test des 52 villes : aucun signal que Steve juge Pertinent n’est masqué ; la précision P ∪ S de C dépasse celle de B (67,1 % sur la passe 1) ; l’API, le rail, la carte et le panneau montrent les mêmes ensembles ; Farid fait la recette.',
    b: 'Farid écrit d’autres chiffres dans le commentaire (par exemple une précision minimale ou un rappel minimal), mesurés par le même oracle.',
    c: 'La bascule se décide sur la recette de Farid seule, sans mesure chiffrée par l’oracle.',
  },
  D14: {
    a: 'Dans le panneau du signal, un badge « Retour de Steve » (vert, jaune, rouge) ouvre une section « Avis de Steve » : classement, motif, sens, analyse, provenance, état du rattachement. Dans le rail, des compteurs P / S / N par ville. Les 3 composants d’annotation passent au design system. Rien sur la carte au premier lot.',
    b: 'En plus du panneau, des pastilles colorées sur la carte Signaux actuelle (composant local MapLibre de 2 761 lignes) dès le lot L3.',
    c: 'On termine d’abord la migration de la carte vers les composants geo partagés (Porte 2), puis on affiche les retours sur la nouvelle carte et dans le panneau.',
    d: 'Un écran séparé liste tous les retours de Steve (filtrable par ville, motif, statut de rattachement), sans rien afficher sur les objets du radar.',
  },
  D15: {
    a: 'B0, l’import (L1) et l’oracle de ciblage (O1) démarrent maintenant, en parallèle de #703, car ils ne touchent pas la chaîne de rafraîchissement. Le classifieur C (C1) attend que le rafraîchissement soit stable.',
    b: 'Tout le travail de ce dossier attend la clôture de #703 (rafraîchissement quotidien en production).',
  },
  D16: {
    a: 'Mathieu et Farid envoient à Steve la définition réelle des cinq filtres (§5.7, lue dans le code) et la table qui relie ses 28 codes de motif aux critères C, pour qu’il la corrige avant le développement de C.',
    b: 'On ne répond pas à sa question R-16 avant que C soit développée ; il reçoit alors directement la nouvelle sélection.',
  },
};

// Small entity-relationship diagrams (Mermaid erDiagram subset of parse-er.mjs), laid out
// by erLayout. `existing`: tables present on main; the others are proposed or indicative.
export const DIAGRAMS = {
  D2: {
    M1: {
      colGap: 180,
      layers: ['Table existante, étendue', 'Tables référencées'],
      placement: { prospect_notes: { col: 0, row: 0 }, account_users: { col: 1, row: 0 }, signals: { col: 1, row: 1 } },
      existing: ['prospect_notes', 'account_users', 'signals'],
      labels: { cible_signal: 'cible signal' },
      er: `erDiagram
    prospect_notes }o--|| account_users : auteur
    prospect_notes }o--o| signals : cible_signal
    prospect_notes {
      uuid id PK
      text target_type "lot ou signal"
      text city_slug
      uuid signal_id FK "UUID"
      uuid author_id FK "compte obligatoire"
      text body "10 000 caractères max"
    }
    account_users {
      uuid id PK
    }
    signals {
      uuid id PK "aucune insertion sur main"
    }`,
    },
    M2: {
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
    M3: {
      colGap: 180,
      layers: ['Source', 'Jugement', 'Ancres et publication'],
      placement: {
        annotation_sources: { col: 0, row: 0 }, annotation_raw_rows: { col: 0, row: 1 }, annotation_assessments: { col: 1, row: 1 },
        comment_projection: { col: 2, row: 0 }, annotation_anchors: { col: 2, row: 1 }, graph_nodes: { col: 2, row: 2 },
      },
      existing: ['graph_nodes'],
      labels: { normalisee_en: 'normalisée en', rattachee_a: '1 à N ancres', cle_texte_sans_fk: 'clé texte, sans FK', publie_en: 'publiée en' },
      er: `erDiagram
    annotation_sources ||--o{ annotation_raw_rows : contient
    annotation_raw_rows ||--o{ annotation_assessments : normalisee_en
    annotation_assessments ||--o{ annotation_anchors : rattachee_a
    annotation_anchors }o..o| graph_nodes : cle_texte_sans_fk
    annotation_assessments ||--o| comment_projection : publie_en
    annotation_sources {
      uuid id PK
      text file_sha256 UK
    }
    annotation_raw_rows {
      uuid id PK
      uuid source_id FK
      jsonb cells
    }
    annotation_assessments {
      uuid id PK
      uuid raw_row_id FK
      text classement
      text motif_code
      text sens
    }
    annotation_anchors {
      uuid id PK
      uuid assessment_id FK
      text anchor_key "sans FK"
    }
    graph_nodes {
      text id PK
    }
    comment_projection {
      uuid id PK
      uuid assessment_id FK
      text thread_id
    }`,
    },
    M4: {
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
      colGap: 180,
      layers: ['Ancre proposée', 'Graphe existant'],
      placement: { annotation_anchors: { col: 0, row: 0 }, graph_nodes: { col: 1, row: 0 } },
      existing: ['graph_nodes'],
      labels: { cle_texte_sans_fk: 'clé texte, sans FK' },
      er: `erDiagram
    annotation_anchors }o..o| graph_nodes : cle_texte_sans_fk
    annotation_anchors {
      uuid id PK
      text anchor_key "radar.signal:<ville>:<id>"
      jsonb observed "ville, date, verbatim"
      text resolution "résolue … disparue"
    }
    graph_nodes {
      text id PK "signal-… (texte)"
    }`,
    },
    b: {
      colGap: 180,
      layers: ['Ancre en attente', 'Clé métier'],
      placement: { annotation_anchors: { col: 0, row: 0 }, cle_metier_stable: { col: 1, row: 0 } },
      existing: [],
      labels: {},
      er: `erDiagram
    annotation_anchors }o..o| cle_metier_stable : attend
    annotation_anchors {
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
