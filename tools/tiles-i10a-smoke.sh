#!/bin/bash
# I-10A live smoke: read-only tile fetch from each upstream (no proxy involved).
# Usage: bash tools/tiles-i10a-smoke.sh [outdir]
# Prints one line per tile: url -> http, content-type, bytes, magic.
set -u
OUTDIR="${1:-/tmp/tiles-i10a-smoke}"
mkdir -p "$OUTDIR"
fail=0
n=0

check() {
  url="$1"
  name="$2"
  n=$((n + 1))
  code=$(curl -sS -o "$OUTDIR/$name" -w "%{http_code} %{content_type} %{size_download}" --max-time 25 "$url") || {
    echo "FAIL $url (curl error)"; fail=1; return; }
  magic=$(head -c 2 "$OUTDIR/$name" 2>/dev/null | od -An -tx1 | tr -d ' \n')
  echo "tile $n: $url -> http/type/size: $code magic: $code:$magic"
  set -- $code
  if [ "$1" != "200" ]; then echo "FAIL $url (status $1)"; fail=1; return; fi
  case "$2" in
    image/jpeg) [ "$magic" = "ffd8" ] || { echo "FAIL $url (jpeg magic $magic)"; fail=1; };;
    image/png) [ "$magic" = "8950" ] || { echo "FAIL $url (png magic $magic)"; fail=1; };;
    *) echo "FAIL $url (content-type $2)"; fail=1;;
  esac
}

# Default: Gouvernement du Quebec WMTS Cartes_Images / BDTQ-20K (Salaberry-de-Valleyfield).
check "https://servicesmatriciels.mern.gouv.qc.ca/erdas-iws/ogc/wmts/Cartes_Images/BDTQ-20K/default/GoogleMapsCompatibleExt2:epsg:3857/13/2939/2408.jpg" def-z13.jpg
check "https://servicesmatriciels.mern.gouv.qc.ca/erdas-iws/ogc/wmts/Cartes_Images/BDTQ-20K/default/GoogleMapsCompatibleExt2:epsg:3857/15/11753/9636.jpg" def-z15.jpg
check "https://servicesmatriciels.mern.gouv.qc.ca/erdas-iws/ogc/wmts/Cartes_Images/BDTQ-20K/default/GoogleMapsCompatibleExt2:epsg:3857/17/47012/38544.jpg" def-z17.jpg
# Fallback: RNCan CBMT geometry + text-only overlay (same tiles).
check "https://maps-cartes.services.geo.ca/server2_serveur2/rest/services/BaseMaps/CBMT_CBCT_GEOM_3857/MapServer/tile/15/11753/9636" fb-geom-z15.jpg
check "https://maps-cartes.services.geo.ca/server2_serveur2/rest/services/BaseMaps/CBMT_TXT_3857/MapServer/tile/15/11753/9636" fb-txt-z15.png

echo "smoke: $n tiles, failures: $fail"
exit "$fail"
