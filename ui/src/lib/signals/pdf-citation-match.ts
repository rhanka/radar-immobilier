/**
 * Appariement texte verbatim d'une citation (« extrait cité ») sur la couche
 * texte d'une page PDF (pdf.js text layer).
 *
 * Contexte : les graphes graphify ne portent presque jamais de `bbox`. La preuve
 * doit néanmoins surligner le passage cité. La citation EXISTE (c'est l'« extrait
 * cité » du panneau de droite, produit par pdftotext au grounding), donc elle est
 * présente verbatim — à la normalisation près (espaces, accents, ligatures,
 * césures de fin de ligne) — dans la couche texte de la page.
 *
 * Stratégie, sans aucune dépendance pdf.js (logique pure, testable offline) :
 *   1. Normaliser citation et texte de page de la même façon, en conservant pour
 *      le texte de page une table de correspondance index normalisé → index brut.
 *   2. Chercher la citation normalisée comme sous-chaîne ; si absente, retomber
 *      sur la plus longue fenêtre de mots consécutifs de la citation qui matche
 *      (robustesse aux coupures OCR/pdftotext et aux têtes/queues bruitées).
 *   3. Restituer l'intervalle [start, end] dans le texte BRUT de la page, que le
 *      composant convertit en spans surlignés.
 */

/** Intervalle de caractères dans le texte brut de la page (fin exclusive). */
export interface CitationMatch {
  /** Index de début dans le texte brut concaténé de la page. */
  start: number;
  /** Index de fin (exclusif) dans le texte brut concaténé de la page. */
  end: number;
  /** Fraction de la citation (en mots) effectivement retrouvée, dans [0, 1]. */
  coverage: number;
}

/**
 * Normalise un texte pour l'appariement : minuscules, accents retirés,
 * ligatures décomposées, espaces (et césures) réduits à une espace simple.
 * La ponctuation est conservée mais les espaces autour sont normalisés.
 */
export function normalizeForMatch(input: string): string {
  return input
    .normalize("NFKD") // décompose accents + ligatures (œ→oe via remplacement ci-dessous)
    .replace(/œ/gu, "oe")
    .replace(/Œ/gu, "OE")
    .replace(/æ/gu, "ae")
    .replace(/Æ/gu, "AE")
    .replace(/[̀-ͯ]/gu, "") // diacritiques combinants
    .replace(/[‘’‚‛′]/gu, "'") // apostrophes typographiques
    .replace(/[“”„‟″]/gu, '"') // guillemets
    .replace(/[‐-―]/gu, "-") // tirets unicode → -
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Construit le texte normalisé d'une page + la table de correspondance des index
 * normalisés vers les index bruts (pour retrouver l'intervalle d'origine).
 */
function buildNormalizedIndex(raw: string): { normalized: string; map: number[] } {
  const normalizedChars: string[] = [];
  const map: number[] = [];
  let prevWasSpace = true; // évite l'espace de tête
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    // Les espaces (et tout blanc) sont détectés sur le caractère BRUT :
    // `normalizeForMatch` applique un `.trim()` qui réduirait un blanc isolé à "".
    if (/\s/u.test(ch)) {
      if (prevWasSpace) continue;
      normalizedChars.push(" ");
      map.push(i);
      prevWasSpace = true;
      continue;
    }
    const norm = normalizeForMatch(ch);
    if (norm.length === 0) {
      // caractère qui disparaît à la normalisation (diacritique combinant seul,
      // césure…) : on l'absorbe dans le caractère précédent.
      continue;
    }
    // une ligature peut produire plusieurs caractères (ex. œ→oe) : tous pointent sur i
    for (const c of norm) {
      normalizedChars.push(c);
      map.push(i);
    }
    prevWasSpace = false;
  }
  // retire l'espace de queue éventuel
  while (normalizedChars.length > 0 && normalizedChars[normalizedChars.length - 1] === " ") {
    normalizedChars.pop();
    map.pop();
  }
  return { normalized: normalizedChars.join(""), map };
}

/**
 * Cherche la citation `excerpt` dans le texte brut `pageText` et retourne
 * l'intervalle brut surlignable, ou `null` si rien d'exploitable.
 *
 * - Match exact (normalisé) d'abord.
 * - Sinon, plus longue séquence de mots consécutifs de la citation présente dans
 *   la page : on érode la citation par les bords (queue puis tête) jusqu'à
 *   trouver une fenêtre d'au moins `minWords` mots. Couvre les cas où pdftotext a
 *   coupé/bruité le début ou la fin de la citation.
 */
export function findCitationInPage(
  pageText: string,
  excerpt: string,
  options: { minWords?: number; minCoverage?: number } = {},
): CitationMatch | null {
  const minWords = options.minWords ?? 4;
  const minCoverage = options.minCoverage ?? 0.4;

  const cleanExcerpt = normalizeForMatch(excerpt);
  if (cleanExcerpt.length === 0) return null;
  const totalWords = cleanExcerpt.split(" ").filter(Boolean);
  if (totalWords.length === 0) return null;

  const { normalized, map } = buildNormalizedIndex(pageText);
  if (normalized.length === 0) return null;

  const toRawRange = (normStart: number, normEnd: number): CitationMatch | null => {
    if (normStart < 0 || normEnd <= normStart || normEnd > map.length) return null;
    const rawStart = map[normStart]!;
    const rawEnd = (map[normEnd - 1] ?? rawStart) + 1;
    return { start: rawStart, end: rawEnd, coverage: 0 };
  };

  // 1) Match exact normalisé.
  const exactIdx = normalized.indexOf(cleanExcerpt);
  if (exactIdx >= 0) {
    const range = toRawRange(exactIdx, exactIdx + cleanExcerpt.length);
    if (range) return { ...range, coverage: 1 };
  }

  // 2) Plus longue fenêtre de mots consécutifs présente dans la page.
  //    On essaie des sous-séquences [i, j) de la citation, de la plus longue à la
  //    plus courte, par fenêtre glissante décroissante. Borne le coût en limitant
  //    la longueur de citation considérée.
  const maxWindow = Math.min(totalWords.length, 60);
  for (let windowLen = maxWindow; windowLen >= minWords; windowLen--) {
    for (let i = 0; i + windowLen <= totalWords.length; i++) {
      const candidate = totalWords.slice(i, i + windowLen).join(" ");
      const idx = normalized.indexOf(candidate);
      if (idx >= 0) {
        const range = toRawRange(idx, idx + candidate.length);
        if (range) {
          const coverage = windowLen / totalWords.length;
          if (coverage >= minCoverage || windowLen >= minWords) {
            return { ...range, coverage };
          }
        }
      }
    }
  }

  return null;
}
