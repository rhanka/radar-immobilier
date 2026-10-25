def text: type == "string" and length > 0 and length <= 512 and (explode|all(.[]; .>=32 and .!=127));
def uuid: text and test("^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$") and . != "00000000-0000-0000-0000-000000000000";
def sha: type == "string" and test("^[a-f0-9]{64}$") and (test("^0+$")|not);
def name: text and test("^[a-z0-9]([-a-z0-9]*[a-z0-9])?$") and length <= 63;
def bound($b): .binding == $b;
def fresh: type == "string" and (try (sub("\\.[0-9]+Z$";"Z")|fromdateiso8601 as $t | $t <= now and $t >= now-86400) catch false);
def reference: .reference|text;
def attestation: reference and (.sha256|sha) and (.observedAt|fresh);
def valid:
  ([..|strings|test("<|>|placeholder|replace.me|changeme|todo|\\$\\{";"i")]|any|not)
  and (.context|text) and .namespace == "radar-immobilier-preprod"
  and (.image|text and test("^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$"))
  and (.image|split(":")|last|sha)
  and (.jobName|name and startswith("base-operator-"))
  and ((.binding.workspaceId|uuid) or ((.operation=="init" or .operation=="inspect")
    and .binding.workspaceId==null and (.workspaceSlug|text) and .binding.workspaceSlug==.workspaceSlug))
  and (.binding.actorSub|text)
  and (.binding.maintenanceAttemptId|uuid)
  and (.binding.releaseId|text and test("^[a-f0-9]{40}[:/][a-zA-Z0-9._:-]+$"))
  and (.reason|text) and (.repository|text and test("^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$"))
  and (.database.database|text) and (.database.role|text) and (.database.schema|text)
  and (.database|keys)==["database","role","schema"]
  and (.binding|keys-["workspaceId","workspaceSlug","actorSub","maintenanceAttemptId","releaseId"]|length)==0
  and (.backup|reference and (.sha256|sha) and (.restoredAt|fresh) and (.restoreReceiptSha256|sha))
  and (.operation|IN("inspect","init","attach","activate","resume"));
valid
