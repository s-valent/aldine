import { useEffect, useImperativeHandle, forwardRef, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export interface PdfPaneHandle {
  /** Scroll to a page + PDF-space y and flash a highlight (forward SyncTeX). */
  showForward(page: number, y: number, h?: number): void;
}

interface Props {
  pdfUrl: string | null;
  status: 'idle' | 'compiling' | 'ok' | 'error';
  zoom?: number; // multiplier on fit-width (1 = fit width)
  onFirstOpen(): void;
  /** Inverse SyncTeX: user double-clicked at (page, pdfX, pdfY) in PDF points. */
  onInverse?(page: number, x: number, y: number): void;
}

const PdfPane = forwardRef<PdfPaneHandle, Props>(function PdfPane({ pdfUrl, status, zoom = 1, onFirstOpen, onInverse }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const renderTask = useRef(0);
  const firstOpenFired = useRef(false);
  // per-page viewport info for coordinate mapping
  const pageInfo = useRef<Array<{ el: HTMLCanvasElement; scale: number; height: number }>>([]);

  useImperativeHandle(ref, () => ({
    showForward(page, y, h = 12) {
      const info = pageInfo.current[page - 1];
      const scroller = scrollRef.current;
      if (!info || !scroller) return;
      const top = info.el.offsetTop + y * info.scale;
      scroller.scrollTo({ top: top - scroller.clientHeight / 3, behavior: 'smooth' });
      // flash a highlight overlay
      const flash = document.createElement('div');
      flash.className = 'pdf-flash';
      flash.style.left = `${info.el.offsetLeft}px`;
      flash.style.top = `${info.el.offsetTop + (y - h) * info.scale}px`;
      flash.style.width = `${info.el.clientWidth}px`;
      flash.style.height = `${Math.max(16, h * 2 * info.scale)}px`;
      innerRef.current?.appendChild(flash);
      setTimeout(() => flash.remove(), 1400);
    },
  }), []);

  // auto-typeset once when the pane first mounts with no pdf
  useEffect(() => {
    if (!firstOpenFired.current && !pdfUrl && status === 'idle') {
      firstOpenFired.current = true;
      onFirstOpen();
    }
  }, [pdfUrl, status, onFirstOpen]);

  useEffect(() => {
    if (!pdfUrl || !innerRef.current) return;
    const my = ++renderTask.current;
    const container = innerRef.current;
    const scroller = scrollRef.current!;
    const prevScroll = scroller.scrollTop;

    (async () => {
      try {
        const doc = await pdfjs.getDocument(pdfUrl).promise;
        if (my !== renderTask.current) return;
        const width = Math.max(320, scroller.clientWidth - 36) * zoom;
        const frag = document.createDocumentFragment();
        const info: Array<{ el: HTMLCanvasElement; scale: number; height: number }> = [];
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          if (my !== renderTask.current) return;
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.className = 'pdf-page';
          canvas.dataset.page = String(i);
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          const cctx = canvas.getContext('2d')!;
          cctx.scale(dpr, dpr);
          await page.render({ canvasContext: cctx, viewport }).promise;
          frag.appendChild(canvas);
          info.push({ el: canvas, scale, height: base.height });
        }
        if (my !== renderTask.current) return;
        container.replaceChildren(frag);
        pageInfo.current = info;
        setRendered(true);
        scroller.scrollTop = prevScroll;
      } catch (err) {
        console.error('[pdf] render failed', err);
      }
    })();
  }, [pdfUrl, zoom]);

  const handleDblClick = (e: React.MouseEvent) => {
    if (!onInverse) return;
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLCanvasElement) || !target.dataset.page) return;
    const idx = Number(target.dataset.page) - 1;
    const info = pageInfo.current[idx];
    if (!info) return;
    const rect = target.getBoundingClientRect();
    const x = (e.clientX - rect.left) / info.scale;
    const y = (e.clientY - rect.top) / info.scale;
    onInverse(idx + 1, x, y);
  };

  return (
    <div className="pdf-pane" ref={scrollRef} data-testid="pdf-pane">
      <div className="pdf-pane__inner" ref={innerRef} onDoubleClick={handleDblClick} title={onInverse ? 'Double-click to jump to source' : undefined} />
      {!rendered && (
        <div className="pdf-empty">
          {status === 'compiling' ? (
            <><span className="spinner" /><p>Typesetting your document…</p></>
          ) : status === 'error' ? (
            <p>Fix the errors on the left, then typeset again.</p>
          ) : (
            <p>Press <span className="kbd">⌘S</span> to typeset and preview.</p>
          )}
        </div>
      )}
    </div>
  );
});

export default PdfPane;
