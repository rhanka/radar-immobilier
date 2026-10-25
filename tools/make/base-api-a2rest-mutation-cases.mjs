const workspace = "api/src/services/facets/mcp-signal-workspace.ts";
const search = "api/src/services/facets/mcp-signal-search.ts";
const authority = "tests/integration/mcp-signal-search-facade-authority.spec.ts";
const races = "tests/integration/mcp-signal-search-facade-races.spec.ts";
const archives = "tests/integration/mcp-signal-search-facade-archives.spec.ts";
const projection = "src/services/facets/mcp-signal-result.test.ts";
export const cases = [
  ["selector-substitution", workspace,
    'if (!ids.includes(parsed.data)) throw new ScopeError(403, "workspace_not_authorized");',
    "if (!ids.includes(parsed.data)) return ids[0];", authority, "resolves zero, one and several memberships"],
  ["membership-set", workspace, "const current = await resolveMcpSignalWorkspace(db, sub, selector);",
    "const current = workspaceId;", races, "rejects added authority after documentary enrichment starts"],
  ["revoked-memberships", "api/src/services/workspaces/store.ts", 'eq(workspaceMemberships.status, "active")',
    "eq(workspaceMemberships.status, workspaceMemberships.status)", authority, "resolves zero, one and several memberships"],
  ["approval", "api/src/services/workspaces/store.ts", 'eq(accountUsers.status, "approved")',
    "eq(accountUsers.status, accountUsers.status)", races, "rejects unapproved authority after documentary enrichment starts"],
  ["personal-mask", search, "archive.filter((row) => row.effectiveDiscarded)",
    'archive.filter((row) => row.workspace?.state === "active")', archives, "masks personal OR common archives"],
  ["common-mask", search, "archive.filter((row) => row.effectiveDiscarded)",
    'archive.filter((row) => row.personal?.state === "active")', archives, "masks personal OR common archives"],
  ["post-enrichment-revisions", "api/src/services/facets/projection-revisions.ts",
    "if (before.token === after.token) return { scope: after, payload };", "if (true) return { scope: after, payload };",
    races, "discards stale source cards and reuses the documentary cache on retry"],
  ["request-document-context", search, "enrichment ??= createDocEnrichmentContext(deps.docEnrichmentBudgetMs);",
    "enrichment = createDocEnrichmentContext(deps.docEnrichmentBudgetMs);",
    "tests/integration/mcp-signal-search-document-budget.spec.ts", "shares one deadline and cache across retries"],
  ["limit-before-filters", "api/src/services/facets/mcp-signal-result.ts", "return cards.map(",
    "return cards.slice(0, args.limit).map(", projection, "filters the entire population before limit"],
  ["lost-firm-status", "api/src/services/facets/mcp-signal-result.ts", "regulatoryStatus: node.regulatoryStatus,",
    'regulatoryStatus: "anticipation",', projection, "preserves nested business fields"],
  ["open-binding", "api/src/routes/mcp-signal-search.ts", "!deps.mcpSignalSearch?.enabled || !deps.db",
    "!deps.db", "tests/integration/mcp-signal-search-facade.spec.ts", "keeps the binding closed by default"],
];
