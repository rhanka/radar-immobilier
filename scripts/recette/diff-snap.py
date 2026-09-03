#!/usr/bin/env python3
"""diff-snap.py — bascules B′ par identifiant entre deux snapshots d'appartenance.

Usage :
    diff-snap.py <old.ndjson> <new.ndjson> <axe>
    axe ∈ {eligible, bPerim, resElig, precoce, bprime}

Chaque snapshot est produit par `recette-membership-snapshot.prod.test.ts`.
Le net POSITIF peut masquer des SORTANTS : ce diff les nomme un par un.
Priorité recette : les SORTANTS (signaux qui QUITTENT B′) > les entrants.
"""
import sys
import json

BITS = {"eligible": 1, "bPerim": 2, "resElig": 4, "precoce": 8, "bprime": 16}


def load(path):
    out = {}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            out[obj["id"]] = obj
    return out


def main():
    if len(sys.argv) != 4 or sys.argv[3] not in BITS:
        print(__doc__)
        sys.exit(2)
    old_f, new_f, axis = sys.argv[1], sys.argv[2], sys.argv[3]
    mask = BITS[axis]
    old, new = load(old_f), load(new_f)
    entrants, sortants = [], []
    for i in sorted(set(old) | set(new)):
        o, n = old.get(i), new.get(i)
        ob = bool(o and (o["f"] & mask))
        nb = bool(n and (n["f"] & mask))
        if ob == nb:
            continue
        ctx = n or o
        rec = {
            "id": i, "city": ctx.get("c"), "etape": ctx.get("e"),
            "instr": ctx.get("i"),
            "excl_old": (o or {}).get("x", "ABSENT"),
            "excl_new": (n or {}).get("x", "ABSENT"),
            "rv_old": (o or {}).get("rv"), "rv_new": (n or {}).get("rv"),
        }
        (entrants if nb else sortants).append(rec)
    print(f"== {axis}: {old_f.split('/')[-1]} -> {new_f.split('/')[-1]} ==")
    print(f"   ENTRANTS (0->1): {len(entrants)}   "
          f"SORTANTS (1->0): {len(sortants)}   "
          f"net={len(entrants) - len(sortants):+d}")
    if sortants:
        print("   --- SORTANTS (signaux PERDUS — bloquant sauf correction justifiée) ---")
        for r in sortants:
            print(f"     - {r['id']} [{r['city']}] etape={r['etape']} "
                  f"instr={r['instr']} rv {r['rv_old']}->{r['rv_new']} "
                  f"excl {r['excl_old']}->{r['excl_new']}")
    if entrants and len(entrants) <= 20:
        print("   --- entrants ---")
        for r in entrants:
            print(f"     + {r['id']} [{r['city']}] etape={r['etape']} "
                  f"instr={r['instr']} rv {r['rv_old']}->{r['rv_new']}")


if __name__ == "__main__":
    main()
