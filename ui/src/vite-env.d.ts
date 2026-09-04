/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the radar API (empty → same-origin via the Vite proxy). */
  readonly VITE_API_BASE_URL?: string;
  /**
   * Base URL of the geo OGC API Features endpoint (CORS `*`), consumed DIRECTLY
   * by browser layers (ex. CPTAQ `/collections/ca-qc-constraints-<slug>/items`).
   * Per-environment; unset → same-origin (degrades to a visible absence state).
   */
  readonly VITE_GEO_OGC_BASE_URL?: string;
  /**
   * Shared secret that unlocks the reconciliation-studio write affordances
   * (accept/reject). Injected per-environment; NEVER hardcode a real secret.
   * Unset → the studio stays read-only.
   */
  readonly VITE_RADAR_ONTOLOGY_WRITE_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
