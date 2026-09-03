#!/usr/bin/env python3
"""dump-parity.py — parité de deux dumps de projection graph_nodes (ex. SCW vs OVH).

Usage : dump-parity.py <A.ndjson> <B.ndjson>

Chaque ligne = une GraphSignalProjectionRow (mêmes clés que le dump prod PG).
Compare les ENSEMBLES d'id et, pour les id communs, les CHAMPS qui alimentent
la classification B′ (citySlug, type, category, label, nbUnitesMax, intensite,
description, etapeAnnote, sourceRef). Prouve A==B (parité) ou mesure le delta —
étape (2) du re-baseline OVH : ne pas SUPPOSER la parité md5 de migration.

Sortie : compte only-A / only-B / commun / champs-divergents + échantillons.
Code retour 0 si parité STRICTE (mêmes id, mêmes champs classif), 1 sinon.
"""
import sys
import json

CLASSIF_FIELDS = [
    "citySlug", "type", "category", "label",
    "nbUnitesMax", "intensite", "description", "etapeAnnote", "sourceRef",
]


def load(path):
    out = {}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            o = json.loads(line)
            out[o["id"]] = o
    return out


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    A, B = load(sys.argv[1]), load(sys.argv[2])
    ia, ib = set(A), set(B)
    only_a, only_b, common = ia - ib, ib - ia, ia & ib

    changed = []
    for i in sorted(common):
        a, b = A[i], B[i]
        diff = [f for f in CLASSIF_FIELDS if a.get(f) != b.get(f)]
        if diff:
            changed.append((i, diff, {f: (a.get(f), b.get(f)) for f in diff}))

    print(f"A={len(A)}  B={len(B)}  commun={len(common)}")
    print(f"  only-A (absents de B): {len(only_a)}")
    print(f"  only-B (absents de A): {len(only_b)}")
    print(f"  id communs a champs classif DIVERGENTS: {len(changed)}")
    for i in sorted(only_a)[:15]:
        print(f"    -A {i} [{A[i].get('citySlug')}] type={A[i].get('type')}")
    for i in sorted(only_b)[:15]:
        print(f"    +B {i} [{B[i].get('citySlug')}] type={B[i].get('type')}")
    for i, fields, vals in changed[:15]:
        print(f"    ~ {i} [{A[i].get('citySlug')}] champs={fields} {vals}")

    parity = not only_a and not only_b and not changed
    print("\nPARITE STRICTE" if parity else "\nDELTA (PAS de parite stricte)")
    sys.exit(0 if parity else 1)


if __name__ == "__main__":
    main()
