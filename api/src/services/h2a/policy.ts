/**
 * EV10: the radar POLICY, expressed as real `@sentropic/h2a` POLICY artifacts.
 *
 * Each decision journaled in the coordination chain references these policy ids
 * (`policyIds` on the h2a journal payload), so the signed chain carries the
 * governance boundary the decision was taken under. The wording mirrors the
 * ÉV5 `radarPolicy` rules, now first-class h2a `POLICY` artifacts under the
 * radar scope.
 */

import type { H2APolicy } from "@sentropic/h2a";

/** The scope every radar coordination artifact lives under. */
export const RADAR_SCOPE = "scope:radar";

/** The radar POLICY artifacts (decision-support, anti-cheat, OACIQ, Loi 25). */
export const RADAR_POLICIES: readonly H2APolicy[] = [
  {
    kind: "POLICY",
    id: "policy:radar:decision-support",
    scope: RADAR_SCOPE,
    rule: "Aide a la decision, pas un conseil : toute sortie reste indicative.",
    sourceAuthority: "principal@radar",
    adoptionMode: "ratified",
    version: "1",
  },
  {
    kind: "POLICY",
    id: "policy:radar:anti-cheat",
    scope: RADAR_SCOPE,
    rule: "Anti-triche : aucune donnee fabriquee ; un axe non-disponible n'est jamais traite comme favorable.",
    sourceAuthority: "principal@radar",
    adoptionMode: "ratified",
    version: "1",
  },
  {
    kind: "POLICY",
    id: "policy:radar:courtage-oaciq",
    scope: RADAR_SCOPE,
    rule: "Courtage (OACIQ) : approcher un proprietaire ou monter une acquisition releve d'un courtier agree.",
    sourceAuthority: "principal@radar",
    adoptionMode: "ratified",
    version: "1",
  },
  {
    kind: "POLICY",
    id: "policy:radar:loi-25",
    scope: RADAR_SCOPE,
    rule: "Loi 25 : renseignements personnels (proprietaire) masques par defaut, acces journalise.",
    sourceAuthority: "principal@radar",
    adoptionMode: "ratified",
    version: "1",
  },
  {
    kind: "POLICY",
    id: "policy:radar:principal-is-human",
    scope: RADAR_SCOPE,
    rule: "Le PRINCIPAL est un humain ; l'IA n'est jamais PRINCIPAL.",
    sourceAuthority: "principal@radar",
    adoptionMode: "ratified",
    version: "1",
  },
];

/** All radar policy ids, referenced by every journaled decision. */
export const RADAR_POLICY_IDS: readonly string[] = RADAR_POLICIES.map((p) => p.id);
