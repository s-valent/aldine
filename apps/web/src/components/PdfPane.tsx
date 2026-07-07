import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

interface Props {
  pdfUrl: string | null;
  status: 'idle' | 'compiling' | 'ok' | 'error';
  zoom?: number; // multiplier on fit-width (1 = fit width)
  onFirstOpen(): void;
}

export default function PdfPane({ pdfUrl, status, zoom = 1, onFirstOpen }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const renderTask = useRef(0);
  const firstOpenFired = useRef(false);

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
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          if (my !== renderTask.current) return;
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.className = 'pdf-page';
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          const cctx = canvas.getContext('2d')!;
          cctx.scale(dpr, dpr);
          await page.render({ canvasContext: cctx, viewport }).promise;
          frag.appendChild(canvas);
        }
        if (my !== renderTask.current) return;
        container.replaceChildren(frag);
        setRendered(true);
        scroller.scrollTop = prevScroll;
      } catch (err) {
        console.error('[pdf] render failed', err);
      }
    })();
  }, [pdfUrl, zoom]);

  return (
    <div className="pdf-pane" ref={scrollRef} data-testid="pdf-pane">
      <div className="pdf-pane__inner" ref={innerRef} />
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
}
