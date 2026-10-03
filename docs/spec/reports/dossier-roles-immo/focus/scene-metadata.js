// Contenu des cartes du dossier de décision « rôles et droits de décision dans
// radar-immobilier ». Le gabarit, la géométrie et le routage viennent de la
// chaîne existante (`docs/architecture/focus`), qui importe elle-même le kit h2a
// monté en /kit. Ici : uniquement le contenu des cinq scènes et le contrôle de contrat.
// Classes : observed = cadre fixé par l'owner ou constaté dans les fichiers ;
// declared = proposé par le dossier, non ratifié ; unknown = autorité non établie ;
// external = autorité extérieure au dépôt.
import { roleIsShort } from '../../../../architecture/focus/scene-metadata.js';

const EVIDENCE = new Set(['observed', 'declared', 'historical', 'dormant', 'unknown', 'external']);
const RUNTIME = new Set(['active', 'suspended', 'dormant', 'manual', 'retained', 'unknown', 'not-applicable']);

const IMMO = ['radar-immobilier'];
const GEO = ['geo'];
const H2A = ['h2a'];
const A = (repo, kind, evidenceClass, runtimeState, icon, spec) => ({
  card: 'A', kind, repo: [...repo].sort(), evidenceClass, runtimeState, icon,
  code: spec.code ?? '', role: spec.role ?? '', name: spec.name ?? '', detail: spec.detail ?? '',
});
const BOX = (repo, evidenceClass, runtimeState, spec) => ({
  card: 'box', kind: 'cluster', repo: [...repo].sort(), evidenceClass, runtimeState, icon: 'cluster',
  code: spec.code ?? '', role: '', name: spec.name ?? '', detail: '',
});
const e = (evidenceClass, runtimeState) => ({ evidenceClass, runtimeState });
// Cadre fixé par l'owner (ou fait constaté) : observed, retained.
const K = (kind, icon, spec, repo = IMMO) => A(repo, kind, 'observed', 'retained', icon, spec);
// Proposé par le dossier, non ratifié : declared, dormant.
const P = (kind, icon, spec, repo = IMMO) => A(repo, kind, 'declared', 'dormant', icon, spec);
// Autorité ou droit non établi par une source.
const U = (kind, icon, spec, repo = IMMO) => A(repo, kind, 'unknown', 'unknown', icon, spec);
const CADRE = e('observed', 'retained');
const PROPOSED = e('declared', 'dormant');
const OPEN = e('unknown', 'unknown');

