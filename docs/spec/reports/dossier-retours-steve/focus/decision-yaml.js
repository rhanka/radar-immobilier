// Paste-ready YAML export of the decisions, for a GitHub PR comment or card.
// No dependency: a small emitter for the fixed schema agreed with h-cond.
//   header    dossier, fichier, version, decideur, date (ISO-8601 with offset), coller_dans
//   decisions id, titre, role (decide | valide), decide, consulte, option, option_libelle,
//             statut (tranchee | differee | non_traitee), commentaire (literal block `|`)
// Keys are ASCII. No value is ever quoted: a string is a plain scalar whenever a YAML
// reader loads it back unchanged; otherwise it is a block scalar under its key (`>-`
// folded for a single line, `|-` literal for several lines). Empty option fields are null.
// The `date` header is a plain ISO-8601 date-time: readers with a timestamp type load it
// as a timestamp, by design.

export const STATUSES = ['tranchee', 'differee', 'non_traitee'];
export const ROLES = ['decide', 'valide'];

// A plain scalar may not start with a YAML indicator character.
const RESERVED_START = /^[-?:,[\]{}#&*!|>'"%@`]/;
// `: ` (or a final `:`) would open a mapping and ` #` a comment. `#` not preceded by a
// space and `:` not followed by one (URLs, sha256:…) stay plain.
const PLAIN_BREAKERS = /: |:$| #/;
// Plain words that a YAML 1.1 / 1.2 reader would not load as a string.
const NON_STRING = /^(?:~|null|true|false|yes|no|on|off|y|n|[-+]?\.(?:inf|nan))$/i;
// Numbers in YAML 1.1 or 1.2 (decimal, float, hex, octal, binary, sexagesimal).
const NUMBER = /^[-+]?(?:\d[\d_]*(?:\.[\d_]*)?(?:e[-+]?\d+)?|\.\d[\d_]*(?:e[-+]?\d+)?|0x[\da-f_]+|0o[0-7_]+|0b[01_]+|\d[\d_]*(?::[0-5]?\d)+(?:\.[\d_]*)?)$/i;
// A date alone would load as a timestamp: only date-times (the `date` header) stay plain.
const DATE_ONLY = /^\d{4}-\d\d?-\d\d?$/;
// Characters a YAML stream may not carry raw (C0 except tab and line feed, DEL, C1,
// line/paragraph separators, BOM). Without quoted scalars there is no escape for them,
// so they are dropped; carriage returns become line feeds.
const NON_PRINTABLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u{2028}\u{2029}\u{feff}]/gu;
const clean = value => String(value).replace(/\r\n?/g, '\n').replace(NON_PRINTABLE, '');

const isPlainSafe = text => text.length > 0
  && text === text.trim() && !/[\t\n]/.test(text)
  && !RESERVED_START.test(text) && !PLAIN_BREAKERS.test(text)
  && !NON_STRING.test(text) && !NUMBER.test(text) && !DATE_ONLY.test(text);

// Block scalar for a value that cannot be plain. Content lines are indented by `indent`
// spaces; a first content line starting with a space needs the explicit indentation
// indicator (always 2: content sits two spaces under its key). Readers disagree on a line
// made only of blanks, so such a line is emptied; trailing line breaks are dropped.
const blockScalar = (value, style, chomping, indent) => {
  const text = value.replace(/^[ \t]+$/gm, '').replace(/\n+$/, '');
  const header = `${style}${/^\n* /.test(text) ? '2' : ''}${chomping}`;
  if (!text) return header;
  const pad = ' '.repeat(indent);
  return `${header}\n${text.split('\n').map(line => (line ? pad + line : '')).join('\n')}`;
};

// `indent` is the indentation of a block scalar's content: key indentation + 2.
export function yamlScalar(value, indent = 2) {
  if (value === null || value === undefined) return 'null';
  const text = clean(value);
  if (isPlainSafe(text)) return text;
  return blockScalar(text, /\n[^\n]/.test(text) ? '|' : '>', '-', indent);
}

// Literal block (`|`) for free text. Line endings are normalised, leading blank lines
// and trailing whitespace are dropped (clip chomping: readers get one final line break).
// Every content line is indented by `indent` spaces (>= 4 here), so a line such as ```
// never closes the surrounding Markdown fence.
export function yamlBlock(value, indent) {
  const text = clean(value ?? '').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
  return blockScalar(text, '|', '', indent);
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
    // A decision already taken (question.decided) stands unless a draft answer overrides it.
    const raw = selections[question.key] ?? question.decided?.option;
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
      commentaire: comments[question.key] ?? question.decided?.note ?? '',
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
    lines.push(`  - id: ${yamlScalar(record.id, 6)}`);
    for (const key of RECORD_KEYS) lines.push(`    ${key}: ${yamlScalar(record[key], 6)}`);
    lines.push(`    commentaire: ${yamlBlock(record.commentaire, 6)}`);
  }
  return lines.join('\n');
}

// What the copy button puts in the clipboard: a fenced block GitHub renders as YAML.
export const markdownBlock = yaml => `\`\`\`yaml\n${yaml}\n\`\`\``;
