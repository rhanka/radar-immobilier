# PG-coupled schedules (config preprod.coherenceSchedules, radar-refresh-pv) after an
# operation: `release` when the live database and the mirrored S3 prefixes are proven
# to share one snapshot; `hold` (stay suspended) when documents were mirrored but the
# live database was not replaced by that snapshot; `keep` otherwise.
# Input: the record; $cfg: deploy/cutover/config.json; $env: preprod|prod.
if $env != "preprod" then {decision: "keep", hold: []}
elif (.mode == "restore" and .restoreAborted != true and .coherence.ok == true)
  or (.kind == "cutover" and (.mode // "run") != "restore" and .checkpoints.switch == "completed")
then {decision: "release", hold: []}
elif .jobs.docs != null then {decision: "hold", hold: ($cfg.preprod.coherenceSchedules // [])}
else {decision: "keep", hold: []} end
