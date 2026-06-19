#!/usr/bin/env python3
"""POC: GeoPDF de zonage -> points-labels de zone georeferences (lon/lat WGS84).

Lit le geotransform du GeoPDF (gdalinfo), extrait les labels (codes de zone) avec
leur bbox pixel via `pdftotext -bbox`, convertit le centre de chaque bbox en
coordonnees monde (EPSG:3857) puis en lon/lat (EPSG:4326).
"""
import re
import subprocess
import json
import sys
from osgeo import gdal, osr

PDF = sys.argv[1] if len(sys.argv) > 1 else "sta-plan-zonage.pdf"

# 1) Geotransform du GeoPDF (page 1)
ds = gdal.Open(PDF)
gt = ds.GetGeoTransform()            # (x0, a, b, y0, d, e)  affine pixel->monde
raster_w, raster_h = ds.RasterXSize, ds.RasterYSize
srs = osr.SpatialReference()
srs.ImportFromWkt(ds.GetProjection())
wgs84 = osr.SpatialReference(); wgs84.ImportFromEPSG(4326)
srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
wgs84.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
ct = osr.CoordinateTransformation(srs, wgs84)

def pixel_to_world(px, py):
    X = gt[0] + px * gt[1] + py * gt[2]
    Y = gt[3] + px * gt[4] + py * gt[5]
    lon, lat, _ = ct.TransformPoint(X, Y)
    return lon, lat

# 2) Labels via pdftotext -bbox (page coords, origine haut-gauche, page=1224x792)
xml = subprocess.run(["pdftotext", "-f", "1", "-l", "1", "-bbox", PDF, "-"],
                     capture_output=True, text=True).stdout
# dims page
m = re.search(r'<page width="([\d.]+)" height="([\d.]+)">', xml)
page_w, page_h = float(m.group(1)), float(m.group(2))
sx, sy = raster_w / page_w, raster_h / page_h   # page-pts -> raster-px

ZONE_RE = re.compile(r'^[A-Z]{1,3}-?\d{1,4}$')   # H-53, A1-101, I-31, P-15, A1
words = re.findall(
    r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)</word>',
    xml)

feats = []
for xmin, ymin, xmax, ymax, txt in words:
    txt = txt.strip()
    if not ZONE_RE.match(txt):
        continue
    cx = (float(xmin) + float(xmax)) / 2.0 * sx
    cy = (float(ymin) + float(ymax)) / 2.0 * sy
    lon, lat = pixel_to_world(cx, cy)
    feats.append({
        "type": "Feature",
        "properties": {"zone_code": txt, "px": round(cx, 1), "py": round(cy, 1)},
        "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
    })

fc = {"type": "FeatureCollection", "features": feats}
with open("sta-zone-labels.geojson", "w") as f:
    json.dump(fc, f, ensure_ascii=False, indent=1)

codes = sorted({f["properties"]["zone_code"] for f in feats})
print(f"labels zone extraits: {len(feats)} ; codes uniques: {len(codes)}")
print("exemples:", codes[:20])
# bbox geo couverte
lons = [f["geometry"]["coordinates"][0] for f in feats]
lats = [f["geometry"]["coordinates"][1] for f in feats]
print(f"bbox labels lon[{min(lons):.5f},{max(lons):.5f}] lat[{min(lats):.5f},{max(lats):.5f}]")
# echantillon
for f in feats[:6]:
    print(" ", f["properties"]["zone_code"], f["geometry"]["coordinates"])
