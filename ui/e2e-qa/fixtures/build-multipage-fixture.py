#!/usr/bin/env python3
"""Génère `preuve-qa-multipage.pdf` : 3 pages, couche texte réelle (Helvetica).

But QA (#82/#83) :
  - Page 1 et page 3 : amorce générique « ATTENDU QUE la municipalite … » →
    PRÉSENTE sur plusieurs pages, NE DOIT PAS être surlignée (prouve #83 :
    pas de faux positif hors page cible).
  - Page 2 (cible) : la citation complète et spécifique, à une position connue
    (x=72, y=620 en espace PDF, page A4 595x842) → surlignage attendu, aligné
    au texte (prouve #82).

Le PDF est construit à la main (aucune dépendance), offsets xref recalculés.
"""

from pathlib import Path

# Chaque page : liste de (x, y, taille, texte). y en convention PDF (bas-gauche).
PAGES = [
    # Page 1 — générique (amorce partagée, NE PAS surligner)
    [
        (72, 780, 14, "Page 1 - Proces-verbal seance ordinaire"),
        (72, 740, 12, "ATTENDU QUE la municipalite tient une seance publique."),
        (72, 710, 12, "Divers points administratifs sont abordes ce jour."),
    ],
    # Page 2 — CIBLE : citation specifique a position connue (x=72, y=620)
    [
        (72, 780, 14, "Page 2 - Resolution adoptee"),
        (72, 740, 12, "ATTENDU QUE la municipalite souhaite encadrer le developpement."),
        (72, 620, 12, "Le conseil adopte le reglement numero 2026-42 sur la"),
        (72, 600, 12, "densification residentielle du secteur nord de la ville."),
        (72, 540, 12, "La presente resolution prend effet immediatement."),
    ],
    # Page 3 — générique (amorce partagée, NE PAS surligner)
    [
        (72, 780, 14, "Page 3 - Affaires diverses"),
        (72, 740, 12, "ATTENDU QUE la municipalite poursuit ses travaux courants."),
        (72, 710, 12, "La seance est levee a vingt et une heures."),
    ],
]

MEDIA_W, MEDIA_H = 595, 842  # A4 portrait


def content_stream(lines):
    # `Tm` (matrice de texte ABSOLUE) à chaque ligne : positionnement fiable,
    # indépendant de la ligne précédente (Td est relatif et accumulait → pdf.js
    # ne voyait qu'un seul item). size encodée dans Tm (a=d=size).
    parts = ["BT"]
    for x, y, size, text in lines:
        esc = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        parts.append(f"/F1 {size} Tf 1 0 0 1 {x} {y} Tm ({esc}) Tj")
    parts.append("ET")
    return "\n".join(parts)


def build():
    objects = []  # liste de bytes, index 0 = objet 1

    # 1: Catalog, 2: Pages, puis pour chaque page : Page obj + Contents obj.
    # Font partagee : dernier objet.
    n_pages = len(PAGES)
    # numerotation : 1 catalog, 2 pages, 3..(2+2*n) pages+contents, font = dernier
    page_obj_ids = []
    content_objs = []
    kids = []
    next_id = 3
    for lines in PAGES:
        page_id = next_id
        content_id = next_id + 1
        next_id += 2
        page_obj_ids.append((page_id, content_id, lines))
        kids.append(f"{page_id} 0 R")
    font_id = next_id

    # Objet 1 : Catalog
    objects.append((1, f"<< /Type /Catalog /Pages 2 0 R >>".encode()))
    # Objet 2 : Pages
    kids_str = " ".join(kids)
    objects.append(
        (2, f"<< /Type /Pages /Kids [{kids_str}] /Count {n_pages} >>".encode())
    )
    # Pages + Contents
    for page_id, content_id, lines in page_obj_ids:
        page_dict = (
            f"<< /Type /Page /Parent 2 0 R "
            f"/MediaBox [0 0 {MEDIA_W} {MEDIA_H}] "
            f"/Contents {content_id} 0 R "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> >>"
        )
        objects.append((page_id, page_dict.encode()))
        stream = content_stream(lines).encode()
        content = (
            f"<< /Length {len(stream)} >>\nstream\n".encode()
            + stream
            + b"\nendstream"
        )
        objects.append((content_id, content))
    # Font
    objects.append(
        (
            font_id,
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        )
    )

    objects.sort(key=lambda o: o[0])
    max_id = objects[-1][0]

    out = bytearray(b"%PDF-1.4\n")
    offsets = {}
    for obj_id, body in objects:
        offsets[obj_id] = len(out)
        out += f"{obj_id} 0 obj\n".encode() + body + b"\nendobj\n"

    xref_pos = len(out)
    out += f"xref\n0 {max_id + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for obj_id in range(1, max_id + 1):
        out += f"{offsets[obj_id]:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {max_id + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF".encode()
    )
    return bytes(out)


if __name__ == "__main__":
    pdf = build()
    dest = Path(__file__).with_name("preuve-qa-multipage.pdf")
    dest.write_bytes(pdf)
    print(f"wrote {dest} ({len(pdf)} bytes, {len(PAGES)} pages)")
