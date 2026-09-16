# v101b replay freeze

v101b reuses the v101 corpus, prompts, schemas, validators, profiles, arms, and 32,768-token cap. Only llm-mesh changes to 0.19.3 and Codex cap enforcement changes to true.

GPT-4.1 and Mistral Small 4 artifacts are copied byte-for-byte from v101; the other 24 arms rerun.

Source v101 manifest SHA-256: `33ecc18a28112fae79db72c9866653108f5658edc20a17c796b68ab1a1eb5048`. The 32-token Codex probe materialized the cap but received HTTP 400, so output truncation was not observed.
