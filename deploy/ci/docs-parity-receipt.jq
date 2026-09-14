def sha256: type == "string" and test("^[0-9a-f]{64}$");
def rfc3339_epoch:
  capture("^(?<seconds>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\\.(?<fraction>[0-9]+))?Z$") as $ts
  | (($ts.seconds + "Z" | fromdateiso8601) +
     (if $ts.fraction == null then 0 else ("0." + $ts.fraction | tonumber) end));

.schemaVersion == 1 and .expected == 59017 and .processed == 59017 and .matching == 59017 and
.copied == 0 and .failed == 0 and .prunedExtra == 0 and .logicalBytes == 12534514457 and
(.elapsedSeconds | type) == "number" and (.opsPerSecond | type) == "number" and
(.logicalMiBPerSecond | type) == "number" and .etaSeconds == 0 and
.canonicalDigest == $digest and .sourceVerifiedObjects == 59017 and
.sourceVerifiedBytes == 12534514457 and .sourceManifestDigest == $digest and
.targetVerifiedObjects == 59017 and .targetVerifiedBytes == 12534514457 and
.sourceExact == true and .targetExactParity == true and .exactParity == true and .complete == true and
(.conditionalWriteProofDigest | sha256) and (.destinationIdentityFingerprint | sha256) and
((.sourceObservedAt | rfc3339_epoch) as $source |
 (.targetObservedAt | rfc3339_epoch) as $target |
 (.completedAt | rfc3339_epoch) as $completed | now as $now |
 $source <= $target and $target <= $completed and $completed <= $now and ($now - $source) <= 172800)
