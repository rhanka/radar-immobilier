# Grounding image (citations pipeline) — a DEDICATED image for the
# grounding-citation Job. radar-api:latest CANNOT run the grounding (it ships
# only node + poppler; it lacks python3 / s5cmd / jq / an LLM-CLI). Built + pushed
# to the SCW registry like radar-api, and pinned by digest at deploy.
#
# Base node:24-bookworm-slim (matches api/Dockerfile) — the grounding pipeline
# needs BOTH node (tools/graphify-v23/*.js) AND python3 (tools/grounding/*.py),
# plus jq + poppler-utils (pdftotext) + s5cmd (S3 read raw PDFs / publish graph).
#
# ⚠ LLM STAGE — TBD (i-infra architecture ruling, NOT finalized here). The
# grounding STAGE2 LLM is host-side today (codex CLI -> llm-mesh -> gpt-5.6-luna).
# Whether the PREPROD Job runs the LLM IN the pod (→ an LLM-CLI installed here +
# mesh access) or calls out to llm-mesh is an i-infra decision. This is a
# SKELETON: it installs the deterministic POD runtimes only and leaves the
# LLM-CLI deliberately UNSET (a missing/wrong LLM tool must not ship silently).
# i-infra certifies the runtimes before any de-INERT; the LLM line is finalized
# in a follow-up once i-infra rules.
FROM node:24-bookworm-slim

# Deterministic pod runtimes (least-tools): python3 (grounding *.py), jq,
# poppler-utils (pdftotext), ca-certificates + curl (s5cmd fetch). node is in the
# base image (graphify-v23 *.js). i-infra certifies these runtimes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-venv jq poppler-utils ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# s5cmd (pinned) — S3 read (raw PDFs) + publish (grounded graph → MinIO/SCW).
ARG S5CMD_VERSION=2.2.2
RUN curl -fsSL "https://github.com/peak/s5cmd/releases/download/v${S5CMD_VERSION}/s5cmd_${S5CMD_VERSION}_Linux-64bit.tar.gz" \
      | tar -xz -C /usr/local/bin s5cmd \
 && s5cmd version

# ── LLM-CLI: PLACEHOLDER (i-infra to finalize) ────────────────────────────────
# If the preprod Job runs the LLM IN-POD, install the chosen CLI here, e.g.:
#   RUN <install the chosen LLM-CLI>   # <-- TBD i-infra: which CLI + llm-mesh access
# Left UNSET on purpose (see header). Do NOT de-INERT the grounding Job until this
# is finalized + i-infra-certified.

# Grounding + graphify-v23 tooling (bash + node + python). Build context = repo
# root so these paths resolve.
WORKDIR /workspace
COPY tools/grounding    /workspace/tools/grounding
COPY tools/graphify-v23 /workspace/tools/graphify-v23

# No default ENTRYPOINT/CMD — the grounding Job (41-grounding-citation-job.yaml,
# authored by extraction #588) sets the command (e.g. drive-grounding.sh with a
# city arg).
