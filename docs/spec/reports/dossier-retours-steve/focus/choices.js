// Les choix exposés sont exactement les décisions D1 à D16 du §3 et du §10 du dossier
// « retours de Steve », dans l'ordre de décision (Fabien, puis Farid). Une réponse par décision.
// Rien n'est ratifié ici : la page ne produit qu'un brouillon local exportable.
import roles from './roles.json' with { type: 'json' };
import { decisionRecords, decisionsYaml, isoWithOffset, markdownBlock } from './decision-yaml.js';
import { DESCRIPTIONS, DIAGRAMS } from './option-details.js';

// Export target, per dossier: the PR where Farid pastes his decisions.
export const DECISIONS_TARGET_URL = 'https://github.com/rhanka/radar-immobilier/pull/794';
export const DECISIONS_TARGET_LABEL = 'Ouvrir la PR #794 sur GitHub';
// The dossier carries no revision label: its date stands for the revision.
export const DOSSIER_REVISION = '2026-10-03';
// The "Je suis" selector. This dossier names no validation beside the decider,
// so a person's own decisions are the ones they decide.
export const PEOPLE = ['Farid', 'Fabien'];

// Ordre de décision : Fabien décide d'abord ses sept décisions (D1 actée, architecture, données,
// oracle) ; elles sont prises telles quelles, sauf incohérence avec une autre décision.
// Farid décide ensuite les dix siennes (produit, affichage, priorités), en connaissant
// les choix de Fabien. Chaque décision : une introduction (problème, pourquoi maintenant,
// ce qui change selon le choix, renvois au dossier), ses dépendances, puis des options
// avec avantages et inconvénients. Identifiants, décideurs et options inchangés.
export const STEPS = [
  { id: 'fabien', step: 1, decides: 'Fabien', label: 'Étape 1 · Fabien décide d’abord (architecture, données, oracle)' },
  { id: 'farid', step: 2, decides: 'Farid', label: 'Étape 2 · Farid décide ensuite (produit, affichage, priorités)' },
];
export const SEQUENCE = 'Fabien décide d’abord ses sept décisions (D1, D2, D3, D4, D9, D10, D11) : D1 est déjà actée par l’owner le 2026-10-04 (tout conserver) ; les autres sont prises telles quelles, sauf incohérence avec une autre décision. '
  + 'Farid décide ensuite ses neuf décisions (D5, D6, D7, D8, D12, D13, D14, D15, D16), en connaissant les choix de Fabien. '
  + 'Si un choix de Farid contredit un choix de Fabien (par exemple D1 « tout conserver » avec D2 = (c), une table de contrôle qui n’affiche rien), on revient à Fabien sur ce seul point.';

const q = (key, question, recommended, text, options) => ({
  key, mode: 'single', question, recommended, options,
  step: roles[key][0] === 'Fabien' ? 1 : 2, group: STEPS.find(step => step.decides === roles[key][0]).label,
  intro: text.intro, dependsOn: text.dependsOn ?? [], recommendation: text.recommendation, decided: text.decided ?? null,
  decides: roles[key][0], consulted: roles[key][1], validators: [],
});
const o = (key, title, pros, cons) => ({ key, title, pros, cons });