const scenes = {
  // Scène 1 — §5 : personnes, fonctions, rôle h2a, périmètres de décision.
  'roles-perimetres': {
    nodes: {
      PE: BOX(IMMO, 'observed', 'retained', { code: 'PE', name: 'Personnes' }),
      FAB: K('person', 'user', { code: 'P-1', role: 'Personne · owner', name: 'Fabien', detail: 'AI Builder · owner du code' }),
      FAR: K('person', 'user', { code: 'P-2', role: 'Personne · PO', name: 'Farid', detail: 'sans rôle h2a · décideur' }),
      MAT: K('person', 'user', { code: 'P-3', role: 'Personne · PM', name: 'Mathieu', detail: 'sans rôle h2a · oriente' }),
      STE: K('person', 'user', { code: 'P-4', role: 'Personne · client', name: 'Steve', detail: 'sans rôle h2a · financeur' }),
      FO: BOX(IMMO, 'observed', 'retained', { code: 'FO', name: 'Fonctions (cadre)' }),
      FAIB: K('function', 'identity', { code: 'F-AIB', role: 'Fonction · tech', name: 'AI Builder, owner', detail: 'garant de la livraison' }),
      FPO: K('function', 'identity', { code: 'F-PO', role: 'Fonction · produit', name: 'Product Owner, proxy', detail: 'définit, valide le backlog' }),
      FPM: K('function', 'identity', { code: 'F-PM', role: 'Fonction · produit', name: 'Product Manager', detail: 'oriente le produit' }),
      FCL: K('function', 'identity', { code: 'F-CLI', role: 'Fonction · client', name: 'Client financeur', detail: 'utilisateur principal' }),
      H2: BOX(IMMO, 'observed', 'retained', { code: 'H2', name: 'Rôle h2a' }),
      PRI: K('role', 'network', { code: 'R-1', role: 'Rôle h2a · humain', name: 'PRINCIPAL du dépôt', detail: 'scope repo:radar-immobilier' }),
      AGT: K('role', 'cronjob', { code: 'R-2', role: 'Rôles h2a · agents', name: 'i-cond, lanes, harness', detail: 'préparent, ne décident pas' }),
      PD: BOX(IMMO, 'declared', 'dormant', { code: 'PD', name: 'Domaines de décision' }),
      DTECH: P('domain', 'graph', { code: 'D-T', role: 'Domaines · tech', name: 'tech.* · ops.* · wow.*', detail: 'D Fabien · V AI Builder' }),
      DPROD: P('domain', 'graph', { code: 'D-P', role: 'Domaines · produit', name: 'product.*', detail: 'D Farid · V PO' }),
      DCLI: P('domain', 'graph', { code: 'D-C', role: 'Domaines · client', name: 'client.* · cost.budget', detail: 'D Steve · consultés C' }),
    },
    edges: {
      'FAB|FAIB|exerce': CADRE,
      'FAR|FPO|exerce': CADRE,
      'MAT|FPM|exerce': CADRE,
      'STE|FCL|exerce': CADRE,
      'FAB|PRI|tient': CADRE,
      'PRI|AGT|émet MANDATE': CADRE,
      'FCL|PRI|✕ option réservée': OPEN,
      'FAIB|DTECH|décide · valide': PROPOSED,
      'FPO|DPROD|décide · valide': PROPOSED,
      'FCL|DCLI|décide': PROPOSED,
      'FPM|DPROD|oriente · à confirmer': OPEN,
    },
  },

  // Scène 2 — §6 : la matrice, domaine par domaine, et les deux validations nommées.
  'matrice-decide-valide': {
    nodes: {
      MC: BOX(IMMO, 'declared', 'dormant', { code: 'MC', name: 'Client et coût' }),
      OBJ: P('domain', 'graph', { code: 'client.objectives', role: 'Client · objectifs', name: 'D Steve', detail: 'C Mathieu, Farid, Fabien' }),
      BUD: P('domain', 'graph', { code: 'cost.budget', role: 'Coût · budget', name: 'D Steve · financeur', detail: 'C Fabien (estimation)' }),
      BIL: P('domain', 'graph', { code: 'cost.billing', role: 'Coût · facturation', name: 'D Fabien · V PO', detail: 'I Steve · option D9' }),
      MP: BOX(IMMO, 'declared', 'dormant', { code: 'MP', name: 'Produit' }),
      ORI: U('domain', 'graph', { code: 'product.orientation', role: 'Produit · pivot', name: 'D unknown · délégation ?', detail: 'Mathieu oriente · V PO Farid' }),
      BKL: P('domain', 'graph', { code: 'product.backlog', role: 'Produit · backlog', name: 'D Farid · V PO', detail: 'C Fabien, Steve, Mathieu' }),
      ITE: P('domain', 'graph', { code: 'product.iteration', role: 'Produit · itération', name: 'D Farid · V PO', detail: 'V AI Builder · engagement' }),
      ACC: P('domain', 'graph', { code: 'product.acceptance', role: 'Produit · recette', name: 'D Farid · V PO', detail: 'V AI Builder · C Steve' }),
      SEM: P('domain', 'graph', { code: 'product.semantics', role: 'Produit · sémantique', name: 'D Farid · V PO', detail: 'V AI Builder · C Steve' }),
      MT: BOX(IMMO, 'declared', 'dormant', { code: 'MT', name: 'Technique, opérations' }),
      ARC: P('domain', 'graph', { code: 'tech.*', role: 'Tech · archi, IA', name: 'D Fabien · V AI Builder', detail: 'V PO si visible du client' }),
      SEC: P('domain', 'graph', { code: 'tech.security', role: 'Tech · sécurité', name: 'D Fabien · V AI Builder', detail: 'C Steve · V légale : unknown' }),
      REL: P('domain', 'graph', { code: 'ops.release', role: 'Ops · release', name: 'D Fabien · V AI Builder', detail: 'V PO · recette de la version' }),
      CON: P('domain', 'graph', { code: 'ops.continuity', role: 'Ops · PRA', name: 'D Fabien · V AI Builder', detail: 'C Steve (RPO, RTO)' }),
      WOW: P('domain', 'graph', { code: 'wow.process', role: 'Méthode · rôles', name: 'D Fabien · V AI Builder', detail: 'V PO · saisie PO' }),
      MV: BOX(IMMO, 'declared', 'dormant', { code: 'MV', name: 'Validations nommées' }),
      VPO: P('validation', 'check', { code: 'V-PO', role: 'V · PO', name: 'Farid', detail: 'recette, sémantique, saisie' }),
      VAI: P('validation', 'check', { code: 'V-AIB', role: 'V · AI Builder', name: 'Fabien', detail: 'aptitude, sécurité, repli' }),
    },
    edges: {
      'ITE|VPO|périmètre promis': PROPOSED,
      'ITE|VAI|capacité': PROPOSED,
      'ACC|VPO|UAT OK': PROPOSED,
      'ACC|VAI|version testée': PROPOSED,
      'SEM|VPO|résultat métier': PROPOSED,
      'SEM|VAI|mesurabilité': PROPOSED,
      'REL|VPO|même version': PROPOSED,
      'REL|VAI|GO production': PROPOSED,
      'ARC|VPO|D4 · si visible': PROPOSED,
      'SEC|VPO|D4 · si parcours': PROPOSED,
      'WOW|VPO|saisie PO': PROPOSED,
      'BIL|VPO|période, unités': PROPOSED,
    },
  },

  // Scène 3 — §7 : circuit de validation PO puis AI Builder, garde-fous.
  'circuit-validation': {
    nodes: {
      C1: BOX(IMMO, 'declared', 'dormant', { code: 'C1', name: '1 · Préparer' }),
      PREP: P('step', 'cronjob', { code: 'S-1', role: 'Agent · R', name: 'Dossier et empreinte', detail: 'options, preuves, risques' }),
      C2: BOX(IMMO, 'declared', 'dormant', { code: 'C2', name: '2 · Présenter' }),
      BLOC: P('step', 'document', { code: 'S-2', role: 'i-cond · présente', name: 'Bloc « qui décide »', detail: 'domaine, D, V, C, I, délai' }),
      CONS: P('step', 'user', { code: 'S-3', role: 'Consultés · C', name: 'Steve, Mathieu', detail: 'avis tracés, sans veto' }),
      C3: BOX(IMMO, 'declared', 'dormant', { code: 'C3', name: '3 · Décider' }),
      DEC: P('step', 'identity', { code: 'S-4', role: 'Décideur · D', name: 'Une personne nommée', detail: 'tranchée (date, nom)' }),
      C4: BOX(IMMO, 'declared', 'dormant', { code: 'C4', name: '4 · Validation PO' }),
      VPO: P('step', 'check', { code: 'S-5', role: 'V · PO', name: 'Farid · recette, sémantique', detail: 'acceptée ou refusée, motif' }),
      C5: BOX(IMMO, 'declared', 'dormant', { code: 'C5', name: '5 · V AI Builder' }),
      VAI: P('step', 'check', { code: 'S-6', role: 'V · AI Builder', name: 'Fabien · aptitude, sécurité', detail: 'repli · acceptée ou refusée' }),
      C6: BOX(IMMO, 'declared', 'dormant', { code: 'C6', name: '6 · GO et exécution' }),
      GO: P('step', 'release', { code: 'S-7', role: 'Autorisation · GO', name: 'Conditions cumulées', detail: 'D + V PO + V AI Builder' }),
      EXE: P('step', 'cronjob', { code: 'S-8', role: 'Agent · mandat', name: 'Exécution', detail: 'référence le GO · preuve' }),
      CG: BOX(IMMO, 'declared', 'dormant', { code: 'CG', name: 'Garde-fous' }),
      REV: P('guard', 'check', { code: 'G-1', role: 'Garde-fou · révision', name: 'Nouvelle empreinte', detail: 'l’accord ne suit pas' }),
      DEL: P('guard', 'check', { code: 'G-2', role: 'Garde-fou · délai', name: 'Délai expiré', detail: 'jamais une approbation' }),
      URG: P('guard', 'check', { code: 'G-3', role: 'Garde-fou · urgence', name: 'Exception bornée D8', detail: 'revue après intervention' }),
      RLY: P('guard', 'check', { code: 'G-4', role: 'Garde-fou · relais', name: 'Compte qui transmet', detail: 'ne prouve pas le décideur' }),
    },
    edges: {
      'PREP|BLOC|dossier': PROPOSED,
      'BLOC|CONS|sollicite': PROPOSED,
      'CONS|DEC|avis traités': PROPOSED,
      'BLOC|DEC|présente': PROPOSED,
      'DEC|VPO|même empreinte': PROPOSED,
      'VPO|VAI|acceptée': PROPOSED,
      'VAI|GO|acceptée': PROPOSED,
      'GO|EXE|autorise': PROPOSED,
      'REV|DEC|✕ invalide l’accord': PROPOSED,
      'DEL|GO|✕ repli statu quo': PROPOSED,
      'URG|VPO|préautorisée': PROPOSED,
      'RLY|DEC|identité séparée': PROPOSED,
    },
  },

  // Scène 4 — §5.3 : les deux branches de la décision h2a D10.
  'deux-branches-d10': {
    nodes: {
      Q: BOX(H2A, 'unknown', 'unknown', { code: 'Q', name: 'h2a D10 · ouverte' }),
      D10: U('decision', 'network', { code: 'D10', role: 'h2a · DEC', name: 'Humains et rôles', detail: 'invariant ou profil ?' }, H2A),
      BA: BOX(H2A, 'declared', 'dormant', { code: 'BA', name: 'Branche A · invariant' }),
      A1: P('branch', 'document', { code: 'A-1', role: 'h2a · vocabulaire', name: 'VOCABULARY, DEC-016', detail: 'amendés : 2 rôles humains' }, H2A),
      A2: P('branch', 'identity', { code: 'A-2', role: 'h2a · conséquence', name: 'Humain hors PRINCIPAL', detail: 'aucun rôle possible' }, H2A),
      A3: P('branch', 'check', { code: 'A-3', role: 'immo · profil', name: 'Règle redondante', detail: 'portée par h2a' }),
      BB: BOX(H2A, 'declared', 'dormant', { code: 'BB', name: 'Branche B · profil' }),
      B1: P('branch', 'document', { code: 'B-1', role: 'h2a · vocabulaire', name: 'Inchangé', detail: 'CONTROL humain possible' }, H2A),
      B2: P('branch', 'identity', { code: 'B-2', role: 'immo · profil', name: 'Règle écrite dans immo', detail: 'seuls PRINCIPAL, EXECUTIF' }),
      B3: P('branch', 'check', { code: 'B-3', role: 'immo · contrôle', name: 'Contrôle statique', detail: 'vérifie la règle du profil' }),
      EF: BOX(IMMO, 'declared', 'dormant', { code: 'EF', name: 'Effet immo identique' }),
      E1: P('effect', 'user', { code: 'E-1', role: 'immo · PRINCIPAL', name: 'Fabien seul', detail: 'scope repo:radar-immobilier' }),
      E2: P('effect', 'user', { code: 'E-2', role: 'immo · humains', name: 'Farid, Mathieu, Steve', detail: 'décideurs sans rôle h2a' }),
      E3: P('effect', 'check', { code: 'E-3', role: 'immo · validations', name: 'PO et AI Builder', detail: 'nommées, sur critères' }),
      DF: BOX(IMMO, 'declared', 'dormant', { code: 'DF', name: 'Ce qui diffère' }),
      X1: P('diff', 'document', { code: 'X-1', role: 'Diffère · écriture', name: 'Où la règle est écrite', detail: 'h2a (A) ou profil immo (B)' }),
      X2: U('diff', 'network', { code: 'X-2', role: 'Diffère · option', name: 'Steve PRINCIPAL client', detail: 'réservée · après D7 h2a' }),
    },
    edges: {
      'D10|A1|A': OPEN,
      'D10|B1|B': OPEN,
      'A1|A2|': PROPOSED,
      'A2|A3|': PROPOSED,
      'B1|B2|': PROPOSED,
      'B2|B3|': PROPOSED,
      'A3|E1|même affectation': PROPOSED,
      'B3|E1|même affectation': PROPOSED,
      'E1|E2|': PROPOSED,
      'E2|E3|': PROPOSED,
      'A3|X1|h2a': PROPOSED,
      'B3|X1|immo': PROPOSED,
      'E1|X2|deux branches': OPEN,
    },
  },

  // Scène 5 — §9 : immo (quatre humains) et geo (un humain) côte à côte.
  'immo-vs-geo': {
    nodes: {
      P: BOX(IMMO, 'observed', 'retained', { code: 'P', name: 'Une même personne' }),
      FAB: K('person', 'user', { code: 'P-1', role: 'Personne · owner', name: 'Fabien', detail: 'AI Builder immo · PO geo' }),
      IP: BOX(IMMO, 'observed', 'retained', { code: 'IP', name: 'immo · personnes' }),
      IFAB: K('function', 'identity', { code: 'I-1', role: 'immo · PRINCIPAL', name: 'AI Builder, owner', detail: 'PRINCIPAL · non enregistré h2a' }),
      IFAR: K('function', 'identity', { code: 'I-2', role: 'immo · PO', name: 'Farid', detail: 'backlog · Validation PO' }),
      IMAT: U('function', 'identity', { code: 'I-3', role: 'immo · PM', name: 'Mathieu', detail: 'oriente · D à confirmer' }),
      ISTE: K('function', 'identity', { code: 'I-4', role: 'immo · client', name: 'Steve', detail: 'objectifs, budget' }),
      IG: BOX(IMMO, 'declared', 'dormant', { code: 'IG', name: 'immo · GO production' }),
      IDEC: P('act', 'release', { code: 'A-1', role: 'D · AI Builder', name: 'Fabien décide', detail: 'aptitude, sécurité, repli' }),
      IVPO: P('act', 'check', { code: 'A-2', role: 'V · PO', name: 'Farid valide', detail: 'recette de cette version' }),
      IINF: P('act', 'user', { code: 'A-3', role: 'I · informés', name: 'Steve, Mathieu', detail: 'aucun veto' }),
      GT: BOX(GEO, 'observed', 'retained', { code: 'GT', name: 'geo · titulaires' }),
      GFAB: K('function', 'identity', { code: 'G-1', role: 'geo · owner complet', name: 'Fabien', detail: 'owner, PO · mainteneur ?' }, GEO),
      GOP: K('function', 'cronjob', { code: 'G-2', role: 'geo · opérateur', name: 'geo-cond', detail: 'agent sous mandat' }, GEO),
      GTE: K('function', 'identity', { code: 'G-3', role: 'geo · tenant', name: 'i-cond pour immo', detail: 'consulté, pas de veto' }, GEO),
      GK: A(GEO, 'function', 'external', 'unknown', 'unknown', { code: 'G-4', role: 'geo · plateforme', name: 'k8s', detail: 'autorité à nommer' }),
      GG: BOX(GEO, 'declared', 'dormant', { code: 'GG', name: 'geo · mise en prod' }),
      GDEC: P('act', 'release', { code: 'B-1', role: 'D · acte réservé', name: 'Fabien autorise', detail: 'jamais délégué' }, GEO),
      GEXE: P('act', 'cronjob', { code: 'B-2', role: 'R · exécute', name: 'geo-cond', detail: 'ne décide pas le GO' }, GEO),
      GCON: P('act', 'user', { code: 'B-3', role: 'C · consultés', name: 'Tenants affectés', detail: 'inventaire du coût' }, GEO),
      DF: BOX(IMMO, 'declared', 'dormant', { code: 'DF', name: 'Ce qui diffère' }),
      X1: P('diff', 'document', { code: 'X-1', role: 'immo', name: '4 humains', detail: '2 validations, 2 personnes' }),
      X2: P('diff', 'document', { code: 'X-2', role: 'geo', name: '1 humain', detail: 'cumul : 1 seul valideur' }, GEO),
      X3: U('diff', 'document', { code: 'X-3', role: 'Contrat · geo-immo', name: 'Rupture de contrat', detail: '2 questions · D13 h2a' }),
    },
    edges: {
      'FAB|IFAB|repo:radar-immobilier': CADRE,
      'FAB|GFAB|geo': CADRE,
      'IFAB|IDEC|décide': PROPOSED,
      'IFAR|IVPO|valide': PROPOSED,
      'ISTE|IINF|informé': PROPOSED,
      'GFAB|GDEC|autorise': PROPOSED,
      'GOP|GEXE|exécute': PROPOSED,
      'GTE|GCON|consulté': PROPOSED,
      'IDEC|X1|': PROPOSED,
      'GDEC|X2|': PROPOSED,
      'GCON|X3|D13 h2a': OPEN,
    },
  },
};

