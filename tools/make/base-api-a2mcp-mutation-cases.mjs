const adapter = "packages/immo-mcp/src/data-source.ts";
const errorSuite = "tests/integration/a2base-mcp-errors.spec.ts";
const authority = "tests/integration/a2base-mcp-authority.spec.ts";
const visible = "tests/integration/a2base-mcp-visibility.spec.ts";
const search = "api/src/services/facets/mcp-signal-search.ts";
const receiver = "tests/integration/a2base-mcp-receiver.spec.ts";
const errorAnchor = "if (res.status !== 200) throw await decodeSignalReadError(res);";
export const cases = [
  ...[503, 410, 404].map((status) => [`empty-${status}`, adapter, errorAnchor,
    `if (res.status === ${status}) return []; ${errorAnchor}`, errorSuite, `preserves ${status} as`]),
  ["empty-payload", adapter,
    "return parseSignalSearchResponse(body, { city: slug, limit: args.limit, workspaceId: args.workspaceId });",
    "return [];", errorSuite, "preserves 200 as"],
  ["legacy-route", "packages/immo-mcp/src/signal-search-response.ts",
    '"/api/v1/mcp/facets/signals/search"', '"/api/graph-signals/synthetic-city"', visible,
    "allows a validated empty city"],
  ["personal-mask", search, "archive.filter((row) => row.effectiveDiscarded)",
    'archive.filter((row) => row.workspace?.state === "active")', visible, "masks personal OR common archives"],
  ["common-mask", search, "archive.filter((row) => row.effectiveDiscarded)",
    'archive.filter((row) => row.personal?.state === "active")', visible, "masks personal OR common archives"],
  ["revoked-membership", "api/src/services/workspaces/store.ts", 'eq(workspaceMemberships.status, "active")',
    "eq(workspaceMemberships.status, workspaceMemberships.status)",
    "tests/integration/mcp-signal-search-workspace.spec.ts", "resolves only 0/1/N current memberships without substituting a selector"],
  ["approval", "api/src/routes/auth.ts", 'if (exchangedStatus !== "approved")',
    "if (false)", authority, "current approval is revoked"],
  ["original-bearer", "packages/immo-mcp/src/authorized-egress.ts", "return { accessToken: validated.token };",
    "return { accessToken: input.subjectToken };", authority, "current membership is revoked"],
  ["authorization-invalidation", "packages/immo-mcp/src/tool-handlers.ts",
    "(error.upstreamStatus === 401 || error.upstreamStatus === 403)", "false", authority, "current membership is revoked"],
  ["receiver-prefix", "api/src/artifacts/strict-receiver.ts", "rawPath !== MCP_SIGNAL_SEARCH_PATH",
    "!rawPath.startsWith(MCP_SIGNAL_SEARCH_PATH)", receiver, "refuses legacy, prefix, encoded"],
  ["receiver-duplicates", "api/src/artifacts/strict-receiver.ts", "decodeMcpSignalSearch(query)",
    "decodeMcpSignalSearch(new URLSearchParams(Object.fromEntries(query)))", receiver, "refuses legacy, prefix, encoded"],
];
