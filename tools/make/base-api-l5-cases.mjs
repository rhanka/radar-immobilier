export const cases = [
  ["L5-real-authority-fence", "services/facets/pw-write-fences.ts",
    "await lockPublishedWriteAuthority(tx, fences);", "void fences;",
    "tests/integration/l5-published-write.spec.ts", "should refuse confirmation and mask business summary after actual artifact ACL withdrawal"],
  ["L5-bootstrap-workspace", "artifacts/published-write-bootstrap.ts",
    "await readFacetContext(options.db, reader.session.readerSub, selected.data);", "void selected;",
    "tests/integration/l5-bootstrap.spec.ts", "should require an explicit workspace and matching read grant, then recheck membership"],
  ["L5-bootstrap-reader", "artifacts/published-write-bootstrap.ts",
    "claims.readerSub !== reader.session.readerSub", "false",
    "tests/integration/l5-bootstrap.spec.ts", "should reject a valid signed read grant bound to another reader"],
];
