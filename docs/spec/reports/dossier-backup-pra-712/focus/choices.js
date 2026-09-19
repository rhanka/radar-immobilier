// Les choix exposés au propriétaire sont exactement ceux de la section 12 du
// dossier v2 « Sauvegardes et PRA d'ensemble immo + geo » : D1 à D5.
// Rien n'est ratifié ici : la page ne produit qu'un brouillon local exportable.
const GROUP = "§12 — Ce que j'attends de toi";
export const questions = [
  {
    key: 'D1', mode: 'single', group: GROUP,
    question: 'D1 — PR #712 et geo#390 : que faire ?',
    context: 'Recommandé : A, corriger avant fusion. Les deux revues contradictoires concluent « non fusionnable en l’état ». Cette réponse n’autorise, par elle-même, ni fusion, ni provisionnement, ni activation, ni action cluster.',
    options: [
      { key: 'A', title: 'A — corriger avant fusion, prouver en préproduction, puis fusionner les deux PR et activer préprod et prod ensemble (recommandé)', detail: 'Satisfait les exigences 3 et 4 telles quelles ; une passe de corrections substantielle, puis D2, puis la preuve.' },
      { key: 'B', title: 'B — corriger, prouver, fusionner et activer la préproduction seule ; la production après un premier cycle préproduction vérifié', detail: 'Position par défaut des deux revues ; déroge à l’exigence 3 (activation simultanée).' },
      { key: 'C', title: 'C — fusionner en l’état', detail: 'Rejeté par les deux revues : reçus forgés, écrasement, absence de confinement, alerte d’astreinte à l’activation ; saute la preuve avant fusion.' },
      { key: 'D', title: 'D — reporter', detail: 'Livrer d’un coup coordinateur de cycle et copie geo ; aucune sauvegarde planifiée d’ici là.' },
    ],
  },
  {
    key: 'D2', mode: 'single', group: GROUP,
    question: 'D2 — mode et durée du verrou d’objet (immo préproduction, immo production, geo)',
    context: 'La conformité est irréversible : personne, ni un administrateur ni toi, ne peut supprimer une version verrouillée avant échéance, et le stockage est facturé quoi qu’il arrive. Le verrou prime sur l’expiration. Préalable : le défaut B4 doit être corrigé pour que le provisionnement aille au bout avec une rétention par défaut.',
    options: [
      { key: 'CONDUCTEUR', title: 'Recommandation du conducteur : conformité 7 j en production, gouvernance 1 j en préproduction, conformité 1 an pour geo', detail: 'En production, seuls les jeux des 7 derniers jours sont indestructibles ; les plus anciens restent récupérables 35 jours comme versions non courantes.' },
      { key: 'FABLE', title: 'Proposition Fable : gouvernance 35 j dans les deux environnements immo (geo selon son plan)', detail: 'Aucune identité runtime ne détient le contournement ; durée alignée sur l’expiration des versions non courantes.' },
      { key: 'GEMINI', title: 'Proposition Gemini : gouvernance 14 j, jamais de conformité', detail: 'Garde la possibilité de corriger une erreur de rétention ; au-delà de 35 j, les versions non courantes ne pourraient plus expirer.' },
      { key: 'AUTRE', title: 'Autre combinaison', detail: 'Mode et durée par périmètre à préciser en commentaire.' },
    ],
  },
  {
    key: 'D3', mode: 'single', group: GROUP,
    question: 'D3 — versionnement du bucket sentropic-geo',
    context: 'Non confirmé actif à ce jour ; sans lui, copier une version exacte des publications geo est impossible.',
    options: [
      { key: 'CONFIRME', title: 'Confirmé actif', detail: 'Le versionnement de sentropic-geo est actif.' },
      { key: 'ACTIVER', title: 'À activer', detail: 'Le versionnement de sentropic-geo est à activer.' },
      { key: 'MESURER', title: 'À mesurer d’abord par la lane k8s', detail: 'Relevé de l’état réel avant décision.' },
    ],
  },
  {
    key: 'D4', mode: 'single', group: GROUP,
    question: 'D4 — nom et région du bucket de reprise geo',
    context: 'sentropic-geo-pra en bhs, proposé. Une cible dans la même région ne couvre pas une panne régionale ; une autre région ajoute sortie réseau, stockage et latence, à chiffrer par i-infra et k8s.',
    options: [
      { key: 'VALIDE', title: 'sentropic-geo-pra en bhs, validé', detail: 'Couvre la perte d’objets et d’instance, pas une panne régionale.' },
      { key: 'AUTRE_REGION', title: 'Une autre région', detail: 'Pour couvrir une panne régionale : région à préciser en commentaire, coût à chiffrer.' },
      { key: 'AUTRE_NOM', title: 'Un autre nom', detail: 'Nom à préciser en commentaire.' },
    ],
  },
  {
    key: 'D5', mode: 'single', group: GROUP,
    question: 'D5 — détection d’exposition publique',
    context: 'OVH BHS n’a ni blocage d’accès public ni politique de bucket : un droit public posé à la main est détecté, pas empêché.',
    options: [
      { key: 'BUCKET', title: '(a) s’en tenir au niveau du bucket, avec la preuve que l’écrivain se voit refuser la pose d’une ACL publique — solution retenue par le conducteur', detail: 'Aucun élargissement de droits ; le résidu au niveau des objets est documenté.' },
      { key: 'OBJETS', title: '(b) étendre la détection au niveau des objets', detail: 'Demande d’élargir les droits du lecteur à la lecture des ACL d’objets.' },
    ],
  },
];

export const minimalValidAnswer = 'D1 A/B/C/D · D2 une combinaison · D3 · D4 · D5 — recommandé : D1 = A, D5 = (a)';

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
    schema: 'immo-712-decision-owner-response/v2',
    dossier: manifest.dossier, dossierHash: manifest.dossierHash,
    artifactInputHash: manifest.artifactInputHash, capturedAt,
    status: 'draft-not-ratified',
    authority: 'brouillon local : aucune fusion de PR, aucun déploiement, aucune action cluster, aucun acte de production, aucun événement track',
    minimalValidAnswer, responses,
  };
}
