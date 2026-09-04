/**
 * Appariement texte verbatim d'une citation (« extrait cité ») sur la couche
 * texte d'une page PDF (pdf.js text layer).
 *
 * Contexte : les graphes graphify ne portent presque jamais de `bbox`. La preuve
 * doit néanmoins surligner le passage cité. La citation EXISTE (c'est l'« extrait
 * cité » du panneau de droite, produit au grounding), donc elle est présente
 * verbatim — à la normalisation près — dans la couche texte de la page.
 *
 * Constats MESURÉS sur PV réels (Saint-Amable, 12 échecs sur 15 avec l'ancien
 * algorithme « fenêtre de mots sur texte espacé ») :
 *   a. pdf.js découpe les nombres à tirets en items séparés (« 712-46-2026 » →
 *      « 712 », « - », « 46 »…) et le composant joint les items par une espace →
 *      le texte de page contient « 712 - 46 - 2026 », voire « 05 2 - 03 - 26 »
 *      (item coupé en plein chiffre). Tout numéro de règlement/résolution cassait
 *      la fenêtre de mots.
 *   b. Les citations graphify contiennent des ÉLISIONS — explicites (« […] »,
 *      « [...] ») ou implicites (en-tête de résolution + décision, sans les
 *      CONSIDÉRANT intermédiaires) : la citation est PLUSIEURS passages disjoints
 *      de la page, jamais une seule sous-chaîne contiguë.
 *   c. Le seuil d'acceptation exigeait 40 % de couverture d'une SEULE fenêtre
 *      contiguë : un préfixe véridique de 24 mots (sur 65) était rejeté.
 *
 * Stratégie, sans aucune dépendance pdf.js (logique pure, testable offline) :
 *   1. SQUELETTE : normaliser page et citation en retirant TOUS les espaces et
 *      les tirets (avec table index squelette → index brut pour la page). Le
 *      match devient insensible à la tokenisation pdf.js (espaces artificiels
 *      dans les mots/nombres) et aux césures de fin de ligne.
 *   2. SEGMENTS : chercher la plus longue fenêtre de mots consécutifs de la
 *      citation présente dans le squelette, puis RÉCURSER sur les mots restants
 *      (avant/après) → plusieurs plages surlignables (élisions couvertes).
 *   3. ACCEPTATION : couverture cumulée ≥ minCoverage OU une fenêtre « forte »
 *      (≥ strongWords mots consécutifs, quasi impossible par hasard). Chaque
 *      fenêtre individuelle reste ≥ minWords pour ne pas surligner une amorce
 *      générique (bug #83).
 */

/** Intervalle de caractères dans le texte brut de la page (fin exclusive). */
export interface CitationRange {
  start: number;
  end: number;
}

/** Résultat d'appariement : plages brutes surlignables + couverture. */
export interface CitationMatch {
  /** Début de la PREMIÈRE plage (ordre de page) — rétrocompat mono-plage. */
  start: number;
  /** Fin (exclusive) de la première plage — rétrocompat mono-plage. */
  end: number;
  /** Fraction de la citation (en mots) couverte par les plages, dans [0, 1]. */
  coverage: number;
  /** TOUTES les plages surlignables, triées par position dans la page. */
  ranges: CitationRange[];
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
    .replace(/­/gu, "-") // tiret conditionnel (césure) → -
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Marqueurs d'ÉLISION insérés par graphify dans les citations (« […] »,
 * « [...] », « (...) », « ... » isolé) : retirés avant le découpage en mots —
 * ils n'existent jamais dans la page et scinderaient artificiellement les
 * fenêtres tout en dégradant la couverture.
 */
const ELLIPSIS_MARKERS = /\[[\s.…]*\]|\([\s.…]*\)|(?:^|(?<=\s))(?:\.{3,}|…)(?=\s|$)/gu;

/**
 * Construit le SQUELETTE d'un texte : caractères normalisés SANS espaces ni
 * tirets, plus la table de correspondance index squelette → index brut. Retirer
 * les espaces rend le match insensible aux items pdf.js joints par des espaces
 * (« qu e la » ≡ « que la ») ; retirer les tirets absorbe à la fois les nombres
 * éclatés (« 712 - 46 - 2026 » ≡ « 712-46-2026 ») et les césures de fin de
 * ligne (« modifica- tion » ≡ « modification »).
 */
