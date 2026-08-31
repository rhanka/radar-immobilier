import { describe, expect, it } from "vitest";

import { deriveEtape as deriveEtapeGraphStore } from "./graph-store.js";
import { deriveEtape as deriveEtapeBPrime } from "@radar/domain";

/**
 * W2 §3-SYNC test. Two `deriveEtape` implementations feed firmness — graph-store
 * (node `etape` → `regulatoryStatus` → drawer) and b-prime (the B′ signal view).
 * They MUST agree: a drift would re-introduce avis-served-as-firm (the 026-508
 * bug) via the node. This asserts BOTH produce the expected etape AND agree with
 * each other on every case, and locks the §3-conservative reorder — a pure avis
 * whose text names a FUTURE adoption stays `avis_motion`, never promoted to firm.
 *
 * (The durable fix is a single shared helper, tracked as a §3-hardening
 * follow-up; until then this test is the drift guard.)
 */
const CASES: Array<{
  name: string;
  label: string;
  description: string;
  etape: string;
}> = [
  {
    // THE 026-508 fail-safe: a pure ACTIVE avis whose text says "présenté pour
    // adoption lors d'une séance subséquente" must NOT become adoption (firm).
    name: "pure avis de motion + FUTURE adoption reference → avis_motion (§3 fail-safe)",
    label: "Avis de motion — Règlement 2026-509",
    description:
      "Donne avis de motion qu'il sera présenté pour adoption, lors d'une séance subséquente, le Règlement numéro 2026-509 modifiant le Règlement de zonage.",
    etape: "avis_motion",
  },
  {
    // §3 RESIDUAL (i-cond review): an active avis referencing the EXISTING
    // règlement it modifies as "en vigueur" must NOT match entree_vigueur (firm) —
    // the guard precedes consultation/entree_vigueur.
    name: "active avis referencing an EXISTING règlement « en vigueur » → avis_motion (§3 residual)",
    label: "Avis de motion — Règlement 0651-01",
    description:
      "Donne avis de motion qu'il sera présenté pour adoption le Règlement 0651-01 modifiant le Règlement de zonage 0651 actuellement en vigueur.",
    etape: "avis_motion",
  },
  {
    // Combined "avis de motion ET dépôt du projet" (508) IS at the projet stage.
    name: "combined avis + dépôt du projet → projet_reglement",
    label: "Avis de motion et dépôt du projet — Règlement 2026-508",
    description:
      "Avis de motion et dépôt du projet de Règlement numéro 2026-508 modifiant le Règlement de nuisances. Dépose le projet du Règlement numéro 2026-508.",
    etape: "projet_reglement",
  },
  {
    // "Adoption du Projet de Règlement" resolution (509) — past-tense recital.
    name: "adoption du projet resolution (past-tense recital) → projet_reglement",
    label: "Adoption du Projet de Règlement 2026-509",
    description:
      "Adoption du Projet de Règlement numéro 2026-509. Attendu qu'un avis de motion a été donné lors de la séance ordinaire; que le Projet de Règlement 2026-509 est adopté.",
    etape: "projet_reglement",
  },
  {
    // "Adoption du Premier projet" (510) → projet stage via "premier projet".
    name: "adoption du premier projet → projet_reglement",
    label: "Adoption du Premier projet de Règlement 2026-510",
    description:
      "Attendu qu'un avis de motion a été donné; adoption du premier projet de Règlement 2026-510 modifiant le zonage.",
    etape: "projet_reglement",
  },
  {
    // Final adoption recalling a PAST avis → adoption (the recital is non-triggering).
    name: "final adoption recalling a past avis → adoption",
    label: "Adoption du Règlement 2026-500",
    description:
      "Attendu qu'un avis de motion a été donné; il est résolu d'adopter le Règlement numéro 2026-500.",
    etape: "adoption",
  },
  // ── Regression: existing behaviour preserved ──────────────────────────────
  {
    name: "second projet",
    label: "Adoption du second projet de Règlement 2026-511",
    description: "",
    etape: "second_projet",
  },
  {
    name: "consultation publique",
    label: "Consultation publique du Règlement",
    description: "",
    etape: "consultation",
  },
  {
    name: "entrée en vigueur",
    label: "Entrée en vigueur du Règlement 2026-500",
    description: "",
    etape: "entree_vigueur",
  },
  {
    name: "no lifecycle keyword → inconnu",
    label: "Point d'information divers",
    description: "aucun stade réglementaire",
    etape: "inconnu",
  },
];

describe("deriveEtape — W2 §3 conservative reorder + cross-impl SYNC", () => {
  for (const c of CASES) {
    it(`${c.name}`, () => {
      const gs = deriveEtapeGraphStore(c.label, c.description);
      const bp = deriveEtapeBPrime(c.label, c.description);
      expect(gs).toBe(c.etape);
      expect(bp).toBe(c.etape);
      // The two impls MUST agree — a divergence is a latent §3 firmness drift.
      expect(gs).toBe(bp);
    });
  }
});
