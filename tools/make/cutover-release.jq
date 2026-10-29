def sha: type=="string" and test("^[0-9a-f]{40}$");
def image($name): type=="string" and test("^ghcr.io/rhanka/radar-"+$name+"@sha256:[0-9a-f]{64}$");
.version==1 and (.gitSha|sha) and (.apiImage|image("api")) and (.uiImage|image("ui"))
and .apiServedSha==.gitSha and .uiServedSha==.gitSha[0:7]
and has("dataMigration") and (.dataMigration==null or .dataMigration=="6h")
and ((keys-["version","gitSha","apiImage","uiImage","apiServedSha","uiServedSha","dataMigration"])|length==0)
