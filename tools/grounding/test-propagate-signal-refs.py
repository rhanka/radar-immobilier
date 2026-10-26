#!/usr/bin/env python3
"""Test de régression : propagation de la ref de détection DesignationEvent -> Signal raisé
(raises_signal), pour que la carte du Signal rezonage montre son PV. Voir build-grounded-graph.py
(bloc « PROPAGATION détection »). Sans dépendance : construit une fixture, lance le script, assère.

Usage: python3 tools/grounding/test-propagate-signal-refs.py   (exit 0 = PASS)
"""
import json, os, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build-grounded-graph.py")
SHA = "a" * 64

def build(tmp):
    base = {"nodes": [
        {"id": "ev1", "type": "DesignationEvent", "label": "event 026-999", "properties": {"docSha": SHA}},
        {"id": "sg1", "type": "Signal", "label": "signal 026-999", "properties": {"category": "rezonage"}},
        {"id": "sg2", "type": "Signal", "label": "signal orphelin", "properties": {"category": "rezonage"}},
    ], "edges": [
        {"source": "ev1", "target": "sg1", "label": "raises_signal", "refs": []},
    ]}
    json.dump(base, open(f"{tmp}/base.json", "w"))
    os.makedirs(f"{tmp}/meta"); os.makedirs(f"{tmp}/cites")
    json.dump({"sha256": SHA, "sourceUrl": "https://x/pv.pdf", "storageKey": f"raw/proces-verbaux-x/cas/{SHA}.pdf"},
              open(f"{tmp}/meta/{SHA}.meta.json", "w"))
    json.dump({"results": [{"id": "ev1", "found": True, "page": 7, "excerpt": "avis de motion verbatim"}]},
              open(f"{tmp}/cites/{SHA}.json", "w"))
    subprocess.run([sys.executable, BUILD, f"{tmp}/base.json", f"{tmp}/out.json", f"{tmp}/meta", f"{tmp}/cites"],
                   check=True, capture_output=True)
    g = json.load(open(f"{tmp}/out.json"))
    return {n["id"]: n for n in g["nodes"]}

def refs(n): return (n.get("properties") or {}).get("refs") or []

fails = []
with tempfile.TemporaryDirectory() as tmp:
    nm = build(tmp)
    ev, sg1, sg2 = nm["ev1"], nm["sg1"], nm["sg2"]
    # 1. l'événement porte sa ref groundée
    if not (refs(ev) and refs(ev)[0].get("docSha") == SHA and refs(ev)[0].get("page") == 7):
        fails.append("ev1 ne porte pas sa ref groundée (docSha/page)")
    # 2. FIX : le Signal raisé porte la ref propagée (docSha+page+excerpt exacts + marqueur)
    r = refs(sg1)
    if not r:
        fails.append("sg1 (signal raisé) ne porte AUCUNE ref propagée — LE BUG")
    else:
        r0 = r[0]
        if r0.get("docSha") != SHA: fails.append(f"sg1 docSha propagé faux: {r0.get('docSha')}")
        if r0.get("page") != 7: fails.append(f"sg1 page propagée fausse: {r0.get('page')}")
        if not (r0.get("excerpt") or "").strip(): fails.append("sg1 excerpt propagé vide")
        if r0.get("linkSource") != "raises_signal-detection": fails.append("sg1 marqueur linkSource manquant")
    # 3. ADDITIF : l'événement garde EXACTEMENT sa ref (pas retirée)
    if not (refs(ev) and refs(ev)[0].get("docSha") == SHA):
        fails.append("ev1 a PERDU sa ref (non-additif)")
    # 4. anti-fabrication : un signal SANS événement source raisé ne reçoit AUCUNE ref
    if refs(sg2):
        fails.append("sg2 (signal orphelin, pas d'événement source) a reçu une ref — fabrication")

if fails:
    print("FAIL:\n  - " + "\n  - ".join(fails)); sys.exit(1)
print("PASS: propagation raises_signal-detection (ev->signal) OK — additif, marqué, anti-fabrication")
