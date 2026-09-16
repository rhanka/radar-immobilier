# v101b replay freeze

v101b reuses the v101 corpus, prompts, schemas, validators, profiles, arms, and intended 32,768-token cap. llm-mesh changes to 0.19.3. The original Codex run attempted wire enforcement, but the ChatGPT Codex backend rejected `max_output_tokens` at both 32,768 and 4,096. The isolated Codex replay therefore omits the unsupported member and records `cap.enforced=false` in every receipt.

GPT-4.1 and Mistral Small 4 artifacts are copied byte-for-byte from v101; the other 24 arms rerun.

Source v101 manifest SHA-256: `33ecc18a28112fae79db72c9866653108f5658edc20a17c796b68ab1a1eb5048`. The 32-token Codex probe materialized the cap but received HTTP 400, so output truncation was not observed.

The replay gate is transport-only: an arm opens when at least two of its three
probes return HTTP 200 with exploitable JSON and none returns HTTP 400. Quality
acceptance is deliberately excluded from the gate. An arm opens its circuit
after three consecutive failures with the same code; two consecutive arm
circuits stop the provider queue. Replay artifacts and their atomic status live
under `codex-replay/`, with an atomic public copy at `status-codex.json`.
