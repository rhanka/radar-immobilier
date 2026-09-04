# Grounding image (citations pipeline) — PUBLISH-ONLY (plan 4.4.3, ruling
# WP14/i-infra). There is no in-cluster llm-mesh endpoint (budget not applied), so
# the pod does NOT call an LLM. The validated grounding runs on the HOST, which
# stages a candidate; the IN-CLUSTER Job only: pulls the candidate, hash-verifies
# it, and publishes it to the preprod MinIO (graph/<city>/latest.json). So the
# image needs NO LLM-CLI, NO mesh access, NO pdftotext, NO node graphify tooling —
# only the publish runtimes.
#
# radar-api:latest still can't do this (it lacks python3/s5cmd/jq), hence a
# dedicated image, built + pushed to the SCW registry like radar-api.
#
# Measured deps of tools/grounding/publish-citation-grounding.sh: s5cmd (pull +
# publish), jq, python3 (candidate JSON). hash-verify = sha256sum (coreutils, in
# base) / python3 hashlib. debian-slim base (no node needed → leaner than the
# api's node base).
FROM debian:bookworm-slim

# Publish-only runtimes (least-tools): python3 + jq (candidate JSON), sha256sum
# (coreutils, base) for hash-verify, ca-certificates + curl (s5cmd fetch).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 jq ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# s5cmd (pinned) — pull the host-staged candidate + publish the grounded graph
# to the preprod MinIO.
ARG S5CMD_VERSION=2.2.2
RUN curl -fsSL "https://github.com/peak/s5cmd/releases/download/v${S5CMD_VERSION}/s5cmd_${S5CMD_VERSION}_Linux-64bit.tar.gz" \
      | tar -xz -C /usr/local/bin s5cmd \
 && s5cmd version

# The grounding publish tooling (pull + hash-verify + publish). tools/graphify-v23
# and the LLM/pdftotext stages are HOST-side (not in this publish-only image).
WORKDIR /workspace
COPY tools/grounding /workspace/tools/grounding

# No default ENTRYPOINT/CMD — the grounding-citation Job (41-…, extraction #588,
# publish-only) sets the command (publish-citation-grounding.sh with a city).
