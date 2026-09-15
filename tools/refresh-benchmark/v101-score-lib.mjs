import { createHash } from "node:crypto";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const normalize = (value) => value.normalize("NFKC").normalize("NFD")
  .replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function parseExtraction(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

export function normalizeExtraction(extraction, document) {
  const contractViolation = "contract_version" in extraction
    && extraction.contract_version !== "immo-pv-extraction-v9"
    ? { path: "contract_version", code: "contract_version_mismatch" } : null;
  delete extraction.contract_version;
  const identity = { source_file: document.originalKey, rawRef: document.originalKey,
    docSha: document.sha256, sourceUrl: document.sourceUrl, modality: "pdf" };
  for (const entities of [extraction.nodes, extraction.edges]) {
    if (!Array.isArray(entities)) continue;
    for (const entity of entities) {
      if (!Array.isArray(entity?.citations)) continue;
      entity.citations = entity.citations.map((citation) => ({ ...citation, ...identity,
        ...(typeof citation?.excerpt === "string"
          ? { excerpt: [...citation.excerpt].slice(0, 200).join("") } : {}) }));
    }
  }
  return contractViolation;
}

export function provenanceViolations(extraction, document, pages) {
  const violations = [];
  const inspect = (record, path, entityCitation = false) => {
    if (record.source_file !== document.originalKey || record.rawRef !== document.originalKey
      || record.docSha !== document.sha256 || record.sourceUrl !== document.sourceUrl
      || record.modality !== "pdf") violations.push({ path, code: "invalid_pdf_identity" });
    if (!Number.isInteger(record.page) || record.page < 1 || record.page > pages.length) {
      violations.push({ path, code: "invalid_pdf_page" }); return;
    }
    if (typeof record.excerpt !== "string") {
      violations.push({ path, code: "ungrounded_pdf_excerpt" }); return;
    }
    const rawLength = [...record.excerpt].length;
    const normalizedLength = [...normalize(record.excerpt)].length;
    if (entityCitation && (rawLength < 20 || normalizedLength < 12)) {
      violations.push({ path, code: "entity_citation_excerpt_too_short" }); return;
    }
    if (!normalize(pages[record.page - 1] ?? "").includes(normalize(record.excerpt))) {
      violations.push({ path, code: normalizedLength < 12
        ? "excerpt_below_anchor_floor" : "ungrounded_pdf_excerpt" });
    }
  };
  for (const [name, entities] of [["nodes", extraction.nodes], ["edges", extraction.edges]]) {
    (entities ?? []).forEach((entity, entityIndex) => {
      if (entity.source_file !== document.originalKey) {
        violations.push({ path: `${name}[${entityIndex}]`, code: "invalid_entity_source_file" });
      }
      (entity.citations ?? []).forEach((citation, citationIndex) =>
        inspect(citation, `${name}[${entityIndex}].citations[${citationIndex}]`, true));
    });
  }
  (extraction.evidence ?? []).forEach((record, index) => inspect(record, `evidence[${index}]`));
  return violations;
}

export function discardDirect(extraction, path) {
  let match = /^(nodes|edges|evidence)\[(\d+)\]$/u.exec(path);
  if (match) {
    const [record] = extraction[match[1]].splice(Number(match[2]), 1);
    return { kind: { nodes: "node", edges: "edge", evidence: "evidence" }[match[1]],
      id: record?.id ?? null };
  }
  match = /^(nodes|edges)\[(\d+)\]\.citations\[(\d+)\]$/u.exec(path);
  if (!match) throw new Error(`C-prime target is not localizable: ${path}`);
  const entity = extraction[match[1]][Number(match[2])];
  if (!entity) throw new Error(`C-prime entity is absent: ${path}`);
  const [record] = entity.citations.splice(Number(match[3]), 1);
  return { kind: "citation", parentKind: match[1].slice(0, -1),
    parentId: entity.id ?? null, excerptSha256: sha256(record?.excerpt ?? "") };
}

export function cascade(extraction, evidenceNodeTypes) {
  const dropped = [];
  for (;;) {
    const evidenceIds = new Set((extraction.evidence ?? []).map(({ id }) => id));
    for (const entity of [...extraction.nodes, ...extraction.edges]) {
      if (Array.isArray(entity.evidence_refs)) {
        entity.evidence_refs = entity.evidence_refs.filter((id) => evidenceIds.has(id));
      }
    }
    const nodeIds = new Set(extraction.nodes.map(({ id }) => id));
    const badNode = extraction.nodes.findIndex((node) => !node.citations?.length
      || (evidenceNodeTypes.has(node.node_type) && !node.evidence_refs?.length));
    if (badNode >= 0) {
      const [record] = extraction.nodes.splice(badNode, 1);
      dropped.push({ kind: "node", id: record.id, cause: "empty-required-support" }); continue;
    }
    const badEdge = extraction.edges.findIndex((edge) => !edge.citations?.length
      || !edge.evidence_refs?.length || !nodeIds.has(edge.source) || !nodeIds.has(edge.target));
    if (badEdge >= 0) {
      const [record] = extraction.edges.splice(badEdge, 1);
      dropped.push({ kind: "edge", source: record.source, target: record.target,
        relation: record.relation, cause: "empty-or-dangling-support" }); continue;
    }
    return dropped;
  }
}
