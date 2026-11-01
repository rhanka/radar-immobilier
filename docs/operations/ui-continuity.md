# UI continuity: coordination worker and local state v1

The production UI enables `/immo-sw.js`, scope `/`, only on
`https://preprod.immo.sent-tech.ca`. Registration follows application mount,
uses `updateViaCache: "none"`, and never blocks authentication or navigation.
Ordinary local/QA origins do not register. The dedicated Playwright HTTP fixture
uses an injected runtime probe; it is not a production build input.

## Authorities and compatibility

- Browser preferences: `radar.beta.evaluation` (`true`/absence),
  `chatWidgetDisplayMode` (`docked`/`floating`), `signaux-show-lot-labels`
  (`1`/`0`, default false), `signaux-show-zone-labels` (`1`/`0`, default true).
  Their embedded contract is `immo.ui.preferences@1.0.0`; no scalar migration.
- URL: navigation, selection, filters and viewport in the current tab. A link
  with no filters keeps product defaults. The initial basemap remains Plan.
- Server: memberships, authorization, classification and baskets. A stored
  workspace identifier is only a suggestion, revalidated before explicit use.
- Context schema: `immo.ui.context@1.0.0`; session schema:
  `immo.ui.session@1.0.0`; transport: `immo.ui.sync.v1`, protocol 1.
  The executable codecs and interfaces live in `ui/src/lib/sync/`.
- `clientBuildId` identifies loaded bundle bytes, `workerBuildId` identifies
  worker bytes; both are stamped from `GIT_SHA` during the image build.
  Neither is inferred from the currently served `build.json`.

Each page instance writes its own context under
`immo.ui.context.v1.<partition>.<workspaceId>.<tabId>`. Navigation writes are
debounced by 250 ms, capped at 32 KiB, 32 retained records, and 24 hours.
The partition is SHA-256 of origin plus validated account subject, without
persisting the subject itself. It is pseudonymous data, not protection from
same-origin scripts. Browser storage does not imply Québec data residency.

Preferences converge by invalidation and canonical-key re-read through storage
events and BroadcastChannel. Receiving never rewrites a value. Contexts appear
under “Reprendre un contexte”; adoption rechecks schema, epoch, account and fresh
workspace memberships, then calls workspace selection and router methods.
The resulting URL is an ordinary browser-history entry. Text searches,
`showDiscarded`, unknown filters, chat contents and transient UI commands are
excluded. The resume UI labels partial contexts. No route changes automatically.

Logout first suspends publication, changes the epoch and purges affected context
keys. Other tabs suspend and independently revalidate `/auth/me`; a generation
guard discards authentication responses launched before invalidation. A logout
tombstone cannot silently reactivate the same account: the explicit login action
prepares a fresh local session. Visibility/pageshow/online revalidate before
publication resumes. Unknown versions are ignored without overwriting their
bytes; explicit logout purge is a distinct operation. No destructive migration
or down-migration is performed in v1. Storage refusal/quota failures disable
writes for that page; the application remains usable in memory.
Invalidation hints name the affected partition and epoch, so a late hint cannot
cancel a fresh login. Available transports still notify peers if storage writes
fail. Re-reading an existing approved epoch never rewrites its record.
Suspending publication for wake authentication retains the previous epoch's
ownership: logout still invalidates it, and a concurrent newer login and its
contexts remain intact.

## Worker update and rollback

The worker validates browser window clients and exchanges a closed protocol over
MessageChannel: presence/build negotiation, ping, scoped invalidation, session
invalidation, compatible activation and neutralization. Invalidations carry hints
only. Same-origin browser provenance does not establish account identity or
business permissions. There is no fetch listener, Cache Storage, IndexedDB,
credential, grant, H5 value, operation queue or MCP transport.

1. First installation activates naturally, without `skipWaiting` or
   `clients.claim`. A currently uncontrolled page handshakes with
   `registration.active` directly.
2. A new worker waits. “Recharger cet onglet” flushes the useful route context,
   asks the waiting worker to challenge **all actual browser windows**, including
   uncontrolled clients, then activates only if every live client answers protocol
   1. Unknown, unresponsive, incompatible or newly discovered clients refuse it.
3. Only the requesting tab reloads, once. Other tabs retain their JavaScript and
   drafts. A controller change re-handshakes without reloading. Focus/online and
   every operation re-handshake, so stopping the worker loses no essential state.
   Installing/waiting transitions do not contact the retiring worker; the client
   handshakes with its replacement only after activation has completed.
4. Normal rollback republishes the previous image/worker bytes at the same stable
   URL. Preserve that image digest and `GIT_SHA`. Recheck the served worker,
   waiting/active lifecycle and client/worker versions, including an older tab.
5. Neutralization builds the image with `IMMO_SW_ENABLED=false`. This both disables
   new registrations and replaces the stable script with the dedicated kill
   worker generated by `buildDisabledWorkerSource`. The disabled client still
   updates an existing registration. Kill bytes skip waiting solely to disable,
   notify all windows with `DISABLED`, and unregister. They never claim clients.
6. Unregister does not instantly remove an open page's controller. The kill worker
   remains a pass-through; open pages remain usable. Keep serving kill bytes
   during convergence. Closed/offline browsers converge only after returning.

## Serving and qualification

Compose, cluster and preprod nginx variants have an exact root-script location:
JavaScript MIME, `expires -1` (`Cache-Control: no-cache`), and `try_files ... =404`.
No local `add_header` shadows the inherited security headers under nginx 1.27.
No `Service-Worker-Allowed` expansion or artifact CSP change is needed. The
prepared preprod CSP fix is merged with its original commit ancestry preserved.

Use `make -f tools/ui-continuity.mk <target> ENV=test-...` for `test-ui`,
`typecheck`, `lint`, `test-api`, `test-immo-mcp` and `test-e2e`. The wrapper avoids
loading `.env`, isolates dependency volumes and invokes the existing real-stack
Playwright target/runner. Every campaign uses `down -v` on exit. No test publishes
host ports. The synthetic Playwright fixture serves changing bytes at the stable
URL; tests exercise the production client and worker, not a mocked SW API.
The disposable wrapper puts dependencies, temporary files and synthetic database
data in memory. API tests use a `git archive HEAD` snapshot with workspace links
remapped to that source; untracked files are excluded. This avoids measured host
disk stalls without changing test deadlines or assertions.

An isolated candidate is not a deployed-preprod receipt. Promotion must verify
the actual preprod responses for `/immo-sw.js` and a missing JS asset, the served
build IDs, update refusal/activation, rollback and neutralization. No deployment
or cutover is part of this branch.

## Follow-ups

MCP relay, cross-origin/pinned-release continuity, a reader broker, remote state
replication, DS asset caching and schema governance in Engram remain separate
iterations. No artifact opening, DS guide, hostConfig transport or H5 helper was
changed here.
