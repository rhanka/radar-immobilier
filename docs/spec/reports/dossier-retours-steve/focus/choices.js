// Les choix exposés au propriétaire sont exactement les décisions D1 à D16 du §3
// et du §10 du dossier « retours de Steve ». Une réponse par décision.
// Rien n'est ratifié ici : la page ne produit qu'un brouillon local exportable.
import roles from './roles.json' with { type: 'json' };
import { decisionRecords, decisionsYaml, isoWithOffset, markdownBlock } from './decision-yaml.js';

// Export target, per dossier: the PR where Farid pastes his decisions.
export const DECISIONS_TARGET_URL = 'https://github.com/rhanka/radar-immobilier/pull/794';
export const DECISIONS_TARGET_LABEL = 'Ouvrir la PR #794 sur GitHub';
// The dossier carries no revision label: its date stands for the revision.
export const DOSSIER_REVISION = '2026-10-03';
// The "Je suis" selector. This dossier names no validation beside the decider,
// so a person's own decisions are the ones they decide.
export const PEOPLE = ['Farid', 'Fabien'];

const q = (key, group, question, recommended, context, options) => ({ key, mode: 'single', group, question, recommended, context, options,
  decides: roles[key][0], consulted: roles[key][1], validators: [] });
const o = (key, title, detail) => ({ key, title, detail });

