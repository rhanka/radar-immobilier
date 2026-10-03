// Les choix exposés sont exactement les décisions D1 à D18 du §3 et du §10 du
// dossier « rôles et droits de décision dans radar-immobilier » (révision r1,
// après relecture d'Astra). Une réponse par décision.
// Rien n'est ratifié ici : la page ne produit qu'un brouillon local exportable.
import roles from './roles.json' with { type: 'json' };
import { decisionRecords, decisionsYaml, isoWithOffset, markdownBlock } from './decision-yaml.js';

// Export target, per dossier: the PR where Farid pastes his decisions.
export const DECISIONS_TARGET_URL = 'https://github.com/rhanka/radar-immobilier/pull/795';
export const DECISIONS_TARGET_LABEL = 'Ouvrir la PR #795 sur GitHub';
// Review state of the dossier ("État de relecture : r1").
export const DOSSIER_REVISION = 'r1';
// The "Je suis" selector. A person's own decisions: those they decide, plus those
// where they carry a named validation (Validation PO / Validation AI Builder).
export const PEOPLE = ['Farid', 'Fabien'];
const validatorsOf = text => PEOPLE.filter(name => new RegExp(`^Validation [^:]+ : ${name}\\b`).test(text ?? ''));

const q = (key, group, question, recommended, context, options) => ({ key, mode: 'single', group, question, recommended, context, options,
  decides: roles[key][0], consulted: roles[key][1], validation: roles[key][2], validators: validatorsOf(roles[key][2]) });
const o = (key, title, detail) => ({ key, title, detail });

