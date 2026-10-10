// Les choix exposés sont exactement les décisions G1 à G8 (§9.3) et D1 à D17 (ch. 9) du dossier
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
export const DOSSIER_REVISION = '2026-10-10';
// The "Je suis" selector. This dossier names no validation beside the decider,
// so a person's own decisions are the ones they decide.
export const PEOPLE = ['Farid', 'Fabien'];

// Ordre de décision : Fabien décide d'abord G1 à G8 puis ses huit décisions immo (D1 tranchée, architecture,
// données, jeu de référence, contrat d'entrée D17) ; une fois décidées, Farid ne les rouvre pas, sauf incohérence avec une autre décision.
// Farid décide ensuite les neuf siennes (produit, affichage, priorités), en connaissant
// les choix de Fabien. Chaque décision : une introduction (problème, pourquoi maintenant,
// ce qui change selon le choix, renvois au dossier), ses dépendances, puis des options
// avec avantages et inconvénients. Identifiants, décideurs et options inchangés.
export const STEPS = [
  { id: 'fabien', step: 1, decides: 'Fabien', label: 'Tour de Fabien · Fabien décide d’abord (décisions génériques G1 à G8, puis architecture, données, jeu de référence)' },
  { id: 'farid', step: 2, decides: 'Farid', label: 'Tour de Farid · Farid décide ensuite (produit, affichage, priorités)' },
];
export const SEQUENCE = 'Tour de Fabien. Fabien tranche d\'abord ses 16 décisions : architecture, IA, jeu de référence et données. Deux sont tranchées (D1, D17) et une l\'est en partie (D10). Ses choix valent tels quels, sauf incohérence avec ceux de Farid (règle posée par Fabien le 04/10 à 14:22). '
  + 'Tour de Farid. Farid tranche ensuite ses 9 décisions, une fois les choix de Fabien posés, dans cet ordre : montrer les retours de Steve : D5 (auteur affiché), D6 (qui les voit, noms masqués), D14 (où les montrer d\'abord), D15 (en parallèle du rafraîchissement ou après) ; sélection C : D7 (règle de C), D8 (qui tranche quand la règle et Steve divergent), D16 (ce qu\'on demande et renvoie à Steve), D12 (comment C est montrée), D13 (seuil de remplacement). '
  + 'Incohérence. Si un choix de Farid contredit un choix de Fabien, on revient à Fabien sur ce seul point.';

const q = (key, question, recommended, text, options) => ({
  key, mode: 'single', question, recommended, options,
  step: roles[key][0] === 'Fabien' ? 1 : 2, group: STEPS.find(step => step.decides === roles[key][0]).label,
  intro: text.intro, dependsOn: text.dependsOn ?? [], recommendation: text.recommendation, decided: text.decided ?? null, family: text.family ?? 'immo',
  decides: roles[key][0], consulted: roles[key][1], validators: [],
});
const o = (key, title, pros, cons, description) => ({ key, title, pros, cons, description });

