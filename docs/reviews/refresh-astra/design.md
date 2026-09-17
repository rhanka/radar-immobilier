# Committed refresh model policy

Owner decision: 2026-09-17 04:40Z; Refs #703 and #697.

- D1: Astra low via Codex is primary; Gemini 3.8 Flash low via Cloud Code
  is the only application fallback. Exact model routing prevents silent mesh
  substitutions. Keep mesh-refresh pinned at 0.19.2 for Codex cap omission.
- D2: Intercept transport failures and blank text before quality validation.
  Mark validator failures explicitly. One mesh route attempt prevents its
  internal quality retries. File and state persistence failures stop the run.
- D3: Each model attempt gets a separate timeout signal. Parent cancellation
  stops the policy. Kubernetes bounds the entire Job at 2100 seconds.
- D4: Select fallback once per document and retain it for remaining chunks.
  Count consecutive quota documents once each; reset only after a fully
  successful primary document. Open the cycle circuit at three.
- D5: Reserve two attempts per chunk before calling either model. Persist
  safe attempt receipts even on transport/quality failure. Preserve all models
  for mixed documents; include both models and forced mode in run identity.
- D6: Both transports share runtime principal/owner scope, with separately
  enrolled accounts in the writable keyring. No new Secret key is required.

Independent design lenses: transport and state/resume. Findings accepted:
document/chunk distinction, timeout isolation, fallback budget, forced identity,
quality retry suppression and success reset only at document completion.
Final local state review of `5f26f219` identified no blocking finding; external
public-diff review artifacts record their own outcomes separately.
