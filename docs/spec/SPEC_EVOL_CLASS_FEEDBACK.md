# Human feedback on AI classification

The current AI annotation remains a global projection. Migration 0046 adds its creation date and an append-only history. A database trigger records each new AI projection version, including direct SQL writes. Existing rows are backfilled with their known update date; earlier dates cannot be reconstructed.

Feedback belongs to an approved account and workspace. It records the exact AI provenance judged, the original class, verdict, optional comment and resulting manual decision. Positive feedback validates the same class. Negative feedback requires another actionable class and a catalog reason compatible with that class. Both append feedback and manual facet events in one transaction. Existing personal and workspace writers retain their rights, revisions and epoch checks. Workspace scope supports the existing shared archive capability only.

The API compares the annotation shown to the current annotation. A stale judgement fails with 409. A command key makes retries idempotent. An immutable history reference and snapshot retain provenance after purge or reannotation. Private scoped reads expose the resulting human badge only to the authorized viewer. Evaluation export is workspace scoped and aggregates only visible feedback.

The card offers DS small icon buttons. Negative feedback opens an explicit form. Another class and a compatible reason are mandatory. Cancel writes nothing. Errors keep the form available. The AI badge includes the update date. Human feedback shows validated or reclassified status on private cards.

Validation covers immutable rows, stale provenance, transaction rollback, permissions, human precedence, export aggregation and actual browser clicks in light and dark themes. No merge or live activation is part of this lane.
