# Independent Architecture Review: Immo, Geo, and Kubernetes Storage/Pipeline Topology

**Review Target:** Immo, Geo, and Kubernetes Architecture Document (Snapshot: 2026-09-13, 11:38 UTC, commit baseline `2ab8da2b`).  
**Review Type:** Adversarial Text-Only Third-Party Technical Audit.  
**Auditor Mode:** Independent Third-Party Reviewer (requested via `h2a run agy`).

---

## 1. Verdict

### **NEEDS CHANGES**

While the prose in §§1–5 and the Resource Register (§3) display rigorous intellectual honesty regarding unverified overrides and transitional duct tape, **Diagrams 1, 2, and 3 fail to provide an unambiguous, self-contained visual mapping of the physical DB/S3 resources and reader/writer contracts.** 

A human relying primarily on the diagrams cannot reliably trace physical bucket/prefix identities, encounters severed execution pipelines, faces contradictory tenant/environment subgraph boundaries, and cannot deduce the exact storage paths for critical runtime flows (notably the live PDF repoint and the grounding-to-projection disconnect).

---

## 2. Numbered Findings

### Finding 1: Severed Stage 3 (Grounding) to Stage 4 (Projection) Pipeline
* **Severity:** **CRITICAL**
* **Exact Location:** Diagram 2 (`[PP-PUBLISH]`, `[PP-GROUND]`, `[PP-PROJECT]`, `[PP-GRAPH]`), §2, §3.
* **Reasoning:** In Diagram 2, `PP_PUBLISH` (Job 41) is shown writing `graph/` to `PP_GROUND` (`radar-immobilier-docs-preprod` on in-cluster MinIO). However, `PP_PROJECT` (Stage 4) reads `graph/` exclusively from `PP_GRAPH` (`radar-immobilier-graph-preprod` on OVH S3). 
  - `PP_GROUND` is a visual and architectural dead-end with no downstream consumer.
  - `PP_GRAPH` has no automated cluster-side writer for `graph/`; the only incoming edge is an unverified, dashed workstation line from `WS_IMMO`.
  - A human operator reading Diagram 2 would assume the preproduction grounding pipeline feeds the projection pipeline. In reality, the preprod pipeline is completely fractured across two distinct physical storage providers (MinIO vs. OVH S3) with no bridge.
* **Minimal Remedy:** Annotate `PP_GROUND` in Diagram 2 with an explicit dead-end warning (`[PP-GROUND] MinIO · ⚠️ DECOUPLED FROM PROJECTION`). Draw an explicit visual break or red-flag callout between `PP_GROUND` and `PP_GRAPH` confirming that automated grounding output does not reach preprod projection without manual intervention or unverified job overrides.

---

### Finding 2: Omission of Physical Object Prefix for Repointed PV PDF Reads
* **Severity:** **HIGH**
* **Exact Location:** Diagrams 1, 2, and 3 (`PP_API --> GEO_S3`), §1, §2, §4.
* **Reasoning:** In all three diagrams, `PP_API` points to `GEO_S3` (`sentropic-geo`) with labels such as `"READ PV PDFs · LIVE repoint shared corpus"` or `"READ mapped PV PDFs · no Immo fallback"`. 
  - Diagram 3 explicitly partitions `GEO_S3` into `raw / manifests` and `normalized/` for Geo runners.
  - None of the three diagrams identifies which prefix `PP_API` reads inside `GEO_S3`. 
  - An engineer configuring IAM policies, bucket lifecycles, or debugging `/api/documents/raw` 404s cannot determine whether Immo queries `raw/`, `documents/`, `pv/`, or the bucket root.
* **Minimal Remedy:** Update the edge labels across Diagrams 1, 2, and 3 to include the exact target prefix: e.g., `PP_API -->|"READ mapped PV PDFs (prefix: raw/...)"| GEO_S3`.

---

