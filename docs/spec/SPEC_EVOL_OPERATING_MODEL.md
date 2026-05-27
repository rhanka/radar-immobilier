# SPEC_EVOL — Modèle opérationnel (dev + support) — HYPOTHÈSE BUSINESS (hors V1)

> **Status**: EVOL — **hypothèse business cible**, **hors périmètre V1**. La VISION/PROCESS
> décrivent un radar **mono-opérateur** (utilisateur V1 = toi, en démo) ; la topologie
> multi-tenant + support multi-tiers ci-dessous est **à valider**, pas à construire en V1.
> Référencé par `SPEC_EVOL_PROCESS_E2E.md` §11. Repose sur `@sentropic/h2a` (cible) —
> **spike d'abord**. Right-sizé suite aux relectures agy + Opus xhigh.

## 0. Avertissement de périmètre
Ce document est la **cible d'exploitation** (développement accompagné + support à coût
maîtrisé), **pas la V1**. Les rôles/tiers/économie sont une **hypothèse stratégique**.

## 1. Deux gouvernances distinctes (ne pas confondre)
- **Dev-time (fabrication)** : toi (PRINCIPAL) **mandates** tes agents dev/ops sous une
  `POLICY` (périmètre, anti-triche, lot-gates, make-only). Le feedback du responsable
  produit = **entrées de spec**.
- **Run-time (produit)** : gouvernance des **décisions produit** (go/no-go opportunités),
  bornée par une `POLICY` de disclaimer.
- ⚠️ **Séparer** : un feedback support qui modifierait à chaud la `POLICY` des agents de
  dev = régressions en cascade (deadlock). Support ≠ cycle de release.

## 2. Rôles (h2a, corrigés) — cible
- **PRINCIPAL = des humains** : toi (expert/plateforme), responsable produit (son tenant).
  **Jamais l'IA.**
- **CONDUCTOR / AGENTS** = l'IA orchestrée (`flow`).
- Relation plateforme ↔ client = **`CONTRACT` / autorité `delegated`** (SaaS B2B) —
  **pas `federation`** (qui suppose des pairs souverains).

## 3. Support multi-tiers — cible (hypothèse)
- **Tier 0** : client final ↔ **copilote** produit — rapports/mémos **préparés, validés
  par un humain avant toute sortie externe** (pas d'agent autonome rendant un avis
  réglementaire → responsabilité civile/professionnelle).
- **Tier 1** : responsable produit + ses agents. **Tier 2** : agents de dev en soutien.
  **Tier 3** : toi (expert) en recours.
- **Litige client ↔ plateforme** → **nœud d'escalade externe** (médiation / OACIQ /
  tribunaux), **jamais Sentropic juge-et-partie**.

## 4. Économie — honnête (correction des relectures)
La thèse « coût marginal plat » **ne tient pas telle quelle** : les axes décisifs sont
**structurellement non-disponibles sans étape humaine/payante** — propriétaire caviardé
(LFM art. 72), marché Tier C, registre foncier 1,50 $/doc, interprétation réglementaire
(PROCESS §5 : « garder une étape humaine pour les décisions lourdes »). L'escalade
humaine/experte est donc sur le **chemin critique de presque chaque opportunité
qualifiée**, pas un cas rare. → modéliser le **coût récurrent par dossier qualifié** ; le
plafond « surveillance » (§4.4) limite l'exposition tant que la preuve manque.

## 5. Responsabilité & conformité (Québec)
- **`POLICY` de disclaimer** : **décision-support, pas conseil** ; bornage **courtage
  (OACIQ)** pour `approcher-propriétaire`/montage d'acquisition, **arpenteur-géomètre**
  (servitudes/contraintes), **notaire** (registre foncier).
- **Loi 25** : renseignements personnels (propriétaire) **hors-chaîne** ; finalité/base
  légale/rétention + droits d'accès, rectification, **effacement** (⟂ journal immuable).

## 6. Surface h2a (cible, par paliers)
V1 = `POLICY` + label de rôle + journal simple (cf. `SPEC_EVOL_PROCESS_E2E.md` §11).
Ensuite : `ENGAGEMENT` signés pour les go/no-go, `MANDATE` pour déléguer, journal
**Postgres `jsonb`** (PII hors-chaîne). Crypto `ed25519` **uniquement** avec des
porteurs de clés distincts (due diligence, attestation pro agréé). Modes multi-humains
+ profils ABC = encore au-delà.

## 7. À valider (décisions stratégiques)
- Le modèle **multi-tenant / multi-tiers** est-il le vrai business (vs mono-opérateur de
  la VISION) ? — décision à prendre **avant** d'investir.
- Spike `@sentropic/h2a` (compat runtime, surface) ; coût réel des escalades ; périmètre
  **OACIQ / Loi 25** (avis juridique requis).