export const questions = [
  q('D1', 'A · Affectation et correspondance h2a', 'D1 — Affectation des personnes et correspondance h2a', 'a',
    'Recommandé : (a). Cadre owner appliqué à la lettre ; C1-C3 du quorum (3/3) ; identique sous les deux branches de D10 h2a. Consensus Fable / Astra.', [
      o('a', '(a) Fabien seul PRINCIPAL repo:radar-immobilier (selon le cadre, non enregistré dans h2a) ; Farid, Mathieu, Steve humains décideurs sans rôle h2a', 'Déclarés dans le profil du dépôt ; preuve de leur acte = référence externe avec son statut.'),
      o('b', '(b) Steve PRINCIPAL sur un scope client:radar', 'Option réservée : autorité autonome établie, accord de Steve, besoin réel de signature, scope contrôlé (D7 h2a), ratification compétente — cumulatifs.'),
      o('c', '(c) Différer', 'Les dossiers continuent de nommer des décideurs qu’aucun profil ne porte.'),
    ]),
  q('D2', 'A · Affectation et correspondance h2a', 'D2 — Règle « seuls PRINCIPAL et EXECUTIF sont humains » dans le profil immo', 'a',
    'Recommandé : (a). Nécessaire sous la branche B de D10 h2a, redondante et inoffensive sous la branche A. Consensus Fable / Astra.', [
      o('a', '(a) Écrire la règle dans le profil immo maintenant', 'humanRoles: ["PRINCIPAL", "EXECUTIF"], vérifiée par le contrôle statique (D15).'),
      o('b', '(b) Attendre la DEC h2a (D10)', 'Une seule source ; date de la DEC unknown ; différer ne tranche pas D10.'),
      o('c', '(c) Ne pas l’écrire', 'Le cadre owner n’est écrit nulle part dans le dépôt.'),
    ]),
  q('D3', 'B · Périmètres de validation', 'D3 — Périmètre et critères de la Validation PO', 'a',
    'Recommandé : (a). Farid peut amender la liste dans son commentaire.', [
      o('a', '(a) Cinq critères : recette de la version, sémantique métier visible, oracle et seuils métier, saisie PO, effets du coût refacturé sur le produit', 'Critères nommés, donc refus motivables ; le cinquième ne confère ni pouvoir de financement ni fonction de facturation.'),
      o('b', '(b) Recette seule', 'Léger ; la sémantique visible et les seuils métier passeraient sans validation PO.'),
      o('c', '(c) Recette + tout ce qui est visible du client, sans liste', 'Large ; non vérifiable par un contrôle statique.'),
    ]),
  q('D4', 'B · Périmètres de validation', 'D4 — Déclencheurs de la Validation PO sur une décision technique', 'a',
    'Recommandé : (a). Correspond aux lignes tech.* de la matrice. Consensus Fable / Astra.', [
      o('a', '(a) Quatre déclencheurs : qualité servie, coût refacturé, droit ou parcours produit, saisie PO ; sinon Farid consulté et V PO N-A motivé ; effet unknown = à instruire', 'Limite les sollicitations du PO à ce qui le concerne.'),
      o('b', '(b) Toujours V PO sur tech.*', 'Simple ; Farid validerait des choix qu’il ne peut pas juger.'),
      o('c', '(c) Jamais, C seulement', 'Une décision technique qui change la qualité servie passerait sans lui.'),
    ]),
  q('D5', 'B · Périmètres de validation', 'D5 — Ordre du backlog et engagement d’itération', 'a',
    'Recommandé : (a). Position immo D3 ; verbatim owner du 2026-09-15 (non re-mesuré). « Fabien décide D5 » = adoption du dispositif, pas les priorités futures.', [
      o('a', '(a) Farid ordonne seul (Fabien consulté) ; contenu d’itération = D Farid ; engagement de livraison et échéance = D Fabien + V AI Builder, V PO sur le périmètre promis', 'Deux actes liés, un seul décideur chacun.'),
      o('b', '(b) Validation AI Builder aussi sur l’ordre', 'Protège la capacité ; contredit le verbatim.'),
      o('c', '(c) Fabien consulté partout, jamais valideur', 'Fabien garantirait des échéances qu’il n’a pas validées.'),
    ]),
  q('D6', 'B · Périmètres de validation', 'D6 — Recette : qui porte « UAT OK »', 'a',
    'Recommandé : (a) ; (b) est portée à Steve et Farid par Q17.2. Recette PO et acceptation contractuelle client sont deux actes distincts.', [
      o('a', '(a) Farid D + V PO ; Steve consulté, remontée via Farid ; Fabien V AI Builder (version testée)', 'Cadre : proxy du client ; aucune autorité inventée pour Steve.'),
      o('b', '(b) Droit de reprise convenu entre Steve et Farid', 'Option à convenir explicitement (périmètre, conditions) ; le profil consigne l’accord, il ne le crée pas.'),
      o('c', '(c) Steve valide chaque recette', 'Acceptation contractuelle de Steve : unknown, à établir par sa source.'),
    ]),
  q('D7', 'B · Périmètres de validation', 'D7 — Orientation produit : décideur inscrit tant que la délégation n’est pas écrite', 'c',
    'Recommandé : (c) — r1 : Fable se rallie à Astra ; (a) est la position r0 de Fable, conservée en option nommée. Désaccord X11 du quorum ; annexe A.', [
      o('a', '(a) Décideur « Steve — délégation à Mathieu : non vérifié » ; Mathieu consulté ; Farid V PO (position r0 de Fable)', 'Inscrit un D Steve sur l’orientation que le cadre n’écrit pas ; substitue de fait Steve à Mathieu.'),
      o('b', '(b) Mathieu décideur « à confirmer »', 'Colle à « oriente » lu comme « décide » ; inscrit un droit que personne n’a écrit.'),
      o('c', '(c) Dernier mot unknown : Mathieu oriente (cadre), Farid garde le backlog, Steve garde objectifs et financement ; question Q17.1 portée ; seuls les arbitrages exigeant l’autorité non établie sont suspendus', 'Aucun nom inventé dans aucun sens ; les droits déjà établis continuent.'),
    ]),
  q('D8', 'B · Périmètres de validation', 'D8 — Urgence production (hotfix)', 'a',
    'Recommandé : (a) — r1 : Fable se rallie à Astra ; (b) est la position r0 de Fable. Les délais restent des propositions que Farid amende.', [
      o('a', '(a) Procédure d’urgence préautorisée et bornée, définie avant incident par Fabien et Farid ; revue de Farid après intervention, qui ne vaut pas validation rétroactive ; écart = décision corrective', 'Actes admissibles, critères, exclusions, preuves, durée, information, repli ; hors déclencheurs D4, V PO N-A motivé.'),
      o('b', '(b) V PO a posteriori sous 2 jours ouvrés, Farid informé sous 24 h, retrait si refusée (position r0 de Fable)', 'Transforme une validation préalable en validation rétroactive ; un retrait automatique peut rétablir la panne.'),
      o('c', '(c) Toujours V PO préalable', 'Aucune exception ; une panne attend une recette.'),
      o('d', '(d) Délégation permanente à Fabien pour tout correctif', 'Un correctif qui change un comportement visible passerait sans V PO ni procédure.'),
    ]),
  q('D9', 'B · Périmètres de validation', 'D9 — Facturation (cost.billing)', 'a',
    'Recommandé : (a), proposition à confirmer. La source ne prouve pas un contrôle existant de Farid (source-gap).', [
      o('a', '(a) Fabien D (émetteur), Farid V (période, unités) — fonction contractuelle distincte de la Validation PO', '« période de facturation Farid » (methode-unites-facturation.md:7).'),
      o('b', '(b) Fabien seul', 'Perd le contrôle de période.'),
      o('c', '(c) Steve V', 'Charge Steve d’un contrôle que Farid peut faire.'),
    ]),
  q('D10', 'C · Présentation « qui décide »', 'D10 — Bloc « qui décide » dans les dossiers', 'a',
    'Recommandé : (a). E0 du quorum (3/3) ; champs ajoutés en r1 (empreinte du profil, décideur attendu, auteur effectif, relais, preuve).', [
      o('a', '(a) Bloc complet §8.1 sous le titre, répété par question (bloc réduit §8.2, consultés compris)', 'Parsable par le contrôle statique ; chaque dossier dit qui décide.'),
      o('b', '(b) Bloc réduit partout', 'Court ; perd présentateur, base d’autorité, preuve, statut.'),
      o('c', '(c) Différer jusqu’à la réponse h2a', 'Une seule forme pour tous les dépôts ; h2a n’a pas de date.'),
    ]),
  q('D11', 'C · Présentation « qui décide »', 'D11 — Questions au PO : format réduit, canal, délai et repli', 'a',
    'Recommandé : (a). Validation AI Builder de Fabien limitée au canal et à l’archivage, nommée dans la question.', [
      o('a', '(a) Bloc réduit ; réponse sur la carte GitHub si publiable, sinon preuve archivée hors dépôt à accès approprié et référencée ; délai par défaut 5 jours ouvrés ; repli = statu quo', 'Réponse datée, attribuable, archivée ; compatible avec un dépôt public.'),
      o('b', '(b) Réunion + compte rendu', 'Le compte rendu est écrit par le relais : le décideur doit le confirmer.'),
      o('c', '(c) Libre', 'Réponses relayées indiscernables du décideur.'),
    ]),
  q('D12', 'C · Présentation « qui décide »', 'D12 — Cartes GitHub et board : conventions de la surface PO', 'a',
    'Recommandé : (a). Validation AI Builder de Fabien limitée à l’outillage.', [
      o('a', '(a) Carte de type décision = bloc réduit + étiquettes decide:farid / decide:fabien (décideur) et porte:… (question transmise à Steve ou à une autre autorité) ; vue « Décisions » ; cartes de décision et d’orientation adressées au PO dans la colonne « Validation PO (UAT preprod, orientations design) », cartes de mise en œuvre en design ou dev ; décisions collées en YAML dans la carte ; créer ou prioriser ≠ engager', 'Porteur, destinataire et décideur distingués ; un automate ne confond pas « priorisé » et « engagé ».'),
      o('b', '(b) Étiquettes seules', 'Léger ; pas de décideur lisible sur la carte détachée.'),
      o('c', '(c) Aucune convention', 'Le board reste muet sur qui décide.'),
    ]),
  q('D13', 'D · Outillage et dépôt', 'D13 — Track : décideur, validations, relais', 'a',
    'Recommandé : (a). Conforme à C6 : accountable reste le sponsor ; décideur attendu et auteur effectif séparés.', [
      o('a', '(a) À la création : décideur attendu et base d’autorité dans --context ; après réponse : auteur effectif, preuve, relais, empreintes ; accountable inchangé ; champs natifs quand track les offre', 'Aucun decidedBy prérempli comme fait accompli ; anciens actes « autorité historique non établie — non vérifié ».'),
      o('b', '(b) Attendre les champs natifs', 'Une seule écriture ; date unknown.'),
      o('c', '(c) accountable = décideur', 'Défait la décision D6 du package track.'),
    ]),
  q('D14', 'D · Outillage et dépôt', 'D14 — Fichier de profil, source unique', 'a',
    'Recommandé : (a). Chaque attribution porte provenance, périmètre, validité, révocation, ratification ; projection vers org.h2a.yaml v2 seulement si h2a adopte E1.', [
      o('a', '(a) docs/governance/roles.profile.json (avec provenance et validité des droits) + docs/governance/ROLES.md contrôlé contre le JSON', 'Un seul fichier parsé ; le profil consigne les autorités établies, il ne crée pas celles des tiers.'),
      o('b', '(b) ROLES.md seul, tableau Markdown parsé', 'Un fichier ; parseur fragile.'),
      o('c', '(c) org.h2a.yaml v2 dès maintenant', 'Présume D1-D4 h2a ; configuration décorative tant que le parseur h2a ne la lit pas.'),
    ]),
  q('D15', 'D · Outillage et dépôt', 'D15 — Contrôle statique Node/TS', 'a',
    'Recommandé : (a). E0 du quorum ; 0 Python ; vérifie la cohérence des déclarations, pas leur vérité.', [
      o('a', '(a) make check-decisions sur DOSSIER_DECISION_*.md et plan/*-BRANCH_*.md ; tolérant pour brouillons et renseignements unknown ; bloquant en CI pour les transitions engageantes', 'Périmètre = nouveaux dossiers et plans ; exceptions datées pour l’existant.'),
      o('b', '(b) Avertissement seul', 'Reste une ligne de spécification.'),
      o('c', '(c) Différer', 'Le bloc n’est pas vérifié.'),
    ]),
  q('D16', 'D · Outillage et dépôt', 'D16 — Identités stables et droits GitHub', 'b',
    'Recommandé : (b), le dépôt étant public (gh repo view : PUBLIC). Les prénoms et fonctions affichés restent des données personnelles déjà présentes dans le dépôt.', [
      o('a', '(a) human:<courriel> + alias GitHub déclarés dans le profil', 'Cohérent avec le by de Track ; publierait des courriels de tiers.'),
      o('b', '(b) Identifiants stables sans prénom ni adresse encodés + table d’alias hors dépôt public ; chaque personne confirme ; droits GitHub de Farid séparés des droits de décision, re-mesurés et alignés', 'Aucune donnée personnelle nouvelle au-delà de l’existant ; un identifiant opaque ne rend pas l’ensemble anonyme.'),
      o('c', '(c) Prénoms seuls', 'Ambigu ; aucune clé stable.'),
    ]),
  q('D17', 'E · Questions portées à Steve', 'D17 — Questions produit portées à Steve par Farid', 'a',
    'Recommandé : (a). Deux fiches : Q17.1 délégation d’orientation (décision de Steve, acceptation de Mathieu, V Farid) ; Q17.2 recette client (renseignement, accord Steve / Farid).', [
      o('a', '(a) Farid porte les deux fiches, chacune avec son bloc réduit ; réponses consignées avec leur source ; unknown jusque-là', 'Porteur, décideur de fond, validations et consultés distingués ; D17 n’enregistre pas les réponses qu’elle transmet.'),
      o('b', '(b) Fabien porte', 'Mélange produit et contrat.'),
      o('c', '(c) Attendre', 'Les cases « ? » de la matrice restent unknown sans date.'),
    ]),
  q('D18', 'E · Questions portées à Steve', 'D18 — Questions contractuelles portées à Steve par Fabien', 'a',
    'Recommandé : (a). Q18.1 responsabilité des données = renseignement (source juridique ou contractuelle) ; Q18.2 seuils de dépense = décision de Steve.', [
      o('a', '(a) Fabien porte les deux fiches ; unknown jusqu’à réponse ; aucune personne désignée par simple inscription au profil', 'Un rôle technique ne confère aucune autorité légale ; renseignement et décision séparés.'),
      o('b', '(b) Farid porte', 'Qualité de partie contractante et habilitation de Farid pour ce portage : non vérifié.'),
      o('c', '(c) Attendre', 'La « Déclaration Loi 25 à prévoir » reste sans responsable.'),
    ]),
];

export const minimalValidAnswer = 'Une option par décision D1 à D18, ou « différer » ; Farid répond au moins à D3, D6 et D7 ; Fabien au moins à D1, D14 et D15';

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
      recommended: question.recommended, decides: question.decides, consulted: question.consulted, validation: question.validation,
      selection, decisionStatus: answered ? 'owner-draft-not-ratified' : 'open',
      comment: comments[question.key] ?? '',
      options: question.options.map(option => ({ key: option.key, title: option.title, detail: option.detail })),
    };
  });
  return {
    schema: 'immo-roles-decision-response/v1',
    dossier: manifest.dossier, dossierHash: manifest.dossierHash,
    artifactInputHash: manifest.artifactInputHash, capturedAt,
    status: 'draft-not-ratified',
    authority: 'brouillon local : aucune règle écrite dans le dépôt, aucun droit accordé, aucun événement track, aucune fusion de PR ; attributions prévues seulement, auteur effectif et relais not covered',
    minimalValidAnswer, responses,
  };
}
