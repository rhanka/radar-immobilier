// Les choix exposés sont exactement les décisions G1 à G8 (annexe II) et D1 à D17 (ch. 10) du dossier
// « retours de Steve », dans l'ordre de décision (Fabien, puis Farid). Une réponse par décision.
// Rien n'est ratifié ici : la page ne produit qu'un brouillon local exportable.
import roles from './roles.json' with { type: 'json' };
import { decisionRecords, decisionsYaml, isoWithOffset, markdownBlock } from './decision-yaml.js';
import { DESCRIPTIONS, DIAGRAMS } from './option-details.js';
import { GENERIC } from './generic-decisions.js';

// Export target, per dossier: the PR where Farid pastes his decisions.
export const DECISIONS_TARGET_URL = 'https://github.com/rhanka/radar-immobilier/pull/794';
export const DECISIONS_TARGET_LABEL = 'Ouvrir la PR #794 sur GitHub';
// The dossier carries no revision label: its date stands for the revision.
export const DOSSIER_REVISION = '2026-10-03';
// The "Je suis" selector. This dossier names no validation beside the decider,
// so a person's own decisions are the ones they decide.
export const PEOPLE = ['Farid', 'Fabien'];

// Ordre de décision : Fabien décide d'abord G1 à G8 puis ses huit décisions immo (D1 actée, architecture,
// données, jeu de référence, contrat d'entrée D17) ; une fois décidées, Farid ne les rouvre pas, sauf incohérence avec une autre décision.
// Farid décide ensuite les neuf siennes (produit, affichage, priorités), en connaissant
// les choix de Fabien. Chaque décision : une introduction (problème, pourquoi maintenant,
// ce qui change selon le choix, renvois au dossier), ses dépendances, puis des options
// avec avantages et inconvénients. Identifiants, décideurs et options inchangés.
export const STEPS = [
  { id: 'fabien', step: 1, decides: 'Fabien', label: 'Étape 1 · Fabien décide d’abord (décisions génériques G1 à G8, puis architecture, données, jeu de référence)' },
  { id: 'farid', step: 2, decides: 'Farid', label: 'Étape 2 · Farid décide ensuite (produit, affichage, priorités)' },
];
export const SEQUENCE = 'Fabien décide d’abord les huit décisions génériques G1 à G8 (convergence sentropic + engram, §9.5 ; fiches en annexe II), puis ses huit décisions immo (D1, D2, D3, D4, D9, D10, D11, D17) : D1 et D17 sont déjà actées par Fabien (owner), ainsi que le volet « usage des 121 lignes » de D10 ; les autres sont à décider par Fabien et ne sont pas rouvertes par Farid, sauf incohérence avec une autre décision. '
  + 'Farid décide ensuite ses neuf décisions (D5, D6, D7, D8, D12, D13, D14, D15, D16), en connaissant les choix de Fabien. '
  + 'Si un choix de Farid contredit un choix de Fabien (par exemple D1 « tout conserver » avec D2 = (c), une table de contrôle qui n’affiche rien), on revient à Fabien sur ce seul point.';

const q = (key, question, recommended, text, options) => ({
  key, mode: 'single', question, recommended, options,
  step: roles[key][0] === 'Fabien' ? 1 : 2, group: STEPS.find(step => step.decides === roles[key][0]).label,
  intro: text.intro, dependsOn: text.dependsOn ?? [], recommendation: text.recommendation, decided: text.decided ?? null, family: text.family ?? 'immo',
  decides: roles[key][0], consulted: roles[key][1], validators: [],
});
const o = (key, title, pros, cons, description) => ({ key, title, pros, cons, description });

