# Garde-fou budget hard-cap GCP — §5 3D Tiles → DÉPLACÉ (canonical dans rhanka/geo)

**Ce runbook a été déplacé.** Le garde-fou §5 (Photorealistic 3D Tiles) protège le moteur geo → source unique côté geo, accessible au geo-executor et rejouable sur un checkout propre.

**Canonical** : `rhanka/geo` → `docs/ops/GCP_BUDGET_GUARDRAIL_3DTILES.md` (+ `docs/ops/cap-billing/` = source Cloud Function).
_(branche `geo-socle/gcp-guardrail-runbook` en attendant le merge.)_

Contenu là-bas : runbook **gcloud** (hard-cap billing-disable + quota + clé restreinte), ordre non-négociable garde-fous→test-kill→clé, `${BILLING_ACCOUNT}` paramétré (jamais committé — repos publics), clé créée-pas-committée à l'exec.

**Résumé (pour découvrabilité infra-ops)** : un « budget cap » GCP = alerte, PAS un hard-cap. Le hard-cap réel = une **Cloud Function billing-disable** (budget 100% → Pub/Sub → détache le billing du projet) + **quota** Map Tiles + **clé restreinte** Map-Tiles-only+referrer, sur un **projet dédié**. Exécution = owner-direct (billing) + geo-driver (gcloud) + i-infra co-val (scope-projet-only).
