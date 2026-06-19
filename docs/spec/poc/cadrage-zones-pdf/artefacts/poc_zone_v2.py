#!/usr/bin/env python3
"""POC v2: zone H-53 = lots H dont le label le plus proche SANS franchir de lisere noir.
Ajoute le test de "ligne de vue" (line-of-sight) entre centroide du lot et label:
si le segment traverse un pixel de lisere noir epais -> ce label est masque.
C'est la separation par contours qui manquait au Voronoi pur."""
import json, urllib.parse, urllib.request
from osgeo import gdal
gdal.UseExceptions()
import collections as _c

RASTER = "sta-plan-4326.tif"; TARGET = "H-53"
CAD = "https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer/0/query"
ds = gdal.Open(RASTER); gt = ds.GetGeoTransform(); inv = gdal.InvGeoTransform(gt)
B = [ds.GetRasterBand(i + 1).ReadAsArray() for i in range(3)]
H, W = B[0].shape

def to_px(lon, lat):
    return int(inv[0] + lon * inv[1] + lat * inv[2]), int(inv[3] + lon * inv[4] + lat * inv[5])

def is_border(px, py):
    """pixel sombre = lisere/texte de frontiere."""
    if not (0 <= px < W and 0 <= py < H): return True
    return max(int(B[0][py][px]), int(B[1][py][px]), int(B[2][py][px])) < 70

def blocked(p0, p1):
    """Bresenham: compte les pixels-frontiere sur le segment; >2 consecutifs = mur."""
    x0, y0 = p0; x1, y1 = p1
    dx, dy = abs(x1 - x0), abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx - dy; run = 0
    while True:
        if is_border(x0, y0):
            run += 1
            if run >= 3: return True     # liseré franc traversé
        else:
            run = 0
        if x0 == x1 and y0 == y1: break
        e2 = 2 * err
        if e2 > -dy: err -= dy; x0 += sx
        if e2 < dx: err += dx; y0 += sy
    return False

def sample_cat(lon, lat, rad=5):
    px, py = to_px(lon, lat)
    cnt = _c.Counter()
    for j in range(max(0, py - rad), min(H, py + rad + 1)):
        for i in range(max(0, px - rad), min(W, px + rad + 1)):
            r, g, b = int(B[0][j][i]), int(B[1][j][i]), int(B[2][j][i])
            if max(r, g, b) < 60 or min(r, g, b) > 235: continue
            cnt[(r // 16 * 16, g // 16 * 16, b // 16 * 16)] += 1
    if not cnt: return "?"
    r, g, b = cnt.most_common(1)[0][0]
    if r >= 200 and g >= 200 and b < 200: return "H"
    if r >= 180 and g < 160 and b < 160: return "C"
    if g >= 180 and r < 200 and b < 180: return "A"
    if b >= 180 and r < 200: return "P"
    return "X"

labels = [f for f in json.load(open("sta-zone-labels.geojson"))["features"] if "-" in f["properties"]["zone_code"]]
for f in labels:
    f["px"] = to_px(*f["geometry"]["coordinates"])
    f["cat"] = sample_cat(*f["geometry"]["coordinates"], rad=6)
target = next(f for f in labels if f["properties"]["zone_code"] == TARGET); tcat = target["cat"]
same = [f for f in labels if f["cat"] == tcat]

D = 0.006; lon0, lat0 = target["geometry"]["coordinates"]
params = {"where": "1=1", "geometry": f"{lon0-D},{lat0-D},{lon0+D},{lat0+D}",
          "geometryType": "esriGeometryEnvelope", "inSR": "4326", "outSR": "4326",
          "spatialRel": "esriSpatialRelIntersects", "outFields": "NO_LOT",
          "resultRecordCount": "3000", "f": "geojson"}
lots = json.load(urllib.request.urlopen(CAD + "?" + urllib.parse.urlencode(params), timeout=40))["features"]

def centroid(g):
    ring = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"][0][0]
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    return sum(xs) / len(xs), sum(ys) / len(ys)
def d2(a, b): return (a[0]-b[0])**2 + (a[1]-b[1])**2

kept = []
for ft in lots:
    g = ft.get("geometry")
    if not g: continue
    cx, cy = centroid(g); cpx = to_px(cx, cy)
    if sample_cat(cx, cy) != tcat: continue
    # labels H visibles (sans liseré entre) tries par distance
    vis = sorted((f for f in same if not blocked(cpx, f["px"])),
                 key=lambda f: d2((cx, cy), f["geometry"]["coordinates"]))
    if vis and vis[0]["properties"]["zone_code"] == TARGET:
        ft["properties"] = {"zone_code": TARGET, "NO_LOT": ft["properties"].get("NO_LOT")}
        kept.append(ft)

print(f"{TARGET} cat={tcat} | lots retenus: {len(kept)} / {len(lots)}")
json.dump({"type": "FeatureCollection", "features": kept}, open("sta-H53-lots.geojson", "w"))
