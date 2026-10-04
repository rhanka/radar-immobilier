// Paste-ready YAML export of the decisions, for a GitHub PR comment or card.
// No dependency: a small emitter for the fixed schema agreed with h-cond.
//   header    dossier, fichier, version, decideur, date (ISO-8601 with offset), coller_dans
//   decisions id, titre, role (decide | valide), decide, consulte, option, option_libelle,
//             statut (tranchee | differee | non_traitee), commentaire (literal block `|`)
// Keys are ASCII. Rule "no quotes": no double (or single) quoted scalar is ever written.
// A string stays a plain scalar whenever YAML reads it back as that same string;
// otherwise it becomes a folded block `>-` (one line) or a literal block `|-`
// (several lines). The commentaire is always a literal block `|`.

export const STATUSES = ['tranchee', 'differee', 'non_traitee'];
export const ROLES = ['decide', 'valide'];

// A plain scalar may not start with a YAML indicator character.
const RESERVED_START = /^[-?:,[\]{}#&*!|>'"%@`]/;
// Inside a plain scalar, `: ` starts a mapping value and ` #` a comment; a final `:` too.
const BREAKS_PLAIN = /: |\s#|:$/;
// Plain words that a YAML 1.1 / 1.2 reader would not load as a string.
const NON_STRING = /^(?:~|null|true|false|yes|no|on|off|y|n|[-+]?\.(?:inf|nan))$/i;
// Numbers, dates and times all start with a digit (optionally signed or dotted).
const NUMBER_LIKE = /^[-+.]?\d/;
// Characters a YAML stream may not carry raw (C0 except tab and line feed, DEL, C1,
// line/paragraph separators, BOM). Without quoted scalars they cannot be escaped:
// they are dropped before emission (they never occur in the dossier's own strings).
const NON_PRINTABLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u{2028}\u{2029}\u{feff}]/gu;

const clean = value => String(value).replace(/\r\n?/g, '\n').replace(NON_PRINTABLE, '');

export const isPlainSafe = text => text.length > 0
  && text === text.trim()
  && !/[\t\n]/.test(text)
  && !BREAKS_PLAIN.test(text) && !RESERVED_START.test(text)
  && !NON_STRING.test(text) && !NUMBER_LIKE.test(text);

// Block scalar body: every content line indented by `indent` spaces; a first line
// starting with a space needs an explicit indentation indicator (always 2: the body
// sits two spaces right of its key).
const blockBody = (style, text, indent) => {
  const pad = ' '.repeat(indent);
  const indicator = text.startsWith(' ') ? `${style[0]}2${style.slice(1)}` : style;
  return `${indicator}\n${text.split('\n').map(line => (line ? pad + line : '')).join('\n')}`;
};

// `indent` = indentation of the block body (key indentation + 2).
export function yamlScalar(value, indent = 2) {
  if (value === null || value === undefined) return 'null';
  const text = clean(value);
  if (isPlainSafe(text)) return text;
  // One line: folded block, no final line break (`>-`). Several lines: literal `|-`,
  // which keeps every line break (a folded block would join them).
  if (!text.includes('\n')) return blockBody('>-', text, indent);
  return blockBody('|-', text, indent);
}

// Literal block (`|`) for free text. Line endings are normalised, leading blank lines
// and trailing whitespace are dropped. Every content line is indented by `indent`
// spaces (>= 4 here), so a line such as ``` never closes the surrounding Markdown fence.
export function yamlBlock(value, indent) {
  const text = clean(value ?? '').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
  if (!text) return '|';
  return blockBody('|', text, indent);
}

// Local time with its UTC offset, e.g. 2026-10-04T14:05:09-04:00.
export function isoWithOffset(date = new Date()) {
  const two = number => String(Math.trunc(Math.abs(number))).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
    + `T${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
    + `${offset >= 0 ? '+' : '-'}${two(offset / 60)}:${two(offset % 60)}`;
}

// Role of `person` on a question: decider, named validator, or neither (consulted only,
// informed, or not involved).
export const roleOf = (question, person) => question.decides === person ? 'decide'
  : (question.validators ?? []).includes(person) ? 'valide' : null;

// One record per decision. scope 'mine' keeps the decisions where `person` decides or
// carries a named validation; scope 'all' keeps every decision (role may then be null).
export function decisionRecords(questions, { selections = {}, comments = {}, deferred = {} } = {}, person, scope = 'mine') {
  return questions.flatMap(question => {
    const role = roleOf(question, person);
    if (scope === 'mine' && !role) return [];
    const raw = selections[question.key];
    const picked = (Array.isArray(raw) ? raw : [raw]).filter(value => value !== null && value !== undefined);
    const options = picked.map(key => {
      const option = question.options.find(item => item.key === key);
      if (!option) throw Error(`Unknown option ${key} for ${question.key}`);
      return option;
    });
    return [{
      id: question.key,
      titre: question.question.replace(/^D\d+ — /, ''),
      role,
      decide: question.decides,
      consulte: question.consulted,
      option: options.length ? options.map(option => option.key).join(', ') : null,
      option_libelle: options.length ? options.map(option => option.title).join(' ; ') : null,
      statut: deferred[question.key] ? 'differee' : options.length ? 'tranchee' : 'non_traitee',
      commentaire: comments[question.key] ?? '',
    }];
  });
}

const HEADER_KEYS = ['dossier', 'fichier', 'version', 'decideur', 'date', 'coller_dans'];
const RECORD_KEYS = ['titre', 'role', 'decide', 'consulte', 'option', 'option_libelle', 'statut'];

export function decisionsYaml(header, records) {
  const lines = HEADER_KEYS.map(key => `${key}: ${yamlScalar(header[key], 2)}`);
  if (!records.length) return [...lines, 'decisions: []'].join('\n');
  lines.push('decisions:');
  for (const record of records) {
    lines.push(`  - id: ${yamlScalar(record.id, 6)}`);
    for (const key of RECORD_KEYS) lines.push(`    ${key}: ${yamlScalar(record[key], 6)}`);
    lines.push(`    commentaire: ${yamlBlock(record.commentaire, 6)}`);
  }
  return lines.join('\n');
}

// What the copy button puts in the clipboard: a fenced block GitHub renders as YAML.
export const markdownBlock = yaml => `\`\`\`yaml\n${yaml}\n\`\`\``;
