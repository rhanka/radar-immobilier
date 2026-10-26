# Reader-auth contract (ARTEFACTS A6/H5) — receiving binding pending

The local H5 modules use a separate authentication path. This is not yet
a receiving API authentication binding:

- Page session: `__Host-preview-session` (AEAD, `preview-session.ts`).
  Never `radar_session`; never the publisher or MCP credential.
- API calls from content: signed grant (`preview-grant.ts`) bound to
  issuer/audience/tier/host/artifact/release/reader/session/profile/policy
  revision/expiry, adapted to the API reader context (`reader-context.ts`)
  separately from H4's delegated search token.
- Application browser auth (`radar_session` cookie) and IdP Bearer [REDACTED]
  paths in `api/src/routes/auth.ts` are untouched. No new OAuth scope, no
  authority header or identity is accepted from content.

The named protected adapter currently targets the existing API contract
`/api/graph-signals/:city`; no HTTP adapter or receiving H5 authentication
mount has been integrated. Requalify that adapter if BASE retires the route.
Do not forward an H5 grant to the IdP bearer path or bypass its strict guards.

## Verification checklist (Sol, with the mounted app)

- `GET /api/geo/collections/...` on the app host keeps its current
  public/authenticated behavior (no H5 regression).
- On a content host, `/api/*` stays `401 unauthenticated` even with a valid
  `radar_session` cookie (existing `content-app.test.ts` threat case).
- Reader operations validate method/params/response; unknown operations
  404, wrong reader/session/host/release/profile/policy 401, expired 401.
- Renewal rereads approval/ACL/policy; revocation and outage close access
  within the 60 s cutoff, including active streams.
- No `radar_session`, publisher secret or MCP credential in served bytes,
  `Set-Cookie` or logs; `Referer: no-referrer` on every reader response.
- Cookies kept small (`< 4 KB` each, synthetic secrets); no silent cookie
  splitting or storage-vault fallback.
