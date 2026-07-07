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
  const codeRef = useRef<CodePaneHandle>(null);
  const compilingRef = useRef(false);

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
    if (compilingRef.current) return;
    compilingRef.current = true;
    setCompile((c) => ({ ...c, status: 'compiling' }));
    try {
      const result = await api.compile(id, branch);
      setCompile({ status: result.ok ? 'ok' : 'error', result });
      if (!result.ok) {
        const n = result.errors.filter((e) => e.type === 'error').length;
        toast(result.timedOut ? 'Typesetting timed out' : `Typesetting failed — ${n || 'see'} error${n === 1 ? '' : 's'}`, 'error');
      }
    } catch (err: any) {
      setCompile({ status: 'error', result: null });
      toast(`Typesetting failed: ${err.message}`, 'error');
    } finally {
      compilingRef.current = false;
    }
  }, [id, branch]);

  // Cmd+S / Ctrl+S → typeset
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

  const jumpToLine = (line: number | null) => {
    if (line != null && project) {
      // errors reference the root file; open it if needed
      if (activeFile !== project.rootFile) setActiveFile(project.rootFile);
      requestAnimationFrame(() => codeRef.current?.gotoLine(line));
    }
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

  if (!project) return <div className="editor-shell" />;

  return (
    <div className="editor-shell" data-testid="editor-shell">
      <PluginHost ctx={pluginCtx} onPanels={setPluginPanels} />
      <header className="toolbar">
        <button className="btn btn--ghost" onClick={() => navigate('/')} title="All projects" aria-label="Back to projects">⌂</button>
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
                onOpen={setActiveFile}
                onCreate={async (path) => { await api.writeFile(id, branch, path, ''); await loadFiles(); setActiveFile(path); }}
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
            <CodePane
              key={`${id}::${branch}::${activeFile}`}
              ref={codeRef}
              projectId={id}
              branch={branch}
              filePath={activeFile}
              onUsers={setUsers}
              onSave={doCompile}
            />
          ) : (
            <div className="pdf-empty"><p>Select a file to start writing.</p></div>
          )}
          {compile.result && errors.length > 0 && (
            <div className="errors" data-testid="errors-panel">
              {errors.slice(0, 50).map((e, i) => (
                <button key={i} className="errors__row" onClick={() => jumpToLine(e.line)}>
                  <span className={`errors__badge errors__badge--${e.type}`}>{e.type === 'error' ? 'Error' : 'Warning'}</span>
                  {e.line != null && <span className="errors__line">line {e.line}</span>}
                  <span className="errors__msg" title={e.message}>{e.message}</span>
                </button>
              ))}
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
            <span className="pdf-status" data-testid="pdf-status">
              {compile.status === 'compiling' && <><span className="dot dot--busy" /> Typesetting…</>}
              {compile.status === 'ok' && compile.result && <><span className="dot dot--ok" /> Typeset in {(compile.result.durationMs / 1000).toFixed(1)}s</>}
              {compile.status === 'error' && <><span className="dot dot--error" /> {errCount > 0 ? `${errCount} error${errCount === 1 ? '' : 's'}` : 'Failed'}</>}
            </span>
          </div>
          <PdfPane pdfUrl={compile.result?.pdfUrl || null} status={compile.status} onFirstOpen={doCompile} />
        </section>
      </div>
    </div>
  );
}
