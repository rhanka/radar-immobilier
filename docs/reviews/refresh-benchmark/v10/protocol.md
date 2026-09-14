# T1 v10 campaign — LOW with extraction contract v6

- Experimental delta from v9: only T1 profile commit
  `50d91e0e12a0d990a5ba23cb1f01104d01bcbb78` and its derived profile,
  prompt, schema, hash, and byte-size fields.
- The manifest and manual oracle are byte-identical to v9 apart from the
  manifest campaign label.
- Model: `gemini-3.8-flash-tiered`; effort: `LOW`; output cap: 65,536.
- Sequence: one Valcourt control request, then one request for each of the five
  frozen PDFs. The control is excluded from campaign P/R/F1.
- No quality retry and no planned transport retry. Maximum: six Gemini calls.
- Acceptance is reported separately from automatic precision, recall, and F1.
  The oracle scorer admits only `Signal` and `DesignationEvent`; `Bylaw` nodes
  do not count and this scoring contract is unchanged.
- Sonnet is `N-A` unless an Anthropic key is present in the process environment;
  no `.env*` file is read.