### Finding 3: Misplaced Snapshot-Restore Boundary and Orphaned Flow in Diagram 1
* **Severity:** **HIGH**
* **Exact Location:** Diagram 1 (`restore`, `PP_BACKUP`), §1, §3.
* **Reasoning:** 
  - The node `restore["Snapshot-restore Job<br/>Completed; separate from refresh"]` is drawn in the external region outside both the `cloud` and `preprod` subgraphs, grouped alongside external cloud object storage.
  - In reality, the restore job was a Kubernetes Job running inside the `radar-immobilier-preprod` namespace.
  - Furthermore, `restore` shows an incoming read edge from `PP_BACKUP`, but zero outgoing write edges. A restore job that reads a backup and restores nothing is an incomplete and misleading data flow.
* **Minimal Remedy:** Move `restore` inside `subgraph preprod` in Diagram 1, and add the missing write edge: `restore -->|"Restore data"| PP_DB`.

---

### Finding 4: Contradictory Scoping and Environment Ownership of `LEGACY-POC`
* **Severity:** **HIGH**
* **Exact Location:** Diagram 2 (`LEGACY_POC`, `subgraph immo`), Diagram 1, §1, §3.
* **Reasoning:** 
  - In Diagram 2, `LEGACY_POC` (`radar-immobilier-docs-pocs` on Scaleway S3) is nested inside `subgraph immo["IMMO · preprod PV chain"]`.
  - However, §1 and §3 explicitly establish that `LEGACY-POC` is a shared reference bucket, not an environment-isolated preprod store: production `PR_REFRESH` declares a read dependency on it, and the production GitHub Actions grounding workflow publishes directly to it.
  - Nesting `LEGACY_POC` inside a preprod Immo subgraph creates a false boundary, directly contradicting Diagram 1 (where it is placed outside the cluster) and masking cross-environment pollution.
* **Minimal Remedy:** In Diagram 2, extract `LEGACY_POC` outside `subgraph immo` and place it alongside `GEO_S3` and `PP_GEO_S3` as an external shared/reference resource.

---

### Finding 5: Flat Topology and Obscured Cross-Environment Reads in Diagram 3
* **Severity:** **MEDIUM**
* **Exact Location:** Diagram 3 (`PP_API`, `PR_API`, `GEO_API`, `PP_GEO`, `PP_GEO_S3`, `GEO_S3`), §4.
* **Reasoning:** 
  - Diagram 3 completely omits environment/tenant subgraphs. Production consumers (`PR_API`), preproduction consumers (`PP_API`), production serving (`GEO_API`), preproduction serving (`PP_GEO`), and shared storage (`GEO_S3`) all float in an uncontained diagram space.
  - Because there are no boundary boxes for `preprod` and `prod`, the cross-environment dependency where `PP_API` (preprod) directly bypasses preprod and reads from `GEO_S3` (prod/shared) looks identical to a standard local read.
* **Minimal Remedy:** Introduce visual environment grouping in Diagram 3 (`subgraph prod["Production"]` enclosing `PR_API`, `GEO_API`, and `GEO_S3`; `subgraph preprod["Preproduction"]` enclosing `PP_API`, `PP_GEO`, and `PP_GEO_S3`), making the cross-environment line visually evident.

---

### Finding 6: Omission of `GEO-DB` (`geo/postgis`) from Geo Processing View
* **Severity:** **MEDIUM**
* **Exact Location:** Diagram 3, §3 (`GEO-DB`), §4.
* **Reasoning:** 
  - Diagram 1 models `[GEO-DB] geo/postgis` as a live PostgreSQL/PostGIS StatefulSet in the `geo` namespace.
  - Diagram 3 shows intensive spatial joins (`join["Spatial join: parcel ∩ zoning polygons"]`) and semantic joins (`fold`), but omits `GEO-DB` entirely.
  - While §3 notes that no `GEO-API -> GEO-DB` dependency was demonstrated for OGC serving, a human reviewer cannot discern whether the spatial join workers execute in-memory/file-based calculations (e.g., via Parquet/DuckDB/Turf) or if they connect to `geo/postgis`.
* **Minimal Remedy:** Either add `GEO_DB` to Diagram 3 with an explicit label (`[GEO-DB] geo/postgis · Unused / No batch join dependency verified`) or annotate the `join` node: `Spatial join (In-process Parquet / No PostGIS dependency)`.

