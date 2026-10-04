# Prompt selection rule (written before the v2 run)

Fixed on 2026-10-04 after the v1 optim run and before any v2 run, so the choice of the final
prompt cannot be tuned to the outcome.

1. Only `optim` results are used. `blind` is run once, with the selected prompt, after
   `final-prompt.json` is written; its result is reported whatever it is.
2. Candidates: every `prompt-c-v*.md` run on the full optim set with the three models.
3. Hard constraint (Steve's asymmetry reserve): the total number of Steve-"Pertinent" items hidden
   (predicted "Non pertinent"), summed over the three models, must not exceed that of v1 (8).
4. Among the candidates meeting 3, select the highest mean 3-class accuracy over the three models;
   ties → lower summed noise in the default view; then the earlier version.
5. At most three iterations (v1, v2, v3) on 60 optim items, to limit overfitting to optim.
