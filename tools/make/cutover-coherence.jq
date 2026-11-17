# Post-restore coherence (preprod): the database and the PG-coupled S3 prefixes
# (graph/, refresh/018/) must come from the same pinned backup snapshot, and the
# mirror prefixes must hold nothing outside it. Input: the operation record.
# Output: {ok, reasons, mirrorAnomalies}. Any reason refuses; an old verdict without the mirror
# counters is refused too (it never proved the mirror).
. as $r | ($r.pin // {}) as $pin | ($r.jobs.restore.verdict // {}) as $db
| ($r.jobs.docs.verdict // {}) as $docs | ($r.jobs.recon.verdict // {}) as $recon
| [
  (if ($pin.date|type) != "string" or ($pin.manifestSha256|type) != "string" then "no backup pin" else empty end),
  (if $db.date != $pin.date or $db.pgSha256 != $pin.pgSha256 then "database not restored from the pinned snapshot" else empty end),
  (if $docs.date != $pin.date or $docs.manifestSha256 != $pin.manifestSha256 then "documents not restored from the pinned snapshot" else empty end),
  (if ($docs.copyErrors // 0) > 0 or ($docs.deleteErrors // 0) > 0 then "document mirror incomplete" else empty end),
  (if $recon.date != $pin.date or $recon.manifestSha256 != $pin.manifestSha256 then "recon did not check the pinned snapshot" else empty end),
  (if ($recon.mirrorExtra|type) != "number" then "recon did not check the mirror prefixes"
   elif $recon.mirrorExtra > 0 then "mirror prefixes hold \($recon.mirrorExtra) object(s) outside the snapshot" else empty end),
  (if ($recon.mirrorAnomalies|type) != "number" then "recon did not count non-canonical mirror keys"
   elif $recon.mirrorAnomalies > 0 then "mirror prefixes hold \($recon.mirrorAnomalies) non-canonical object(s) readable by listing readers" else empty end),
  (if ($recon.missing // 1) > 0 or ($recon.sizeMismatch // 1) > 0 then "snapshot documents missing or different" else empty end)
] | {ok: (length == 0), reasons: ., mirrorAnomalies: ($recon.mirrorAnomalies // null)}
