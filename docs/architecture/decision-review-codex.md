# Independent Codex review — D1

Requested through h2a, native Codex `gpt-6-astra`, high effort; session
`01a09ad4-3951-7d73-86e2-8d01ab18c1dd`. Text-only review of dossier D1 and the
continuation audit, before the renderer was tested. Verbatim response follows.

Verdict: **Suitable for presentation as INCOMPLETE; insufficient for an execution decision.** The packet clearly distinguishes proposals, reported results and unresolved evidence. Its preference for A is provisional, not yet supported by enough comparative evidence to select a delivery sequence. This review assesses only the inline packet; linked sources and runtime claims were not independently verified.

1. **High — Retirement scope and production gate ordering are ambiguous.**

   Exact passage (§6): “**G5** MinIO removal only after no clients remain → **G6** separate production inventory/backup/promotion.”

   If G5 concerns only a verified preprod-exclusive instance, this ordering may be sound. If any resource or client is shared with production, the required inventory comes too late. The packet does not establish which case applies.

   Specify each gate’s environment and resource scope. Require inventory and acceptance from every affected consumer before deleting a resource; retain a separate production promotion gate. This finding identifies an ambiguity, not an assertion that production uses PP-MINIO.

2. **High — Credential continuity is recognized but lacks an explicit acceptance gate.**

   Exact passage (continuation evidence): “durable credential refresh and its unique writer remain design/operations questions.”

   G1 can succeed using ephemeral credentials without establishing that autonomous operation survives refresh, restart or workload replacement. Neither option A nor B resolves this merely by choosing an orchestration model.

   Before durable autonomous operation, require an agreed credential owner, persistence contract, exclusive refresh-writer mechanism, and refresh/restart/recovery acceptance evidence. A bounded ephemeral test remains a reasonable earlier step; it cannot qualify ongoing operation.

3. **High — Rollback depends on an undefined consistency boundary.**

   Exact passage (§6): “restore the captured graph/DB checkpoint and reconcile objects before routing clients back.”

   The packet does not define how graph state, SQL projection and referenced evidence objects form a consistent recovery point, or how writes after that point are handled. Object parity alone cannot establish application consistency.

   Describe the proposed checkpoint boundary, writer fencing, treatment of intervening writes, and recovery acceptance conditions. A coordinated write pause may simplify this; versioned objects and replayable checkpoints may reduce downtime but add complexity. The owner’s recovery envelope should determine the choice.

4. **Medium — The retirement gates do not cover the entire fixed dependency-removal objective.**

   Exact passage (§1): “eradicate MinIO and SCW storage/image dependencies, **retain SCW TEM until a replacement is validated**.”

   The explicit removal gate addresses MinIO. SCW storage and image dependencies lack corresponding inventory, replacement and retirement criteria. The stated exclusion of old SCW resources also limits what this packet can establish.

   Either bound this dossier to an initial retirement tranche and identify the remaining decision surface, or add explicit coverage for those dependencies. Preserve TEM’s existing exclusion without reopening the owner’s decision.

5. **Medium — A’s comparative advantage remains unestablished.**

   Exact passages (§4–5): “Medium integration + migration; unpriced”; “Highest initial engineering scope; unpriced”; “B can be cheaper overall if the DAG integration is already close to ready.”

   These judgments are honestly labeled, but relative effort and readiness are precisely what could overturn A. The reported candidate dry run supports extraction progress; it does not establish reusable publication, recovery or orchestration readiness.

   Compare remaining work against the same acceptance boundary: fresh served Signals, resolvable evidence, exclusive writers, durable credentials and recovery. A is stronger if those contracts already exist and can be reused. B is stronger if establishing them constitutes most of A’s work anyway. C is stronger if verified storage urgency dominates refresh delivery.

6. **Medium — Presentation and eventual decision need distinct, explicit asks.**

   Exact passages (§1 and §8): “Decide the **delivery sequence**”; “This **incomplete presentation does not request approval**.”

   The disclaimer prevents execution authorization, but the opening can still suggest that selecting A/B/C is expected now. Clarify that this presentation requests review of the framing and missing criteria; sequence selection remains pending evidence and an explicit owner decision. Neither viewing the page nor expressing a provisional preference should satisfy that later gate.

Beyond downtime, RPO/RTO and retention, missing owner criteria include:

- Relative priority and deadlines for autonomous refresh versus dependency retirement.
- Acceptable duration and operational burden of workstation dependence.
- Budget or effort ceiling, including tolerance for temporary orchestration rework.
- Required freshness, coverage and evidence availability for initial acceptance.
- Who accepts the affected Immo, Graphify, Geo and poc-k8s contracts.

**Safe to present as INCOMPLETE: yes**, with these findings visible and unresolved. It provides a useful decision frame without inventing production details. It does not authorize implementation, migration, package integration, infrastructure startup or deployment.
