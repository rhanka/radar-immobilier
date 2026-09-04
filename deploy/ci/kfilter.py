#!/usr/bin/env python3
"""Filter a multi-document `kubectl kustomize` render by kind (and optionally an
exact name or a name PREFIX), preserving each matching document's ORIGINAL text
byte-for-byte (so an applied ConfigMap equals the generated one exactly).

Usage:
  kfilter.py <file> <Kind> [<name>]            -> matching YAML documents
  kfilter.py --name-prefix <P> <file> <Kind>   -> that kind whose name starts P
  kfilter.py --names <file> <Kind>             -> names of that kind, one per line

Only the standard library is used (no PyYAML dependency for a valid render — a
minimal per-document `kind:`/`name:` scan is enough and never reformats).
"""
import re
import sys

argv = sys.argv[1:]
names_only = False
name_prefix = None
while argv and argv[0].startswith("--"):
    flag = argv.pop(0)
    if flag == "--names":
        names_only = True
    elif flag == "--name-prefix":
        name_prefix = argv.pop(0)
    else:
        sys.exit(f"kfilter: unknown flag {flag}")

if len(argv) < 2:
    sys.exit("kfilter: usage: kfilter.py [--names] [--name-prefix P] <file> <Kind> [<name>]")
path, kind = argv[0], argv[1]
exact_name = argv[2] if len(argv) > 2 else None

text = open(path, encoding="utf-8").read()
# kustomize separates documents with a line that is exactly '---'.
chunks = re.split(r"(?m)^---[ \t]*$", text)


def doc_field(chunk, field):
    # Top-level `field:` (kind) or `metadata.name` (2-space indent). Good enough
    # for kustomize output, which is canonically indented and never flow-style.
    if field == "kind":
        m = re.search(r"(?m)^kind:[ \t]+(\S+)[ \t]*$", chunk)
        return m.group(1) if m else None
    if field == "name":
        m = re.search(r"(?m)^  name:[ \t]+(\S+)[ \t]*$", chunk)
        return m.group(1) if m else None
    return None


matches = []
for chunk in chunks:
    if not chunk.strip():
        continue
    if doc_field(chunk, "kind") != kind:
        continue
    dname = doc_field(chunk, "name") or ""
    if exact_name is not None and dname != exact_name:
        continue
    if name_prefix is not None and not dname.startswith(name_prefix):
        continue
    matches.append((dname, chunk.strip("\n")))

if names_only:
    for dname, _ in matches:
        print(dname)
else:
    out = "\n---\n".join(c for _, c in matches)
    if out:
        sys.stdout.write(out + "\n")