export const questions = [
  // ——— Étape 1 · Fabien ———
  q('D1', 'D1 — Périmètre de conservation des retours de Steve', 'b', {
    decided: { option: 'b', by: 'Fabien (owner)', date: '2026-10-04', note: 'Actée par l’owner le 2026-10-04 : on conserve tous les retours de Steve ; il en a besoin pour l’oracle.' },
    intro: 'Décision actée par l’owner le 2026-10-04 : on conserve tous les retours de Steve ; c’est sa décision, il en a besoin pour l’oracle. '
      + 'Steve a livré un classeur de 7 feuilles (124 lignes de triage, 121 contrôles d’exclusion, 77 constats, 26 règles, 28 codes de motif) et une analyse écrite qui pose ses trois critères (§2, §5.1). '
      + 'Ce choix fixe ce que l’équipe pourra montrer sur les objets du radar et ce que l’oracle pourra mesurer (D10). '
      + 'Conséquence pour D2 : « tout conserver » suppose un modèle qui garde toutes les lignes, l’option a (ou b) de D2.',
    dependsOn: [],
    recommendation: 'Tranchée : (b), tout conserver, actée par l’owner le 2026-10-04 ; les options a et c restent affichées pour mémoire.',
  }, [
    o('a', '(a) Triage seul',
      ['Rapide : une feuille, 124 lignes.', 'Moins de rattachements à vérifier à l’import.'],
      ['Perd les 121 contrôles d’exclusion, là où se trouvent les faux négatifs, ainsi que les constats et les règles.', 'Oracle incomplet : impossible de mesurer ce que les filtres cachent à tort.']),
    o('b', '(b) Tout le classeur et l’analyse, brut immuable',
      ['Aucune perte : chaque cellule, formule et valeur mémorisée.', 'L’oracle (D10) dispose des exclusions et des règles.', 'Les 52 villes suivantes s’importeront de la même façon.'],
      ['Plus de tables et de curation (rattachements à vérifier).', 'Import un peu plus long à écrire et à recetter.']),
    o('c', '(c) Notes libres seules',
      ['Surface existante : les notes des lots et des signaux.', 'Aucun schéma nouveau : livrable vite.'],
      ['Perd la structure (classement, motif, sens), les groupes et la provenance.', 'Inutilisable pour l’oracle ; une note est limitée à 10 000 caractères.']),
  ]),
  q('D2', 'D2 — Modèle de données', 'a', {
    intro: 'Le classeur de Steve (7 feuilles, 433 lignes, une cellule de 17 114 caractères, §5.1) doit être stocké en base et rattaché aux objets du radar (#784), et Steve doit pouvoir poursuivre son annotation dans l’application, avec des boucles de validation par l’équipe ou le PO (vision owner, §6.3). '
      + 'Les tables d’annotation existantes, prospect_marks et prospect_notes (§6.0), servent à l’équipe sur les lots : elles restent telles quelles, ni étendues ni réutilisées. '
      + 'Le §6.3 part des besoins réels de Steve (verdict, motif, provenance, 1 à N objets visés, révisions, saisie et validation dans l’application, oracle C) et propose un modèle minimal de six tables (scène 2). '
      + 'Il faut choisir la forme des tables maintenant : l’import (lot L1), l’affichage (U1) et l’oracle (O1) en dépendent tous (§7).',
    dependsOn: ['D1'],
    recommendation: '(a) couvre exactement les besoins listés au §6.3 avec six tables nommées en clair, dont la boucle de validation ; ce qu’il ne fait pas (fil de discussion libre, états archiver, classer, lier, épingler, évaluation en ligne) reste possible plus tard, sans le défaire.',
  }, [
    o('a', '(a) Modèle minimal « besoins de Steve » (6 tables)',
      ['Une table par besoin réel : provenance, annotations vivantes, validations, codes et critères, objets visés, oracle gelé.', 'Aucune perte : toutes les cellules sont gardées ; une révision remplace sans effacer.', 'Signaux visés par ville + id texte, la clé du graphe décidée pour #812 : survit à la ré-extraction.', 'Le moins de code d’import et de migration parmi les options utiles.'],
      ['Pas de fil de discussion libre ni d’états archiver, classer, lier, épingler au premier lot (assumé, §6.3).', 'Une file de rapprochement (identifiants abrégés, ambiguïtés) reste à traiter à la main.']),
    o('b', '(b) Modèle complet en couches (version précédente)',
      ['Prévoit d’emblée les réponses de l’équipe (projection Comment) et plusieurs jeux d’étiquettes.', 'Sépare lignes brutes et évaluations, référentiels en trois tables distinctes.'],
      ['Neuf tables nouvelles et une migration plus lourde à écrire et tester.', 'Des tables sans usage immédiat (projection, jeux d’étiquettes) : coût sans besoin exprimé par Steve.', 'Plus de code d’import que l’option a.']),
    o('c', '(c) Table de contrôle seule (oracle)',
      ['Rapide : une table.', 'Respecte le précédent du 2026-06-11 : la mesure ne nourrit pas la production.'],
      ['Rien d’affichable : ne répond pas à #784 (« attaché à l’élément associé »).', 'Steve ne voit pas ses retours dans l’outil.', 'Une seconde structure sera nécessaire plus tard pour l’affichage.']),
    o('d', '(d) Attendre le paquet sentropic complet',
      ['Aucune dette côté radar : tout vit dans sentropic.', 'Aucune migration à écrire ni à maintenir maintenant.'],
      ['Bloquant sans date : #784 et l’oracle attendent.', 'Le paquet ne porte de toute façon ni verdict structuré ni provenance (§6.1).']),
  ]),
  q('D3', 'D3 — Ancre signal et correctif B0', 'a', {
    intro: 'Une ancre est la référence qui attache une annotation à un objet du radar (signal, ville, zone, lot…) ; c’est une ligne de la table annotation_cibles (ville + id texte, scène 2). '
      + 'Aujourd’hui l’annotation d’un signal est cassée : l’UI envoie l’identifiant texte du graphe (« signal-… »), alors que l’API exige un UUID, identifiant aléatoire de l’ancienne table signals que plus aucun code n’alimente (§6.1, défaut 1). '
      + '« B0 » est le petit lot correctif qui répare cela (§7). Sans ancre fiable, aucun retour de Steve ne s’affiche sur son signal. '
      + 'Risque connu : une ré-extraction du graphe peut supprimer ou renommer des identifiants (graph-store.ts, §6.1).',
    dependsOn: ['D2'],
    recommendation: '(a) avec B0 tout de suite : c’est le seul choix qui rend l’annotation de signal utilisable maintenant et qui ne perd rien à la ré-extraction. Une clé métier stable reste un suivi séparé.',
  }, [
    o('a', '(a) Clé texte namespacée + instantané observé, B0 immédiat',
      ['Survit à la ré-extraction : l’ancre passe « disparue » au lieu d’effacer l’annotation, et l’instantané observé (ville, date, type, verbatim) reste lisible.', 'Répare tout de suite l’annotation existante (B0, taille S).', 'Aucune clé étrangère vers le graphe, donc aucune suppression en cascade.'],
      ['Si l’extraction renomme un identifiant, un rapprochement est nécessaire (file de revue).', 'La clé texte n’est pas une identité métier définitive.']),
    o('b', '(b) Attendre une clé métier stable',
      ['Identité propre et stable par conception.', 'Évite plus tard tout rapprochement d’identifiants.'],
      ['Dépend d’une ontologie qui n’existe pas : bloquant, sans date.', 'L’annotation de signal reste cassée en attendant.']),
    o('c', '(c) Passer par l’UUID signals',
      ['Contrat v1 (migration 0011) inchangé.', 'Aucune nouvelle colonne d’ancre à créer.'],
      ['Aucune insertion dans signals sur main : l’ancre est impossible en pratique.', 'Maintient le défaut actuel (refus 400 attendu).']),
  ]),
  q('D4', 'D4 — Conformité sentropic et suppression', 'a', {
    intro: 'Les annotations doivent suivre le contrat du module comments de sentropic, la plateforme commune (exigence E3, §6.1). '
      + 'Ce module, en version 0.2.0, supprime physiquement un commentaire ; or l’owner a décidé (O1, dossier COLLAB) qu’une suppression laisse une trace (« tombstone ») et une durée de rétention. '
      + 'Il faut décider comment être conforme sans contredire O1, avant l’import (L1) et l’API de lecture (L2). '
      + 'Concrètement : peut-on supprimer un retour de Steve, et par quel chemin ? Dans la scène 2, comment_projection relie une évaluation publiée à son fil de commentaires.',
    dependsOn: ['D2'],
    recommendation: '(a), puis adoption du port complet quand sentropic publiera la version avec tombstone. Réserve : le dossier COLLAB n’est pas sur main (non vérifié) ; s’il était abandonné, (b) redeviendrait défendable.',
  }, [
    o('a', '(a) Cibles et lecture conformes, import immuable, demande de tombstone',
      ['Respecte O1 et la ligne COLLAB « le paquet porte l’intégrité ».', 'Livrable maintenant : cibles et lecture conformes, sans modifier le paquet.', 'Premier lot en lecture seule : aucune suppression à gérer tant que le paquet n’a pas de tombstone.'],
      ['Conformité partielle : pas encore le port complet CommentStore.', 'Une demande à sentropic (tombstone) à suivre.', 'Une migration vers le port complet plus tard.']),
    o('b', '(b) Adaptateur CommentStore à tombstone hôte',
      ['Port complet utilisé dès maintenant.', 'Un seul chemin d’écriture et de lecture : celui du port.'],
      ['Contredit COLLAB §2 : un tombstone porté seulement par Radar est un piège.', 'Un delete qui ne supprime pas trahit la sémantique du port.', 'Dette à défaire quand sentropic livrera.']),
    o('c', '(c) Attendre le port complet',
      ['Conformité intégrale, aucun écart.', 'Aucune migration ultérieure vers le port complet.'],
      ['Bloquant tant que sentropic n’a pas livré, sans date.', 'Rien d’affiché pour Steve en attendant.']),
  ]),
  q('D9', 'D9 — Sens de « double annotation » (point ouvert)', null, {
    intro: 'La demande initiale parle de « double annotation (ancienne / nouvelle) » sans dire ce qui est comparé à quoi. '
      + 'Le modèle retenu (D2) garde le verdict de Steve dans annotations ; les autres jeux (adjudication C, prédiction C) vivent dans les versions gelées de l’oracle, et la classification du radar se recalcule (§6.6) : les trois lectures sont donc possibles techniquement. '
      + 'Mais chacune produit une mesure différente et fixe ce que l’oracle (D10) comparera : il faut la préciser avant de geler l’oracle de ciblage. '
      + 'Le sens de la demande appartient à Fabien.',
    dependsOn: ['D2'],
    recommendation: 'Point ouvert : aucune option recommandée. La lecture (1) est celle que le dossier a modélisée (§6.6) ; les trois tiennent dans le même schéma.',
  }, [
    o('1', 'Steve contre classification radar',
      ['Mesure directement l’écart entre ce que Steve juge et ce que le radar montre (B aujourd’hui, C demain).', 'C’est la lecture qui sert la bascule B → C (D13).'],
      ['La classification serveur de septembre n’est pas archivée : la version radar sera reconstituée, en partie.', 'Ne mesure pas l’accord entre deux humains.']),
    o('2', 'Ancienne grille de Steve contre grille C',
      ['Suit l’évolution des critères de Steve dans le temps.', 'Utile si Steve réétiquette ses lignes avec les critères C.'],
      ['Exige un second passage de Steve sur les mêmes lignes.', 'Ne dit rien de la qualité du radar.']),
    o('3', 'Oracle 676 contre oracle Steve',
      ['Relie l’extraction (oracle E) et le ciblage (oracle C).', 'Réutilise deux références déjà constituées (674/676 et le tableur).'],
      ['Compare deux questions différentes : « a-t-on extrait l’acte ? » contre « fallait-il le montrer ? ».', 'Recouvrement des deux corpus probablement faible (non vérifié).']),
  ]),
  q('D10', 'D10 — Oracle #783', 'b', {
    intro: 'Un oracle est un jeu de réponses de référence qui note automatiquement le radar. L’oracle actuel (674 unités committées, 676 en copie locale) note l’extraction des actes dans les procès-verbaux, pas le choix des signaux à montrer (§9.3). '
      + 'Les retours de Steve sont la première vérité humaine sur ce choix : dans sa vue de travail, 24 signaux sur 73 sont du bruit (32,9 %, scène 1). '
      + 'Il faut décider comment construire l’oracle de ciblage (#783) avant de développer C (D7), car c’est lui qui dira si C fait mieux que B (D13). '
      + 'Dans la scène 3, l’oracle est la bande du bas : hors ligne, alimenté par les annotations en base. '
      + 'La proposition complète (ancien oracle → nouvel oracle, construction, gel, validation) est au §9.3.',
    dependsOn: ['D2', 'D9'],
    recommendation: 'Double oracle : c’est la seule façon de mesurer l’utilité (ciblage) sans perdre la mesure de l’extraction ; campagne nouvelle seulement pour ce que les archives ne permettent pas d’évaluer. Unité : le signal, regroupé par dossier ; une unité « dossier » serait plus fidèle mais dépend d’une clé de règlement peu fiable (C-26).',
  }, [
    o('a', 'Remplacer v3 par le tableur',
      ['Rapide : une seule source.', 'Aucune adjudication supplémentaire à organiser.'],
      ['Les retours ne portent que sur ce que l’écran affichait : échantillon biaisé, les sept dossiers manqués restent invisibles.', 'Perd l’historique de l’extraction et la comparabilité des benchmarks passés.']),
    o('b', 'Double oracle E / C, jeu test indépendant',
      ['Mesure séparément « a-t-on extrait l’acte ? » (E) et « fallait-il le montrer ? » (C).', 'Jeu test indépendant : les 52 villes suivantes de Steve, jamais vues pendant le réglage (51 villes de développement).', 'Partition par dossier : pas de fuite entre développement et test.'],
      ['Adjudication nommée et corpus de test coûtent du travail (Steve, l’équipe).', 'Deux oracles à versionner et geler par empreinte (sha256).']),
    o('c', 'Campagne C entièrement nouvelle',
      ['Conçue pour le besoin réel, sans biais d’affichage.', 'Peut couvrir d’emblée les 52 villes restantes avec la méthode C.'],
      ['Comparaison moins directe avec l’historique.', 'Repart de zéro : délai et coût d’annotation les plus élevés.']),
  ]),
  q('D11', 'D11 — Benchmark #782', 'a', {
    intro: 'Le benchmark #782 compare des modèles et des réglages sur un même oracle. Si on y ajoute la mesure du ciblage (B, puis C), il faut décider si elle rejoint les métriques d’extraction ou forme un volet à part (§9.4). '
      + 'Le choix fixe aussi le sort du prompt d’extraction gelé (immo-pv-extraction-v9) : lui faire produire sens, effet et portée romprait la comparabilité des campagnes v10 et v11. '
      + 'Ce que verra Farid : un tableau unique, ou deux tableaux qui ne se mélangent pas.',
    dependsOn: ['D10'],
    recommendation: 'Volet ciblage séparé : c’est la condition pour comparer B et C sans casser l’historique de l’extraction.',
  }, [
    o('a', 'Volet ciblage séparé',
      ['Extraction et ciblage restent comparables chacun dans le temps.', 'Colonnes historique, B et C distinctes : l’effet de C se lit directement.', 'Tout changement du contrat d’extraction devient une nouvelle version, décidée à part.'],
      ['Deux tableaux à lire.', 'Pont entre les deux seulement sur les 100 documents du corpus commun.']),
    o('b', 'Métriques fusionnées',
      ['Un seul tableau, un seul score.', 'Lecture plus simple pour un public non technique.'],
      ['Mélange deux questions différentes : un F1 fusionné ne dit plus rien.', 'Perd la comparabilité avec les campagnes passées.']),
  ]),

  // ——— Étape 2 · Farid ———
  q('D5', 'D5 — Auteur des retours importés', 'c', {
    intro: 'Steve poursuivra son annotation dans l’application (vision owner, §6.3) : ses retours importés et ses annotations futures doivent porter le même auteur. '
      + 'Aujourd’hui il n’a pas de compte vérifié, et ce n’est pas lui qui lance l’import. '
      + 'Il faut décider qui est affiché comme auteur, sans usurper son identité ni effacer celle de l’importateur (exigence E5, §6.2). '
      + 'Effet visible : la ligne « auteur » de chaque annotation dans le panneau du signal, et le nom de qui valide ou conteste.',
    dependsOn: ['D2', 'D4'],
    recommendation: '(c) : Steve annote et valide avec son propre compte ; ses retours importés lui sont attribués, l’importateur est tracé à part. (a) ne vaut que si la création du compte tarde.',
  }, [
    o('a', '(a) Auteur documentaire externe + importateur tracé',
      ['Le contenu est attribué à son vrai auteur sans attendre la création d’un compte.', 'L’importateur réel est tracé : on sait qui a chargé quoi.'],
      ['Steve ne peut ni annoter ni valider dans l’application sous ce nom externe.', 'Deux identités pour la même personne le jour où il aura un compte.']),
    o('b', '(b) Importateur seul comme auteur',
      ['Aucune identité externe à gérer.', 'Aucun libellé spécial à afficher.'],
      ['Le texte de Steve est attribué à l’importateur : faux pour le lecteur.', 'Perd la valeur de la parole du client et empêche la boucle de validation.']),
    o('c', '(c) Compte Steve, pour l’import et la saisie',
      ['Une seule identité : ses retours importés et ses annotations futures portent son compte.', 'Il annote, trie et répond aux contestations lui-même dans l’application.', 'L’importateur reste tracé à part (importe_par).'],
      ['Compte à créer et vérifier avant l’import.', 'Droits à cadrer : Steve annote, l’équipe ou le PO valide.']),
  ]),
  q('D6', 'D6 — Visibilité et données personnelles', 'c', {
    intro: 'Le constat C-79 de Steve signale des noms de particuliers en clair dans des résumés de signaux (§5.6) ; les verbatims importés peuvent en contenir aussi. '
      + 'Règle actuelle des notes (migration 0011) : tout utilisateur approuvé lit tout. '
      + 'Il faut décider qui voit les retours et s’ils sont caviardés avant le premier affichage (U1), au regard de la Loi 25 (exigence E9). '
      + 'Le module comments de sentropic ne masque pas les données personnelles : c’est au radar de le faire (D4, D5).',
    dependsOn: ['D4', 'D5'],
    recommendation: '(c) : toute l’équipe garde l’accès aux retours, et les noms de particuliers sont masqués, dans les retours comme dans les résumés de signaux.',
  }, [
    o('a', '(a) Tous les approuvés, sans caviardage',
      ['Règle existante, aucun travail.', 'Toute l’équipe voit tout.'],
      ['Expose des noms de particuliers.', 'Ne répond pas à la demande C-79 de Steve.']),
    o('b', '(b) Administrateurs et Steve',
      ['Exposition minimale.', 'Aucun caviardage à développer.'],
      ['L’équipe produit ne voit pas les retours : on perd l’intérêt de les afficher.', 'Gestion de droits spécifique à construire.']),
    o('c', '(c) Approuvés, verbatims caviardés',
      ['Toute l’équipe voit les retours.', 'Noms de particuliers masqués dans les retours et dans les résumés de signaux : répond à C-79.'],
      ['Détection des données personnelles à écrire et tester (colonne pii_status).', 'Un caviardage peut masquer un nom utile (élu, promoteur) : règles à préciser.']),
  ]),
  q('D7', 'D7 — Définition de C v1', 'K', {
    intro: 'C est la nouvelle sélection de signaux proposée, alignée sur les trois critères de Steve : résidentiel, assouplissement, densification (§2.2, scène 1). Aujourd’hui, deux de ces trois critères n’ont aucune donnée au radar. '
      + 'Steve pose une réserve : un signal dont le sens n’est pas lisible doit rester affiché (« masquer ce qui n’a pas pu être lu transformerait une lacune en dossier manqué »). '
      + 'Il faut fixer la règle de C avant de la développer (lot C1) ; elle sera mesurée par l’oracle de ciblage (D10), sur la lecture de la double annotation retenue (D9). '
      + 'Les critères K1 à K9 sont détaillés au §9.2.',
    dependsOn: ['D9', 'D10'],
    recommendation: 'K1–K9 + trois états, après relecture de la table de dérivation par Steve : c’est la seule règle qui applique ses trois critères sans masquer ce qui n’a pas pu être lu. Aucun seuil de taille de projet ni filtre sur l’origine privée.',
  }, [
    o('S', 'Triplet strict pour toute visibilité',
      ['Flux court et lisible : seulement ce qui réunit les trois critères (22 sur 73).', 'Plus simple à calculer : un signal entre ou non.'],
      ['Masque les indéterminés : contredit la réserve explicite de Steve.', 'Perte de rappel sur les dossiers mal lus.']),
    o('K', 'K1–K9 + trois états',
      ['Respecte les trois critères et la réserve : on ne masque que ce qui est établi hors critères.', 'Trois états (confirmé, à instruire, exclu prouvé) et deux compteurs : un cas incertain n’est pas présenté comme une opportunité.'],
      ['Le flux garde du travail manuel (les « à instruire »).', 'Exige des extractions nouvelles (sens, effet sur les unités, portée) : lot C1 de taille L.']),
    o('T', 'B inchangé, critères pour trier',
      ['Aucun changement d’appartenance, aucun risque.', 'Aucune extraction nouvelle à développer.'],
      ['Le bruit connu (24 sur 73) persiste.', 'Ne répond pas à Steve : « ce n’est pas une question de hiérarchie ».']),
  ]),
  q('D8', 'D8 — Cas contradictoires (Saint-Victor, Amos, CPTAQ, seconds projets, ODJ, S-RESTRICTIF)', 'a', {
    intro: 'Certains cas ne se tranchent pas par une règle automatique : Saint-Victor (un resserrement qui favorise pourtant la densification), Amos (logement sur commerce), portée de l’exception CPTAQ, seconds projets, points d’ordre du jour, trois restrictions « À surveiller » (§9.2). '
      + 'Le tableur et l’analyse de Steve se contredisent parfois sur ces cas. '
      + 'Il faut décider qui les arbitre avant de geler l’oracle (D10) et la règle C (D7) ; sinon l’oracle sanctionnera le bon comportement.',
    dependsOn: ['D7', 'D10'],
    recommendation: '(a) : la règle reste celle du client, et les cas ouverts ne faussent pas la mesure pendant qu’ils sont arbitrés.',
  }, [
    o('a', 'Revue métier, abstention en attendant',
      ['Steve et Mathieu tranchent sur exemples et preuves : la règle reste celle du client.', 'En attendant, abstention explicite : ces cas ne comptent ni pour ni contre.'],
      ['Demande du temps à Steve et Mathieu.', 'Quelques cas restent ouverts plus longtemps.']),
    o('b', 'Arbitrage par l’équipe',
      ['Plus rapide.', 'Ne mobilise ni Steve ni Mathieu.'],
      ['Risque de prêter à Steve une règle qu’il n’a pas posée.', 'L’oracle refléterait l’avis de l’équipe, pas celui du client.']),
    o('c', 'Statu quo',
      ['Aucun effort.', 'L’oracle peut être gelé tout de suite.'],
      ['Cas sans statut dans l’oracle : mesures faussées.', 'Désaccords invisibles.']),
  ]),
  q('D12', 'D12 — Exposition A/B/C (point ouvert)', 'a', {
    intro: 'Aujourd’hui l’écran montre la sélection B ; le sélecteur A/B a été retiré en août (§9.1). '
      + 'La demande initiale parle d’un « mécanisme A/B étendu en C », mais les règles de partage validées le 1er octobre (#787, item 4) demandent de ne pas réintroduire de choix entre plusieurs viviers. '
      + 'Les deux lectures sont défendables (§9.5) : Farid tranche. '
      + 'Concrètement : Steve verra-t-il un sélecteur A/B/C, ou une seule sélection qui change le jour où C est prouvée meilleure (D13) ? La règle C (D7) et sa mesure (D10, D11) doivent être connues.',
    dependsOn: ['D7', 'D10', 'D11'],
    recommendation: '(a), avec des emprunts à (c) : interface simple pour Steve, conforme à #787, retour arrière immédiat. Si Farid veut un sélecteur visible, (b).',
  }, [
    o('a', '(a) C en shadow, comparaison réservée UAT, puis remplacement de B',
      ['Conforme à #787 : aucun choix de vivier pour les utilisateurs.', 'Interface simple, comme Steve le demande.', 'Retour arrière simple : désactiver C.'],
      ['Steve ne voit C qu’en UAT (mode réservé) avant la bascule.', 'La comparaison reste un outil interne.']),
    o('b', '(b) Sélecteur A/B/C visible + mode comparatif',
      ['Littéralement « A/B étendu en C ».', 'L’utilisateur compare lui-même les sélections.'],
      ['Réintroduit un choix de viviers, contraire à #787 (item 4).', 'Plus complexe à expliquer et à maintenir (paramètre filter.targeting).']),
    o('c', '(c) Incréments dans B',
      ['Aligné avec #761 ; livrable par petits morceaux (sens, plein droit, second projet).', 'Chaque amélioration est visible pour Steve dès sa livraison.'],
      ['Pas de mesure d’ensemble B contre C.', 'Les filtres Résidentiel et Zonage restent.']),
    o('d', '(d) Application C séparée',
      ['Liberté totale de simplification.', 'Aucun risque pour l’écran actuel de Steve.'],
      ['Duplique sélection, filtres et notes.', 'Deux applications à maintenir.']),
  ]),
  q('D13', 'D13 — Seuil de bascule B → C (à fixer)', 'a', {
    intro: 'Si C tourne en parallèle de B (D12), il faut écrire à l’avance quand C remplace B ; sans seuil écrit, la bascule se décidera à l’impression. '
      + 'La mesure viendra de l’oracle de ciblage (D10), sur le jeu test des 52 villes, dans le volet ciblage du benchmark (D11). '
      + 'Point de départ mesuré sur l’échantillon de Steve : précision P ∪ S de B = 67,1 % (49 sur 73) ; 34 des 40 Pertinent visibles en passe 1 (§9.3). '
      + 'Proposition à amender par Farid dans le commentaire.',
    dependsOn: ['D10', 'D11', 'D12'],
    recommendation: '(a) : garantit qu’aucun dossier utile ne disparaît et que C fait réellement mieux que B, sur des écrans cohérents entre eux. Résidentiel et Zonage ne sont retirés qu’après une décision #761 fondée sur la mesure.',
  }, [
    o('a', 'Aucun P masqué, précision P ∪ S > B, parité',
      ['Protège la réserve de Steve : aucun Pertinent masqué.', 'Exige un gain réel de précision, pas seulement un affichage plus court.', 'Parité API, rail, carte, panneau : aucun écart entre écrans (#786).'],
      ['Demande le jeu test complet (52 villes) avant de basculer.', 'La bascule peut tarder si un seul Pertinent est perdu.']),
    o('b', 'Seuil chiffré différent',
      ['Farid fixe ses propres chiffres (à écrire dans le commentaire).', 'Peut refléter un compromis métier que Farid connaît mieux.'],
      ['À préciser.', 'Risque d’un seuil non mesurable par l’oracle.']),
    o('c', 'Bascule sur recette seule',
      ['Rapide : recette de Farid seulement.', 'Ne dépend pas de l’achèvement du jeu test.'],
      ['Sans mesure, aucune garantie de non-régression.', 'Contraire à l’objet de l’oracle de ciblage.']),
  ]),
  q('D14', 'D14 — Première livraison UI', 'a', {
    intro: 'Une fois les retours en base, il faut les montrer. L’UI est en migration : 39 composants Svelte sur 69 utilisent le design system, les 3 composants d’annotation aucun, et la carte Signaux est un composant local MapLibre de 2 761 lignes destiné à être remplacé (§8, scène 4). '
      + 'Il faut choisir où le retour de Steve apparaît en premier : dans le panneau du signal et le rail, ou directement sur la carte. '
      + 'Le choix décide si #784 avance sans attendre la migration geo. Il suppose l’ancre réparée (D3), la lecture conforme (D4) et la règle de visibilité (D6).',
    dependsOn: ['D3', 'D4', 'D6'],
    recommendation: '(a) : valeur visible tout de suite, sans investir dans un composant de carte destiné à être remplacé.',
  }, [
    o('a', '(a) Panneau + rail + DS ciblé',
      ['Valeur immédiate : badge et section « Avis de Steve » dans le panneau, compteurs P / S / N dans le rail.', 'Aucun code ajouté à un composant à remplacer.', 'Les 3 composants d’annotation migrent au design system dans le même lot.'],
      ['Pas d’indicateur sur la carte au premier lot.', 'Les badges par signal exigent la lecture groupée du lot L2.']),
    o('b', '(b) Pastilles sur la carte actuelle dès L3',
      ['Visibilité cartographique immédiate.', 'L’ancre ne dépend pas du moteur de carte.'],
      ['Code ajouté à un composant de 2 761 lignes voué au remplacement.', 'Double travail à la migration geo.']),
    o('c', '(c) Migration geo complète d’abord',
      ['Expérience cohérente d’emblée.', 'Aucun code d’annotation à reprendre après la migration.'],
      ['Dépend de la « Porte 2 » (moteur geo désactivé aujourd’hui).', 'Retarde #784 sans date.']),
    o('d', '(d) Tableau de retours séparé seul',
      ['Toute la donnée consultable en un seul écran.', 'Utile comme outil de curation des rattachements.'],
      ['N’annote pas l’élément associé : ne répond pas à #784.', 'Un écran de plus.']),
  ]),
  q('D15', 'D15 — Séquencement', 'a', {
    intro: 'La priorité n° 1 de Steve reste la fraîcheur des signaux (#703, rafraîchissement quotidien). Le travail de ce dossier peut avancer en parallèle ou attendre. '
      + 'B0 (D3), l’import (L1) et l’oracle (O1, D10) ne touchent pas la chaîne de rafraîchissement ; le classifieur C (C1), lui, a besoin de signaux frais (§12). '
      + 'Le choix fixe quand Steve verra ses retours dans l’outil (D14).',
    dependsOn: ['D3', 'D10', 'D14'],
    recommendation: '(a) : livre tôt ce qui ne gêne pas le rafraîchissement, et garde C1 pour après sa stabilisation.',
  }, [
    o('a', '(a) B0, import et oracle en parallèle de la fraîcheur',
      ['Valeur livrée tôt : annotation réparée, retours visibles, oracle prêt.', 'Aucune interférence avec la chaîne de rafraîchissement.', 'C1 démarre sur des signaux stabilisés.'],
      ['Deux chantiers en parallèle à suivre.', 'L’attention de l’équipe est partagée.']),
    o('b', '(b) Tout après #703',
      ['Une seule priorité à la fois.', 'Aucun risque d’interférence, même indirecte, avec le rafraîchissement.'],
      ['Rien de visible pour Steve sur ses retours avant #703.', 'L’annotation de signal reste cassée plus longtemps.']),
  ]),
  q('D16', 'D16 — Retour à Steve', 'a', {
    intro: 'Steve a reconstitué le fonctionnement des filtres en observant l’écran, et écrit qu’« une seule réponse des développeurs remplacerait toute cette reconstitution » (R-16, §5.7). Le dossier a confronté sa reconstitution au code. '
      + 'Il faut décider si on lui renvoie maintenant la définition réelle des filtres et la table qui relie ses codes de motif aux critères C (D7, D8), ou si on attend C.',
    dependsOn: ['D7', 'D8'],
    recommendation: 'Renvoyer, par Mathieu et Farid après relecture : répond à sa question et lui permet de corriger la table de dérivation avant que C soit développée.',
  }, [
    o('a', 'Renvoyer filtres réels et table de dérivation',
      ['Répond directement à sa demande R-16.', 'Lui permet de corriger la table de dérivation avant le développement de C.', 'Renforce la confiance du client.'],
      ['Un aller-retour à préparer (relecture par Mathieu et Farid).', 'Une partie de ses observations date de septembre, en partie périmée depuis #793.']),
    o('b', 'Ne rien renvoyer avant C',
      ['Évite un aller-retour intermédiaire.', 'La réponse portera directement sur C, déjà développée.'],
      ['Steve continue à deviner le fonctionnement des filtres.', 'Erreurs de dérivation découvertes trop tard.']),
  ]),
];

