## 3. Explicit Shared-Resource Mapping Summary

The following matrix resolves all physical identities, hosting boundaries, tenant ownership, prefix paths, and actual vs. target roles across the three views:

| Shared ID | Physical Provider & Host | Logical Tenant & Env | Internal Bucket / Path Identity | Active Readers (Audited) | Active Writers (Audited) | Actual State vs. Target Architecture |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`PP-DB`** | OVH K8s `poc-ca` / PVC | Immo Preprod | PostgreSQL 16 + PostGIS (`radar-postgres`) | `PP-API` (SQL) | `PP-SCRAPE` (interim direct feed), `PP-PROJECT` (`upsertGraphAtomic`), `restore` | **Actual:** Dual-writer interim state. **Target (E5):** `upsertGraphAtomic` as sole PG writer. |
| **`PR-DB`** | OVH K8s `poc-ca` / PVC | Immo Prod | PostgreSQL 16 + PostGIS (`radar-postgres`) | `PR-API` (SQL) | `PR-REFRESH` (declared write) | Production live state unverified; declared symmetry. |
| **`GEO-DB`** | OVH K8s `poc-ca` / PVC | Geo Prod | PostgreSQL 16 + PostGIS 3.4 (`geo/postgis`) | *None demonstrated* | *None demonstrated* | **Actual:** Running StatefulSet, but no API or batch join dependency verified. **Target:** File-based Parquet serving. |
| **`PP-MINIO`** | OVH K8s `poc-ca` / PVC | Immo Preprod | `http://radar-minio:9000` (PVC-backed service) | Hosts `PP-RAW`, `PP-DOCS`, `PP-GROUND` | Internal cluster workloads | **Actual:** Legacy/interim in-cluster object store. **Target:** Complete migration to OVH S3. |
| **`PP-RAW`** | OVH K8s / `PP-MINIO` | Immo Preprod | Bucket: `radar-immobilier-raw` | `PP-API` (default store / state) | `PP-API` (state/metadata writes) | Active default store for `radar-api`. |
| **`PP-DOCS`** | OVH K8s / `PP-MINIO` | Immo Preprod | Bucket: `radar-immobilier-docs` | `PP-API` (fallback scrape reader) | *None* (Orphaned / No writer) | Code-derived fallback (`SCRAPE_S3_BUCKET ?? 'radar-immobilier-docs'`). |
| **`PP-GROUND`**| OVH K8s / `PP-MINIO` | Immo Preprod | Bucket: `radar-immobilier-docs-preprod`<br/>Prefix: `graph/` | *None* (Dead-end) | `PP-PUBLISH` (Job 41, declared) | **Severed Pipeline:** Grounding writes here; projection reads `PP-GRAPH`. |
| **`PR-MINIO`** | OVH K8s `poc-ca` / PVC | Immo Prod | `radar-minio` in namespace `radar-immobilier` | `PR-API` (declared base S3) | Unverified | Production overrides not audited live. |
| **`PP-GRAPH`**| OVHcloud S3 (BHS) | Immo Preprod | Bucket: `radar-immobilier-graph-preprod`<br/>Prefixes: `raw/`, `parsed/`, `ontology/`, `runs/`, `graph/` | `PP-PROJECT` (reads `graph/`), `WS_IMMO` (reads corpus) | `PP-SCRAPE` (writes `raw/`, `runs/`), `parse` (writes `parsed/`, `ontology/`), `WS_IMMO` (writes `graph/`) | **Single physical bucket** fulfilling both corpus and canonical graph roles. |
| **`LEGACY-POC`**| Scaleway S3 | Shared Reference / Historical | Bucket: `radar-immobilier-docs-pocs`<br/>Prefixes: `candidats/`, `graph/` | `PP-PUBLISH` (reads `candidats/`), `PR_REFRESH` (declared graph read) | `WS_IMMO` (declared staging write `candidats/`), GH Actions Prod Grounding | **Cross-Environment:** Shared between preprod Job 41 and prod GH Actions. |
| **`PP-GEO-S3`**| OVHcloud S3 (BHS) | Geo Preprod | Bucket: `sentropic-geo-preprod`<br/>Prefix: `normalized/` | `PP-GEO` (`geo-api` preprod OGC) | `sync` (controlled preprod sync job) | Serving copy for preproduction Geo OGC features. |
| **`GEO-S3`** | OVHcloud S3 (BHS) | Geo Prod / Shared | Bucket: `sentropic-geo`<br/>Prefixes: `raw/`, `manifests/`, `normalized/`, *unspecified PV prefix* | `GEO-API` (reads `normalized/`), `sync` (reads `normalized/`), `normalize`, **`PP-API` (reads mapped PV PDFs directly)** | Geo `capture` (writes `raw/`), `normalize`, `fold`, `constraints` (write `normalized/`) | **Shared Cross-Environment Read:** `PP-API` (preprod) reads PV documents directly from production `GEO-S3` without fallback. |
| **`PP-BACKUP`**| OVHcloud S3 (BHS) | Platform Preprod | Bucket: `radar-preprod-snapshot` | `restore` (snapshot restore Job) | Backup operators | Operational restore source, distinct from refresh/corpus. |
| **`PP/PR-SSO-DB`**| OVH K8s `poc-ca` | Sentropic Platform | PostgreSQL in `sentropic[-preprod]` | `pidp` / `idp` (auth-idp) | Auth IDP service | Platform identity stores. Not Immo graph databases. |

---

## 4. Limitations of this Review

1. **Static Manifest & Textual Scope:** This audit is strictly an evaluation of the architecture document, commit references (`2ab8da2b`, `09703678`, `f68d8ddf`, `03acdfd`, `6296396f`, `73172214`), and the verified configuration excerpts provided.
2. **No Dynamic Execution or Cluster Querying:** No live `kubectl` API queries, SSH sessions, database connections, DNS resolutions, or browser rendering tests were executed by the auditor during this pass.
3. **No Secret or Object-Level Inspection:** In accordance with non-sensitive inspection boundaries, Kubernetes Secret values (e.g., `POSTGRES_PASSWORD`, S3 access keys) and exact S3 object inventories/keys were not inspected. The presence of a binding in a manifest or code path does not guarantee runtime execution success, network reachability, or data freshness.
