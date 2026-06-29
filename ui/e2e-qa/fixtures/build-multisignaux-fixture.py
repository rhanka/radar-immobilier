#!/usr/bin/env python3
"""Génère `preuve-qa-multisignaux.pdf` : 3 pages, couche texte réelle.

But QA LOT 2 (#84 — surlignage MULTI-signaux) : un même procès-verbal porte
PLUSIEURS signaux sur la MÊME page (comme St-Frédéric : A16/Rf51/I93 tous page
2). La page 2 (cible) contient TROIS citations distinctes à des positions
verticales connues ; chaque citation correspond à un signal différent, surligné
dans une couleur propre + badge ID.

  - Page 2 (cible) : 3 citations spécifiques distinctes (signaux A16, Rf51, I93).
  - Pages 1 et 3 : amorce générique « ATTENDU QUE la municipalite … » partagée →
    prouve que le garde de page PAR SIGNAL (LOT 1 #83) tient toujours : aucun
    surlignage parasite hors page cible.

Le PDF est construit à la main (aucune dépendance), offsets xref recalculés.
"""

from pathlib import Path

PAGES = [
    # Page 1 — générique (amorce partagée, NE PAS surligner)
    [
        (72, 780, 14, "Page 1 - Proces-verbal seance ordinaire"),
        (72, 740, 12, "ATTENDU QUE la municipalite tient une seance publique."),
        (72, 710, 12, "Divers points administratifs sont abordes ce jour."),
    ],
    # Page 2 — CIBLE : TROIS citations distinctes (3 signaux du même PV).
    [
        (72, 780, 14, "Page 2 - Resolutions adoptees"),
        (72, 740, 12, "ATTENDU QUE la municipalite souhaite encadrer le developpement."),
        # Signal A16 (y=680)
        (72, 680, 12, "Le conseil adopte le reglement A16 sur la hauteur maximale"),
        (72, 662, 12, "des batiments dans le secteur central de la ville."),
        # Signal Rf51 (y=600)
        (72, 600, 12, "Il est resolu d'autoriser la refonte Rf51 du plan d'urbanisme"),
        (72, 582, 12, "afin de densifier les abords de la rue Principale."),
        # Signal I93 (y=520)
        (72, 520, 12, "Le conseil approuve l'investissement I93 pour la requalification"),
        (72, 502, 12, "du parc municipal et la mise aux normes des infrastructures."),
        (72, 440, 12, "La presente seance est levee a vingt et une heures."),
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
    parts = ["BT"]
    for x, y, size, text in lines:
        esc = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        parts.append(f"/F1 {size} Tf 1 0 0 1 {x} {y} Tm ({esc}) Tj")
    parts.append("ET")
    return "\n".join(parts)


def build():
    objects = []
    n_pages = len(PAGES)
    page_obj_ids = []
    kids = []
    next_id = 3
    for lines in PAGES:
        page_id = next_id
        content_id = next_id + 1
        next_id += 2
        page_obj_ids.append((page_id, content_id, lines))
        kids.append(f"{page_id} 0 R")
    font_id = next_id

    objects.append((1, b"<< /Type /Catalog /Pages 2 0 R >>"))
    kids_str = " ".join(kids)
    objects.append(
        (2, f"<< /Type /Pages /Kids [{kids_str}] /Count {n_pages} >>".encode())
    )
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
    objects.append(
        (font_id, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
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
    dest = Path(__file__).with_name("preuve-qa-multisignaux.pdf")
    dest.write_bytes(pdf)
    print(f"wrote {dest} ({len(pdf)} bytes, {len(PAGES)} pages)")
