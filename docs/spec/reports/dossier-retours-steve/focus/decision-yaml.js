// Paste-ready YAML export of the decisions, for a GitHub PR comment or card.
// No dependency: a small emitter for the fixed schema agreed with h-cond.
//   header    dossier, fichier, version, decideur, date (ISO-8601 with offset), coller_dans
//   decisions id, titre, role (decide | valide), decide, consulte, option, option_libelle,
//             statut (tranchee | differee | non_traitee), commentaire (literal block `|`)
// Keys are ASCII. Strings stay plain only when unambiguous; otherwise they are
// double-quoted with JSON-compatible escapes (so JSON.parse reads them back).

export const STATUSES = ['tranchee', 'differee', 'non_traitee'];
export const ROLES = ['decide', 'valide'];

// A plain scalar may not start with a YAML indicator character.
const RESERVED_START = /^[-?:,[\]{}#&*!|>'"%@`]/;
// Agreed rule: quote as soon as the string contains `: # ' "`.
const QUOTE_CHARS = /[:#'"]/;
// Plain words that a YAML 1.1 / 1.2 reader would not load as a string.
const NON_STRING = /^(?:~|null|true|false|yes|no|on|off|y|n|[-+]?\.(?:inf|nan))$/i;
// Numbers, dates and times all start with a digit (optionally signed or dotted).
const NUMBER_LIKE = /^[-+.]?\d/;
// Characters a YAML stream may not carry raw (C0 except tab and line feed, DEL, C1,
// line/paragraph separators, BOM). Tab and line feed are handled per scalar style.
const NON_PRINTABLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u{2028}\u{2029}\u{feff}]/u;
const ESCAPED = /[\\"\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}\u{feff}]/gu;
const ESCAPES = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t', '\r': '\\r' };

const isPlainSafe = text => text.length > 0
  && text === text.trim()
  && !/[\t\n\r]/.test(text) && !NON_PRINTABLE.test(text)
  && !QUOTE_CHARS.test(text) && !RESERVED_START.test(text)
  && !NON_STRING.test(text) && !NUMBER_LIKE.test(text);

export const yamlQuoted = text => `"${String(text).replace(ESCAPED,
  char => ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;

export function yamlScalar(value) {
  if (value === null || value === undefined) return 'null';
  const text = String(value);
  return isPlainSafe(text) ? text : yamlQuoted(text);
}

// Literal block (`|`) for free text. Line endings are normalised, leading blank lines
// and trailing whitespace are dropped. Every content line is indented by `indent`
// spaces (>= 4 here), so a line such as ``` never closes the surrounding Markdown fence.
export function yamlBlock(value, indent) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
  if (!text) return '|';
  // A literal block cannot carry non-printable characters: fall back to a quoted string.
  if (NON_PRINTABLE.test(text)) return yamlQuoted(text);
  // A first line starting with a space needs an explicit indentation indicator.
  const header = text.startsWith(' ') ? '|2' : '|';
  const pad = ' '.repeat(indent);
  return `${header}\n${text.split('\n').map(line => (line ? pad + line : '')).join('\n')}`;
}

// Local time with its UTC offset, e.g. 2026-10-03T14:05:09-04:00.
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
  const lines = HEADER_KEYS.map(key => `${key}: ${yamlScalar(header[key])}`);
  if (!records.length) return [...lines, 'decisions: []'].join('\n');
  lines.push('decisions:');
  for (const record of records) {
    lines.push(`  - id: ${yamlScalar(record.id)}`);
    for (const key of RECORD_KEYS) lines.push(`    ${key}: ${yamlScalar(record[key])}`);
    lines.push(`    commentaire: ${yamlBlock(record.commentaire, 6)}`);
  }
  return lines.join('\n');
}

// What the copy button puts in the clipboard: a fenced block GitHub renders as YAML.
export const markdownBlock = yaml => `\`\`\`yaml\n${yaml}\n\`\`\``;
