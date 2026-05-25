// 4-track PROMPT benchmark results (Salaberry-de-Valleyfield).
// Source of truth: docs/spec/SPEC_EVOL_DEMO_FINDINGS.md §10 + scoring reports.
// Independent neutral scoring, frozen VISION-aligned metrics, isolated runs,
// no cheating (see rules/MASTER.md "Fair Benchmarking").

export interface MetricDef {
  id: string;
  label: string;
  hint: string;
}

export type Fabrication = "none" | "multiple";

export interface TrackScore {
  id: string;
  name: string;
  operator: "human" | "agent";
  mode: string;
  scores: number[]; // aligned with benchmarkMetrics order (M1..M7)
  total: number;
  rank: number;
  fabrication: Fabrication;
  note: string;
}

export const benchmarkMetrics: MetricDef[] = [
  { id: "M1", label: "Couverture des signaux", hint: "Signaux de densification réels détectés vs référentiel vérifié." },
  { id: "M2", label: "Précision réglementaire", hint: "Règlements/zones cités avec numéro + date + nature vérifiables." },
  { id: "M3", label: "Traçabilité des sources", hint: "Part des affirmations avec lien source exact." },
  { id: "M4", label: "Honnêteté factuelle", hint: "Faits vs hypothèses ; « non disponible » plutôt qu'inventer ; pénalise la fabrication." },
  { id: "M5", label: "Spécificité actionnable", hint: "Granularité secteur→zone→rue→lot ; opportunités localisées." },
  { id: "M6", label: "Contrôle des faux positifs", hint: "Écarte le bruit (dérogations mineures, non-résidentiel)." },
  { id: "M7", label: "Priorisation VISION", hint: "Cohérence avec les pondérations : zonage > CPTAQ > PPCMOI > dérogations." },
];

export const benchmarkTracks: TrackScore[] = [
  {
    id: "A2",
    name: "Claude Opus 4.7",
    operator: "agent",
    mode: "mode max · isolé · web-only",
    scores: [5, 5, 5, 5, 4, 5, 5],
    total: 34,
    rank: 1,
    fabrication: "none",
    note: "Couverture la plus large + meilleure traçabilité, complétude (Phases 4-6), contrôle des faux positifs et priorisation VISION. Aucune fabrication.",
  },
  {
    id: "C2",
    name: "Codex GPT-5.5 xhigh",
    operator: "agent",
    mode: "xhigh · isolé (PTY)",
    scores: [3, 5, 5, 5, 5, 4, 4],
    total: 31,
    rank: 2,
    fabrication: "none",
    note: "Plus étroit (manque PPCMOI/CPTAQ/Plan 450) mais seul à atteindre des données de lot vérifiées via l'open-data (contourne le rôle bloqué). Reproductible, aucune fabrication.",
  },
  {
    id: "H1",
    name: "Humain · ChatGPT GPT-5.5",
    operator: "human",
    mode: "manuel",
    scores: [5, 5, 4, 5, 3, 4, 4],
    total: 30,
    rank: 3,
    fabrication: "none",
    note: "Lecture réglementaire exhaustive et précise, honnête. Perd surtout sur la complétude (transcript arrêté en Phase 3). Aucune fabrication.",
  },
  {
    id: "G2",
    name: "Gemini 3.5 Flash",
    operator: "agent",
    mode: "high · isolé",
    scores: [2, 2, 2, 1, 4, 2, 2],
    total: 14,
    rank: 4,
    fabrication: "multiple",
    note: "Manque les amendements de zonage (cœur de la mission) et présente comme vérifiés un PPCMOI, des numéros de lots, une résolution et un prix introuvables. Disqualifié pour la démo.",
  },
];

export const benchmarkVerdict =
  "Deux agents automatisés (Opus 34, Codex 31) battent la base humaine (30), sans fabrication. Sur le cœur réglementaire (M2/M4), Opus, Codex et l'humain sont à égalité. Ce n'est pas un « l'IA bat l'humain » général : Gemini a fabriqué et finit dernier, et l'humain a perdu en partie car son rapport était tronqué.";

export const benchmarkMethod = [
  "Même prompt initial pour tous (docs/spec/input/PROMPT.md), une seule variable : le mode d'exécution.",
  "Runs isolés (un dossier par agent, aucun accès aux sorties des autres).",
  "Métriques gelées avant scoring, appliquées à l'identique — humain compris.",
  "Scoring par un agent indépendant, sources vérifiées, fabrications pénalisées.",
  "Règle absolue : ne pas tricher vs l'humain (rules/MASTER.md).",
];
