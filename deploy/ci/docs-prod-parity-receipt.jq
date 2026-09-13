def sha256: type == "string" and test("^[0-9a-f]{64}$");

.processed == 59017 and .logicalBytes == 12534514457 and .failed == 0 and
.canonicalDigest == $digest and .sourceVerifiedObjects == 59017 and
.sourceVerifiedBytes == 12534514457 and .sourceManifestDigest == $digest and
.targetVerifiedObjects == 59017 and .targetVerifiedBytes == 12534514457 and
.sourceExact == true and .targetExactParity == true and .exactParity == true and .complete == true and
(.conditionalWriteProofDigest | sha256) and (.destinationIdentityFingerprint | sha256) and
((.sourceObservedAt | fromdateiso8601) as $source |
 (.targetObservedAt | fromdateiso8601) as $target |
 (.completedAt | fromdateiso8601) as $completed | now as $now |
 $source <= $target and $target <= $completed and $completed <= $now and ($now - $source) <= 172800)