function buildSkeletonIndex(raw: string): { skeleton: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (/\s/u.test(ch)) continue; // espaces : jamais dans le squelette
    const norm = normalizeForMatch(ch);
    if (norm.length === 0) continue; // diacritique combinant seul, etc.
    // une ligature peut produire plusieurs caractères (ex. œ→oe) : tous pointent sur i
    for (const c of norm) {
      if (c === "-" || c === " ") continue; // tirets/espaces issus de la normalisation
      chars.push(c);
      map.push(i);
    }
  }
  return { skeleton: chars.join(""), map };
}

/**
 * Localise une occurrence exacte pour la recherche plein-texte du viewer.
 * Le résultat partage le contrat de plages de `findCitationInPage`, mais accepte
 * les requêtes courtes et permet de viser la nième occurrence d'une même page.
 */
export function findTextOccurrenceInPage(
  pageText: string,
  query: string,
  occurrence = 0,
): CitationMatch | null {
  const { skeleton, map } = buildSkeletonIndex(pageText);
  const needle = buildSkeletonIndex(query).skeleton;
  if (!needle || occurrence < 0) return null;

  let position = -1;
  let from = 0;
  for (let index = 0; index <= occurrence; index++) {
    position = skeleton.indexOf(needle, from);
    if (position < 0) return null;
    from = position + needle.length;
  }
  const range = {
    start: map[position]!,
    end: map[position + needle.length - 1]! + 1,
  };
  return { ...range, coverage: 1, ranges: [range] };
}

/** Squelette d'une suite de mots normalisés (mêmes règles que la page). */
function wordsSkeleton(words: readonly string[], from: number, to: number): string {
  return words.slice(from, to).join("").replace(/-/gu, "");
}

/** Fenêtre de mots consécutifs [at, at+len) trouvée à `skelIdx` du squelette. */
interface MatchedWindow {
  at: number;
  len: number;
  skelIdx: number;
  skelLen: number;
}

/**
 * Cherche la citation `excerpt` dans le texte brut `pageText` et retourne les
 * plages brutes surlignables, ou `null` si rien d'exploitable.
 *
 * - Découpe la citation en mots (marqueurs d'élision retirés).
 * - Trouve la plus longue fenêtre de mots consécutifs dont le squelette est
 *   présent dans le squelette de la page, puis récurse sur les restes → chaque
 *   segment réellement présent (autour d'une élision, d'une troncature ou d'un
 *   bruit OCR) produit sa propre plage.
 * - Accepte si la couverture cumulée atteint `minCoverage` OU si une fenêtre
 *   d'au moins `strongWords` mots consécutifs existe (préfixe long véridique
 *   d'une citation longue). Toute fenêtre reste ≥ `minWords` (anti bug #83 :
 *   une amorce générique de 4-5 mots ne déclenche jamais de surlignage).
 */
