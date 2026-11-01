# Official Sentropic artifact kit

Verbatim local snapshot from `rhanka/sent-tech-design-system`, checkout
`22421ed82f69737825b962e5a0e448482733eaca`, inspected 2026-11-01.
The snapshot README identifies React **0.36.46**; the themes package is **0.11.0**.
This intentionally lags the newer React ESM distribution (0.38.0 reported by DS).
No React, ReactDOM, Elements runtime, external font or CDN is required here.

| Vendored file | Upstream snapshot file | Bytes | SHA-256 |
|---|---|---:|---|
| sent-tech.css | ds-bundle/tokens/sent-tech.css | 112476 | 925139c5dad7d3f5deba7483ed5bfd5a9394671cd00bbd4bf6c02660065f892e |
| components.css | ds-bundle/_ds_bundle.css | 536362 | 16db33abc8e0655c7c010b7546f97e26e32cad4fafa8718aa6b9cf84d0e3c4ea |

`packages/artifacts-host/src/design-kit.ts` is the shared manifest. The API
checks exact bytes before caching them. The deployment embeds these files;
they are independent of the 256 KiB author publication budget. Never replace
bytes at an existing version/digest URL. Keep older approved kits when adding
a future kit so published pages remain reproducible.

Load tokens, components, then author layout CSS. Set
`data-st-theme="sent-tech"` on the root. Author styles use semantic `--st-*`
tokens and never redefine the palette. Literal colors in these official
compiled files are upstream output, not an author palette.

Published pages load this kit from their own content origin through the
authorized reader path. The application origin exposes the same immutable
public assets for approval. CSP remains `style-src 'self'`; approval adds only
this source and the exact hash of its small layout block. React ThemeProvider
injects runtime styles and needs separate CSP qualification before use.
