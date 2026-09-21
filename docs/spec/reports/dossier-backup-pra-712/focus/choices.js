// Dossier recentré sur l'ÉTAPE 1 (première vague). RÈGLE DURE : ZÉRO question.
// Le design est tranché ; chaque point est une DÉCISION STATUÉE (un fait) ou de
// l'EXÉCUTION, jamais une question. Rien n'est ratifié ici : la page ne produit
// qu'un enregistrement local exportable, relu par l'owner avant tout commit.
//
// Deux étapes explicites : « ce qu'on fait maintenant » (étape 1, cette semaine)
// et « ce qu'il faudra faire après » (prochaine carte, étape 2). Les points de
// l'étape 2 sont listés, jamais posés en question.

// Le principe qui porte tout le dossier étape 1.
export const principe = {
  title: 'Principe',
  body: "La préproduction ne se sauvegarde pas. On sauvegarde la PRODUCTION seule ; "
    + "la préprod est RECONSTRUITE depuis la prod — préprod iso-prod, pour tester avant de passer en prod.",
};

// La cible de validation de la semaine, affichée comme la cible à tenir.
export const cible = {
  title: 'Cible de validation de la semaine',
  items: [
    "1ʳᵉ vague : backup prod → préprod en place — bascule des données globales prod → préprod (DB + docs, `runs/` inclus).",
    "Restore prod → prod full automatisé, dans un temps limité — RTO borné, cible < 2 h.",
  ],
};

// Étape 1 — ce qu'on fait maintenant. Chaque item est une décision STATUÉE (fait)
// ou de l'exécution, présenté comme tel, jamais comme une question.
export const etape1 = {
  title: 'Ce qu’on fait maintenant',
  tag: 'étape 1 · cette semaine',
  decisions: [
    { key: 'D1', title: 'Serving = immo, GEO_DOCUMENTS_REPOINT=0',
      detail: 'On sert les PV depuis immo (geo n’a rien à date). Le repoint préprod à 1 était une erreur : flip 1 → 0. Statué, pas une question.' },
    { key: 'D2', title: 'Bascule prod → préprod, mécanisme natif immo',
      detail: 'Scripts NATIFS du repo immo, câblés en CI immo, rejouables par l’owner SANS IA (OPS-3) : autonomie immo, aucune orchestration externe. Ils copient les données globales de prod vers préprod — DB + docs, `runs/` inclus. Automatisé.' },
    { key: 'D3', title: 'Restore prod → prod full automatisé',
      detail: 'Même nature : script natif immo, en CI, rejouable sans IA (OPS-3). Cible statuée : RTO borné, < 2 h. Le « temps limité » par défaut, écrit comme cible, pas posé en question.' },
    { key: 'D4', title: 'Provisioning des creds = lane k8s',
      detail: 'Identités OVH (lecture docs+DB prod ; écriture docs-preprod + DB préprod) et sauvegarde `.env` : fait par la lane k8s, pas par l’owner. Acte d’exécution.' },
    { key: 'D5', title: 'Réutilisation du toolkit backup natif existant',
      detail: 'feat/backup-pra-698 : scripts de sauvegarde, restore et verify, déjà écrits. On réutilise, on ne réécrit pas.' },
  ],
};

// L'état factuel : ce qui est prêt, ce qui reste à construire. Aucune question.
export const pretVsConstruire = {
  pret: [
    'Bascule et restore : scripts natifs du repo immo, câblés en CI, rejouables sans IA (OPS-3).',
    'DB prod → préprod : job restore-verify existant.',
    'Toolkit backup natif : feat/backup-pra-698 (scripts de sauvegarde, restore, verify).',
    'Copie docs : server-side same-endpoint OVH bhs (pas de copieur à-travers-pod, contrainte disque).',
    '`runs/` : gratuit avec la copie docs.',
  ],
  aConstruire: [
    'Image `radar-backup` : à builder puis à épingler (pin).',
    'Identités à provisionner (lane k8s) : lecture docs+DB prod, écriture docs-preprod + DB préprod, sauvegarde `.env`.',
  ],
};

// Étape 2 — ce qu'il faudra faire après, la prochaine carte. Listé, jamais posé
// en question : c'est le PRA conforme, hors de la première vague.
export const etape2 = {
  title: 'Ce qu’il faudra faire après',
  tag: 'prochaine carte · étape 2',
  items: [
    'Verrou d’objet (Object Lock) — mode et durée.',
    'RPO 24 h et rétention longue.',
    'Externalisation hors-région.',
    'Cutover geo (spec (a) geo-cond gelée).',
    'Indépendance du dépôt k8s.',
    'PRA complet.',
  ],
};

// ZÉRO question : le dossier étape 1 n'interroge pas. L'export et le contrôle
// Chromium s'appuient sur ce tableau vide.
export const questions = [];

// Enregistrement local exportable : le design statué de l'étape 1, tel quel.
// Aucune réponse à donner — l'owner relit, puis i-cond commite.
export function decisionRecord(manifest, capturedAt = null) {
  return {
    schema: 'immo-712-backup-pra-etape1-decisions/v1',
    dossier: manifest.dossier, dossierHash: manifest.dossierHash,
    artifactInputHash: manifest.artifactInputHash, capturedAt,
    status: 'statué · relu par l’owner avant commit',
    authority: 'enregistrement local : aucune fusion de PR, aucun déploiement, aucune action cluster, aucun acte de production, aucun événement track',
    questions: [],
    principe, cible, etape1, pretVsConstruire, etape2,
  };
}
