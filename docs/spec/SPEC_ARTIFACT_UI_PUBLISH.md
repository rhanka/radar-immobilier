# Publishing the real UI as an artifact

How to build the Signaux SPA for artifact publication and publish the
resulting `ui/dist` with the existing upload channel. The `/__app` data
relay itself is **not** part of this document (lot J1.2c); the build below
already points at its future prefix.

## 1. Build the artifact dist

```sh
make build-ui-artifact ENV=<env>
```

This produces `ui/dist` with the artifact variables only; the normal app
build (`make build`) is unchanged:

| Variable | App build (`make build`) | Artifact build (`make build-ui-artifact`) |
|---|---|---|
| `base` | `/` (or `/radar-immobilier/` under `GITHUB_PAGES=true`) | `/` (`GITHUB_PAGES` forced empty) |
| `VITE_API_BASE_URL` | empty (same-origin via the Vite proxy) | `/__app` (future reader relay prefix, J1.2c) |
| `VITE_BASEMAP_TILE_URL` | unset (OSM template `https://tile.openstreetmap.org/{z}/{x}/{y}.png`) | `/__artifacts/tiles/v1/osm/{z}/{x}/{y}` (same-origin tile relay) |

Consequences of the artifact variables:

- Tile requests stay same-origin under `connect-src`/`img-src 'self'`.
  The OSM path (`GET /__artifacts/tiles/v1/osm/{z}/{x}/{y}`, z 0..19) is
  served with a per-reader rate limit (429 + `Retry-After` past budget),
  an identifying service `User-Agent`, no client IP forwarded, and a
  server cache honoring upstream freshness headers. Keep the
  `© OpenStreetMap contributors` attribution visible in the page.
- API calls resolve against `/__app`. Until J1.2c lands, that prefix
  answers 404 on the artifact host; the boot and data layers are wired to
  it in J1.2a/J1.2c.
- Served on the artifact host, the release runs under the generic
  application CSP (`default-src 'self'`, hash-only `script-src`,
  `style-src 'self' 'unsafe-inline'`, `worker-src 'self'`, everything else
  closed) and extension-less navigations fall back to the release
  `index.html` (SPA history fallback; `/__reader`, `/__artifacts`,
  `/__app` and real files never fall back). Service workers stay refused.

## 2. Pre-flight the dist

- At most 255 files, 16 MiB per file, 64 MiB per release.
- Served binary types: `image/png`, `image/jpeg`, `image/gif`,
  `image/webp`, `image/svg+xml`, `application/pdf`, `font/woff2`,
  `video/mp4` (magic-byte verified at commit; SVG must carry no script,
  handler or external reference and is served sandboxed).

## 3. Publish with the upload channel

Stage bytes outside the model, then publish one atomic release:

1. `artifacts_create_upload({ artifactId, mimeType, maxSize })` returns a
   signed PUT URL bound to that exact `Content-Length`. Measure the file
   first: a PUT of any other size is refused. Large files supplied by the
   Product Owner go through the browser instead:
   `artifacts_create_upload_page({ artifactId })` returns an
   `uploadPageUrl` (bytes travel browser to storage, never through a
   model payload).
2. `artifacts_commit_upload({ artifactId, uploadId, path, mimeType,
   digest, size, idempotencyKey })` pins the staged bytes to a manifest
   path (`municipalities.geojson` is served as `application/json`).
3. Review with `artifacts_list_assets`, then publish atomically with
   `artifacts_publish_bundle_v2` (inline files plus copy/carry/keep asset
   forms).

## 4. Verify on the artifact host

- Open the release with one approval gesture; the Signaux view loads
  with live reader data, zero CSP violation, zero off-origin request.
- The map background renders through the same-origin OSM relay with the
  OSM attribution visible; tile failures degrade to the neutral fill,
  never to a cross-origin fetch.
