# SPEC_EVOL — Modèle opérationnel (dev + support) sur `@sentropic/h2a`

> **Status**: EVOL — référencé par `SPEC_EVOL_PROCESS_E2E.md` §11.
> **But**: comment Sentropic **développe** ET **exploite** le radar avec une
> coordination humain↔agent **signée et auditable** (`@sentropic/h2a` v0.3.1), à
> **coût marginal** pour le client.

## 1. Principe
**Agents d'abord, humain sur escalade.** Tout acte/décision = **artefact h2a signé +
journalisé** (ed25519, journal append-only chaîné) → traçabilité, responsabilité,
audit. Le client paie surtout des agents ; l'humain est un **recours**, pas le débit.

## 2. Rôles & autorité (h2a)
- **Sentropic (toi)** : PRINCIPAL de la plateforme + CONDUCTOR des agents dev/ops ;
  **recours en dernier ressort** (`public-authority`/`consortium`).
- **Responsable produit (client)** : PRINCIPAL de son tenant + CONDUCTOR de ses agents
  de support produit.
- **Client final** : utilisateur du produit, interagit avec les agents produit.
- **Matrice d'autorité** : qui peut signer/décider quoi (`MANDATE`/`AUTHORITY`).

## 3. Dev-time — développement produit accompagné
- Le **chat de dev = canal h2a** : le feedback du responsable produit devient
  `ENGAGEMENT`/`AMENDMENT` **signés** → corrections de spec **journalisées**.
- **Toi = responsable plateforme** : tu émets des `MANDATE` aux agents dev/ops sous une
  `POLICY` (périmètre, **règle anti-triche**, lot-gates, make-only).
- Boucle : intention/feedback (client) → spec signée → exécution agents (mandatés) →
  revue/gates → **journal auditable**.

## 4. Run-time — support multi-tiers (routes d'`ENFORCEMENT_PLAN`)
- **Tier 0** : client final ↔ agents produit (assistant radar, sous `MANDATE`/`POLICY`).
- **Tier 1** : responsable produit (PRINCIPAL) + ses agents → support de 1ᵉʳ niveau
  dans le produit.
- **Tier 2** : agents de dev (CONDUCTOR plateforme) en soutien (escalade `federation`).
- **Tier 3** : toi (PRINCIPAL / recours) + tes agents → garant de pérennité.
- Chaque **escalade/handoff = enveloppe signée + journalisée**.

## 5. Coût marginal & pérennité
- Les agents absorbent le volume sous mandat ; l'humain n'est sollicité que sur
  **escalade** (deadlock, décision lourde, recours, obligation récurrente).
- Le **journal signé** = preuve de service + base d'amélioration continue.
- **Profil ABC** : contrat SaaS (**A enterprise**) sur un contexte de données publiques
  (**C government-citizen**), avec dimension **B ecosystem** (pros immo, fournisseurs).

## 6. Lien avec le produit
Les rôles/escalade se matérialisent dans l'outil (cf. `SPEC_EVOL_PROCESS_E2E.md` §11) :
droits par rôle, panneau h2a (enveloppes/escalade), **provenance signée** (§6).

## 7. À confirmer / périmètre V1
- Mapping exact des modes multi-humains + instanciation des profils ABC (SPEC
  `../a2a-cli`).
- Intégration `@sentropic/h2a` (v0.3.1) : surface minimale utile en V1 (probable :
  rôles + `MANDATE`/`POLICY` + journal signé), le reste différé.
- Quels tiers d'abord (probable : Tier 0 produit + Tier 1 responsable produit).
