#!/usr/bin/env python3
"""Inject verbatim grounding (docSha+sourceUrl+rawRef+page+excerpt) into the
mont-tremblant baseline graph and emit a v2.3 grounded candidate.

No invention: every ref is keyed to a real PV docSha; excerpts are the verbatim
Sonnet-extracted quotes; pages are the real PV pages; sourceUrl/rawRef come from
the S3 .meta.json sidecars.
"""
import json, glob, sys, os

# Usage: build-grounded-graph.py <baseline.json> <out.json> [meta_dir] [cites_dir]
BASE = sys.argv[1] if len(sys.argv) > 1 else "baseline-latest.json"
OUT = sys.argv[2] if len(sys.argv) > 2 else "graph.v23.grounded.json"
META_DIR = sys.argv[3] if len(sys.argv) > 3 else "meta"
CITES_DIR = sys.argv[4] if len(sys.argv) > 4 else "cites"

g = json.load(open(BASE))

# --- load sourceUrl/rawRef per docSha from meta sidecars ---
meta = {}
for f in glob.glob(os.path.join(META_DIR, "*.meta.json")):
    m = json.load(open(f))
    meta[m["sha256"]] = {"sourceUrl": m.get("sourceUrl"), "rawRef": m.get("storageKey")}

# --- load citations per docSha ---
cites = {}  # node_id -> {docSha, page, excerpt}
for f in glob.glob(os.path.join(CITES_DIR, "*.json")):
    sha = os.path.basename(f).replace(".json", "")
    obj = json.load(open(f))
    for r in obj.get("results", []):
        if r.get("found") and r.get("excerpt", "").strip():
            cites[r["id"]] = {"docSha": sha, "page": int(r.get("page") or 0), "excerpt": r["excerpt"].strip()}

nodes = {n["id"]: n for n in g["nodes"]}

# --- node->docSha map (direct or via raises_signal parent) — same logic as nodes-by-sha ---
node_sha = {}
for n in g["nodes"]:
    if n["type"] in ("DesignationEvent", "Signal"):
        ds = (n.get("properties") or {}).get("docSha")
        if ds: node_sha[n["id"]] = ds
for e in g.get("edges", []):
    refs = [r for r in (e.get("refs") or []) if isinstance(r, dict)]
    ds = next((r.get("docSha") for r in refs if r.get("docSha")), None)
    if not ds:
        src = nodes.get(e.get("source"))
        if src: ds = (src.get("properties") or {}).get("docSha")
    if ds:
        for ep in (e.get("source"), e.get("target")):
            nn = nodes.get(ep)
            if nn and nn["type"] in ("DesignationEvent", "Signal") and ep not in node_sha:
                node_sha[ep] = ds

# --- inject node-level refs (read first by UI buildEvidence via props.refs) ---
grounded_nodes = 0
for n in g["nodes"]:
    if n["type"] not in ("DesignationEvent", "Signal"):
        continue
    p = n.setdefault("properties", {})
    ds = node_sha.get(n["id"])
    if not ds:
        continue
    p["docSha"] = ds  # ensure node carries docSha (gate)
    md = meta.get(ds, {})
    cit = cites.get(n["id"])
    ref = {
        "docSha": ds,
        "rawRef": md.get("rawRef"),
        "sourceUrl": md.get("sourceUrl"),
    }
    if cit:
        ref["page"] = cit["page"]
        ref["excerpt"] = cit["excerpt"]
        ref["citation"] = cit["excerpt"]
        # also surface verbatim on properties for legacy readers
        p["citation"] = cit["excerpt"]
        p["page"] = cit["page"]
    # surface streamable fields on properties too
    p["sourceUrl"] = md.get("sourceUrl")
    p["rawRef"] = md.get("rawRef")
    p["refs"] = [ref]
    n["refs"] = [ref]  # node top-level -> props.refs (read by API buildEvidence)
    # fallback: si description vide, utiliser le label du nœud
    if not p.get("description") and n.get("label"):
        p["description"] = n["label"]
    grounded_nodes += 1

# --- fallback description sur nœuds sans docSha (non groundés) ---------------
for n in g["nodes"]:
    if n["type"] not in ("DesignationEvent", "Signal"):
        continue
    p = n.setdefault("properties", {})
    if not p.get("description") and n.get("label"):
        p["description"] = n["label"]

# --- inject grounded refs onto edges, replacing synthetic generated:// refs ---
def grounded_edge_ref(ds, node_id):
    md = meta.get(ds, {})
    cit = cites.get(node_id)
    r = {"docSha": ds, "rawRef": md.get("rawRef"), "sourceUrl": md.get("sourceUrl")}
    if cit:
        r["page"] = cit["page"]; r["excerpt"] = cit["excerpt"]; r["citation"] = cit["excerpt"]
    return r

cleaned_edges = 0
for e in g.get("edges", []):
    # determine docSha for this edge: prefer a node endpoint's docSha
    ds = None
    target_node = None
    for ep in (e.get("target"), e.get("source")):
        if ep in node_sha:
            ds = node_sha[ep]; target_node = ep; break
    new_refs = []
    for r in (e.get("refs") or []):
        if not isinstance(r, dict):
            # ref non-dict (string) : conserver tel quel, pas synthétique
            new_refs.append(r)
            continue
        raw = str(r.get("rawRef") or "")
        src_file = str(r.get("source_file") or "")
        if raw.startswith("generated://") or src_file.startswith("generated://") or r.get("synthetic"):
            cleaned_edges += 1
            continue  # drop synthetic
        new_refs.append(r)
    # if edge connects to a grounded node and has no real ref, attach one
    if ds and not new_refs:
        new_refs.append(grounded_edge_ref(ds, target_node))
    e["refs"] = new_refs

g["ontology_version"] = "2.3"

json.dump(g, open(OUT, "w"), ensure_ascii=False, indent=2)
total_sig = len([n for n in g["nodes"] if n["type"] in ("DesignationEvent","Signal")])
print(f"grounded nodes: {grounded_nodes}/{total_sig}")
print(f"synthetic edge refs dropped: {cleaned_edges}")
print(f"wrote {OUT}")