export const questions = [
  // ——— Étape 1 · Fabien : décisions génériques G1 à G8 (convergence sentropic + engram), puis immo ———
  ...GENERIC.map(g => q(g.key, g.question, g.recommended, { intro: g.intro, dependsOn: g.dependsOn, recommendation: g.recommendation, family: 'générique' },
    g.options.map(option => o(option.key, option.title, option.pros, option.cons, option.description)))),
  q('D1', 'D1 — Périmètre de conservation des retours de Steve', 'b', {
    decided: { option: 'b', by: 'Fabien (owner)', date: '2026-10-04', note: 'Actée par Fabien (owner) le 2026-10-04 : on conserve tous les retours de Steve ; il en a besoin pour le jeu de référence.' },
    intro: 'Décision actée par Fabien (owner) le 2026-10-04 : on conserve tous les retours de Steve ; c’est sa décision, il en a besoin pour le jeu de référence. '
      + 'Steve a livré un classeur de 7 feuilles (124 lignes de triage, 121 contrôles d’exclusion, 77 constats, 26 règles, 28 codes de motif) et une analyse écrite qui pose ses trois critères (§2, §4.2). '
      + 'Ce choix fixe ce que l’équipe pourra montrer sur les objets du radar et ce que le jeu de référence pourra mesurer (D10). '
      + 'Conséquence pour D2 : « tout conserver » suppose un modèle qui garde toutes les lignes, l’option a (ou b) de D2.',
    dependsOn: [],
    recommendation: 'Tranchée : (b), tout conserver, actée par Fabien (owner) le 2026-10-04 ; les options a et c restent affichées pour mémoire.',
  }, [
    o('a', '(a) Triage seul',
      ['Rapide : une feuille, 124 lignes.', 'Moins de rattachements à vérifier à l’import.'],
      ['Perd les 121 contrôles d’exclusion, là où se trouvent les faux négatifs, ainsi que les constats et les règles.', 'Jeu de référence incomplet : impossible de mesurer ce que les filtres cachent à tort.']),
    o('b', '(b) Tout le classeur et l’analyse, brut immuable',
      ['Aucune perte : chaque cellule, formule et valeur mémorisée.', 'Le jeu de référence (D10) dispose des exclusions et des règles.', 'Les 52 villes suivantes s’importeront de la même façon.'],
      ['Plus de tables et de curation (rattachements à vérifier).', 'Import un peu plus long à écrire et à recetter.']),
    o('c', '(c) Notes libres seules',
      ['Surface existante : les notes des lots et des signaux.', 'Aucun schéma nouveau : livrable vite.'],
      ['Perd la structure (classement, motif, sens), les groupes et la provenance.', 'Inutilisable pour le jeu de référence ; une note est limitée à 10 000 caractères.']),
  ]),
  q('D2', 'D2 — Modèle de données immo : adoption du générique', 'a', {
    intro: 'La convergence sentropic + engram (G2, G7) attribue les annotations, révisions et validations à un paquet générique, @sentropic/annotations, et le jeu de référence à engram ; elle recommande qu’immo ne construise pas ses propres tables. '
      + 'Il reste à décider comment immo s’y inscrit : en premier adoptant, qui apporte un profil (schéma d’étiquettes : verdicts, 28 motifs, critères, sens) et ses données (graphe, documents, rattachements geo, classeur de Steve), ou en construisant d’abord six tables à lui. '
      + 'L’état initial et l’état proposé, objet par objet et par propriétaire, sont à l’annexe III et au §9.2 ; les besoins de Steve au §9.1. '
      + 'L’import (L1), l’affichage (U1, U2) et le jeu de référence C (O1) en dépendent.',
    dependsOn: ['D1', 'G2', 'G7'],
    recommendation: '(a) : aucun double travail, les besoins de Steve deviennent la recette du paquet générique, et immo ne garde que ce qui lui est propre (profil, données, résolveur d’ancres, écrans). (b) ne vaut que si le paquet générique prend un retard non borné.',
  }, [
    o('a', '(a) Adopter le générique : immo = profil + données',
      ['Aucune table d’annotation propre à immo : pas de migration ultérieure.', 'Les besoins de Steve servent de recette au paquet générique, sur le PG et le S3 d’immo.', 'Mêmes règles de version, de validation et de jeu de référence que les autres domaines (BPMN).'],
      ['Dépend du calendrier de @sentropic/annotations (G-L2) et d’engram (G-L0, G-L1).', 'Un profil de domaine à écrire et à faire valider (schéma d’étiquettes, règle D13).']),
    o('b', '(b) Six tables immo, puis migration',
      ['Livrable sans attendre le générique.', 'Modèle déjà décrit et testé dans les versions précédentes du dossier.'],
      ['Réimplémentation que la convergence déconseille (« prevent each new app … from inventing a private model »).', 'Migration vers @sentropic/annotations à faire ensuite, avec reprise des données.', 'Deux modèles à maintenir pendant la transition.']),
    o('c', '(c) Table de contrôle seule (jeu de référence)',
      ['Rapide : une table.', 'Respecte le précédent du 2026-06-11 : la mesure ne nourrit pas la production.'],
      ['Rien d’affichable : ne répond pas à #784 (« attaché à l’élément associé »).', 'Steve ne peut ni annoter ni valider dans l’application.', 'Une seconde structure sera nécessaire plus tard.']),
    o('d', '(d) Attendre le générique sans borne',
      ['Aucun travail côté immo maintenant.', 'Aucune dette de transition.'],
      ['Steve ne voit rien dans l’outil tant que le paquet n’est pas livré.', 'Aucun délai : la recette de Steve n’est pas planifiée.']),
  ]),
  q('D3', 'D3 — Ancre signal et correctif B0', 'a', {
    intro: 'Une ancre est la référence qui attache une annotation à un objet du radar (signal, ville, zone, lot…) ; c’est une ligne de la table annotation_targets (ville + id texte, §9.2). '
      + 'Aujourd’hui l’annotation d’un signal est cassée : l’UI envoie l’identifiant texte du graphe (« signal-… »), alors que l’API exige un UUID, identifiant aléatoire de l’ancienne table signals que plus aucun code n’alimente (§9.3, défaut 1). '
      + '« B0 » est le petit lot correctif qui répare cela (§9.6). Sans ancre fiable, aucun retour de Steve ne s’affiche sur son signal. '
      + 'Risque connu : une ré-extraction du graphe peut supprimer ou renommer des identifiants (graph-store.ts, annexe III).',
    dependsOn: ['G2', 'D2'],
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
    intro: 'Modifiée par G2 et G3 : les annotations de Steve passent par @sentropic/annotations (révisions immuables, tombstone) ; D4 ne porte plus que sur les commentaires de l’équipe et la conformité de lecture. '
      + 'Les commentaires de l’équipe doivent suivre le contrat du module comments de sentropic, la plateforme commune (exigence E3, §9.3). '
      + 'Ce module, en version 0.2.0, supprime physiquement un commentaire ; or l’owner a décidé (O1, dossier COLLAB) qu’une suppression laisse une trace (« tombstone ») et une durée de rétention. '
      + 'Il faut décider comment être conforme sans contredire O1, avant l’import (L1) et l’API de lecture (L2). '
      + 'Concrètement : peut-on supprimer un commentaire de l’équipe, et par quel chemin ?',
    dependsOn: ['G2', 'G3', 'D2'],
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
      ['Bloquant tant que sentropic n’a pas livré, sans date.', 'Aucun fil de commentaires pour l’équipe en attendant.']),
  ]),
  q('D9', 'D9 — Sens de « double annotation » (clôture recommandée)', '4', {
    intro: 'La demande initiale parle de « double annotation (ancienne / nouvelle) » sans dire ce qui est comparé à quoi. '
      + 'La revue du plan (annexe IV) a retenu une lecture : la provenance par champ, où chaque étiquette du jeu de référence C v2 garde sa source (steve_v1, steve_v2a, steve_v2, steve_test, annotations IA individuelles, majorité IA) (§4.9). '
      + 'Les trois lectures initiales restent mesurables dans ce schéma, et D10 fixe déjà l’usage de chaque provenance. '
      + 'La proposition est de clore D9 en la fusionnant dans D10.',
    dependsOn: ['G1', 'D2'],
    recommendation: '(d) : clore D9. La provenance par champ couvre les trois lectures (Steve contre radar avec B′ recalculé, ancienne contre nouvelle annotation de Steve, rapprochement E / C) ; le sujet est porté par D10.',
  }, [
    o('1', '(a) Steve contre classification radar',
      ['Mesure directement l’écart entre ce que Steve juge et ce que le radar montre (B aujourd’hui, C demain).', 'C’est la lecture qui sert la bascule B → C (D13).'],
      ['La classification serveur de septembre n’est pas archivée : la version radar sera reconstituée, en partie.', 'Ne mesure pas l’accord entre deux humains.']),
    o('2', '(b) Ancienne grille de Steve contre grille C',
      ['Suit l’évolution des critères de Steve dans le temps.', 'Utile si Steve réétiquette ses lignes avec les critères C.'],
      ['Exige un second passage de Steve sur les mêmes lignes.', 'Ne dit rien de la qualité du radar.']),
    o('3', '(c) Jeu de référence 676 contre jeu de référence Steve',
      ['Relie l’extraction (jeu de référence E) et le ciblage (jeu de référence C).', 'Réutilise deux références déjà constituées (674/676 et le tableur).'],
      ['Compare deux questions différentes : « a-t-on extrait l’acte ? » contre « fallait-il le montrer ? ».', 'Recouvrement des deux corpus probablement faible (non vérifié).']),
    o('4', '(d) Clore D9 : provenance par champ, portée par D10',
      ['Une seule décision (D10) fixe le jeu de référence et l’usage de chaque provenance.', 'Les trois lectures restent mesurables : chaque étiquette garde sa source (label_provenance, versions de Steve).'],
      ['Le terme « double annotation » de la demande initiale sort du registre.', 'Suppose que D10 soit tranchée avec la provenance par champ explicite.']),
  ]),
  q('D10', 'D10 — Jeu de référence #783', 'b', {
    intro: 'Les 121 lignes retenues du relevé (51 villes) sont exposées : le pilote C v0 les a consommées et l’analyse d’écart les a lues avec toutes les colonnes de Steve (§4.1). '
      + 'Elles ne peuvent donc pas fonder seules un test confirmatoire, quel que soit le découpage. '
      + 'L’arbitrage de Fabien (owner) du 2026-10-05 leur donne deux usages : la mise au point des règles et des tags avec les 3 IA, et un découpage homogène par ville en train et test aveugle exploratoire pour les premiers prompts (ch. 6). '
      + 'L’extension à de nouvelles villes attend la clarification avec Steve des points listés au §4.8 (blocs A, B et D ; 28 points à clarifier après R′ v1, §4.6) ; la mesure qui fonde D13 exige un test neuf (ch. 7).',
    dependsOn: ['G1', 'G5', 'G7', 'D2', 'D9'],
    recommendation: '(b) : seule option qui utilise toutes les lignes de Steve pour la mise au point tout en gardant une mesure admissible pour D13. Les résultats sur les 121 lignes restent exploratoires ; le test neuf est annoté par Steve et, sur au moins 50 cas, par un second annotateur humain (ressource unknown). Le jeu E (extraction) reste séparé et inchangé. À arbitrer avec D13 et G4 : sans second annotateur, le résultat porte la mention single-human-annotator et peut être publié ; son admissibilité pour une bascule, alors que G4 (a) exige une référence human_adjudicated pour toute promotion, reste à décider.',
  }, [
    o('a', '(a) Lecture littérale : la moitié des 121 lignes en test',
      ['Aucune annotation neuve demandée à Steve.', 'Résultats disponibles tôt, sur des données déjà relues.'],
      ['Aucune mesure admissible pour D13 : le test est exposé.', 'Écartée par les 3 relecteurs de la revue du plan (annexe IV, A1).']),
    o('b', '(b) 121 lignes en mise au point et en découpage exploratoire, test confirmatoire neuf',
      ['Toutes les lignes de Steve servent : règles, tags, premiers prompts.', 'Seule voie vers une mesure admissible pour D13 (test neuf, scellé selon G5 b).', 'Fiabilité de la référence mesurée par un second annotateur humain.'],
      ['Annotation neuve par Steve : volume unknown tant que la faisabilité n’est pas chiffrée (annexe I).', 'Second annotateur humain : ressource unknown à ce jour.']),
    o('c', '(c) Campagne C entièrement nouvelle',
      ['Conçue pour le besoin réel, sans biais d’affichage.', 'Peut couvrir d’emblée les 52 villes restantes avec la méthode C.'],
      ['Comparaison moins directe avec l’historique.', 'Repart de zéro : délai et coût d’annotation les plus élevés.']),
  ]),
  q('D11', 'D11 — Benchmark #782', 'a', {
    intro: 'Le benchmark #782 compare des modèles et des réglages sur un même jeu de référence. Si on y ajoute la mesure du ciblage (B, puis C), il faut décider si elle rejoint les métriques d’extraction ou forme un volet à part (§8.2). '
      + 'Le choix fixe aussi le sort du prompt d’extraction gelé (immo-pv-extraction-v9) : lui faire produire sens, effet et portée romprait la comparabilité des campagnes v10 et v11. '
      + 'Ce que verra Farid : un tableau unique, ou deux tableaux qui ne se mélangent pas.',
    dependsOn: ['G6', 'D10'],
    recommendation: '(a) : c’est la condition pour comparer B et C sans casser l’historique de l’extraction.',
  }, [
    o('a', '(a) Volet ciblage séparé',
      ['Extraction et ciblage restent comparables chacun dans le temps.', 'Colonnes historique, B et C distinctes : l’effet de C se lit directement.', 'Tout changement du contrat d’extraction devient une nouvelle version, décidée à part.'],
      ['Deux tableaux à lire.', 'Pont entre les deux seulement sur les 100 documents du corpus commun.']),
    o('b', '(b) Métriques fusionnées',
      ['Un seul tableau, un seul score.', 'Lecture plus simple pour un public non technique.'],
      ['Mélange deux questions différentes : un F1 fusionné ne dit plus rien.', 'Perd la comparabilité avec les campagnes passées.']),
  ]),

  q('D17', 'D17 — Contrat d’entrée : données de la ville à la date du signal', 'a', {
    decided: { option: 'a', by: 'Fabien (owner)', date: '2026-10-05', note: 'Arbitrage de Fabien (owner) du 2026-10-05 : données de la ville prises à la date du signal, rien de postérieur ; colonnes L à T du classeur hors entrée.' },
    intro: 'Un modèle évalué ne doit recevoir que ce qui serait disponible en production au moment de la détection. '
      + 'Le classeur montre une fuite : une colonne de l’assistant cite, pour un signal du 2026-04-14, un second projet adopté le 2026-05-05 (§4.1). '
      + 'Fabien (owner) a tranché le 2026-10-05 : les données de la ville entrent à la date du signal, rien de postérieur, et restent hors entrée les colonnes L à T du classeur (hors P, Q, R) comme les décisions de Steve en B, P, Q et R (§5.3). '
      + 'La décision fixe l’entrée des itérations de prompt (ch. 6) et du test neuf (ch. 7) ; elle précède la ré-annotation (étape 4 du plan).',
    dependsOn: ['D10'],
    recommendation: 'Tranchée : (a), actée par Fabien (owner) le 2026-10-05. L’autre coupure (date de revue de Steve) est publiée en analyse secondaire, comme évaluation rétrospective ; le signal seul reste une condition expérimentale secondaire sur le dev.',
  }, [
    o('a', '(a) Signal + données de la ville à la date du signal',
      ['Évaluation réaliste : le modèle voit ce que la production verrait à la détection.', 'Ferme la fuite temporelle constatée dans les colonnes de l’assistant.', 'Même règle sur le dev et sur le test neuf.'],
      ['Écart possible avec Steve, qui a jugé avec une information postérieure (jusqu’au 21 septembre).', 'Reconstruction datée du contexte à écrire et à vérifier (sha256 de l’entrée rendue).']),
    o('b', '(b) Signal + données de la ville à la date de revue de Steve',
      ['Plus proche de l’information dont Steve disposait.', 'Moins de cas où Steve juge sur une donnée absente de l’entrée.'],
      ['Information postérieure au signal, indisponible en production au moment de la détection.', 'Résultat rétrospectif : ne mesure pas la détection précoce que Steve demande.']),
    o('c', '(c) Signal seul',
      ['Entrée minimale, sans reconstruction de contexte.', 'Sert de condition expérimentale secondaire sur le dev.'],
      ['Rattachement des étapes d’un même dossier (rattache_a, R-07) non couvert.', 'Pénalise les cas où Steve s’appuie sur le contexte de la ville (donnée dans immo).']),
  ]),

  // ——— Étape 2 · Farid ———
  q('D5', 'D5 — Auteur des retours importés', 'c', {
    intro: 'Steve poursuivra son annotation dans l’application (vision owner, §9.1) : ses retours importés et ses annotations futures doivent porter le même auteur. '
      + 'Aujourd’hui il n’a pas de compte vérifié, et ce n’est pas lui qui lance l’import. '
      + 'Il faut décider qui est affiché comme auteur, sans usurper son identité ni effacer celle de l’importateur (exigence E5, §9.3). '
      + 'Effet visible : la ligne « auteur » de chaque annotation dans le panneau du signal, et le nom de qui valide ou conteste.',
    dependsOn: ['G4', 'D2', 'D4'],
    recommendation: '(c) : Steve annote et valide avec son propre compte ; ses décisions importées lui sont attribuées, les textes de l’assistant gardent leur auteur et l’importateur est tracé à part. (a) ne vaut que si la création du compte tarde.',
  }, [
    o('a', '(a) Auteur documentaire externe + importateur tracé',
      ['Le contenu est attribué à son vrai auteur sans attendre la création d’un compte.', 'L’importateur réel est tracé : on sait qui a chargé quoi.'],
      ['Steve ne peut ni annoter ni valider dans l’application sous ce nom externe.', 'Deux identités pour la même personne le jour où il aura un compte.']),
    o('b', '(b) Importateur seul comme auteur',
      ['Aucune identité externe à gérer.', 'Aucun libellé spécial à afficher.'],
      ['Le texte de Steve est attribué à l’importateur : faux pour le lecteur.', 'Perd la valeur de la parole du client et empêche la boucle de validation.']),
    o('c', '(c) Compte Steve, pour l’import et la saisie',
      ['Une seule identité : ses retours importés et ses annotations futures portent son compte.', 'Il annote, trie et répond aux contestations lui-même dans l’application.', 'L’importateur reste tracé à part, avec la source de l’import.'],
      ['Compte à créer et vérifier avant l’import.', 'Droits à cadrer : Steve annote, l’équipe ou le PO valide.']),
  ]),
  q('D6', 'D6 — Visibilité et données personnelles', 'c', {
    intro: 'Le constat C-79 du classeur (onglet Constats transversaux, rédigé par l’assistant du triage) signale des noms de particuliers en clair dans des résumés de signaux (§12.3) ; les verbatims importés peuvent en contenir aussi. '
      + 'Règle actuelle des notes (migration 0011) : tout utilisateur approuvé lit tout. '
      + 'Il faut décider qui voit les retours et s’ils sont caviardés avant le premier affichage (U1), au regard de la Loi 25 (exigence E9). '
      + 'Le module comments de sentropic ne masque pas les données personnelles : c’est au radar de le faire (D4, D5).',
    dependsOn: ['D4', 'D5'],
    recommendation: '(c) : toute l’équipe garde l’accès aux retours, et les noms de particuliers sont masqués, dans les retours comme dans les résumés de signaux.',
  }, [
    o('a', '(a) Tous les approuvés, sans caviardage',
      ['Règle existante, aucun travail.', 'Toute l’équipe voit tout.'],
      ['Expose des noms de particuliers.', 'Ne répond pas au constat C-79.']),
    o('b', '(b) Administrateurs et Steve',
      ['Exposition minimale.', 'Aucun caviardage à développer.'],
      ['L’équipe produit ne voit pas les retours : on perd l’intérêt de les afficher.', 'Gestion de droits spécifique à construire.']),
    o('c', '(c) Approuvés, verbatims caviardés',
      ['Toute l’équipe voit les retours.', 'Noms de particuliers masqués dans les retours et dans les résumés de signaux : répond à C-79.'],
      ['Détection des données personnelles à écrire et tester (colonne pii_status).', 'Un caviardage peut masquer un nom utile (élu, promoteur) : règles à préciser.']),
  ]),
  q('D7', 'D7 — Définition de C v1', 'K', {
    intro: 'C est la nouvelle sélection de signaux proposée, alignée sur les trois critères de Steve : résidentiel, assouplissement, densification (§2.3, scène criteres-steve). Aujourd’hui, deux de ces trois critères n’ont aucune donnée au radar. '
      + 'Steve pose une réserve : un signal dont le sens n’est pas lisible doit rester affiché (« masquer ce qui n’a pas pu être lu transformerait une lacune en dossier manqué »). '
      + 'Il faut fixer la règle de C avant de la développer (lot C1) ; elle sera mesurée par le jeu de référence de ciblage (D10), sur la lecture de la double annotation retenue (D9). '
      + 'Les critères K1 à K9 sont détaillés au §5.1.',
    dependsOn: ['D9', 'D10'],
    recommendation: '(b), après relecture par Steve de la table de dérivation (à établir, `not run`, §9.1) : c’est la seule règle qui applique ses trois critères sans masquer ce qui n’a pas pu être lu. Aucun seuil de taille de projet ni filtre sur l’origine privée. La correspondance entre ces trois états et les verdicts P / S / N de R′ reste à arbitrer : un P calculé par R′ v1 ne vaut pas confirmation des trois critères (§5.1, §5.2).',
  }, [
    o('S', '(a) Triplet strict pour toute visibilité',
      ['Flux court et lisible : seulement ce qui réunit les trois critères (22 sur 73).', 'Plus simple à calculer : un signal entre ou non.'],
      ['Masque les indéterminés : contredit la réserve explicite de Steve.', 'Perte de rappel sur les dossiers mal lus.']),
    o('K', '(b) K1–K9 + trois états',
      ['Respecte les trois critères et la réserve : on ne masque que ce qui est établi hors critères.', 'Trois états (confirmé, à instruire, exclu prouvé) et deux compteurs : un cas incertain n’est pas présenté comme une opportunité.'],
      ['Le flux garde du travail manuel (les « à instruire »).', 'Exige des extractions nouvelles (sens, effet sur les unités, portée) : lot C1 de taille L.']),
    o('T', '(c) B inchangé, critères pour trier',
      ['Aucun changement d’appartenance, aucun risque.', 'Aucune extraction nouvelle à développer.'],
      ['Le bruit connu (24 sur 73) persiste.', 'Ne répond pas à Steve : « ce n’est pas une question de hiérarchie ».']),
  ]),
  q('D8', 'D8 — Cas contradictoires (Saint-Victor, Amos, CPTAQ, seconds projets, ODJ, S-RESTRICTIF)', 'a', {
    intro: 'Certains cas ne se tranchent pas par une règle automatique : Saint-Victor (un resserrement qui favorise pourtant la densification), portée de l’exception CPTAQ, seconds projets, points d’ordre du jour, trois lignes Restriction classées « À surveiller » (§4.2, §4.8), et Amos (logement sur commerce), point du 2026-10-03 absent de la liste actuelle du §4.8. '
      + 'Le tableur et l’analyse de Steve se contredisent parfois sur ces cas, et 7 labels de Steve contredisent ses propres règles selon la liste du tour 5, dont 4 restent en écart après R′ v1 (§2.4, §4.6). '
      + 'Il faut décider qui les arbitre avant de geler le jeu de référence (D10) et la règle C (D7) ; sinon le jeu de référence sanctionnera le bon comportement.',
    dependsOn: ['D7', 'D10'],
    recommendation: '(a) : la règle reste celle du client, et les cas ouverts ne faussent pas la mesure pendant qu’ils sont arbitrés.',
  }, [
    o('a', '(a) Revue métier, cas contestés en attendant',
      ['Steve et Mathieu tranchent sur exemples et preuves : la règle reste celle du client.', 'En attendant, statut contested explicite : résultats publiés avec et sans ces cas.'],
      ['Demande du temps à Steve et Mathieu.', 'Quelques cas restent ouverts plus longtemps.']),
    o('b', '(b) Arbitrage par l’équipe',
      ['Plus rapide.', 'Ne mobilise ni Steve ni Mathieu.'],
      ['Risque de prêter à Steve une règle qu’il n’a pas posée.', 'Le jeu de référence refléterait l’avis de l’équipe, pas celui du client.']),
    o('c', '(c) Statu quo',
      ['Aucun effort.', 'Le jeu de référence peut être gelé tout de suite.'],
      ['Cas sans statut dans le jeu de référence : mesures faussées.', 'Désaccords invisibles.']),
  ]),
  q('D12', 'D12 — Exposition A/B/C (point ouvert)', 'a', {
    intro: 'Aujourd’hui l’écran montre la sélection B ; le sélecteur A/B a été retiré en août (§2.5). '
      + 'La demande initiale parle d’un « mécanisme A/B étendu en C », mais les règles de partage validées le 1er octobre (#787, item 4) demandent de ne pas réintroduire de choix entre plusieurs viviers. '
      + 'Les deux lectures sont défendables (§8.1) : Farid tranche. '
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
  q('D13', 'D13 — Seuil de bascule B → C (proposition de l’owner à acter)', 'a', {
    intro: 'Si C tourne en parallèle de B (D12), il faut écrire à l’avance quand C remplace B ; sans seuil écrit, la bascule se décidera à l’impression. '
      + 'Fabien (owner) propose le 2026-10-05 de traduire « aucun Pertinent masqué » par zéro Pertinent masqué sur le test neuf (k_max = 0), avec une borne supérieure exacte sous un seuil X à fixer par Farid (§7.2). '
      + 'Zéro observé seul ne prouve pas un faible risque : avec un taux réel de 2 %, la probabilité de pass vaut environ 0,56 à 29 Pertinent pour X = 10 % et 0,30 à 59 Pertinent pour X = 5 % (CALCUL binomial, annexe I). '
      + 'Le comparateur est B′ passe 1 recalculé sur les mêmes cas ; la part P ∪ S de la passe 1 observée par Steve (49/73 = 67,1 %) est rapportée, jamais utilisée comme seuil.',
    dependsOn: ['G6', 'D10', 'D11', 'D12'],
    recommendation: '(a) : proposition de Fabien (owner), à acter avec Farid. Statut pass si les deux critères passent (masquage, puis précision P ∪ S contre B′ passe 1), fail si l’un échoue, indeterminate sinon ; X (10 % ou 5 %) fixe la taille du test. Résidentiel et Zonage ne sont retirés qu’après une décision #761 fondée sur la mesure. Toute exigence supplémentaire par signal est une condition distincte, à décider. À arbitrer aussi : un résultat portant la mention single-human-annotator (sans second annotateur, D10) peut être publié ; son admissibilité pour la bascule, alors que G4 (a) exige une référence human_adjudicated pour toute promotion, reste à décider.',
  }, [
    o('a', '(a) Zéro Pertinent masqué (k_max = 0, borne < X), précision P ∪ S > B′ passe 1, parité',
      ['Protège la réserve de Steve : aucun Pertinent masqué, borne publiée.', 'Exige un gain réel de précision contre B′ passe 1, sur les mêmes cas.', 'Statuts pass, fail, indeterminate écrits avant la passe ; parité entre écrans (#786).'],
      ['Taille du test liée à X : environ 29 Pertinent (X = 10 %) ou 59 (X = 5 %), avant effet de grappe.', 'Avec un taux réel de 2 %, P(pass) ≈ 0,56 (29 P, X = 10 %) ou 0,30 (59 P, X = 5 %).']),
    o('b', '(b) Seuil chiffré différent',
      ['Farid fixe ses propres chiffres (à écrire dans le commentaire).', 'Peut refléter un compromis métier que Farid connaît mieux.'],
      ['À préciser.', 'Risque d’un seuil non mesurable par le jeu de référence.']),
    o('c', '(c) Bascule sur recette seule',
      ['Rapide : recette de Farid seulement.', 'Ne dépend pas de l’achèvement du jeu test.'],
      ['Sans mesure, aucune garantie de non-régression.', 'Contraire à l’objet du jeu de référence de ciblage.']),
  ]),
  q('D14', 'D14 — Première livraison UI', 'a', {
    intro: 'Une fois les retours en base, il faut les montrer. L’UI est en migration : 39 composants Svelte sur 69 utilisent le design system, les 3 composants d’annotation aucun, et la carte Signaux est un composant local MapLibre de 2 761 lignes destiné à être remplacé (§9.7, scène architecture-ui). '
      + 'Il faut choisir où le retour de Steve apparaît en premier : dans le panneau du signal et le rail, ou directement sur la carte. '
      + 'Le choix décide si #784 avance sans attendre la migration geo. Il suppose l’ancre réparée (D3), la lecture conforme (D4) et la règle de visibilité (D6).',
    dependsOn: ['D3', 'D4', 'D6'],
    recommendation: '(a) : valeur visible tout de suite, sans investir dans un composant de carte destiné à être remplacé.',
  }, [
    o('a', '(a) Panneau + rail + DS ciblé',
      ['Valeur immédiate : badge et section « Retour du relevé de Steve » dans le panneau, compteurs P / S / N dans le rail.', 'Aucun code ajouté à un composant à remplacer.', 'Les 3 composants d’annotation migrent au design system dans le même lot.'],
      ['Pas d’indicateur sur la carte au premier lot.', 'Les badges par signal exigent la lecture groupée du lot L2.']),
    o('b', '(b) Pastilles sur la carte actuelle dès U1',
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
      + 'B0 (D3), l’import (L1) et le jeu de référence (O1, D10) ne touchent pas la chaîne de rafraîchissement ; le classifieur C (C1), lui, a besoin de signaux frais (§12.2). '
      + 'Le choix fixe quand Steve verra ses retours dans l’outil (D14).',
    dependsOn: ['G7', 'D3', 'D10', 'D14'],
    recommendation: '(a) : livre tôt ce qui ne gêne pas le rafraîchissement, et garde C1 pour après sa stabilisation.',
  }, [
    o('a', '(a) B0, import et jeu de référence en parallèle de la fraîcheur',
      ['Valeur livrée tôt : annotation réparée, retours visibles, jeu de référence prêt.', 'Aucune interférence avec la chaîne de rafraîchissement.', 'C1 démarre sur des signaux stabilisés.'],
      ['Deux chantiers en parallèle à suivre.', 'L’attention de l’équipe est partagée.']),
    o('b', '(b) Tout après #703',
      ['Une seule priorité à la fois.', 'Aucun risque d’interférence, même indirecte, avec le rafraîchissement.'],
      ['Rien de visible pour Steve sur ses retours avant #703.', 'L’annotation de signal reste cassée plus longtemps.']),
  ]),
  q('D16', 'D16 — Retour à Steve', 'a', {
    intro: 'Le classeur reconstitue le fonctionnement des filtres observé à l’écran ; sa règle R-16, rédigée par l’assistant du triage, note qu’« une seule réponse des développeurs remplacerait toute cette reconstitution » (§2.5). Le dossier a confronté cette reconstitution au code. '
      + 'Il faut décider si on lui renvoie maintenant la définition réelle des filtres et la table qui relie ses codes de motif aux critères C (D7, D8), ou si on attend C.',
    dependsOn: ['D7', 'D8'],
    recommendation: '(a) : renvoyer, par Mathieu et Farid après relecture : répond à sa question et lui permet de corriger la table de dérivation avant que C soit développée.',
  }, [
    o('a', '(a) Renvoyer filtres réels et table de dérivation',
      ['Répond directement à la question posée en R-16.', 'Lui permet de corriger la table de dérivation avant le développement de C.', 'Renforce la confiance du client.'],
      ['Un aller-retour à préparer (relecture par Mathieu et Farid).', 'Une partie de ses observations date de septembre, en partie périmée depuis #793.']),
    o('b', '(b) Ne rien renvoyer avant C',
      ['Évite un aller-retour intermédiaire.', 'La réponse portera directement sur C, déjà développée.'],
      ['Steve continue à deviner le fonctionnement des filtres.', 'Erreurs de dérivation découvertes trop tard.']),
  ]),
];

// Each option: a description of what is concretely proposed and, for D2 and D3, a small
// entity-relationship diagram.
for (const question of questions) for (const option of question.options) {
  option.description = option.description ?? DESCRIPTIONS[question.key]?.[option.key];
  if (!option.description) throw Error(`missing description ${question.key}/${option.key}`);
  option.diagram = DIAGRAMS[question.key]?.[option.key] ?? null;
}

// Decisions that build on each one (reverse of dependsOn), for the "conditionne" line.
export const usedBy = Object.fromEntries(questions.map(question => [question.key,
  questions.filter(other => other.dependsOn.includes(question.key)).map(other => other.key)]));

export const minimalValidAnswer = 'Une option par décision G1 à G8 et D1 à D16 ; à défaut, au minimum G2, G7, D9, D12 et D13';

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
