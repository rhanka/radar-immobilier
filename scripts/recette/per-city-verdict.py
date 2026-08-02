#!/usr/bin/env python3
"""per-city-verdict.py — agrège un snapshot d'appartenance B′ PAR VILLE et,
si un fichier de verdicts attendus est fourni, prononce rouge/vert par ville.

Usage :
    per-city-verdict.py <snapshot.ndjson> [expected.json] [--axis bprime|precoce|resElig]

<snapshot.ndjson> : sortie de recette-membership-snapshot.prod.test.ts
<expected.json>   : { "<slug>": {"in_bprime": true|false, "note": "..."} }
                    in_bprime=true  → ville attendue DANS B' (score >=6) ;
                    in_bprime=false → faux positif attendu DEHORS.

Sortie : table par ville (slug | signals | eligible | precoce | bprime | verdict)
et un récapitulatif GREEN/RED. Code retour ≠ 0 s'il reste des RED (gate).
"""
import sys
import json

BITS = {"eligible": 1, "bPerim": 2, "resElig": 4, "precoce": 8, "bprime": 16}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    axis = "bprime"
    for i, a in enumerate(sys.argv):
        if a == "--axis" and i + 1 < len(sys.argv):
            axis = sys.argv[i + 1]
    if not args or axis not in BITS:
        print(__doc__)
        sys.exit(2)
    snap_f = args[0]
    expected = json.load(open(args[1])) if len(args) > 1 else None
    if expected is not None:
        # les clés méta (_meta, …) ne sont pas des villes
        expected = {k: v for k, v in expected.items() if not k.startswith("_")}
    mask = BITS[axis]

    cities = {}
    for line in open(snap_f):
        line = line.strip()
        if not line:
            continue
        o = json.loads(line)
        c = o.get("c")
        if not c:
            continue
        d = cities.setdefault(
            c, {"signals": 0, "eligible": 0, "resElig": 0,
                 "precoce": 0, "bprime": 0, "selected": []}
        )
        d["signals"] += 1
        f = o["f"]
        if f & BITS["eligible"]:
            d["eligible"] += 1
        if f & BITS["resElig"]:
            d["resElig"] += 1
        if f & BITS["precoce"]:
            d["precoce"] += 1
        if f & BITS["bprime"]:
            d["bprime"] += 1
        if f & mask:
            d["selected"].append(o["id"])

    # compteurs séparés par provenance (gold = DUR, silver = mesure/nomme)
    stat = {"gold": {"green": 0, "red": 0}, "silver": {"green": 0, "red": 0}}
    rows = []
    reds_hard = []  # RED sur gold = bloquant
    for slug in sorted(cities):
        d = cities[slug]
        sel = len(d["selected"])
        verdict = ""
        tgt = ""
        if expected is not None and slug in expected:
            exp = expected[slug]
            in_b = exp.get("in_bprime")
            prov = exp.get("provenance", "silver")
            if in_b is None:
                verdict = "n/a"  # no-graph / non scorée
            else:
                want_in = bool(in_b)
                target = exp.get("target")
                ok = (sel > 0) if want_in else (sel == 0)
                tag = "GREEN" if ok else ("RED(manque)" if want_in else "RED(faux+)")
                verdict = f"{prov[0]}:{tag}"  # g:/s: préfixe provenance
                if want_in and target is not None:
                    tgt = f"cible={target}" + ("" if sel == target else f"≠{sel}")
                stat[prov]["green" if ok else "red"] += 1
                if not ok and prov == "gold":
                    reds_hard.append(slug)
        rows.append((slug, d["signals"], d["eligible"], d["precoce"],
                     d["bprime"], verdict, tgt))

    print(f"{'slug':34} {'sig':>4} {'elig':>5} {'prec':>4} {'bpr':>4}  {'verdict':12} note")
    for r in rows:
        print(f"{r[0]:34} {r[1]:>4} {r[2]:>5} {r[3]:>4} {r[4]:>4}  {r[5]:12} {r[6]}")
    print(f"\ncities_corpus={len(cities)}  axis={axis}")
    if expected is not None:
        missing = [s for s in expected if s not in cities and expected[s].get("in_bprime") is not None]
        g, s = stat["gold"], stat["silver"]
        print(f"GOLD  (DUR)    : GREEN={g['green']} RED={g['red']}")
        print(f"SILVER (mesure): GREEN={s['green']} RED={s['red']}  (proxy ~86% precision, sur-inclusif)")
        print(f"attendus_absents_du_corpus (scorés): {len(missing)}")
        if missing:
            print("  absents:", ", ".join(sorted(missing)[:40]))
        if reds_hard:
            print("  RED GOLD (BLOQUANT):", ", ".join(reds_hard))
        # exit non-zero seulement sur RED GOLD (dur) — le silver est mesure, pas gate
        sys.exit(1 if reds_hard else 0)


if __name__ == "__main__":
    main()
