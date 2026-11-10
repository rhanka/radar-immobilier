import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPTS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const ROOT = path.dirname(SCRIPTS); // docs/reviews/oracle-c-draft
// Intermediate files (raw workbook rows, prod node dumps) stay out of git.
export const WORK = path.join(ROOT, 'work');

export const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const VERDICTS = ['Pertinent', 'À surveiller', 'Non pertinent'];
export const VSHORT = { Pertinent: 'P', 'À surveiller': 'S', 'Non pertinent': 'N' };

/** Motif family = the criterion/exclusion that the code expresses (derived from the code dictionary). */
export const MOTIF_FAMILY = {
  'P-VILLE-TERRITOIRE': 'P-meets', 'P-NOUV-ZONE': 'P-meets', 'P-PERIM-URB': 'P-meets', 'P-DENSITE': 'P-meets',
  'P-USAGE-MULTI': 'P-meets', 'P-TYPO-INTERM': 'P-meets', 'P-PROJ-INTEGRE': 'P-meets', 'P-NORMES': 'P-meets',
  'S-MANDAT-AMONT': 'S-early', 'S-PLANIFIE': 'S-early', 'S-PORTEE-FLOUE': 'S-unreadable', 'S-INFO-MANQUANTE': 'S-unreadable',
  'S-CONTRAINTE': 'S-constrained', 'S-RESTRICTIF': 'S-constrained', 'S-PPCMOI-SERIE': 'S-constrained', 'S-PREEMPTION': 'S-constrained',
  'N-FAUX-POSITIF': 'N-not-res-or-urb', 'N-NON-RES': 'N-not-res-or-urb', 'N-ADMIN': 'N-no-capacity',
  'N-ACCESSOIRE': 'N-no-capacity', 'N-FORME': 'N-no-capacity', 'N-UNIFAM': 'N-no-capacity',
  'N-RESTRICTIF': 'N-restrictive', 'N-ODJ-SEUL': 'N-agenda-only', 'N-RETIRE': 'N-agenda-only',
  'N-DOUBLON': 'N-other', 'N-HORS-TERR': 'N-other', 'V2-PRECEDENT': 'N-individual',
};

export const passShort = (p) => (p.startsWith('1') ? 'pass1' : p.startsWith('2') ? 'pass2' : p.startsWith('3') ? 'pass3' : 'off-radar');
