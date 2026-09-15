// Les choix exposés au propriétaire sont exactement ceux de §7 du dossier.
// Rien n'est ratifié ici : la page ne produit qu'un brouillon local exportable.
export const questions = [
  {
    key: 'q1-way-of-working', mode: 'single', group: 'Q1 — Way of working',
    question: 'Quel way of working adopter au-dessus de track ?',
    context: "Une seule réponse. A est recommandée par le présentateur, conditionnelle à T12 ; la relecture indépendante recommande B ou D d'emblée.",
    options: [
      { key: 'A', title: 'A — 8 colonnes owner + « En prod (clos) »', detail: 'Recommandée, conditionnelle à T12 (script kanban-move + action PR vers Status).' },
      { key: 'B', title: 'B — 6 colonnes, phases en labels', detail: 'Préférée par la relecture indépendante ; repli automatique si une colonne ment.' },
      { key: 'C', title: 'C — pas de projet GitHub', detail: 'track report hebdomadaire ; la main owner passe par la revue de PR et environment production.' },
      { key: 'D', title: 'D — board généré depuis track', detail: 'Cible après T12 ; suppose une extension de track, hors des 15 jours.' },
    ],
  },
  {
    key: 'q1-plan-github', mode: 'single', group: 'Q1 — Way of working',
    question: 'Quel est le plan GitHub du compte rhanka ?',
    context: "Détermine le nombre de workflows d'auto-ajout : 1 sur Free, 5 sur Pro ou Team. Non vérifié par le présentateur.",
    options: [
      { key: 'FREE', title: 'Free — un seul auto-ajout', detail: "Le filtre d'auto-ajout doit couvrir les trois dépôts à lui seul." },
      { key: 'PRO', title: 'Pro ou Team — cinq auto-ajouts', detail: 'Un filtre par dépôt devient possible.' },
      { key: 'UNKNOWN', title: 'À vérifier', detail: 'Laisse la question ouverte ; le plan de §5 suppose alors Free.' },
    ],
  },
  {
    key: 'q2-hold', mode: 'single', group: 'Q2 — Itération 2026-09-15 → 2026-09-29',
    question: "Que signifie « clôture du chantier refresh PV vers Signaux » dans le hold de O2 ?",
    context: "C'est la circularité relevée par la relecture : sous la lecture stricte, O2 attend O1 et O1b attend O2.",
    options: [
      { key: 'PREPROD_PROUVE', title: 'Cycle préprod prouvé', detail: 'O2 démarre en S1 ; O1b reste possible dans les 15 jours.' },
      { key: 'CRON_PROD_ARME', title: 'Cron prod armé', detail: "O2 passe après O1b : alors pas d'armement prod dans l'itération, qui se limite à la préprod." },
    ],
  },
  {
    key: 'q2-items', mode: 'multi', group: 'Q2 — Itération 2026-09-15 → 2026-09-29',
    question: "Quels items retenir pour l'itération de 15 jours ?",
    context: 'Sélection recommandée : les neuf items de §4.2, plus le jour 0. La relecture propose de retirer O4 et O8.',
    options: [
      { key: 'J0', title: 'Jour 0 — GO owner pour l’apply du Role de la PR 690', detail: 'Remet le CD préprod au vert ; condition de O1a et O7.' },
      { key: 'O2', title: 'O2 — Backup + PRA (3 h)', detail: 'Inclut le bucket prod distinct (D17) et l’exercice de restauration.' },
      { key: 'O1a', title: 'O1a — Chaîne de fusion refresh + cycle préprod prouvé (1 h)', detail: 'PR 688, 682, 678, 636 ; traitement de l’issue 663.' },
      { key: 'O1b', title: 'O1b — Armement prod du CronJob', detail: 'Tag v* après GO owner ; dépend de O2 et du critère de couverture.' },
      { key: 'O7', title: 'O7 — Annotation signaux / villes (3 h)', detail: 'Mesure des cibles annotables puis UAT Steve en préprod.' },
      { key: 'O3', title: 'O3 — DAG geo, design et début de build (2 h)', detail: 'Design s3-dag finalisé ; premier lot en PR geo.' },
      { key: 'O5', title: 'O5 — Industrialisation règlements / grilles (2 h)', detail: 'Dossier structure documentaire tranché ; lot geo d’acquisition ouvert.' },
      { key: 'O6', title: 'O6 — Mapping signal × zones × règlements (2 h)', detail: 'Lot 1 = relance de la mesure Jalon 1 ; spec Niveau 2 et 3.' },
      { key: 'O4', title: 'O4 — Plan de migration immo → geo (2 h)', detail: 'Sortie possible selon la relecture indépendante.' },
      { key: 'O8', title: 'O8 — Plan 3D (1 h)', detail: 'Sortie possible selon la relecture indépendante.' },
      { key: 'T12', title: 'T12 — Réconciliation Track ↔ Git + kanban-move + action PR → Status', detail: 'Condition de l’option A en Q1.' },
      { key: 'A8', title: 'Option — A8 Couches environnementales BDZI/GRHQ (geo)', detail: 'Si Steve rend sa priorisation des couches pendant l’itération.' },
    ],
  },
  {
    key: 'q2-m1', mode: 'single', group: 'Q2 — Itération 2026-09-15 → 2026-09-29',
    question: 'Réponse au dossier M1 v2, due avec O1a',
    context: 'Reste due séparément ; O1a ne se termine pas sans elle.',
    options: [
      { key: 'A', title: 'A', detail: 'Option A du dossier M1 v2.' },
      { key: 'B', title: 'B', detail: 'Option B du dossier M1 v2.' },
      { key: 'C', title: 'C', detail: 'Option C du dossier M1 v2.' },
      { key: 'D', title: 'D', detail: 'Option D du dossier M1 v2.' },
    ],
  },
  {
    key: 'q2-couverture', mode: 'single', group: 'Q2 — Itération 2026-09-15 → 2026-09-29',
    question: "Faut-il un critère de couverture avant l'armement prod (O1b) ?",
    context: 'Rappel macro mesuré 0,547 ; v16 à 3/5. L’acceptation ne mesure pas la couverture.',
    options: [
      { key: 'OUI', title: 'Oui — critère requis avant O1b', detail: 'Ajoute une mesure de couverture au gate de promotion.' },
      { key: 'NON', title: 'Non — armement sans critère supplémentaire', detail: 'Le gate reste l’acceptation actuelle.' },
    ],
  },
  {
    key: 'q3-creation', mode: 'single', group: 'Q3 — Création',
    question: 'Quelle surface créer sur GitHub ?',
    context: 'Aucune commande n’a été exécutée ; le jeton courant les refuserait (scope project absent).',
    options: [
      { key: '18_PLUS_2', title: '18 issues + 2 adoptées', detail: 'Backlog visible : I1a, I1b, I2 à I9, B1 à B8, plus les issues 663 et 660.' },
      { key: '12_CARTES', title: '12 cartes — itération seule', detail: 'Variante de la relecture : le backlog reste dans track jusqu’à promotion.' },
      { key: 'MODIFIER', title: 'Modifier la liste d’abord', detail: 'Rien n’est créé tant que la liste n’est pas amendée.' },
      { key: 'GO', title: 'GO pour exécuter §5 après Q1 et Q2', detail: 'Le conducteur exécute le plan de création tel qu’écrit.' },
    ],
  },
];

export const minimalValidAnswer = 'Q1 A · hold = préprod prouvé · O2, O1a M1-B, O1b oui, jour 0 GO, O7, O3, O5, O6, O4, O8, T12 · Q3 18+2 GO';

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
      selection, decisionStatus: answered ? 'owner-draft-not-ratified' : 'open',
      comment: comments[question.key] ?? '',
      options: question.options.map(option => ({ key: option.key, title: option.title, detail: option.detail })),
    };
  });
  return {
    schema: 'immo-kanban-decision-owner-response/v1',
    dossier: manifest.dossier, dossierHash: manifest.dossierHash,
    artifactInputHash: manifest.artifactInputHash, capturedAt,
    status: 'draft-not-ratified',
    authority: 'brouillon local : aucune issue, aucun projet GitHub, aucun événement track, aucun déploiement',
    minimalValidAnswer, responses,
  };
}
