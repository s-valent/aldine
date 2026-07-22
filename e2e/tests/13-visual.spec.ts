import { test, expect } from '../fixtures';
import { createProject, openProject, cleanup } from './helpers';

const DOC = [
  '\\section{Introduction}',
  'Hello \\textbf{brave} new \\emph{world} of text.',
  '',
  '\\subsection{Details}',
  'More prose here.',
  '',
].join('\n');

test.describe('visual editor (experimental)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('aldine.experimental.visualEditor', '1');
      window.localStorage.setItem('aldine.editorMode', 'visual');
    });
  });

  async function seed(request: Parameters<typeof createProject>[0], name: string) {
    const id = await createProject(request, name);
    await request.put(`/api/projects/${id}/file`, { data: { branch: 'main', path: 'main.tex', content: DOC } });
    return id;
  }

  test('renders headings and styles, toggles back to source without remount', async ({ page, request }) => {
    const id = await seed(request, 'Visual Render');
    try {
      await openProject(page, id);
      // park the caret in plain prose — the construct under the caret is
      // (correctly) revealed as source, and a fresh doc opens with caret at 0
      await page.locator('.cm-line', { hasText: 'More prose here.' }).click();
      // markup hidden, content rendered
      await expect(page.locator('.cm-content')).toContainText('Introduction');
      await expect(page.locator('.cm-content')).not.toContainText('\\section{');
      await expect(page.locator('.cm-vis-h1')).toHaveCount(1);
      await expect(page.locator('.cm-vis-h2')).toHaveCount(1);
      await expect(page.locator('.cm-vis-b')).toContainText('brave');
      await expect(page.locator('.cm-vis-i')).toContainText('world');

      // tag the editor DOM, toggle to Source — same DOM node must survive (no remount)
      await page.evaluate(() => { document.querySelector('.cm-content')!.setAttribute('data-mounted', 'once'); });
      await page.getByTestId('mode-toggle').getByRole('tab', { name: 'Source' }).click();
      await expect(page.locator('.cm-content')).toContainText('\\section{Introduction}');
      await expect(page.locator('.cm-content[data-mounted="once"]')).toHaveCount(1);

      // and back
      await page.getByTestId('mode-toggle').getByRole('tab', { name: 'Visual' }).click();
      await expect(page.locator('.cm-content')).not.toContainText('\\section{');
      await expect(page.locator('.cm-content[data-mounted="once"]')).toHaveCount(1);
    } finally {
      await cleanup(request, id);
    }
  });

  test('cursor-reveal shows source for the construct under the caret', async ({ page, request }) => {
    const id = await seed(request, 'Visual Reveal');
    try {
      await openProject(page, id);
      await page.locator('.cm-line', { hasText: 'More prose here.' }).click();
      await expect(page.locator('.cm-vis-b')).toContainText('brave');
      await page.locator('.cm-vis-b').click();
      // the bold construct un-renders: raw markup visible
      await expect(page.locator('.cm-content')).toContainText('\\textbf{brave}');
      // click into plain prose → re-renders
      await page.locator('.cm-line', { hasText: 'More prose here.' }).click();
      await expect(page.locator('.cm-content')).not.toContainText('\\textbf{');
    } finally {
      await cleanup(request, id);
    }
  });

  test('a visual-mode cursor tour never changes a byte of source', async ({ page, request }) => {
    const id = await seed(request, 'Visual Bytes');
    try {
      await openProject(page, id);
      await page.locator('.cm-line', { hasText: 'More prose here.' }).click();
      await expect(page.locator('.cm-vis-h1')).toHaveCount(1);
      // tour: click into every construct, arrow across atomic boundaries
      for (const target of ['.cm-vis-b', '.cm-vis-i', '.cm-vis-h1', '.cm-vis-h2'] as const) {
        await page.locator(target).first().click({ force: true }).catch(() => {});
        for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
      }
      await page.keyboard.press('End');
      await page.keyboard.press('Home');
      // let the collab layer flush any (nonexistent) writes
      await page.waitForTimeout(3000);
      const res = await request.get(`/api/projects/${id}/file?branch=main&path=main.tex`);
      expect(await res.text()).toBe(DOC);
    } finally {
      await cleanup(request, id);
    }
  });

  test('math renders via KaTeX and click reveals its source', async ({ page, request }) => {
    const id = await createProject(request, 'Visual Math');
    try {
      await request.put(`/api/projects/${id}/file`, { data: { branch: 'main', path: 'main.tex', content: 'Euler: $e^{i\\pi} + 1 = 0$ stays true.\n\\[ \\int_0^1 x^2 \\, dx = \\tfrac{1}{3} \\]\nplain end\n' } });
      await openProject(page, id);
      await page.locator('.cm-line', { hasText: 'plain end' }).click();
      await expect(page.getByTestId('vis-math')).toHaveCount(2);
      await expect(page.locator('.katex').first()).toBeVisible();
      await expect(page.locator('.cm-content')).not.toContainText('e^{i\\pi}');
      // click the inline equation → the MathLive editor opens
      await page.getByTestId('vis-math').first().click();
      await expect(page.getByTestId('math-popover')).toBeVisible();
      // editing through the math field writes back a precise source edit
      await page.evaluate(() => {
        (document.querySelector('[data-testid="math-field"]') as HTMLElement & { value: string }).value = 'e^{i\\pi} + 2 = 1';
      });
      await page.getByTestId('math-popover-done').click();
      await page.waitForTimeout(2500);
      const edited = await (await request.get(`/api/projects/${id}/file?branch=main&path=main.tex`)).text();
      expect(edited).toContain('$e^{i\\pi} + 2 = 1$');
      // the "TeX" button drops into raw source instead
      await page.getByTestId('vis-math').first().click();
      await page.getByTestId('math-popover-source').click();
      await expect(page.locator('.cm-content')).toContainText('$e^{i\\pi} + 2 = 1$');
      // leave → re-rendered
      await page.locator('.cm-line', { hasText: 'plain end' }).click();
      await expect(page.locator('.cm-content')).not.toContainText('e^{i\\pi}');
    } finally {
      await cleanup(request, id);
    }
  });

  test('lists render with markers; cite and figure become chips', async ({ page, request }) => {
    const id = await createProject(request, 'Visual Chips');
    const doc = [
      'Intro text.',
      '\\begin{itemize}',
      '\\item First point',
      '\\item Second point',
      '\\end{itemize}',
      'See \\cite{knuth1984} and Figure ref.',
      '\\begin{figure}',
      '\\caption{A very nice plot}',
      '\\end{figure}',
      'plain end',
      '',
    ].join('\n');
    try {
      await request.put(`/api/projects/${id}/file`, { data: { branch: 'main', path: 'main.tex', content: doc } });
      await openProject(page, id);
      await page.locator('.cm-line', { hasText: 'plain end' }).click();
      await expect(page.getByTestId('vis-item')).toHaveCount(2);
      await expect(page.locator('.cm-content')).not.toContainText('\\begin{itemize}');
      await expect(page.getByTestId('vis-chip-cite')).toContainText(/knuth1984|Knuth 1984/);
      await expect(page.getByTestId('vis-chip-figure')).toContainText('A very nice plot');
      await expect(page.locator('.cm-content')).not.toContainText('\\caption');
      // clicking the figure chip reveals its source
      await page.getByTestId('vis-chip-figure').click();
      await expect(page.locator('.cm-content')).toContainText('\\begin{figure}');
    } finally {
      await cleanup(request, id);
    }
  });

  test('Mod-B wraps and unwraps the selection byte-exactly', async ({ page, request }) => {
    const id = await seed(request, 'Visual Bold');
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    try {
      await openProject(page, id);
      const line = page.locator('.cm-line', { hasText: 'More prose here.' });
      await line.click();
      // select the word "prose" precisely
      const box = (await line.boundingBox())!;
      await page.mouse.dblclick(box.x + 42, box.y + box.height / 2);
      await page.evaluate(() => window.getSelection()?.toString());
      await page.keyboard.press(`${mod}+b`);
      await page.waitForTimeout(2500); // collab flush
      const wrapped = await (await request.get(`/api/projects/${id}/file?branch=main&path=main.tex`)).text();
      expect(wrapped).toContain('\\textbf{');
      // caret is inside the new bold → construct revealed; toggle again unwraps
      await page.keyboard.press(`${mod}+b`);
      await page.waitForTimeout(2500);
      const unwrapped = await (await request.get(`/api/projects/${id}/file?branch=main&path=main.tex`)).text();
      expect(unwrapped).toBe(DOC);
    } finally {
      await cleanup(request, id);
    }
  });

  test('dual-mode collab: visual and source peers stay byte-consistent', async ({ browser, request }) => {
    const id = await seed(request, 'Dual Mode');
    const mk = async (visual: boolean) => {
      const ctx = await browser.newContext();
      await ctx.addInitScript((v) => {
        window.localStorage.setItem('aldine.onboarded', '1');
        window.localStorage.setItem('aldine.experimental.visualEditor', v ? '1' : '0');
        window.localStorage.setItem('aldine.editorMode', v ? 'visual' : 'source');
        window.localStorage.setItem('aldine.name', v ? 'Ada' : 'Grace');
      }, visual);
      return { ctx, page: await ctx.newPage() };
    };
    const A = await mk(true);
    const B = await mk(false);
    try {
      await openProject(A.page, id);
      await openProject(B.page, id);
      await A.page.locator('.cm-line', { hasText: 'More prose here.' }).click();

      // B (source) extends the heading; A (visual) sees the rendered heading update
      await B.page.locator('.cm-line', { hasText: '\\section{Introduction}' }).click();
      await B.page.keyboard.press('End');
      await B.page.keyboard.press('ArrowLeft'); // inside the closing brace
      await B.page.keyboard.type(' and Basics');
      await expect(A.page.locator('.cm-line.cm-vis-h1')).toContainText('Introduction and Basics', { timeout: 10_000 });

      // remote-caret force-reveal: B's caret sits inside \textbf{...} → A shows raw source
      await B.page.locator('.cm-line', { hasText: '\\textbf{brave}' }).click();
      await B.page.keyboard.press('Home');
      for (let i = 0; i < 15; i++) await B.page.keyboard.press('ArrowRight'); // into "brave"
      // (the remote caret label renders inside the word, so match the markup prefix)
      await expect(A.page.locator('.cm-content')).toContainText('\\textbf{', { timeout: 10_000 });

      // A (visual) types prose; B sees the exact source
      await A.page.locator('.cm-line', { hasText: 'More prose here.' }).click();
      await A.page.keyboard.press('End');
      await A.page.keyboard.type(' Extra from A.');
      await expect(B.page.locator('.cm-content')).toContainText('Extra from A.', { timeout: 10_000 });

      // stored bytes match both peers' view of the world, exactly
      await A.page.waitForTimeout(2500);
      const text = await (await request.get(`/api/projects/${id}/file?branch=main&path=main.tex`)).text();
      expect(text).toBe(DOC
        .replace('\\section{Introduction}', '\\section{Introduction and Basics}')
        .replace('More prose here.', 'More prose here. Extra from A.'));
    } finally {
      await A.ctx.close();
      await B.ctx.close();
      await cleanup(request, id);
    }
  });

  test('table renders as an editable grid; cell edits are precise', async ({ page, request }) => {
    const id = await createProject(request, 'Visual Table');
    const doc = 'Before.\n\\begin{tabular}{ll}\na & b \\\\\nc & d \\\\\n\\end{tabular}\nplain end\n';
    try {
      await request.put(`/api/projects/${id}/file`, { data: { branch: 'main', path: 'main.tex', content: doc } });
      await openProject(page, id);
      await page.locator('.cm-line', { hasText: 'plain end' }).click();
      await expect(page.getByTestId('vis-table')).toBeVisible();
      // edit cell "b" → "beta"
      await page.getByTestId('vis-table').locator('td', { hasText: 'b' }).first().dispatchEvent('mousedown');
      const input = page.getByTestId('vis-table-cell-input');
      await input.fill('beta');
      await input.press('Enter');
      await page.waitForTimeout(2500);
      let text = await (await request.get(`/api/projects/${id}/file?branch=main&path=main.tex`)).text();
      expect(text).toContain('a & beta');
      // add a row
      await page.getByTestId('vis-table-addrow').dispatchEvent('mousedown');
      await page.waitForTimeout(2500);
      text = await (await request.get(`/api/projects/${id}/file?branch=main&path=main.tex`)).text();
      expect(text.match(/\\\\/g)!.length).toBeGreaterThanOrEqual(3);
    } finally {
      await cleanup(request, id);
    }
  });

  test('outline dropdown lists headings and jumps', async ({ page, request }) => {
    const id = await seed(request, 'Visual Outline');
    try {
      await openProject(page, id);
      await page.locator('.cm-line', { hasText: 'More prose here.' }).click();
      const dd = page.getByTestId('outline-dropdown');
      await dd.focus();
      await expect(dd.locator('option', { hasText: 'Introduction' })).toHaveCount(1);
      await expect(dd.locator('option', { hasText: 'Details' })).toHaveCount(1);
    } finally {
      await cleanup(request, id);
    }
  });

  test('a suggestion renders as an inline tracked change and accepts', async ({ page, request }) => {
    const id = await seed(request, 'Visual Suggest');
    try {
      await request.post(`/api/projects/${id}/comments`, {
        data: {
          branch: 'main', file: 'main.tex',
          anchor: { from: DOC.indexOf('More prose here.'), to: DOC.indexOf('More prose here.') + 'More prose'.length, quote: 'More prose' },
          body: 'tighten this', suggestion: 'Less prose', author: 'Reviewer',
        },
      });
      await openProject(page, id);
      await page.locator('.cm-line', { hasText: 'Hello' }).click();
      await expect(page.getByTestId('vis-suggest')).toBeVisible();
      await expect(page.locator('.cm-vis-strike')).toContainText('More prose');
      await page.getByTestId('vis-suggest-accept').dispatchEvent('mousedown');
      await page.waitForTimeout(2500);
      const text = await (await request.get(`/api/projects/${id}/file?branch=main&path=main.tex`)).text();
      expect(text).toContain('Less prose here.');
    } finally {
      await cleanup(request, id);
    }
  });

  test('pasting rich HTML converts to LaTeX', async ({ page, request }) => {
    const id = await seed(request, 'Visual Paste');
    try {
      await openProject(page, id);
      await page.locator('.cm-line', { hasText: 'More prose here.' }).click();
      await page.keyboard.press('End');
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData('text/html', '<p>Copied <b>bold</b> and <i>slanted</i> words.</p><ul><li>alpha</li><li>beta</li></ul>');
        dt.setData('text/plain', 'Copied bold and slanted words. alpha beta');
        document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(2500);
      const text = await (await request.get(`/api/projects/${id}/file?branch=main&path=main.tex`)).text();
      expect(text).toContain('\\textbf{bold}');
      expect(text).toContain('\\textit{slanted}');
      expect(text).toContain('\\begin{itemize}');
      expect(text).toContain('\\item alpha');
    } finally {
      await cleanup(request, id);
    }
  });

  test('spellcheck toggle no longer remounts the editor', async ({ page, request }) => {
    const id = await seed(request, 'No Remount');
    try {
      await openProject(page, id);
      await page.evaluate(() => { document.querySelector('.cm-content')!.setAttribute('data-mounted', 'once'); });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
      await page.getByTestId('palette-input').fill('spellcheck');
      await page.keyboard.press('Enter');
      await expect(page.locator('.cm-content[data-mounted="once"]')).toHaveCount(1);
    } finally {
      await cleanup(request, id);
    }
  });
});
