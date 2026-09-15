// Les choix exposés au propriétaire sont exactement ceux de §7 du dossier M1 (v3) :
// « Répondre par A, B′, C′ ou D′. » Une seule question, une seule réponse.
// Rien n'est ratifié ici : la page ne produit qu'un brouillon local exportable.
export const questions = [
  {
    key: 'm1-option', mode: 'single', group: '§7 — Ce qu’on demande à l’owner',
    question: 'Quelle option retenir pour le CronJob radar-refresh-pv ?',
    context: "Une seule réponse. Le présentateur recommande A, puis d'instruire C′ ensuite. Cette réponse n'autorise, par elle-même, ni acte de production, ni fusion de #682, #687 ou #688, ni modification de contrat, de prompt, de schéma ou de validateur.",
    options: [
      { key: 'A', title: 'A — promouvoir tel quel', detail: 'Gemini 3.8 Flash LOW, contrat v9 93994e45, plafond 64 000, échec journalisé par PV. Plafond mesuré : 87 % acceptés, IC 95 % [79 ; 92].' },
      { key: 'B_PRIME', title: 'B′ — corriger l’ancrage avant de promouvoir', detail: 'Tolérer les insertions de mise en page et autoriser la page suivante pour un extrait qui déborde. Plafond mesuré : 87 → 93 %.' },
      { key: 'C_PRIME', title: 'C′ — écarter l’enregistrement fautif', detail: 'Écarter l’enregistrement au lieu de refuser le document, compteur publié dans le reçu et dans recordOutcome. Plafond mesuré : 87 → 96 %.' },
      { key: 'D_PRIME', title: 'D′ — rejouer v100 à l’identique', detail: 'Mesurer la variance à corpus fixe avant tout choix. Ne corrige aucune cause ; coûte 100 requêtes de plus.' },
    ],
  },
];

export const minimalValidAnswer = 'Une lettre parmi A, B′, C′ et D′ — la recommandation du dossier est A, puis instruire C′';

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
    schema: 'immo-m1-decision-owner-response/v1',
    dossier: manifest.dossier, dossierHash: manifest.dossierHash,
    artifactInputHash: manifest.artifactInputHash, capturedAt,
    status: 'draft-not-ratified',
    authority: 'brouillon local : aucun acte de production, aucune fusion de PR, aucune modification de contrat, de prompt, de schéma ou de validateur, aucun événement track',
    minimalValidAnswer, responses,
  };
}