export function findCitationInPage(
  pageText: string,
  excerpt: string,
  options: { minWords?: number; minCoverage?: number; strongWords?: number } = {},
): CitationMatch | null {
  const minWords = options.minWords ?? 6;
  const minCoverage = options.minCoverage ?? 0.4;
  const strongWords = options.strongWords ?? 10;
  // Borne de coût : une fenêtre n'a pas besoin de dépasser 60 mots pour être
  // unique ; la récursion couvre le reste d'une citation plus longue.
  const MAX_WINDOW = 60;

  const cleanExcerpt = normalizeForMatch(excerpt).replace(ELLIPSIS_MARKERS, " ");
  const words = cleanExcerpt.split(" ").filter(Boolean);
  if (words.length === 0) return null;

  const { skeleton, map } = buildSkeletonIndex(pageText);
  if (skeleton.length === 0) return null;

  // Plus longue fenêtre présente commençant au mot i : binaire sur la longueur
  // (un préfixe d'une sous-chaîne présente est présent → monotone).
  const longestAt = (i: number, maxLen: number): { len: number; skelIdx: number } => {
    if (skeleton.indexOf(wordsSkeleton(words, i, i + minWords)) < 0) {
      return { len: 0, skelIdx: -1 };
    }
    let lo = minWords;
    let hi = maxLen;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (skeleton.indexOf(wordsSkeleton(words, i, i + mid)) >= 0) lo = mid;
      else hi = mid - 1;
    }
    return { len: lo, skelIdx: skeleton.indexOf(wordsSkeleton(words, i, i + lo)) };
  };

  // Segmentation récursive gloutonne : meilleure fenêtre, puis restes.
  const windows: MatchedWindow[] = [];
  const search = (from: number, to: number): void => {
    if (to - from < minWords) return;
    let best: MatchedWindow | null = null;
    for (let i = from; i + minWords <= to; i++) {
      const { len, skelIdx } = longestAt(i, Math.min(to - i, MAX_WINDOW));
      if (len >= minWords && (best === null || len > best.len)) {
        best = { at: i, len, skelIdx, skelLen: wordsSkeleton(words, i, i + len).length };
      }
    }
    if (!best) return;
    windows.push(best);
    search(from, best.at);
    search(best.at + best.len, to);
  };
  search(0, words.length);
  if (windows.length === 0) return null;

  const matchedWords = windows.reduce((acc, w) => acc + w.len, 0);
  const longestWindow = windows.reduce((acc, w) => Math.max(acc, w.len), 0);
  const coverage = Math.min(1, matchedWords / words.length);
  // ACCEPTATION : couverture suffisante OU fenêtre forte. Un match faible ET
  // court (ex. 6 mots génériques d'une citation de 30) reste rejeté (bug #83).
  if (coverage < minCoverage && longestWindow < strongWords) return null;

  // GARDE DE JETON DISCRIMINANT (anti-boilerplate) : deux résolutions d'un même
  // corpus partagent de longues formules identiques (« modifiant le règlement
  // de zonage … afin de modifier les limites de la zone », « avis de motion et
  // adoption du premier projet »…) — MESURÉ : la citation d'un AUTRE règlement
  // atteint 74 % de couverture par simple accumulation de boilerplate. Ce qui
  // distingue le bon passage, ce sont les IDENTIFIANTS (nos de règlement, de
  // résolution, de lot, codes de zone : mots porteurs de chiffres). Si la
  // citation en contient, on exige qu'au moins la MOITIÉ soit couverte par les
  // fenêtres matchées (mesuré : 83-100 % pour les 15 vrais matchs Saint-Amable,
  // 20 % pour le parasite — seul le no du règlement de base, partagé, matchait).
  const identifierIdx = words.reduce<number[]>((acc, w, i) => {
    if (/\d/u.test(w)) acc.push(i);
    return acc;
  }, []);
  if (identifierIdx.length > 0) {
    const covered = identifierIdx.filter((i) =>
      windows.some((w) => i >= w.at && i < w.at + w.len),
    ).length;
    if (covered / identifierIdx.length < 0.5) return null;
  }

  const ranges: CitationRange[] = [];
  for (const w of windows) {
    if (w.skelIdx < 0 || w.skelLen === 0 || w.skelIdx + w.skelLen > map.length) continue;
    ranges.push({ start: map[w.skelIdx]!, end: map[w.skelIdx + w.skelLen - 1]! + 1 });
  }
  if (ranges.length === 0) return null;
  ranges.sort((a, b) => a.start - b.start);

  return { start: ranges[0]!.start, end: ranges[0]!.end, coverage, ranges };
}

/** Intervalle [start, end) d'un item de la couche texte pdf.js dans le texte de page. */
export interface ItemSpan {
  start: number;
  end: number;
}

/**
 * Indices des items de la couche texte chevauchant AU MOINS une plage du match
 * (déduplicés, ordre croissant). C'est la géométrie du surlignage : le viewer
 * dessine une marque par item retourné. Extrait ici (logique pure) pour être
 * testable avec une couche texte simulée, sans pdf.js ni DOM.
 */
export function itemsOverlappingRanges(
  items: readonly ItemSpan[],
  ranges: readonly CitationRange[],
): number[] {
  const out: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    for (const range of ranges) {
      if (item.end > range.start && item.start < range.end) {
        out.push(i);
        break;
      }
    }
  }
  return out;
}
