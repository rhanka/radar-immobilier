export type ChallengeAgentStatus = "complete" | "partial";

export interface ChallengeAgentResult {
  id: string;
  name: string;
  modelNote: string;
  status: ChallengeAgentStatus;
  focus: string;
  strongestChallenge: string;
  findings: string[];
  recommendedActions: string[];
  clientExpected: string[];
  evidence: {
    label: string;
    detail: string;
  }[];
}

export const challengeAgentResults: ChallengeAgentResult[] = [
  {
    id: "codex-patterns",
    name: "Codex challenge",
    modelNote: "gpt-5.5 xhigh, read-only",
    status: "complete",
    focus:
      "Exploit VISION/PROMPT/PROCESS to challenge source combinations and historical weak-signal patterns.",
    strongestChallenge:
      "The proposal should show signal chains, not isolated sources: notice -> regulation -> PPCMOI/minutes -> lot/constraint/outcome.",
    findings: [
      "Test concrete chains across avis publics, regulations, PPCMOI and council minutes before claiming a validated historical pattern.",
      "Do not let context sources like StatCan, INFC or catalog discovery look like primary triggers.",
      "Separate pattern-to-verify evidence from validated evidence so the UI does not overclaim.",
      "Model false-positive traps explicitly: minor derogations, missing lifecycle stage, coarse geography, stale macro data.",
    ],
    recommendedActions: [
      "Add a later data field for source role: trigger, resolver, parcel anchor, constraint, outcome or context.",
      "Add source pairings and historical pattern tests before the final pricing pack.",
      "Reframe the review around 5-7 high-value chains for the client proposal.",
    ],
    clientExpected: [
      "Validate whether the first proposal should prioritize weak municipal detection or deeper parcel due diligence.",
      "Accept that the first screen may show hypotheses to verify, clearly separated from observed facts.",
    ],
    evidence: [
      {
        label: "PROMPT chain",
        detail:
          "PROMPT.md asks to go from zoning source to zones, lots, potential, qualification and report.",
      },
      {
        label: "BR05 spike set",
        detail:
          "34 spike notes provide source families that can be linked into temporal chains.",
      },
    ],
  },
  {
    id: "claude-business-costs",
    name: "Claude business review",
    modelNote: "Opus xhigh, read-only",
    status: "complete",
    focus:
      "Skeptical business/cost review of the source model for a low-cost client proposal.",
    strongestChallenge:
      "The current model can read as a paid-data integration project; the pitch should lead with the free public spine.",
    findings: [
      "The public Phase 1 spine is enough to prove the thesis: avis publics, regulations, PPCMOI, geocoding, MAMH roles and one constraint layer.",
      "Paid/partner sources rated as high as avis publics can inflate scope and budget expectations.",
      "Fait must mean feasibility studied, not a production connector already delivered.",
      "Engineering effort in man-days should reappear because delivery cost is the dominant Phase 1 cost.",
    ],
    recommendedActions: [
      "Demote JLR, Centris, Cadastre, Registre and transaction feeds into optional client-funded enrichment.",
      "Use quadrant axes: radar weak-signal value and delivery complexity/cost.",
      "Add a consolidated panel for client decisions with a default low-cost path.",
    ],
    clientExpected: [
      "Confirm that Phase 1 can start with public free sources by default.",
      "Decide whether any paid enrichment is in budget now or deferred after first evidence.",
    ],
    evidence: [
      {
        label: "Free public spine",
        detail:
          "BR05 feasibility estimates show several core sources are public/free and low-to-medium effort.",
      },
      {
        label: "Cost categories",
        detail:
          "Paid/provider sources require quote, partner agreement, manual fee or client access decision.",
      },
    ],
  },
  {
    id: "agy-gemini-access-video",
    name: "Agy / Gemini access review",
    modelNote: "Agy CLI produced a partial report; CLI exit code 2",
    status: "partial",
    focus:
      "Legal/access modalities, Obscura etiquette, video ingestion and paid-source caveats.",
    strongestChallenge:
      "Obscura is useful for public rendering and evidence capture, not for bypassing protected paid sources.",
    findings: [
      "Cadastre/Infolot, Centris and JLR need official/licensed paths; scraping should be treated as disallowed by default.",
      "MAMH role data is useful but caviarded; owner-level workflows need municipal export or paid/legal access.",
      "Council minutes may deserve more Phase 1 weight because notices signal intent while minutes confirm adoption.",
      "YouTube can be cheap if a legal RSS/caption/audio workflow is validated, but channel details and rights must be verified.",
    ],
    recommendedActions: [
      "Add legal warning callouts for high legal-complexity sources.",
      "Keep YouTube as qualify-now with explicit cost/latency experiment rather than full adapter commitment.",
      "Use Obscura only for public pages, polite rate limits and evidence snapshots.",
    ],
    clientExpected: [
      "Provide or authorize any paid/provider access before it appears in a delivery commitment.",
      "Confirm the value of faster video signal versus waiting for minutes/PVs.",
    ],
    evidence: [
      {
        label: "Agy artifact",
        detail:
          "/home/antoinefa/.gemini/antigravity-cli/brain/9baf12f6-97f9-4c1c-aa5a-8f90fed3a62b/source_value_review.md",
      },
      {
        label: "Security rule",
        detail:
          "Project rules already constrain Obscura to reliability on public pages, not deception or paywall bypass.",
      },
    ],
  },
  {
    id: "internal-peer-55",
    name: "Peer review 5.5",
    modelNote: "gpt-5.5 xhigh, read-only",
    status: "complete",
    focus:
      "Challenge the proposal value from PROMPT.md: decision chains, concrete artifacts and missing client decisions.",
    strongestChallenge:
      "The client-facing proof should be a chain from municipal signal to lots and false-positive controls, not a flat catalog of 34 sources.",
    findings: [
      "Fast demo credibility comes from public sources that connect avis publics, regulations, PPCMOI, geocoding, MAMH role data and CPTAQ constraints.",
      "PPCMOI should be visibly treated as a premium signal because it exposes negotiated exceptions and precedents.",
      "Plans and zoning grids should be manually extracted for one or two strong cases even if full automation waits.",
      "Orthophoto/WMS previews can support lot-underuse evidence without launching heavy computer vision.",
    ],
    recommendedActions: [
      "Add a challenge-chain slide: PPCMOI -> address -> lot; hidden regulation number; rejected minor derogation; CPTAQ long-term expansion; YouTube vs PV.",
      "Add a cost/decision matrix: free automatic, free targeted manual, paid manual, partner feed, excluded.",
      "Show a per-dossier false-positive checklist before any strong opportunity score.",
    ],
    clientExpected: [
      "Choose whether the first proposal emphasizes municipal weak-signal detection or deeper parcel due diligence.",
      "Confirm the budget/permission path for any partner or paid data before it is committed.",
    ],
    evidence: [
      {
        label: "PROMPT.md",
        detail:
          "The client prompt asks for source, zoning, lots, potential, qualification and report outputs.",
      },
      {
        label: "PROCESS.md",
        detail:
          "Scores must be tied to evidence and separate facts from hypotheses before reporting.",
      },
    ],
  },
];
