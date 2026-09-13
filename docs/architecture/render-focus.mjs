import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderHtml } from '/focus/index.js';

const markdown = readFileSync('/docs/architecture.md', 'utf8');
const cursor = createHash('sha256').update(markdown).digest('hex');
const title = markdown.split('\n')[0].replace(/^# /, '');
const sections = [];
const diagramTitles = ['01 · User access and tenant boundaries', '02 · Immo: the four processing stages', '03 · Geo: sources, joins and serving', '04 · Releases and data refresh'];
let last = markdown.indexOf('\n') + 1;
const addProse = (text) => {
  if (text.trim()) sections.push({ kind: 'prose', id: `prose-${sections.length}`, targetRef: 'docs/architecture.md', markdown: text });
};
for (const match of markdown.matchAll(/```mermaid\n([\s\S]*?)\n```/g)) {
  addProse(markdown.slice(last, match.index));
  sections.push({ kind: 'diagram', id: `diagram-${sections.length}`, targetRef: 'docs/architecture.md', syntax: 'mermaid', source: match[1], alt: diagramTitles[sections.filter(s => s.kind === 'diagram').length] });
  last = match.index + match[0].length;
}
addProse(markdown.slice(last));
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const article = renderHtml({
  title, subject: 'Architecture orientation · read-only · 2026-09-13', ref: 'docs/architecture.md', cursor,
  sections, amendmentTrace: [{ at: '2026-09-13', author: 'Architecture inspection', summary: 'Cross-repository evidence and read-only live checks; no infrastructure changes.' }], interactions: [],
}, {
  renderMarkdown: (md) => `<div class="markdown-source"><pre>${escape(md)}</pre></div>`,
  // Prose is escaped, never interpreted as HTML here. Focus escapes its own fields.
  // The browser additionally sanitizes the Markdown renderer output with DOMPurify.
  sanitizeHtml: (html) => html,
});
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${escape(title)} · h2a Focus</title>
<link rel="stylesheet" href="/style.css">
<script defer src="/vendor/marked.min.js"></script><script defer src="/vendor/purify.min.js"></script>
<script defer src="/vendor/mermaid.min.js"></script><script defer src="/viewer.js"></script></head>
<body><aside><a class="brand" href="#top">h2a <strong>Focus</strong></a><p>Immo · Geo · Kubernetes</p>
<nav id="contents" aria-label="Document sections"></nav><a class="source-link" href="/architecture.md">Markdown source ↗</a>
<p class="note">Read-only architecture snapshot.<br>No approval or deployment actions.</p></aside>
<main id="top"><div class="eyebrow">ARCHITECTURE / 13 SEPTEMBER 2026</div>
<div id="render-status" role="status">Preparing diagrams…</div>${article}</main></body></html>`;
writeFileSync('/docs/architecture/architecture.html', html);
console.log(JSON.stringify({ renderer: 'h2a bundled FocusSnapshot renderHtml', diagrams: sections.filter(s => s.kind === 'diagram').length, markdownSha256: cursor, output: 'docs/architecture/architecture.html' }));