---

### Finding 7: Inverted and Conflated Edge Semantics on `PR_REFRESH`
* **Severity:** **MEDIUM**
* **Exact Location:** Diagram 1 (`PR_REFRESH --> LEGACY_POC`), §1, §3.
* **Reasoning:** 
  - In Diagram 1, the edge is drawn as: `PR_REFRESH -.->|"Declared graph READ; scrape target secret-backed"| LEGACY_POC`.
  - The arrow points from the worker `PR_REFRESH` to the storage `LEGACY_POC`. Everywhere else in Diagram 1, an arrow from worker to storage denotes a WRITE, while an arrow with label READ denotes a consumer reading from storage.
  - Labeling a single unidirectional arrow with both `"Declared graph READ"` and `"scrape target secret-backed"` conflates input and output, leaving it completely ambiguous whether `PR_REFRESH` writes scraped data to `LEGACY_POC` or if `LEGACY_POC` is only a read target.
* **Minimal Remedy:** Separate this into two distinct edges:
  1. `PR_REFRESH -.->|"Declared graph READ"| LEGACY_POC` (pointing according to the diagram's read convention).
  2. A dedicated dashed stub: `PR_REFRESH -.->|"Scrape target (Secret-backed S3, unverified)"| UNVERIFIED_S3[("Unverified S3 Bucket")]`.

---

### Finding 8: Orphaned Storage Node `PP-DOCS` with Zero Ingestion Writers
* **Severity:** **MEDIUM**
* **Exact Location:** Diagrams 1 and 2 (`PP_DOCS`), §1, §2, §3.
* **Reasoning:** 
  - Diagrams 1 and 2 depict `PP_API -->|"Legacy document READ"| PP_DOCS`.
  - There are no incoming edges to `PP_DOCS` anywhere in the diagrams. 
  - While §3 explains that `PP-DOCS` is derived from the code fallback `SCRAPE_S3_BUCKET ?? 'radar-immobilier-docs'`, a reader cannot tell whether `PP-DOCS` contains historical static objects, is populated by an unlisted pipeline, or is a completely empty fallback.
* **Minimal Remedy:** Annotate `PP_DOCS` directly on the diagrams as `[PP-DOCS] radar-immobilier-docs<br/>MinIO · Legacy static / No active writer`.

---

### Finding 9: Conflation of Intra-Process Execution with Inter-Process Pipes
* **Severity:** **LOW**
* **Exact Location:** Diagram 2 (`PP_SCRAPE --> parse`), §2.
* **Reasoning:** 
  - Diagram 2 shows an arrow `PP_SCRAPE -->|"Same worker"| parse`.
  - Node labels state that `parse` runs "Inside PP-SCRAPE".
  - In a dataflow diagram, drawing an edge between a container and an internal subroutine mimics an IPC pipe, network hop, or queued message, confusing the physical execution boundaries.
* **Minimal Remedy:** Merge `PP_SCRAPE` and `parse` into a single container node or enclose them within a sub-box representing the `radar-refresh-scrape` Pod boundary.

---

### Finding 10: Mermaid Layout Tangling and Edge Collision Hazards
* **Severity:** **LOW**
* **Exact Location:** Diagrams 1 and 2 (Mermaid `flowchart TB` definitions).
* **Reasoning:** 
  - Diagram 1 features 13 cross-subgraph edges connecting deeply nested Kubernetes workloads (`preprod`, `prod`) to external S3 buckets (`PP_GRAPH`, `GEO_S3`, `PP_GEO_S3`, `LEGACY_POC`, `PP_BACKUP`) and workstation nodes.
  - In standard Mermaid renderers, routing cross-subgraph edges in a top-to-bottom layout (`TB`) causes severe layout instability, line overlapping, crossed text labels, and unpredictable vertical stretching.
* **Minimal Remedy:** Enclose external storage resources in a unified `subgraph external["External Storage & Providers (OVH / Scaleway)"]` positioned laterally, or adopt `flowchart LR` with subgraphs aligned to cleanly delineate cluster compute from external cloud storage.

---
