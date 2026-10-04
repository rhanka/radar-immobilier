// Les choix exposés à l'owner sont exactement les décisions D1 à D7 du §3.1 et du
// §7 du dossier « villes en écart S3 / PG ». Une réponse par décision.
// Rien n'est ratifié ici : la page ne produit qu'un brouillon local exportable.
// Le détail de chaque décision (introduction, Avantages / Inconvénients,
// recommandation) vient du §7 du Markdown, rendu tel quel dans le bloc de choix.
import roles from './roles.json' with { type: 'json' };
import { decisionRecords, decisionsYaml, isoWithOffset, markdownBlock } from './decision-yaml.js';

// Export target, per dossier: the PR of this dossier, where Fabien pastes his decisions.
export const DECISIONS_TARGET_URL = 'https://github.com/rhanka/radar-immobilier/pull/0';
export const DECISIONS_TARGET_LABEL = 'Ouvrir la PR du dossier sur GitHub';
// The dossier carries no revision label: its date stands for the revision.
export const DOSSIER_REVISION = '2026-10-04';
// The "Je suis" selector. Fabien decides every decision; Farid is consulted (D2, D3)
// or informed, so his own list is empty and he copies « toutes » to comment.
export const PEOPLE = ['Fabien', 'Farid'];

const q = (key, group, question, recommended, context, options) => ({ key, mode: 'single', group, question, recommended, context, options,
  decides: roles[key][0], consulted: roles[key][1], validators: [] });
const o = (key, title, detail) => ({ key, title, detail });

export const questions = [
  q('D1', 'Remise en cohérence sans attendre la correction', 'D1 — G1 (71 villes) : supprimer de PG les 3 535 nœuds vides', 'a',
    'Recommandé : (a). Aucune de ces villes ne partage d’identifiant avec une autre : indépendante de D2.', [
      o('a', '(a) Projection S3 → PG des 71 villes, puis reprise des dates sans --heal', 'Les 71 villes passent les trois garde-fous en simulation ; deux jobs CD existants.'),
      o('b', '(b) Laisser en l’état', '71 villes restent sans dates documentaires, comptes de couverture gonflés.'),
      o('c', '(c) Reprise avec --heal', 'Recopie les 3 535 nœuds vides dans S3 : dangereux.'),
    ]),
  q('D2', 'Correction de la collision', 'D2 — Principe de correction de la collision', 'C',
    'Recommandé : C, après harness brainstorm. S3 fait foi pour la réparation. Farid consulté : preuves d’une autre ville affichées.', [
      o('A', 'A — Identifiant PG propre à la ville (ville:id), avec migration', 'Tous les identifiants changent : API, liens, MCP, ancres, arêtes à migrer.'),
      o('B', 'B — Garde-fou et renommage à la projection, préfixe producteur, script de réparation', 'Sans migration ; espace d’identifiants toujours commun ; écarts S3 / PG sur les nœuds renommés.'),
      o('C', 'C — Clé primaire (city_slug, id), arêtes rattachées à la ville, réparation depuis latest.json', 'Corrige la cause ; identifiants visibles inchangés ; migration des deux tables.'),
    ]),
  q('D3', 'Correction de la collision', 'D3 — Priorité de la correction et mesure d’attente', 'a',
    'Recommandé : (a), après avoir confirmé qu’un même PV n’est pas ré-extrait d’un passage à l’autre. Dépend de D2.', [
      o('a', '(a) Priorité immédiate, garde-fou d’une ligne tout de suite, coût accepté jusqu’à la réparation', 'Arrête la contamination ; le contenu extrait reste dans S3 et sera servi après réparation.'),
      o('b', '(b) Comme (a), et suspendre l’extraction des villes refusées', 'Économise les appels de modèle ; ces villes ne reçoivent plus de nouveaux PV.'),
      o('c', '(c) Planification normale, sans garde-fou immédiat', 'L’écart et la contamination continuent de grandir.'),
    ]),
  q('D4', 'Remise en cohérence sans attendre la correction', 'D4 — G5a (3 villes) : --heal', 'a',
    'Recommandé : (a). PG plus riche que S3, mêmes nœuds, aucune preuve étrangère.', [
      o('a', '(a) Reprise des dates avec --heal sur dixville, nominingue, saint-honore-de-shenley', 'S3 retrouve les citations complètes de PG ; archive de latest.json avant écriture.'),
      o('b', '(b) Attendre', 'Les 3 villes restent sans dates documentaires.'),
    ]),
  q('D5', 'Remise en cohérence sans attendre la correction', 'D5 — G5b victoriaville : --heal ou attendre', 'a',
    'Recommandé : (a). Lien avec D6 : le bug producteur peut revenir.', [
      o('a', '(a) Reprise des dates avec --heal sur victoriaville', 'S3 retrouve 15 citations ; 3 nœuds propres à S3 retirés (archivés).'),
      o('b', '(b) Attendre la correction du bug producteur (D6)', 'Ville bloquée pour une durée inconnue.'),
    ]),
  q('D6', 'Bug producteur et cas isolés', 'D6 — G5c (2 villes) : analyse du bug producteur', 'a',
    'Recommandé : (a), avec harness debug, en parallèle de D2.', [
      o('a', '(a) Ouvrir l’analyse maintenant, priorité haute', 'Défaut actif à chaque passage ; code distinct de la projection.'),
      o('b', '(b) Priorité normale, après D2', 'Le groupe grandit ; D4 et D5 risquent d’être défaits.'),
      o('c', '(c) Ne rien ouvrir', 'Défaut masqué par les garde-fous ; villes touchées figées.'),
    ]),
  q('D7', 'Bug producteur et cas isolés', 'D7 — G6 brigham : opération ponctuelle ou laisser', 'a',
    'Recommandé : (a), après D1 et D4, sans urgence.', [
      o('a', '(a) Opération ponctuelle acceptant 21 suppressions, après export des lignes PG', 'brigham sert 9 signaux complets au lieu de 0 ; petit outillage revu.'),
      o('b', '(b) Laisser', 'brigham reste sur la version de juin, bloquée à chaque rafraîchissement.'),
      o('c', '(c) --heal', 'Écrase la ré-extraction de juillet : perte de 9 signaux complets.'),
    ]),
];

export const minimalValidAnswer = 'Une option par décision D1 à D7 ; à défaut, au minimum D2 et D3, dont dépend la réparation de 148 villes';

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
    const selection = raw ?? null;
    if (selection !== null && !question.options.some(option => option.key === selection)) throw Error(`Unknown option ${selection} for ${question.key}`);
    return {
      key: question.key, group: question.group, question: question.question, mode: question.mode,
      recommended: question.recommended, decides: question.decides, consulted: question.consulted,
      selection, decisionStatus: selection !== null ? 'owner-draft-not-ratified' : 'open',
      comment: comments[question.key] ?? '',
      options: question.options.map(option => ({ key: option.key, title: option.title, detail: option.detail })),
    };
  });
  return {
    schema: 'immo-villes-ecart-decision-owner-response/v1',
    dossier: manifest.dossier, dossierHash: manifest.dossierHash,
    artifactInputHash: manifest.artifactInputHash, capturedAt,
    status: 'draft-not-ratified',
    authority: 'brouillon local : aucune réparation, aucun job, aucune écriture cluster, bucket ou base, aucune fusion de PR, aucun événement track',
    minimalValidAnswer, responses,
  };
}
