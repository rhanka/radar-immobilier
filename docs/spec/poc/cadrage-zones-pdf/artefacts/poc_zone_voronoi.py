#!/usr/bin/env python3
"""POC etape 2 (final): polygone de zone H-53 par COULEUR(categorie)+VORONOI(label)+ANCRAGE CADASTRE.

Algorithme:
 1. GeoPDF -> GeoTIFF WGS84 (sta-plan-4326.tif), labels georeferences (poc_labels.py).
 2. Couleur d'aplat au label -> CATEGORIE (H=jaune, C=rouge, A=vert/beige, etc.).
 3. Pour chaque lot cadastral MERN: couleur sous son centroide -> categorie du lot.
 4. Parmi les labels de MEME categorie, le lot est rattache au label le plus proche
    (Voronoi contraint a la categorie). -> identite de zone (H-53 vs H-50...).
 5. On garde les lots dont la zone == H-53. ogr2ogr dissout -> polygone GeoJSON.
Sortie: lots classes (sta-H53-lots.geojson). Union finale via ogr2ogr (etape suivante).
"""
import json, urllib.parse, urllib.request, math
from osgeo import gdal
gdal.UseExceptions()

RASTER = "sta-plan-4326.tif"
TARGET = "H-53"
CAD = "https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer/0/query"

labels = json.load(open("sta-zone-labels.geojson"))["features"]
# garder seulement les vrais labels de zone (H-/I-/C-/P- avec tiret) hors legende A1..A5
zone_labels = [f for f in labels if "-" in f["properties"]["zone_code"]]

ds = gdal.Open(RASTER)
gt = ds.GetGeoTransform(); inv = gdal.InvGeoTransform(gt)
bands = [ds.GetRasterBand(i + 1) for i in range(3)]
import collections as _c

def sample(lon, lat, rad=5):
    px = int(inv[0] + lon * inv[1] + lat * inv[2]); py = int(inv[3] + lon * inv[4] + lat * inv[5])
    if not (0 <= px < ds.RasterXSize and 0 <= py < ds.RasterYSize): return None
    x0, y0 = max(0, px - rad), max(0, py - rad)
    w = min(ds.RasterXSize - x0, 2 * rad + 1); h = min(ds.RasterYSize - y0, 2 * rad + 1)
    p = [b.ReadAsArray(x0, y0, w, h) for b in bands]; cnt = _c.Counter()
    for j in range(h):
        for i in range(w):
            r, g, bl = int(p[0][j][i]), int(p[1][j][i]), int(p[2][j][i])
            if max(r, g, bl) < 60 or min(r, g, bl) > 235: continue
            cnt[(r // 16 * 16, g // 16 * 16, bl // 16 * 16)] += 1
    return cnt.most_common(1)[0][0] if cnt else None

def category(rgb):
    """Classe une couleur d'aplat en categorie de zonage (heuristique HSV simple)."""
    if rgb is None: return "?"
    r, g, b = rgb
    if r >= 200 and g >= 200 and b < 200: return "H"   # jaune
    if r >= 180 and g < 160 and b < 160:  return "C"   # rouge/rose
    if g >= 180 and r < 200 and b < 180:  return "A"   # vert
    if b >= 180 and r < 200:              return "P"   # bleu
    if r >= 180 and g >= 150 and b < 150: return "I"   # orange
    return "X"

# categorie + position de chaque label
for f in zone_labels:
    lon, lat = f["geometry"]["coordinates"]
    f["properties"]["cat"] = category(sample(lon, lat, rad=6))
target = next(f for f in zone_labels if f["properties"]["zone_code"] == TARGET)
tcat = target["properties"]["cat"]
print(f"{TARGET}: categorie={tcat}; labels meme categorie={sum(1 for f in zone_labels if f['properties']['cat']==tcat)}")
same_cat = [f for f in zone_labels if f["properties"]["cat"] == tcat]

# tirer les lots autour de H-53
D = 0.006; lon0, lat0 = target["geometry"]["coordinates"]
params = {"where": "1=1", "geometry": f"{lon0-D},{lat0-D},{lon0+D},{lat0+D}",
          "geometryType": "esriGeometryEnvelope", "inSR": "4326", "outSR": "4326",
          "spatialRel": "esriSpatialRelIntersects", "outFields": "NO_LOT",
          "resultRecordCount": "3000", "f": "geojson"}
with urllib.request.urlopen(CAD + "?" + urllib.parse.urlencode(params), timeout=40) as r:
    lots = json.load(r)["features"]

def centroid(g):
    ring = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"][0][0]
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    return sum(xs) / len(xs), sum(ys) / len(ys)

def d2(a, b): return (a[0]-b[0])**2 + (a[1]-b[1])**2

kept = []
for ft in lots:
    g = ft.get("geometry")
    if not g: continue
    c = centroid(g)
    cat = category(sample(c[0], c[1]))
    if cat != tcat:            # le lot n'est pas dans la categorie H
        continue
    # voronoi contraint: label de meme categorie le plus proche
    nearest = min(same_cat, key=lambda f: d2(c, f["geometry"]["coordinates"]))
    if nearest["properties"]["zone_code"] == TARGET:
        ft["properties"] = {"zone_code": TARGET, "NO_LOT": ft["properties"].get("NO_LOT")}
        kept.append(ft)

print(f"lots zone {TARGET}: {len(kept)} (sur {len(lots)} tires)")
json.dump({"type": "FeatureCollection", "features": kept}, open("sta-H53-lots.geojson", "w"))