export const sceneIds = Object.keys(scenes);

// Même contrat que la chaîne d'architecture : aucun nœud ni arête en trop ou
// manquant des deux côtés, états fermés, gabarit unique A' (ou conteneur).
export function metadataFor(graph) {
  const scene = scenes[graph.id];
  if (!scene) throw Error(`missing scene metadata ${graph.id}`);
  const actualNodes = new Set([...graph.groups, ...graph.nodes].map(item => item.id));
  const expectedNodes = new Set(Object.keys(scene.nodes));
  for (const id of actualNodes) if (!expectedNodes.has(id)) throw Error(`${graph.id}: missing node metadata ${id}`);
  for (const id of expectedNodes) if (!actualNodes.has(id)) throw Error(`${graph.id}: extra node metadata ${id}`);
  const groupIds = new Set(graph.groups.map(group => group.id));
  const edges = {};
  for (const edge of graph.edges) {
    const key = `${edge.source}|${edge.target}|${edge.label}`, value = scene.edges[key];
    if (!value) throw Error(`${graph.id}: missing edge metadata ${key}`);
    edges[edge.id] = value;
  }
  if (Object.keys(edges).length !== Object.keys(scene.edges).length) throw Error(`${graph.id}: extra edge metadata`);
  for (const value of [...Object.values(scene.nodes), ...Object.values(edges)]) {
    if (!EVIDENCE.has(value.evidenceClass) || !RUNTIME.has(value.runtimeState)) throw Error(`${graph.id}: invalid closed state`);
  }
  for (const [id, value] of Object.entries(scene.nodes)) {
    const isGroup = groupIds.has(id);
    if (isGroup !== (value.card === 'box')) throw Error(`${graph.id}/${id}: container and template disagree`);
    if (value.card === 'box') {
      if (value.role) throw Error(`${graph.id}/${id}: a container carries no role title`);
      continue;
    }
    if (value.card !== 'A') throw Error(`${graph.id}/${id}: unknown card template ${value.card}`);
    if (!value.code || !value.role || !value.name || !value.detail) throw Error(`${graph.id}/${id}: card needs code, role, name and detail`);
    if (value.name.includes(value.code)) throw Error(`${graph.id}/${id}: code repeated inside the name`);
    if (!roleIsShort(value.role)) throw Error(`${graph.id}/${id}: role title "${value.role}" is not two-by-two short`);
  }
  return { nodes: scene.nodes, edges };
}

export function decorateGraph(graph) {
  const metadata = metadataFor(graph);
  for (const item of [...graph.groups, ...graph.nodes]) item.metadata = metadata.nodes[item.id];
  for (const edge of graph.edges) edge.metadata = metadata.edges[edge.id];
  return graph;
}
