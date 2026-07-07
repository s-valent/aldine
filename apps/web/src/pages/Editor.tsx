import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, CompileResult, ProjectDetail, TreeEntry } from '../api';
import { useToast } from '../components/Toast';
import FileTree from '../components/FileTree';
import CodePane, { CodePaneHandle } from '../components/CodePane';
import PdfPane from '../components/PdfPane';
import BranchMenu from '../components/BranchMenu';
import HistoryPanel from '../components/HistoryPanel';
import Presence, { PresenceUser } from '../components/Presence';
import { PluginHost, PluginPanel } from '../plugins/host';
import { hintFor } from '../editor/errorHints';
import { IconChevronLeft } from '../components/Icons';

type CompileStatus = 'idle' | 'compiling' | 'ok' | 'error';

export default function Editor() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const branch = params.get('branch') || 'main';
  const navigate = useNavigate();
  const toast = useToast();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [files, setFiles] = useState<TreeEntry[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [tab, setTab] = useState<'files' | 'history' | string>('files');
  const [compile, setCompile] = useState<{ status: CompileStatus; result: CompileResult | null }>({ status: 'idle', result: null });
  const [pdfWidth, setPdfWidth] = useState(() => Math.max(360, Math.round(window.innerWidth * 0.4)));
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [pluginPanels, setPluginPanels] = useState<PluginPanel[]>([]);
  const [auto, setAuto] = useState(() => localStorage.getItem('papyr.autoTypeset') !== '0');
  const [stats, setStats] = useState<{ words: number; selWords: number | null }>({ words: 0, selWords: null });
  const [zoom, setZoom] = useState(1);
  const [showLog, setShowLog] = useState(false);
  const codeRef = useRef<CodePaneHandle>(null);
  const compilingRef = useRef(false);
  const pendingRef = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRef = useRef(auto);
  autoRef.current = auto;

  const loadProject = useCallback(async () => {
    try {
      const p = await api.getProject(id);
      setProject(p);
      return p;
    } catch {
      toast('Project not found', 'error');
      navigate('/');
      return null;
    }
  }, [id]);

  const loadFiles = useCallback(async () => {
    const f = await api.listFiles(id, branch);
    setFiles(f);
    return f;
  }, [id, branch]);

  useEffect(() => {
    (async () => {
      const p = await loadProject();
      if (!p) return;
      const f = await loadFiles();
      const first = f.find((e) => e.path === p.rootFile) || f.find((e) => e.type === 'file' && e.path.endsWith('.tex')) || f.find((e) => e.type === 'file' && !e.binary);
      setActiveFile((cur) => (cur && f.some((e) => e.path === cur) ? cur : first?.path || null));
    })();
  }, [id, branch]);

  const doCompile = useCallback(async () => {
    if (compilingRef.current) { pendingRef.current = true; return; }
    compilingRef.current = true;
    setCompile((c) => ({ ...c, status: 'compiling' }));
    try {
      const result = await api.compile(id, branch);
      setCompile({ status: result.ok ? 'ok' : 'error', result });
    } catch (err: any) {
      setCompile({ status: 'error', result: null });
      toast(`Typesetting failed: ${err.message}`, 'error');
    } finally {
      compilingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        setTimeout(() => doCompile(), 400);
      }
    }
  }, [id, branch]);

  /** Auto-typeset ~2s after edits settle. */
  const onDocChanged = useCallback(() => {
    if (!autoRef.current) return;
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => doCompile(), 2000);
  }, [doCompile]);

  useEffect(() => () => { if (autoTimer.current) clearTimeout(autoTimer.current); }, []);

  const toggleAuto = () => {
    const next = !auto;
    setAuto(next);
    localStorage.setItem('papyr.autoTypeset', next ? '1' : '0');
  };

  // Cmd+S / Ctrl+S → typeset now
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        doCompile();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doCompile]);

  const switchBranch = (name: string) => {
    setParams(name === 'main' ? {} : { branch: name });
    setCompile({ status: 'idle', result: null });
  };

  const renameProject = async (name: string) => {
    if (!project || !name.trim() || name === project.name) return;
    const p = await api.patchProject(id, { name: name.trim() });
    setProject((prev) => (prev ? { ...prev, name: p.name } : prev));
  };

  const jumpToLine = (line: number | null, file?: string) => {
    if (line == null || !project) return;
    const target = file && files.some((f) => f.path === file) ? file : project.rootFile;
    if (activeFile !== target) setActiveFile(target);
    requestAnimationFrame(() => setTimeout(() => codeRef.current?.gotoLine(line), 60));
  };

  const insertAtCursor = useCallback((text: string) => codeRef.current?.insertAtCursor(text), []);

  const pluginCtx = useMemo(() => ({
    projectId: id,
    branch,
    getActiveFile: () => activeFile,
    insertAtCursor,
    refreshFiles: loadFiles,
    refreshProject: loadProject,
    compile: doCompile,
    toast,
  }), [id, branch, activeFile, insertAtCursor, loadFiles, loadProject, doCompile, toast]);

  const errors = compile.result?.errors.filter((e) => e.type !== 'typesetting') || [];
  const errCount = errors.filter((e) => e.type === 'error').length;
  const showErrors = compile.result != null && (errors.length > 0 || !compile.result.ok);
  // a PDF is already on screen when the last compile produced one (recompiles keep it visible)
  const hasPdf = compile.result?.pdfUrl != null;

  if (!project) return <div className="editor-shell" />;

  return (
    <div className="editor-shell" data-testid="editor-shell">
      <PluginHost ctx={pluginCtx} onPanels={setPluginPanels} />
      <header className="toolbar">
        <button className="btn btn--ghost" onClick={() => navigate('/')} title="All projects" aria-label="Back to projects"><IconChevronLeft /></button>
        <span
          className="toolbar__name"
          contentEditable
          suppressContentEditableWarning
          data-testid="project-name"
          onBlur={(e) => renameProject(e.currentTarget.textContent || '')}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
        >
          {project.name}
        </span>
        <BranchMenu
          projectId={id}
          current={branch}
          onSwitch={switchBranch}
          onChanged={() => { loadProject(); loadFiles(); }}
        />
        <div className="toolbar__spacer" />
        <Presence users={users} />
        <div className="toolbar__group">
          <button
            className="btn btn--primary"
            onClick={doCompile}
            disabled={compile.status === 'compiling'}
            data-testid="typeset-button"
            title="Typeset (⌘S)"
          >
            {compile.status === 'compiling' ? <span className="spinner" /> : null}
            Typeset
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="pane sidebar">
          <div className="sidebar__tabs" role="tablist">
            <button className={`sidebar__tab ${tab === 'files' ? 'sidebar__tab--active' : ''}`} onClick={() => setTab('files')} role="tab">Files</button>
            <button className={`sidebar__tab ${tab === 'history' ? 'sidebar__tab--active' : ''}`} onClick={() => setTab('history')} role="tab">History</button>
            {pluginPanels.map((p) => (
              <button key={p.id} className={`sidebar__tab ${tab === p.id ? 'sidebar__tab--active' : ''}`} onClick={() => setTab(p.id)} role="tab" data-testid={`tab-${p.id}`}>
                {p.title}
              </button>
            ))}
          </div>
          <div className="sidebar__body">
            {tab === 'files' && (
              <FileTree
                files={files}
                active={activeFile}
                rootFile={project.rootFile}
                projectId={id}
                branch={branch}
                onOpen={setActiveFile}
                onCreate={async (path) => { await api.writeFile(id, branch, path, ''); await loadFiles(); setActiveFile(path); }}
                onUploaded={async (paths) => {
                  await loadFiles();
                  toast(paths.length === 1 ? `Uploaded ${paths[0]}` : `Uploaded ${paths.length} files`, 'ok');
                }}
                onDelete={async (path) => {
                  await api.deleteFile(id, branch, path);
                  await loadFiles();
                  if (activeFile === path) setActiveFile(null);
                }}
                onRename={async (from, to) => {
                  await api.renameFile(id, branch, from, to);
                  await loadFiles();
                  if (activeFile === from) setActiveFile(to);
                }}
                onSetRoot={async (path) => {
                  await api.patchProject(id, { rootFile: path });
                  await loadProject();
                  toast(`Typeset root is now ${path}`, 'ok');
                }}
              />
            )}
            {tab === 'history' && <HistoryPanel projectId={id} branch={branch} />}
            {pluginPanels.map((p) => (
              <div key={p.id} style={{ display: tab === p.id ? 'block' : 'none' }} ref={(el) => { if (el && !el.hasChildNodes()) p.mount(el); }} />
            ))}
          </div>
        </aside>

        <main className="pane" style={{ flex: 1 }}>
          {activeFile ? (
            <>
              <div className="pane__header">
                <span className="statusbar__file">{activeFile}</span>
                <span className="toolbar__spacer" />
                <span className="pdf-status" data-testid="word-count">
                  {stats.selWords != null
                    ? `${stats.selWords.toLocaleString()} of ${stats.words.toLocaleString()} words`
                    : `${stats.words.toLocaleString()} words`}
                </span>
              </div>
              <CodePane
                key={`${id}::${branch}::${activeFile}`}
                ref={codeRef}
                projectId={id}
                branch={branch}
                filePath={activeFile}
                onUsers={setUsers}
                onSave={doCompile}
                onDocChanged={onDocChanged}
                onStats={setStats}
              />
            </>
          ) : (
            <div className="pdf-empty"><p>Select a file to start writing.</p></div>
          )}
          {showErrors && (
            <div className="errors" data-testid="errors-panel">
              <div className="errors__head">
                <span>{errCount > 0 ? `${errCount} error${errCount === 1 ? '' : 's'}` : 'Problems'}</span>
                <button className="btn btn--ghost btn--small" onClick={() => setShowLog(true)} data-testid="view-log">View log</button>
              </div>
              {errors.slice(0, 50).map((e, i) => {
                const hint = hintFor(e.message);
                return (
                  <button key={i} className="errors__row" onClick={() => jumpToLine(e.line, (e as { file?: string }).file)}>
                    <span className={`errors__badge errors__badge--${e.type}`}>{e.type === 'error' ? 'Error' : 'Warning'}</span>
                    {e.line != null && <span className="errors__line">line {e.line}</span>}
                    <span className="errors__msgwrap">
                      <span className="errors__msg" title={e.message}>{e.message}</span>
                      {hint && <span className="errors__hint">{hint}</span>}
                    </span>
                  </button>
                );
              })}
              {errors.length === 0 && (
                <div className="errors__row" style={{ cursor: 'default' }}>
                  <span className="errors__msg">Typesetting failed — open the log for details.</span>
                </div>
              )}
            </div>
          )}
        </main>

        <div
          className="resizer"
          onMouseDown={(e) => {
            const startX = e.clientX;
            const start = pdfWidth;
            const move = (ev: MouseEvent) => setPdfWidth(Math.min(Math.max(280, start + (startX - ev.clientX)), window.innerWidth - 500));
            const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
          }}
        />

        <section className="pane" style={{ width: pdfWidth, flex: 'none' }}>
          <div className="pane__header">
            <span>Preview</span>
            <span className="pdf-status" data-testid="pdf-status" style={{ marginLeft: 10 }}>
              {compile.status === 'compiling' && hasPdf && <><span className="dot dot--busy" /> Typesetting…</>}
              {compile.status === 'ok' && compile.result && <><span className="dot dot--ok" /> Typeset in {(compile.result.durationMs / 1000).toFixed(1)}s</>}
              {compile.status === 'error' && <><span className="dot dot--error" /> {errCount > 0 ? `${errCount} error${errCount === 1 ? '' : 's'}` : 'Failed'}</>}
            </span>
            <span className="toolbar__spacer" />
            <div className="zoom" data-testid="zoom-controls">
              <button className="btn btn--ghost btn--small" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))} title="Zoom out" aria-label="Zoom out">−</button>
              <button className="zoom__label" onClick={() => setZoom(1)} title="Reset to fit width">{Math.round(zoom * 100)}%</button>
              <button className="btn btn--ghost btn--small" onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))} title="Zoom in" aria-label="Zoom in">+</button>
            </div>
            <button
              className={`auto-toggle ${auto ? 'auto-toggle--on' : ''}`}
              onClick={toggleAuto}
              title={auto ? 'Auto-typeset is on — typesets shortly after you stop typing' : 'Auto-typeset is off'}
              data-testid="auto-toggle"
            >
              <span className="auto-toggle__knob" />
              Auto
            </button>
          </div>
          <PdfPane pdfUrl={compile.result?.pdfUrl || null} status={compile.status} zoom={zoom} onFirstOpen={doCompile} />
        </section>
      </div>

      {showLog && compile.result && (
        <div className="modal-backdrop" onClick={() => setShowLog(false)}>
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <h2>Typesetting log</h2>
            <pre className="logview" data-testid="log-view">{compile.result.log || '(no log)'}</pre>
            <div className="modal__row">
              <button className="btn" onClick={() => setShowLog(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