// Each option: a description of what is concretely proposed and, for D2 and D3, a small
// entity-relationship diagram.
for (const question of questions) for (const option of question.options) {
  option.description = DESCRIPTIONS[question.key]?.[option.key];
  if (!option.description) throw Error(`missing description ${question.key}/${option.key}`);
  option.diagram = DIAGRAMS[question.key]?.[option.key] ?? null;
}

// Decisions that build on each one (reverse of dependsOn), for the "conditionne" line.
export const usedBy = Object.fromEntries(questions.map(question => [question.key,
  questions.filter(other => other.dependsOn.includes(question.key)).map(other => other.key)]));

export const minimalValidAnswer = 'Une option par décision D1 à D16 ; à défaut, au minimum D9, D12 et D13, les trois points ouverts';

// The block the copy button puts in the clipboard: ```yaml, the YAML, ```.
// `manifest.htmlSha256` is the page's own hash, injected by portable.mjs.
export function exportBlock(manifest, state, person, scope = 'mine', now = new Date()) {
  const header = {
    dossier: manifest.title, fichier: manifest.dossier.split('/').pop(),
    version: `${DOSSIER_REVISION} · sha256:${manifest.htmlSha256}`,
    decideur: person, date: isoWithOffset(now), coller_dans: DECISIONS_TARGET_URL,
  };
  const records = decisionRecords(questions, state, person, scope);
  return { records, text: markdownBlock(decisionsYaml(header, records)) };
}

