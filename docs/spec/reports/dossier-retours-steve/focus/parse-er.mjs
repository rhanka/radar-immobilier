// Bounded parser for the Mermaid `erDiagram` subset of this dossier. Unknown syntax fails.
//   left |o--o{ right : label      relation; `--` identifying (key), `..` without foreign key
//   name { type column [PK|FK|UK[, …]] ["comment"] }
// Cardinality of each end: one (||), zero-or-one (|o / o|), zero-or-many (}o / o{),
// one-or-many (}| / |{).

const LEFT = { '||': 'one', '|o': 'zero-or-one', '}o': 'zero-or-many', '}|': 'one-or-many' };
const RIGHT = { '||': 'one', 'o|': 'zero-or-one', 'o{': 'zero-or-many', '|{': 'one-or-many' };
const RELATION = /^([A-Za-z_][\w]*)\s+(\|\||\|o|\}o|\}\|)(--|\.\.)(\|\||o\||o\{|\|\{)\s+([A-Za-z_][\w]*)\s*:\s*([\w-]+)$/;
const ATTRIBUTE = /^([a-z][\w]*)\s+([a-z_][\w]*)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?$/;

export function parseEr(source, id) {
  const entities = new Map(), relations = [];
  let open = null;
  const entity = name => {
    if (!entities.has(name)) entities.set(name, { id: name, attributes: [] });
    return entities.get(name);
  };
  for (const [offset, original] of source.replace(/\r\n?/g, '\n').split('\n').entries()) {
    const line = original.trim(), lineNumber = offset + 1;
    if (!line || line === 'erDiagram' || line.startsWith('%%')) continue;
    if (open) {
      if (line === '}') { open = null; continue; }
      const match = line.match(ATTRIBUTE);
      if (!match) throw Error(`${id}:${lineNumber} unsupported attribute: ${line}`);
      open.attributes.push({ type: match[1], name: match[2], keys: match[3] ? match[3].split(',').map(key => key.trim()) : [], comment: match[4] ?? '' });
      continue;
    }
    const block = line.match(/^([A-Za-z_][\w]*)\s*\{$/);
    if (block) { open = entity(block[1]); if (open.declared) throw Error(`${id}:${lineNumber} duplicate entity ${block[1]}`); open.declared = true; continue; }
    const relation = line.match(RELATION);
    if (!relation) throw Error(`${id}:${lineNumber} unsupported: ${line}`);
    entity(relation[1]); entity(relation[5]);
    relations.push({ id: `${relation[1]}__${relation[6]}__${relation[5]}`, source: relation[1], target: relation[5], label: relation[6],
      sourceCardinality: LEFT[relation[2]], targetCardinality: RIGHT[relation[4]], identifying: relation[3] === '--', line: lineNumber });
  }
  if (open) throw Error(`${id}: unclosed entity ${open.id}`);
  const ids = relations.map(relation => relation.id);
  if (new Set(ids).size !== ids.length) throw Error(`${id}: duplicate relation`);
  for (const item of entities.values()) {
    if (!item.declared) throw Error(`${id}: entity ${item.id} has no column block`);
    delete item.declared;
  }
  return { entities: [...entities.values()], relations };
}
