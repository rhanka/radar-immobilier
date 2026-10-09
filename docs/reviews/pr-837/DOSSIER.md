# Review dossier — PR #837 (expose the preprod immo MCP like prod, GH #835)

review-author:
  host: claude
  model: claude-opus-5-5
target-ref: fix/mcp-preprod-expose@54fe14a3 (diff origin/main...54fe14a3, base 641f48c3)

status: completed
rounds: 6
legs (final round 6, target 54fe14a3):
  - path: docs/reviews/pr-837/leg-astra.md
    model: gpt-6-astra, effort xhigh, lens kustomize render / prod invariance / deploy path
    status: completed
    verdict: GO
  - path: docs/reviews/pr-837/leg-sol.md
    model: gpt-6.1-sol, effort xhigh, lens guard scripts / OAuth semantics
    status: completed
    verdict: GO
consensus-verdict: GO

history:
  round 1 (ddce2b4f): astra GO-with-nits (ASTRA-837-01 same-sha re-run does not restart the MCP; ASTRA-837-02 lookup error treated as absence); sol GO-with-nits (SOL-837-01 Ingress test mutations not isolated; SOL-837-02 IdP handoff incomplete). Fixed in 3b2446c6, d653ffad and the PR description.
  round 2 (220c5c37): both GO-with-nits on the same gap (a failed restart after a successful apply is not retried). Fixed in 9d647f57 (pod-template annotation = ConfigMap resourceVersion, retry-safe).
  round 3 (bc89161a): both GO-with-nits on the same gap (fake kubectl too permissive). Fixed in 0bf90556 (strict stateful fake).
  round 4 (2c6655e5 tree = 0bf90556 code): both GO-with-nits (apply arguments/content and read failures not pinned). Fixed in a6732b7b.
  round 5 (a6732b7b): astra GO; sol GO-with-nits (applied-document assertion missed RADAR_API_BASE_URL). Fixed in 54fe14a3 (byte comparison with the render).
  round 6 (54fe14a3): astra GO, sol GO, no finding.

unverified (stated by both legs): live rollout and pod health, no-op server-side apply resourceVersion behaviour on the live API server, operator Ingress installation, IdP client and account state, authenticated end-to-end acceptance.

observed-deviation: legs launched with codex exec directly (seat, no API key), one leg at a time in the foreground; runs longer than 10 min continued in the background of the tool. Logs kept outside the repo.
