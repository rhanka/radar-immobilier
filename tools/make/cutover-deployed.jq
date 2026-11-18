# Snapshot of the release SERVED before a cutover: the rollback target.
# Unlike a promoted manifest (cutover-release.jq), API and UI may come from
# different commits (production 2026-11-18: API b7724bd, UI 8cb2945); each one
# is pinned by its own digest and its own served sha.
def sha: type=="string" and test("^[0-9a-f]{40}$");
def image($name): type=="string" and test("^ghcr.io/rhanka/radar-"+$name+"@sha256:[0-9a-f]{64}$");
.version==1 and (.gitSha|sha) and (.apiImage|image("api")) and (.uiImage|image("ui"))
and .apiServedSha==.gitSha and (.uiServedSha|type=="string" and test("^[0-9a-f]{7,40}$"))
and has("dataMigration") and .dataMigration==null
and ((keys-["version","gitSha","apiImage","uiImage","apiServedSha","uiServedSha","dataMigration"])|length==0)