// Reserved for the backend connection: kept internal, not exposed in the page.
export function responsePack(manifest, selections = {}, comments = {}, capturedAt = null) {
  const responses = questions.map(question => {
    const raw = selections[question.key];
    const selection = question.mode === 'multi' ? [...(raw ?? [])] : (raw ?? null);
    const known = new Set(question.options.map(option => option.key));
    for (const value of question.mode === 'multi' ? selection : [selection].filter(v => v !== null)) {
      if (!known.has(value)) throw Error(`Unknown option ${value} for ${question.key}`);
    }
    const answered = question.mode === 'multi' ? selection.length > 0 : selection !== null;
    return {
      key: question.key, group: question.group, question: question.question, mode: question.mode,
      recommended: question.recommended, decides: question.decides, consulted: question.consulted,
      selection, decisionStatus: answered ? 'owner-draft-not-ratified' : 'open',
      comment: comments[question.key] ?? '',
      options: question.options.map(option => ({ key: option.key, title: option.title, description: option.description, pros: option.pros, cons: option.cons })),
    };
  });
  return {
    schema: 'immo-steve-decision-owner-response/v1',
    dossier: manifest.dossier, dossierHash: manifest.dossierHash,
    artifactInputHash: manifest.artifactInputHash, capturedAt,
    status: 'draft-not-ratified',
    authority: 'brouillon local : aucune migration, aucun import, aucun acte de production, aucune fusion de PR, aucun événement track',
    minimalValidAnswer, responses,
  };
}
