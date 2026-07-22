import type { EditorView } from '@codemirror/view';

/**
 * WYSIWYG math editing: clicking a rendered equation opens a floating
 * MathLive field. "Done" writes the edited LaTeX back as one precise source
 * edit (collaborative + undoable); "TeX" drops into raw source instead.
 * MathLive loads lazily — first open on a cold cache falls back to source
 * editing rather than blocking.
 */

interface MathTarget { innerFrom: number; innerTo: number; source: string; rect: DOMRect }

let mathfieldReady: Promise<boolean> | null = null;
function ensureMathlive(): Promise<boolean> {
  if (!mathfieldReady) {
    mathfieldReady = import('mathlive')
      .then((m) => {
        // registers <math-field>; keep MathLive's sounds/telemetry off
        (m as { MathfieldElement?: { soundsDirectory?: string | null } }).MathfieldElement &&
          ((m as unknown as { MathfieldElement: { soundsDirectory: string | null } }).MathfieldElement.soundsDirectory = null);
        return true;
      })
      .catch(() => false);
  }
  return mathfieldReady;
}

let openPopover: HTMLElement | null = null;

export function closeMathPopover(): void {
  openPopover?.remove();
  openPopover = null;
}

export async function openMathEditor(view: EditorView, target: MathTarget): Promise<void> {
  closeMathPopover();
  const ok = await ensureMathlive();
  const revealSource = () => {
    closeMathPopover();
    view.dispatch({ selection: { anchor: Math.min(target.innerFrom, view.state.doc.length) }, scrollIntoView: true });
    view.focus();
  };
  if (!ok) return revealSource();

  const pop = document.createElement('div');
  pop.className = 'vis-math-popover';
  pop.setAttribute('data-testid', 'math-popover');
  pop.style.position = 'fixed';
  pop.style.left = `${Math.max(8, Math.min(target.rect.left, window.innerWidth - 340))}px`;
  pop.style.top = `${Math.min(target.rect.bottom + 6, window.innerHeight - 120)}px`;

  const mf = document.createElement('math-field') as HTMLElement & { value: string };
  mf.setAttribute('data-testid', 'math-field');
  mf.value = target.source;
  pop.appendChild(mf);

  const bar = document.createElement('div');
  bar.className = 'vis-math-popover__bar';
  const done = document.createElement('button');
  done.textContent = 'Done';
  done.className = 'btn btn--primary vis-math-popover__btn';
  done.setAttribute('data-testid', 'math-popover-done');
  done.onclick = () => {
    const next = mf.value;
    // refuse to write through a stale range (e.g. a concurrent remote edit)
    const current = view.state.doc.sliceString(target.innerFrom, target.innerTo);
    closeMathPopover();
    if (current !== target.source || next === target.source) return;
    view.dispatch({ changes: { from: target.innerFrom, to: target.innerTo, insert: next }, userEvent: 'input.visual' });
    view.focus();
  };
  const tex = document.createElement('button');
  tex.textContent = 'TeX';
  tex.className = 'btn vis-math-popover__btn';
  tex.setAttribute('data-testid', 'math-popover-source');
  tex.onclick = revealSource;
  bar.append(done, tex);
  pop.appendChild(bar);

  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMathPopover();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) done.click();
    e.stopPropagation();
  });
  const onOutside = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) {
      closeMathPopover();
      window.removeEventListener('mousedown', onOutside, true);
    }
  };
  window.addEventListener('mousedown', onOutside, true);

  document.body.appendChild(pop);
  openPopover = pop;
  (mf as unknown as { focus(): void }).focus?.();
}
