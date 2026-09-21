#!/usr/bin/env bash
# Collect the project's decision dossiers into the GitHub Pages output.
#
# Each dossier is a self-contained, offline-capable Focus page named
# `decision-focus.html`, living under docs/spec/reports/<slug>/. This script
# copies every such page to <dist>/dossiers/<slug>/index.html and writes an
# index (<dist>/dossiers/index.html) that links to all of them.
#
# Usage: collect-decision-dossiers.sh <dist-dir>
# Default <dist-dir> is ui/dist (the directory published by deploy-gh-pages.yml).
set -euo pipefail

DIST="${1:-ui/dist}"
SRC_ROOT="docs/spec/reports"
OUT="${DIST}/dossiers"

if [ ! -d "${DIST}" ]; then
  echo "[dossiers] target dist dir '${DIST}' missing; run 'make build' first" >&2
  exit 1
fi

mkdir -p "${OUT}"

# HTML-escape helper for values injected into the index.
esc() { sed -e 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }

# Extract the <title> of a dossier page (falls back to the slug).
page_title() {
  local file="$1" slug="$2" title
  title="$(tr '\n' ' ' < "${file}" \
    | grep -oiE '<title>[^<]*</title>' \
    | head -n1 \
    | sed -E 's/<[^>]+>//g' \
    | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
  [ -n "${title}" ] && printf '%s' "${title}" || printf '%s' "${slug}"
}

rows=""
count=0
while IFS= read -r page; do
  slug="$(basename "$(dirname "${page}")")"
  mkdir -p "${OUT}/${slug}"
  cp "${page}" "${OUT}/${slug}/index.html"
  title="$(page_title "${page}" "${slug}")"
  esc_title="$(printf '%s' "${title}" | esc)"
  esc_slug="$(printf '%s' "${slug}" | esc)"
  rows="${rows}    <li><a href=\"./${esc_slug}/\">${esc_title}</a> <code>${esc_slug}</code></li>\n"
  count=$((count + 1))
  echo "[dossiers] + ${slug} (${title})"
done < <(find "${SRC_ROOT}" -type f -name 'decision-focus.html' | sort)

cat > "${OUT}/index.html" <<HTML
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dossiers de décision — radar-immobilier</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 52rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.5rem; }
  ul { list-style: none; padding: 0; }
  li { padding: .6rem 0; border-bottom: 1px solid rgba(128,128,128,.25); }
  code { opacity: .6; font-size: .85em; }
  a { text-decoration: none; font-weight: 600; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <h1>Dossiers de décision</h1>
  <p>${count} dossier(s) publié(s) — pages Focus autonomes, générées depuis <code>docs/spec/reports/**/decision-focus.html</code>.</p>
  <ul>
$(printf '%b' "${rows}")  </ul>
</body>
</html>
HTML

echo "[dossiers] ${count} dossier(s) collected into ${OUT}"
