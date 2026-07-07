/** Add-a-reference-by-DOI/arXiv plugin. Proves a second plugin extends Papyr. */

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};

export default {
  activate(papyr) {
    papyr.ui.registerSidebarPanel({
      id: 'references',
      title: 'Cite',
      render(root) {
        let busy = false;
        let query = '';

        const add = async () => {
          const q = query.trim();
          if (!q || busy) return;
          busy = true; draw();
          try {
            const res = await papyr.fetch(`/api/projects/${papyr.project.id}/references/add`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ query: q, branch: papyr.project.branch }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
            await papyr.project.refreshFiles();
            if (body.key) {
              papyr.editor.insertAtCursor(`\\cite{${body.key}}`);
              papyr.toast(body.duplicate ? `Already in bibliography — inserted \\cite{${body.key}}` : `Added ${body.key} and inserted citation`, 'ok');
            }
            query = '';
          } catch (err) {
            papyr.toast(`Lookup failed: ${err.message}`, 'error');
          }
          busy = false; draw();
        };

        function draw() {
          root.replaceChildren(
            h('div', { class: 'panel-list', dataset: { testid: 'references-panel' }, style: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '8px 6px' } },
              h('div', { class: 'menu__label', style: { padding: '0 2px' } }, 'Add reference'),
              h('p', { style: { color: 'var(--text-2)', fontSize: '12px', lineHeight: '1.5', margin: 0 } },
                'Paste a DOI, doi.org URL, or arXiv id. Papyr fetches the BibTeX, appends it to references.bib, and inserts the citation.'),
              h('input', {
                class: 'input',
                placeholder: '10.1145/… or arXiv:2401.01234',
                style: { width: '100%' },
                dataset: { testid: 'reference-query' },
                value: query,
                oninput: (e) => { query = e.target.value; },
                onkeydown: (e) => { if (e.key === 'Enter') add(); },
              }),
              h('button', {
                class: 'btn btn--primary',
                style: { width: '100%', justifyContent: 'center' },
                dataset: { testid: 'reference-add' },
                disabled: busy ? '' : null,
                onclick: add,
              }, busy ? 'Fetching…' : 'Add & cite'),
            ),
          );
        }

        draw();
      },
    });
  },
};