export const questions = [
  // ——— Tour de Fabien : décisions génériques G1 à G8 (convergence sentropic + engram), puis immo ———
  ...GENERIC.map(g => q(g.key, g.question, g.recommended, { intro: g.intro, dependsOn: g.dependsOn, recommendation: g.recommendation, family: 'générique' },
    g.options.map(option => o(option.key, option.title, option.pros, option.cons, option.description)))),
  q('D1', 'D1 — Périmètre de conservation des retours de Steve', 'b', {
    decided: { option: 'b', by: 'Fabien (owner)', date: '2026-10-02', note: 'Tranchée : demande de Fabien (owner) du 2026-10-02. Trace : « je voudrais que tous les retours de steve soient stockés en base (données tableur), attachés aux éléments associés (ville, zone etc), suivant l\'annotation qu\'on avait prévu de faire » (demande du 02/10, 17:39).' },
    intro: 'Décision tranchée : demande de Fabien (owner) du 2026-10-02 : on conserve tous les retours de Steve ; c’est sa décision, il en a besoin pour le jeu de référence. '
      + 'Steve a livré un classeur de 7 feuilles (124 lignes de triage, 121 contrôles d’exclusion, 77 constats, 26 règles, 28 codes de motif) et une analyse écrite qui pose ses trois critères (§2, §4.2). '
      + 'Ce choix fixe ce que l’équipe pourra montrer sur les objets du radar et ce que le jeu de référence pourra mesurer (D10). '
      + 'Conséquence pour D2 : « tout conserver » suppose un modèle qui garde toutes les lignes, l’option a (ou b) de D2.',
    dependsOn: [],
    recommendation: 'Tranchée : (b), tout conserver, tranchée : demande de Fabien (owner) du 2026-10-02 ; les options a et c restent affichées pour mémoire.',
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
      + 'L’état initial et l’état proposé, objet par objet et par propriétaire, sont à l’annexe C et au §8.2 ; les besoins de Steve au §8.1. '
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
    intro: 'Une ancre est la référence qui attache une annotation à un objet du radar (signal, ville, zone, lot…) ; c’est une ligne de la table annotation_targets (ville + id texte, §8.2). '
      + 'Aujourd’hui l’annotation d’un signal est cassée : l’UI envoie l’identifiant texte du graphe (« signal-… »), alors que l’API exige un UUID, identifiant aléatoire de l’ancienne table signals que plus aucun code n’alimente (annexe C.7, défaut 1). '
      + '« B0 » est le petit lot correctif qui répare cela (§8.4). Sans ancre fiable, aucun retour de Steve ne s’affiche sur son signal. '
      + 'Risque connu : une ré-extraction du graphe peut supprimer ou renommer des identifiants (graph-store.ts, annexe C).',
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
      + 'Les commentaires de l’équipe doivent suivre le contrat du module comments de sentropic, la plateforme commune (exigence E3, annexe C.7). '
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
  q('D9', 'D9 — Sens de « double annotation »', 'd', {
    intro: 'La demande initiale parle de « double annotation (ancienne / nouvelle) » sans dire ce qui est comparé à quoi. '
      + 'La revue du plan (annexe B.11) a retenu une lecture : la provenance par champ, où chaque étiquette du jeu de référence C v2 garde sa source (steve_v1, steve_v2a, steve_v2, steve_test, annotations IA individuelles, majorité IA) (§4.8). '
      + 'Les trois lectures initiales restent mesurables dans ce schéma, et D10 fixe déjà l’usage de chaque provenance. '
      + 'La proposition est de clore D9 en la fusionnant dans D10.',
    dependsOn: ['G1', 'D2'],
    recommendation: '(d) : clore D9. La provenance par champ couvre les trois lectures (Steve contre radar avec B′ recalculé, ancienne contre nouvelle annotation de Steve, rapprochement E / C) ; le sujet est porté par D10.',
  }, [
    o('a', '(a) Steve contre classification radar',
      ['Mesure directement l’écart entre ce que Steve juge et ce que le radar montre (B aujourd’hui, C demain).', 'C’est la lecture qui sert la bascule B → C (D13).'],
      ['La classification serveur de septembre n’est pas archivée : la version radar sera reconstituée, en partie.', 'Ne mesure pas l’accord entre deux humains.']),
    o('b', '(b) Ancienne grille de Steve contre grille C',
      ['Suit l’évolution des critères de Steve dans le temps.', 'Utile si Steve réétiquette ses lignes avec les critères C.'],
      ['Exige un second passage de Steve sur les mêmes lignes.', 'Ne dit rien de la qualité du radar.']),
    o('c', '(c) Jeu de référence 676 contre jeu de référence Steve',
      ['Relie l’extraction (jeu de référence E) et le ciblage (jeu de référence C).', 'Réutilise deux références déjà constituées (674/676 et le tableur).'],
      ['Compare deux questions différentes : « a-t-on extrait l’acte ? » contre « fallait-il le montrer ? ».', 'Recouvrement des deux corpus probablement faible (non vérifié).']),
    o('d', '(d) Clore D9 : provenance par champ, portée par D10',
      ['Une seule décision (D10) fixe le jeu de référence et l’usage de chaque provenance.', 'Les trois lectures restent mesurables : chaque étiquette garde sa source (label_provenance, versions de Steve).'],
      ['Le terme « double annotation » de la demande initiale sort du registre.', 'Suppose que D10 soit tranchée avec la provenance par champ explicite.']),
  ]),
  q('D10', 'D10 — Jeu de référence de ciblage : sur quoi se mesurera la bascule', 'b', {
    intro: 'Ce qui reste à décider. Le test étendu suffit-il à fonder la bascule (D13), ou un humain doit-il en vérifier une partie ? La réponse doit rester cohérente avec G4. '
      + 'À savoir. La règle de C a été mise au point sur les 121 lignes, moitié aveugle comprise (chapitre 3). Sur cette moitié, son accord avec Steve est donc biaisé à la hausse.',
    dependsOn: ['G1', 'G4', 'G5', 'G7', 'D2', 'D9'],
    recommendation: '(JUGEMENT). C\'est la seule option qui garde le plan d\'extension et qui donne à la bascule une référence vérifiée par un humain là où elle est incertaine.',
  }, [
    o('a', '(a) Le test étendu, tel que décidé',
      ['Aucune charge pour Steve. Un grand volume est possible. La méthode est la même que sur les 121 lignes.'],
      ['Les annotateurs sont de la même famille que les modèles évalués : la mesure peut récompenser leurs erreurs communes. Si G4 (a) est retenue, ce test ne peut fonder aucune bascule.'],
      'Sur les nouvelles villes, la bonne réponse est celle de l\'annotation convergée des trois modèles ; Steve n\'annote pas. Sur la moitié aveugle des 121 lignes, son classement sert aussi de référence.'),
    o('b', '(b) Le test étendu, plus une vérification par Steve d\'une partie',
      ['Le plan et son volume sont gardés. Steve ne traite qu\'une partie des cas. L\'échantillon mesure l\'erreur de la référence machine.'],
      ['Elle demande du temps à Steve. La référence mêle deux provenances : G4 doit dire si elle suffit. Les résultats sont publiés par provenance.'],
      'Comme (a). Puis, avant que les candidats passent sur le test, Steve annote à l\'aveugle deux groupes de cas pris dans les nouvelles villes, sans voir les étiquettes des modèles : ceux où les modèles ne convergent pas, et un échantillon tiré au hasard des autres. La taille de l\'échantillon est fixée avant le tirage. Cette option complète la décision du 5 octobre sans la changer.'),
    o('c', '(c) Annotation par Steve de la part nouvelle du test, avec un second annotateur humain sur une partie',
      ['La référence est humaine, donc compatible avec G4 (a), et sa fiabilité est mesurée.'],
      ['C\'est la charge la plus lourde pour Steve. La disponibilité d\'un second annotateur est unknown. L\'option revient sur une décision du 5 octobre.'],
      'Steve annote les nouvelles villes du test selon le guide figé. Un second annotateur humain en annote au moins 50, sans voir les réponses de Steve. Pour le test de la bascule, cette option remplace l\'annotation convergée décidée le 5 octobre.'),
  ]),
  q('D11', 'D11 — Benchmark #782', 'a', {
    intro: 'Le benchmark #782 compare des modèles et des réglages sur un même jeu de référence. Si on y ajoute la mesure du ciblage (B, puis C), il faut décider si elle rejoint les métriques d’extraction ou forme un volet à part (§7.3). '
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
      + 'Fabien (owner) a tranché le 2026-10-05 : les données de la ville entrent à la date du signal, rien de postérieur, et restent hors entrée les colonnes L à T du classeur (hors P, Q, R) comme les décisions de Steve en B, P, Q et R (annexe B.7). '
      + 'La décision fixe l’entrée des itérations de prompt (ch. 6) et du test neuf (ch. 7) ; elle précède la ré-annotation (étape 4 du plan).',
    dependsOn: ['D10'],
    recommendation: 'Tranchée : (a), décidée par Fabien le 5 octobre. L’autre coupure (date de revue de Steve) est publiée en analyse secondaire, comme évaluation rétrospective ; le signal seul reste une condition expérimentale secondaire sur le dev.',
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

  // ——— Tour de Farid ———
  q('D5', 'D5 — Auteur des retours importés', 'c', {
    intro: 'Steve poursuivra son annotation dans l’application (vision owner, §8.1) : ses retours importés et ses annotations futures doivent porter le même auteur. '
      + 'Aujourd’hui il n’a pas de compte vérifié, et ce n’est pas lui qui lance l’import. '
      + 'Il faut décider qui est affiché comme auteur, sans usurper son identité ni effacer celle de l’importateur (exigence E5, annexe C.7). '
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
    intro: 'Le constat C-79 du classeur (onglet Constats transversaux, rédigé par l’assistant du triage) signale des noms de particuliers en clair dans des résumés de signaux (§10.4) ; les verbatims importés peuvent en contenir aussi. '
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
  q('D7', 'D7 — La règle de la nouvelle sélection (C)', 'b', {
    intro: 'C est la nouvelle sélection proposée, alignée sur les trois critères de Steve (chapitre 2). Le chapitre 3 montre comment elle trancherait. '
      + 'Son principe doit être arrêté avant de la développer (lot C1) : c\'est ce principe que mesurera le jeu de référence (D10). '
      + 'Les clauses de détail n\'en font pas partie ; elles ne changent que par D8.',
    dependsOn: ['D9', 'D10'],
    recommendation: 'À savoir avant de choisir (b). « Pertinent » n\'établit pas toujours la hausse de logements (chapitre 3).',
  }, [
    o('a', '(a) Seulement les signaux qui réunissent les trois critères',
      ['Un flux court ; un calcul simple.'],
      ['Masque ce qui n\'a pas pu être lu, contre la réserve explicite de Steve. Des dossiers mal lus sont perdus.'],
      'C n\'affiche que les signaux dont l\'habitation, l\'assouplissement et la hausse de logements sont établis ; tout le reste est masqué. Au plus 22 lignes sur 73 resteraient, si la lecture du radar égalait la sienne. Les 12 qu\'il classe Pertinent sans que le sens soit clairement une ouverture disparaîtraient.'),
    o('b', '(b) Règle à trois verdicts',
      ['Applique les critères et les exclusions de Steve sans masquer ce qui n\'a pas pu être lu. Un cas incertain n\'est jamais présenté comme une opportunité.'],
      ['Les « À surveiller » restent à trier à la main. Il faut lire ce que le radar n\'extrait pas aujourd\'hui : sens, effet sur les logements, portée, nature de la pièce. C\'est le lot C1, le plus gros.'],
      'Un signal est Non pertinent, donc masqué avec sa raison, seulement si une exclusion de Steve est établie. Il est Pertinent si l\'habitation, le plein droit et l\'ouverture sont établis, À surveiller sinon. Pertinent et À surveiller sont affichés, avec deux compteurs séparés (chapitre 3).'),
    o('c', '(c) Sélection B inchangée, critères pour trier',
      ['Aucun risque.'],
      ['Le bruit reste. Ne répond pas à Steve : « Ce n\'est pas une question de hiérarchie ».'],
      'Aucun signal n\'entre ni ne sort ; les critères de Steve ordonnent la liste.'),
  ]),
  q('D8', 'D8 — Qui tranche quand la règle et Steve divergent', 'a', {
    intro: 'La règle et ses ajouts. La règle proposée (chapitre 3, « Comment un signal est retenu ou écarté ») compte 15 clauses, tirées des règles que Steve a énoncées pendant le triage. Le dossier propose d\'y ajouter 7 clauses, tirées pour la plupart des codes de motif de son classeur. Par exemple, d\'après le code P-VILLE-TERRITOIRE, une concordance au schéma ou une refonte complète est Pertinente. '
      + 'Leur effet. Les chiffres du dossier (89 accords et 24 écarts sur 113 lignes) sont calculés avec ces clauses. Mesurées une à une, elles mettent la règle d\'accord avec Steve sur 17 lignes ; deux de ces lignes (n° 94 et 100) ne peuvent être évaluées qu\'avec l\'une d\'elles. Une seule ligne passe en désaccord (n° 53). '
      + 'Ce qu\'elles ne savent pas faire. Sur 3 lignes (n° 53, 54 et 114), la règle, avec ces clauses, donne Pertinent alors que Steve classe autrement. Seul le n° 53 tient à une clause prise seule (« Zone créée ou agrandie »). Steve y applique un critère qu\'elles n\'encodent pas : portée floue, contrainte, modification accessoire. '
      + 'Comment elles ont été retenues. Selon une règle écrite avant le calcul : chaque clause met la règle d\'accord avec Steve sur plus de lignes qu\'elle n\'en met en désaccord ; elle passe le contrôle du seuil de remplacement (D13), avec et sans le n° 121 ; elle ne fait masquer aucune ligne que Steve montre (annexe D). '
      + 'Ce qui est à décider. La règle ne change jamais pour améliorer un score : elle ne change que par cette décision, après l\'avis de Steve et de Mathieu. Il faut décider qui tranche ces clauses et toute modification future de la règle, et ce qui vaut en attendant. Sinon, le jeu de référence compterait comme une faute le comportement que Steve attend.',
    dependsOn: ['D7', 'D10'],
    recommendation: '',
  }, [
    o('a', '(a) Revue par Steve et Mathieu, cas contestés en attendant',
      ['La règle reste celle du client', 'rien n\'est réétiqueté en attendant'],
      ['Demande du temps à Steve et à Mathieu', 'des lignes restent ouvertes'],
      'Steve et Mathieu examinent chaque clause sur les lignes qu\'elle change. En attendant, l\'étiquette de Steve ne change pas : la ligne porte le statut « contesté », et les résultats sont publiés avec et sans elle'),
    o('b', '(b) L\'équipe tranche, puis informe Steve',
      ['Plus rapide'],
      ['Risque de prêter à Steve une règle qu\'il n\'a pas posée'],
      'L\'équipe choisit les clauses d\'après les règles écrites de Steve'),
    o('c', '(c) Statu quo',
      ['Aucun effort'],
      ['L\'écart reste invisible et fausse la mesure'],
      'La règle garde ses 15 clauses, sans ajout ; les lignes gardent leur étiquette, sans statut'),
  ]),
  q('D12', 'D12 — Exposition A/B/C', 'a', {
    intro: 'Aujourd’hui l’écran montre la sélection B ; le sélecteur A/B a été retiré en août (§2.5). '
      + 'La demande initiale parle d’un « mécanisme A/B étendu en C », mais les règles de partage validées le 1er octobre (#787, item 4) demandent de ne pas réintroduire de choix entre plusieurs viviers. '
      + 'Les deux lectures sont défendables (§7.2) : Farid tranche. '
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
  q('D13', 'D13 — Seuil de bascule : à quelle condition C remplace B à l\'écran', null, {
    intro: 'Si C est calculée en parallèle de B (D12), il faut écrire avant la mesure à quelle condition C remplace B ; sinon, la bascule se décidera à l\'impression. '
      + 'Fabien propose que C ne masque aucun cas jugé Pertinent sur le test. Mais un zéro observé sur un petit test ne prouve presque rien. '
      + 'Il faut donc aussi un plafond X sur la part de Pertinent que C pourrait masquer en réalité. C\'est X que vous choisissez ; il fixe la taille minimale du test, donc la charge d\'annotation (D10).',
    dependsOn: ['G6', 'D10', 'D11', 'D12'],
    recommendation: 'Le dossier ne recommande pas de valeur de X : c\'est un arbitrage entre exigence et taille du test, qui vous revient. Il déconseille (d).',
  }, [
    o('a', '(a) X = 10 %',
      ['Le test le plus petit.'],
      ['Un plafond plus haut est toléré.'],
      'Le test doit compter au moins 29 cas jugés Pertinent. Si C masque en réalité 2 % des Pertinent, elle passe le critère 1 environ 56 fois sur 100.'),
    o('b', '(b) X = 5 %',
      ['Une garantie deux fois plus stricte.'],
      ['Un test environ deux fois plus grand. Davantage de résultats « indéterminé ».'],
      'Le test doit compter au moins 59 cas jugés Pertinent. Si C masque en réalité 2 % des Pertinent, elle passe le critère 1 environ 30 fois sur 100.'),
    o('c', '(c) Une autre valeur de X',
      ['Votre arbitrage.'],
      ['La taille du test se recalcule : sous 5 %, il devient plus grand encore.'],
      'Vous écrivez X dans le champ x:.'),
    o('d', '(d) Bascule sur recette seule',
      ['Rapide.'],
      ['Aucune garantie de non-régression. Contraire à l\'objet du jeu de référence, et à G6 (a) si elle est retenue.'],
      'Aucune mesure ; votre recette décide.'),
  ]),
  q('D14', 'D14 — Première livraison UI', 'a', {
    intro: 'Une fois les retours en base, il faut les montrer. L’UI est en migration : 39 composants Svelte sur 69 utilisent le design system, les 3 composants d’annotation aucun, et la carte Signaux est un composant local MapLibre de 2 761 lignes destiné à être remplacé (§8.5, scène architecture-ui). '
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
      ['Dépend de l\'activation du moteur de carte partagé, désactivé aujourd\'hui, sans date d\'activation connue.', 'Retarde d\'autant l\'affichage des retours de Steve.']),
    o('d', '(d) Tableau de retours séparé seul',
      ['Toute la donnée consultable en un seul écran.', 'Utile comme outil de curation des rattachements.'],
      ['N’annote pas l’élément associé : ne répond pas à #784.', 'Un écran de plus.']),
  ]),
  q('D15', 'D15 — Séquencement', 'a', {
    intro: 'La priorité n° 1 de Steve reste la fraîcheur des signaux (#703, rafraîchissement quotidien). Le travail de ce dossier peut avancer en parallèle ou attendre. '
      + 'B0 (D3), l’import (L1) et le jeu de référence (O1, D10) ne touchent pas la chaîne de rafraîchissement ; le classifieur C (C1), lui, a besoin de signaux frais (§10.3). '
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
  q('D16', 'D16 — Ce qu\'on demande et ce qu\'on renvoie à Steve', 'a', {
    intro: 'Condition de Fabien. Pas d\'extension à d\'autres villes « tant qu\'on n\'aura pas clarifié les 48 cas ou les 3 IA ne sont pas en accord avec Steve » (5 octobre). Les 48 cas sont ceux du compte de cette date. Aujourd\'hui, sur les 113 lignes évaluées, la règle proposée et Steve diffèrent sur 24 lignes, chacune avec sa suite (page d\'ouverture ; chapitre 4, « Les données de Steve, analysées en profondeur »). '
      + 'Ce qui est demandé à Steve. 7 de ces écarts ne se tranchent que par sa réponse. 5 questions fermées les couvrent : c\'est tout le volume demandé dans l\'option recommandée (a) ; l\'option (b) y ajoute un réexamen de 50 cas. '
      + 'Où lire les questions. Le texte sera versé dans le classeur partagé avec Farid (dossier Immo.Zonage), comme le tableau de référence (« Nouvel onglet du classeur », option recommandée, Fabien, 5 octobre). Il le sera à un endroit auquel Steve n\'a pas accès avant cette décision, une fois cet accès vérifié. Dans le dépôt public, il ne sera versé que chiffré, comme le tableau de référence (« Dépôt public, fichier chiffré », Fabien, 5 octobre). '
      + 'Filtres. Le classeur demande aussi la définition exacte des filtres. La règle R-16, rédigée par l\'assistant du triage, le dit : « LA BONNE DÉMARCHE est de demander aux développeurs la définition exacte des cinq filtres ».',
    dependsOn: ['D7', 'D8'],
    recommendation: 'Le bloc YAML de D16 porte deux champs de plus : delai_jours et envoi.',
  }, [
    o('a', '(a) Envoyer maintenant les questions et la définition réelle des filtres',
      ['Demande courte, regroupée par principe', 'répond à la question du classeur sur les filtres', 'prépare la levée de la condition que Fabien a posée à l\'extension'],
      ['Un aller-retour à préparer (relecture par Mathieu et Farid)'],
      'Partent les 5 questions fermées, avec la définition des cinq filtres et du retrait en amont, lue dans le code déployé au moment de l\'envoi. La table qui relie les codes de motif de Steve aux critères de C suivra quand elle sera établie (not run)'),
    o('b', '(b) (a), plus un réexamen à l\'aveugle de 50 cas',
      ['Mesure la stabilité de ses classements, que rien ne mesure aujourd\'hui. Son cahier de juillet et le relevé ne se comparent que sur l\'objet et le sens de la modification (même lecture dans 12 paires sur 12, chapitre 4), pas sur le classement.'],
      ['Charge nettement plus lourde.'],
      'Steve reclasse 50 lignes sans voir son classement de septembre ni la règle'),
    o('c', '(c) Ne rien envoyer avant que C soit développée',
      ['Un seul aller-retour'],
      ['L\'extension reste bloquée', 'Steve continue de deviner le fonctionnement des filtres'],
      'Un seul envoi, plus tard'),
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

export const minimalValidAnswer = 'Chaque décideur répond à ses décisions, ou marque une décision « différée »';

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