export const questions = [
  q('D1', 'Données et modèle', 'D1 — Périmètre de conservation des retours de Steve', 'b',
    'Recommandé : (b). Les deux auteurs convergent.', [
      o('a', '(a) Triage seul', 'Rapide ; perd exclusions, constats et règles : base d’oracle incomplète.'),
      o('b', '(b) Tout le classeur et l’analyse, brut immuable', '7 feuilles, toutes les cellules, formules et valeurs mémorisées ; analyse conservée comme annotation distincte.'),
      o('c', '(c) Notes libres seules', 'Surface existante ; perd structure, groupes et provenance.'),
    ]),
  q('D2', 'Données et modèle', 'D2 — Modèle de données', 'M3',
    'Recommandé : M3. Les deux auteurs convergent (sources + jugements + ancres + publication).', [
      o('M1', 'M1 — étendre prospect_notes', 'Auteur = compte, une seule ancre, corps limité à 10 000 caractères, aucune provenance.'),
      o('M2', 'M2 — table de contrôle seule', 'Sépare mesure et production ; rien d’affichable, ne répond pas à #784.'),
      o('M3', 'M3 — couches hôtes + projection conforme', 'Source → lignes brutes → évaluations versionnées → ancres 1 à N → projection Comment.'),
      o('M4', 'M4 — attendre le paquet complet', 'Aucune dette hôte ; bloquant sans date.'),
    ]),
  q('D3', 'Données et modèle', 'D3 — Ancre signal et correctif B0', 'a',
    'Recommandé : (a). Formes différentes chez les deux auteurs, même fond : clé texte sans clé étrangère.', [
      o('a', '(a) Clé texte namespacée + instantané observé, B0 immédiat', 'Survit à la ré-ingestion ; répare l’annotation de signal existante (UUID exigé, id texte envoyé).'),
      o('b', '(b) Attendre une clé métier stable', 'Identité propre ; bloquant, sans date.'),
      o('c', '(c) Passer par l’UUID signals', 'Impossible en pratique : aucune insertion dans signals sur main.'),
    ]),
  q('D4', 'Contrat sentropic', 'D4 — Conformité sentropic et suppression', 'a',
    'Recommandé : (a). Divergence tranchée par le dossier COLLAB (le paquet porte l’intégrité) ; réserve : ce dossier n’est pas sur main.', [
      o('a', '(a) Cibles et lecture conformes, import immuable, demande de tombstone', 'Aucun chemin de suppression par le paquet ; réponses dans prospect_notes v1 (suppression logique) ; port complet à la sortie du tombstone.'),
      o('b', '(b) Adaptateur CommentStore à tombstone hôte', 'Port utilisé tout de suite ; contredit la ligne COLLAB et la sémantique de delete.'),
      o('c', '(c) Attendre le port complet', 'Conformité intégrale ; bloquant tant que sentropic n’a pas livré.'),
    ]),
  q('D5', 'Contrat sentropic', 'D5 — Auteur des retours importés', 'a',
    'Recommandé : (a), synthèse des deux auteurs.', [
      o('a', '(a) Auteur documentaire externe + importateur tracé', 'ext:chaperon:steve, libellé « importé par … », recorded_by réel, aucun droit de mutation.'),
      o('b', '(b) Importateur seul comme auteur', 'Aucune identité externe ; le fil n’attribue pas le contenu à son auteur.'),
      o('c', '(c) Compte Steve', 'Seulement quand il annotera dans l’UI ; compte non vérifié.'),
    ]),
  q('D6', 'Contrat sentropic', 'D6 — Visibilité et données personnelles', 'c',
    'Recommandé : (c). C-79 signale des noms de particuliers en clair.', [
      o('a', '(a) Tous les approuvés, sans caviardage', 'Règle 0011 ; exposition des noms.'),
      o('b', '(b) Administrateurs et Steve', 'Restreint ; limite l’usage par l’équipe.'),
      o('c', '(c) Approuvés, verbatims caviardés', 'Caviardage étendu aux résumés de signaux.'),
    ]),
  q('D7', 'Ciblage C et oracle', 'D7 — Définition de C v1', 'K',
    'Recommandé : K1–K9 + trois états. Les deux auteurs convergent.', [
      o('S', 'Triplet strict pour toute visibilité', 'Lisible ; contredit la réserve de Steve sur l’indéterminé.'),
      o('K', 'K1–K9 + trois états', 'Confirmé, à instruire, exclu prouvé ; une absence de donnée n’est jamais une exclusion.'),
      o('T', 'B inchangé, critères pour trier', 'Aucun changement d’appartenance ; le bruit connu persiste.'),
    ]),
  q('D8', 'Ciblage C et oracle', 'D8 — Cas contradictoires (Saint-Victor, Amos, CPTAQ, seconds projets, ODJ, S-RESTRICTIF)', 'a',
    'Recommandé : revue métier par Steve et Mathieu.', [
      o('a', 'Revue métier, abstention en attendant', 'Aucun réétiquetage automatique ; table de dérivation relue par Steve.'),
      o('b', 'Arbitrage par l’équipe', 'Plus rapide ; risque de prêter à Steve une règle qu’il n’a pas posée.'),
      o('c', 'Statu quo', 'Les cas restent dans l’oracle sans statut.'),
    ]),
  q('D9', 'Ciblage C et oracle', 'D9 — Sens de « double annotation » (point ouvert)', null,
    'Point laissé à Fabien, Farid consulté : le schéma couvre les trois lectures, la mesure attendue diffère.', [
      o('1', 'Steve contre classification radar', 'Lecture proposée : verdict source + B′ reconstitué + adjudication C + prédiction C.'),
      o('2', 'Ancienne grille de Steve contre grille C', 'Deux jeux d’étiquettes humaines successifs.'),
      o('3', 'Oracle 676 contre oracle Steve', 'Extraction contre ciblage.'),
    ]),
  q('D10', 'Ciblage C et oracle', 'D10 — Oracle #783', 'b',
    'Recommandé : double oracle, mécanismes des deux auteurs cumulés.', [
      o('a', 'Remplacer v3 par le tableur', 'Rapide ; échantillon conditionné par l’affichage, historique perdu.'),
      o('b', 'Double oracle E / C, jeu test indépendant', 'Unité signal regroupée par dossier ; dev 51 villes, test 52 villes ; partition par dossier.'),
      o('c', 'Campagne C entièrement nouvelle', 'Conçue pour le besoin ; comparaison moins directe.'),
    ]),
  q('D11', 'Ciblage C et oracle', 'D11 — Benchmark #782', 'a',
    'Recommandé : volet ciblage séparé.', [
      o('a', 'Volet ciblage séparé', 'Colonnes historique, B et C distinctes ; enrichir le contrat d’extraction = nouvelle version, décision dédiée.'),
      o('b', 'Métriques fusionnées', 'Un seul tableau ; perd la comparabilité.'),
    ]),
  q('D12', 'Affichage A/B/C', 'D12 — Exposition A/B/C (point ouvert)', 'a',
    'Divergence entre les auteurs, non tranchable par les sources : #787 (item 4) contre « A/B étendu en C ». Recommandation consolidée : (a).', [
      o('a', '(a) C en shadow, comparaison réservée UAT, puis remplacement de B', 'Conforme à #787 ; interface simple ; Steve voit C en UAT avant la bascule.'),
      o('b', '(b) Sélecteur A/B/C visible + mode comparatif', 'Paramètre dédié (pas mode) ; réintroduit un choix de viviers.'),
      o('c', '(c) Incréments dans B', 'Sens, plein droit, second projet ajoutés à B ; pas de mesure d’ensemble.'),
      o('d', '(d) Application C séparée', 'Duplique sélection, filtres et notes.'),
    ]),
  q('D13', 'Affichage A/B/C', 'D13 — Seuil de bascule B → C (à fixer)', 'a',
    'Proposition à amender par Farid dans le commentaire.', [
      o('a', 'Aucun P masqué, précision P ∪ S > B, parité', 'Sur le jeu test 52 villes ; mêmes ensembles API, rail, carte, panneau ; recette par Farid.'),
      o('b', 'Seuil chiffré différent', 'À préciser dans le commentaire.'),
      o('c', 'Bascule sur recette seule', 'Sans seuil mesuré.'),
    ]),
  q('D14', 'Livraison et suites', 'D14 — Première livraison UI', 'a',
    'Recommandé : (a). Divergence partielle : l’auteur A plaçait des pastilles sur la carte actuelle dès L3.', [
      o('a', '(a) Panneau + rail + DS ciblé', 'collab/* migrés au DS ; pastilles carte après migration de GeoCityMapBase.'),
      o('b', '(b) Pastilles sur la carte actuelle dès L3', 'Visibilité immédiate ; code ajouté à un composant local de 2 761 lignes.'),
      o('c', '(c) Migration geo complète d’abord', 'Cohérent ; dépend de la Porte 2, retarde #784.'),
      o('d', '(d) Tableau de retours séparé seul', 'Utile pour la curation ; n’annote pas l’élément associé.'),
    ]),
  q('D15', 'Livraison et suites', 'D15 — Séquencement', 'a',
    'Recommandé : (a). Les deux auteurs convergent.', [
      o('a', '(a) B0, import et oracle en parallèle de la fraîcheur', 'Ne touche pas la chaîne de rafraîchissement ; C1 après stabilisation de #703.'),
      o('b', '(b) Tout après #703', 'Aucun parallélisme.'),
    ]),
  q('D16', 'Livraison et suites', 'D16 — Retour à Steve', 'a',
    'Recommandé : oui, par Mathieu et Farid, après relecture.', [
      o('a', 'Renvoyer filtres réels et table de dérivation', 'Répond à R-16 ; prépare la relecture des critères.'),
      o('b', 'Ne rien renvoyer avant C', 'Évite un aller-retour intermédiaire.'),
    ]),
];

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
      options: question.options.map(option => ({ key: option.key, title: option.title, detail: option.detail })),
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
