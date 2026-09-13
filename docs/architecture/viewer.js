/* Focus owns the document structure; this host adds sanitized Markdown and Mermaid. */
async function enhanceArchitecture() {
  const status = document.querySelector('#render-status');
  try {
    for (const element of document.querySelectorAll('.markdown-source')) {
      element.innerHTML = DOMPurify.sanitize(marked.parse(element.textContent));
      element.classList.replace('markdown-source', 'markdown-rendered');
    }
    const sourceBase = 'https://github.com/rhanka/radar-immobilier/blob/097036783006226afea53a6b49383bf70890774f/docs/architecture.md';
    for (const link of document.querySelectorAll('.markdown-rendered a')) {
      const href = link.getAttribute('href');
      if (href && !href.startsWith('#') && !/^[a-z]+:/i.test(href)) link.href = new URL(href, sourceBase).href;
    }
    for (const table of document.querySelectorAll('table')) {
      const wrap = document.createElement('div'); wrap.className = 'table-scroll';
      table.before(wrap); wrap.append(table);
    }
    for (const [i, heading] of [...document.querySelectorAll('h2')].entries()) {
      heading.id = `section-${i + 1}`;
      const link = document.createElement('a'); link.href = `#${heading.id}`; link.textContent = heading.textContent;
      document.querySelector('#contents').append(link);
    }
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: {
      fontFamily: 'system-ui, sans-serif', fontSize: '15px', primaryColor: '#edf4fc', primaryTextColor: '#162b45',
      primaryBorderColor: '#7998bb', lineColor: '#57758f', clusterBkg: '#f7f9fc', clusterBorder: '#bdcbd9',
    }, flowchart: { htmlLabels: true, curve: 'basis', padding: 16, nodeSpacing: 24, rankSpacing: 38 } });
    let rendered = 0;
    for (const [i, figure] of [...document.querySelectorAll('.focus-diagram')].entries()) {
      const pre = figure.querySelector('pre'); const source = pre.textContent;
      const { svg } = await mermaid.render(`architecture-${i}`, source);
      const toolbar = document.createElement('div'); toolbar.className = 'diagram-toolbar';
      const canvas = document.createElement('div'); canvas.className = 'diagram-canvas'; canvas.tabIndex = 0;
      canvas.setAttribute('aria-label', `Diagram ${i + 1}; use zoom controls or scroll to inspect`);
      // Mermaid strict mode sanitizes its generated SVG.
      canvas.innerHTML = svg;
      const drawing = canvas.querySelector('svg'); drawing.style.maxWidth = 'none';
      const size = () => Number.parseFloat(drawing.style.width) || canvas.clientWidth;
      const fit = () => { const vb = drawing.viewBox.baseVal; drawing.style.width = `${Math.min(canvas.clientWidth - 24, (canvas.clientHeight - 24) * vb.width / vb.height)}px`; };
      const controls = [
        ['Zoom +', () => { drawing.style.width = `${size() * 1.3}px`; }],
        ['Zoom −', () => { drawing.style.width = `${Math.max(180, size() / 1.3)}px`; }],
        ['Ajuster', fit],
        ['Plein écran', (button) => { const expanded = figure.classList.toggle('expanded'); button.textContent = expanded ? 'Fermer' : 'Plein écran'; button.setAttribute('aria-expanded', String(expanded)); document.body.classList.toggle('diagram-open', expanded); fit(); }],
      ];
      for (const [label, action] of controls) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.addEventListener('click', () => action(button)); toolbar.append(button);
      }
      const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Code Mermaid';
      pre.before(toolbar, canvas, details); details.append(summary, pre);
      fit(); rendered++;
    }
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') document.querySelector('.expanded .diagram-toolbar button:last-child')?.click();
    });
    status.textContent = `${rendered} diagrammes Mermaid · source vérifiable · lecture seule`;
    status.dataset.state = 'ready';
    if (/^#section-\d+$/.test(location.hash)) document.querySelector(location.hash)?.scrollIntoView({ behavior: 'instant' });
  } catch (error) {
    status.textContent = `Rendering incomplete: ${error.message}. The source remains available below.`;
    status.dataset.state = 'error'; console.error(error);
  }
}
enhanceArchitecture();
