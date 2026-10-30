# 6H — `search_signals` qualification and controlled preprod activation

Scope: the `search_signals` MCP tool only, served by the scoped facade
`GET /api/v1/mcp/facets/signals/search` (`api/src/routes/mcp-signal-search.ts`).
The five `not_wired_yet` stubs (`search_lots`, `get_lot_card`,
`get_opportunity_dossier`, `list_documents`, `read_document_excerpt`) and the
six raw tools (`get_zones_geojson`, `get_lots_geojson`, `get_grille_pdf`,
`get_pv_pdf`, `get_reglement_provenance`, `query_zoning_events`) keep their
current behaviour: they never called a retired route.

This document adds no operator step. The preprod activation is exactly
`RUNBOOK-PREPROD-MCP-RACCORDEMENTS.md` steps 6-10; the sections below only
state the order, the local qualification that precedes it and the recovery.
The repository default stays `MCP_SIGNAL_SEARCH_ENABLED: "0"` in
`deploy/k8s/39-mcp-receiver-config.yaml`: the receiver ConfigMap is operator
owned and the CD never reconciles it. Flipping the flag alone is not an
activation.

## 1. Local qualification (no cluster access)

Run from a worktree, `ENV` last, one Docker stack at a time, `down -v`
after every stack:

```sh
make test-immo-mcp ENV=test-uimcp
make test-api SCOPE=src/routes/mcp-signal-search.test.ts ENV=test-uimcp-api
make clean ENV=test-uimcp-api
make test-e2e ENV=test-e2e
```

- `test-immo-mcp` covers `signal-search-http`, `signal-search-response`,
  `signal-read-error` and `deployed-baseline` (12-tool surface, stub answers
  frozen).
- `test-api` covers the facade: 401 without session, 503
  `capability_unavailable` while the flag is off, typed refusals.
- `test-e2e` boots the production images with
  `MCP_SIGNAL_SEARCH_ENABLED=1` on synthetic data and probes the facade
  (`ui/e2e-real/mcp.spec.ts`): the seeded member gets the seeded city
  signals, identical to the scoped coherent read; an approved account
  without membership gets a typed refusal (`workspace_missing` or
  `workspace_not_authorized`) and no `signals` payload.
- The real `tools/call search_signals` path through the OAuth token
  exchange needs the preprod IdP and stays `unverified` locally; it is
  qualified by the runbook probe (step 8).

## 2. Controlled preprod activation (operator)

Prerequisites: the runbook inventory is in place (receiver ConfigMap keys,
workload pair, both image digests recorded). Apply the receiver ConfigMap
explicitly through `tools/make/artefacts-delivery.mk` with `ENV=preprod`
last, as the runbook commands do.

| Order | Runbook step | Gate |
|---|---|---|
| 1 | Step 6: supervised CD of the candidate, record API and MCP digests | Served imageIDs equal the recorded digests |
| 2 | Step 7: receiver file with `MCP_SIGNAL_SEARCH_ENABLED=1`, `STRICT_RECEIVER_ARMED=0`, restart API (the flag is read at startup) | API rollout complete |
| 3 | Step 8: probe with the designated single-workspace test account | MCP result equals the facade answer for the same account |
| 4 | Step 9: record the digest-bound A2 receipt, set `STRICT_RECEIVER_ARMED=1` with every matching `STRICT_RECEIVER_RECEIPT_*` key, restart, repeat step 8 | Probe passes armed |
| 5 | Step 10: suspended account, then revoked membership | Typed refusal, no signal payload; restore and probe success again |

Only after order 5 passes is the delivery accepted. Until the receipts
exist, the activation state is `unverified`.

## 3. Rollback

Set `MCP_SIGNAL_SEARCH_ENABLED=0` in the operator receiver ConfigMap and
restart the API (runbook "Closed recovery"). Never reopen a legacy route,
never forward the human bearer, never disarm a matched strict receiver as
recovery.

## 4. Out of scope

No change to `PREPROD_CD_ENABLED` or `BASCULE_SCHEDULE_ENABLED`. No new MCP
tool, no workspace selector on the tool schema (accounts with several
workspaces keep `workspace_ambiguous`).
