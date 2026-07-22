import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ProjectSummary, TemplateInfo } from '../api';
import { useToast } from '../components/Toast';
import { useAuth } from '../components/Auth';
import Modal from '../components/Modal';
import { IconDoc, IconLink, IconX } from '../components/Icons';
import AccountSettings from '../components/AccountSettings';
import { getTheme, toggleTheme } from '../theme';
import GithubImport from '../components/GithubImport';
import Onboarding from '../components/Onboarding';
import { friendlyDate } from '../util/dates';

export default function Home() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [themeChoice, setThemeChoice] = useState(getTheme());
  const [newName, setNewName] = useState('');
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [template, setTemplate] = useState('article');
  const [sharing, setSharing] = useState<ProjectSummary | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const [showGithub, setShowGithub] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => localStorage.getItem('aldine.onboarded') !== '1');
  const dismissOnboarding = () => { localStorage.setItem('aldine.onboarded', '1'); setShowOnboarding(false); };
  const navigate = useNavigate();
  const toast = useToast();
  const { authEnabled, user, setUser } = useAuth();

  const load = () => api.listProjects()
    .then((p) => { setProjects(p); setLoadFailed(false); })
    .catch(() => { setLoadFailed(true); setProjects((cur) => cur ?? []); });
  useEffect(() => { load(); }, []);
  // returning from GitHub OAuth connect → reopen the import flow (now connected)
  useEffect(() => {
    if (new URLSearchParams(location.search).get('github') === 'connected') {
      setShowGithub(true);
      window.history.replaceState({}, '', location.pathname);
    }
  }, []);
  useEffect(() => { api.templates().then(setTemplates).catch(() => setTemplates([])); }, []);

  const create = async () => {
    const name = newName.trim() || 'Untitled Project';
    try {
      const p = await api.createProject(name, undefined, templates.length ? template : undefined);
      navigate(`/p/${p.id}`);
    } catch (err: any) {
      toast(`Could not create project: ${err.message}`, 'error');
    }
  };

  const importZip = async (file: File) => {
    if (!/\.zip$/i.test(file.name)) { toast('Please drop a .zip file', 'error'); return; }
    if (file.size > 60 * 1024 * 1024) { toast('ZIP is larger than 60 MB', 'error'); return; }
    toast('Importing…');
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const p = await api.importZip(file.name.replace(/\.zip$/i, ''), btoa(bin));
      navigate(`/p/${p.id}`);
    } catch (err: any) {
      toast(`Import failed: ${err.message}`, 'error');
    }
  };

  const remove = async (e: React.MouseEvent, p: ProjectSummary) => {
    e.stopPropagation();
    if (!window.confirm(`Delete “${p.name}”? This removes the project and its history.`)) return;
    await api.deleteProject(p.id);
    toast(`Deleted ${p.name}`, 'ok');
    load();
  };

  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`home ${dragOver ? 'home--drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={async (e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) await importZip(f);
      }}
    >
      <div className="home__inner">
        <div className="home__bar">
          <div>
            <h1 className="home__brand">aldine<em>.</em></h1>
            <p className="home__tag">Write LaTeX together. Fast, versioned, yours.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="btn"
              data-testid="theme-toggle"
              title="Switch light/dark theme"
              aria-label="Switch light/dark theme"
              onClick={() => setThemeChoice(toggleTheme())}
            >
              {themeChoice === 'dark' ? '☀︎' : '☾'}
            </button>
            {authEnabled && user && (
              <span className="user-chip">
                <button className="user-chip__name" data-testid="user-name" onClick={() => setShowAccount(true)} title="Account settings">{user.name}</button>
                <button className="btn btn--small" data-testid="logout" onClick={async () => { await api.logout(); setUser(null); }}>Sign out</button>
              </span>
            )}
            <label className="btn" data-testid="import-zip">
              Import ZIP
              <input type="file" accept=".zip" hidden data-testid="import-input" aria-label="Import a project from a ZIP file"
                onChange={async (e) => { if (e.target.files?.[0]) await importZip(e.target.files[0]); e.target.value = ''; }} />
            </label>
            <button className="btn" onClick={() => setShowGithub(true)} data-testid="new-from-github">
              From GitHub
            </button>
            <button className="btn btn--primary" onClick={() => setCreating(true)} data-testid="new-project">
              New project
            </button>
          </div>
        </div>

        {projects === null ? (
          <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>
        ) : loadFailed ? (
          <div className="empty">
            <p style={{ margin: '0 0 16px' }}>Couldn’t reach the server to load your projects.</p>
            <button className="btn btn--primary" onClick={load}>Try again</button>
          </div>
        ) : projects.length === 0 ? (
          <div className="empty">
            <p style={{ margin: '0 0 16px' }}>No projects yet — start a paper however you like.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn--primary" onClick={() => setCreating(true)}>New project</button>
              <button className="btn" onClick={() => setShowGithub(true)}>Import from GitHub</button>
              <label className="btn">Import a ZIP
                <input type="file" accept=".zip" hidden onChange={async (e) => { if (e.target.files?.[0]) await importZip(e.target.files[0]); e.target.value = ''; }} />
              </label>
            </div>
          </div>
        ) : (
          <div className="projects" data-testid="project-grid">
            {projects.map((p) => (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                className="project-card"
                data-testid={`project-card-${p.id}`}
                onClick={() => navigate(`/p/${p.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/p/${p.id}`)}
              >
                <span className="project-card__icon"><IconDoc width={20} height={20} /></span>
                <span className="project-card__name">{p.name}</span>
                <span className="project-card__meta">
                  <span>{friendlyDate(p.createdAt)}</span>
                  {authEnabled && p.ownerId && !p.isOwner && <span title={`Shared by ${p.ownerName || 'someone'}`}>· shared</span>}
                  {p.zotero && <span title="Zotero linked" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><IconLink /> Zotero</span>}
                  {authEnabled && p.isOwner && (
                    <button className="project-card__del" title="Share project" style={{ marginLeft: 'auto' }} data-testid={`share-${p.id}`}
                      onClick={(e) => { e.stopPropagation(); setSharing(p); }}><IconLink /></button>
                  )}
                  <button className="project-card__del" title="Delete project" aria-label={`Delete ${p.name}`} style={authEnabled && p.isOwner ? undefined : { marginLeft: 'auto' }} onClick={(e) => remove(e, p)}><IconX /></button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {sharing && (
        <ShareModal project={sharing} onClose={() => setSharing(null)} onSaved={() => { setSharing(null); load(); }} toast={toast} />
      )}
      {showAccount && user && (
        <AccountSettings user={user} onClose={() => setShowAccount(false)} />
      )}
      {showGithub && (
        <GithubImport onClose={() => setShowGithub(false)} onImported={(id) => navigate(`/p/${id}`)} />
      )}
      {showOnboarding && (
        <Onboarding onNew={() => setCreating(true)} onGithub={() => setShowGithub(true)} onImportZip={importZip} onClose={dismissOnboarding} />
      )}

      {creating && (
        <Modal onClose={() => setCreating(false)} label="New project">
          <div>
            <h2>New project</h2>
            <p className="modal__sub">Name it, pick a starting point, start writing.</p>
            <input
              autoFocus
              className="input"
              placeholder="Project name"
              value={newName}
              data-testid="new-project-name"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setCreating(false); }}
            />
            {templates.length > 0 && (
              <div className="tpl-grid" data-testid="template-grid">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    className={`tpl ${template === t.id ? 'tpl--active' : ''}`}
                    data-testid={`template-${t.id}`}
                    onClick={() => setTemplate(t.id)}
                    title={t.description}
                  >
                    <span className="tpl__icon">{t.icon || '📄'}</span>
                    <span className="tpl__name">{t.name}</span>
                    <span className="tpl__desc">{t.description}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="modal__row">
              <button className="btn" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={create} data-testid="create-project">Create</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ShareModal({ project, onClose, onSaved, toast }: {
  project: ProjectSummary;
  onClose(): void;
  onSaved(): void;
  toast(text: string, kind?: 'info' | 'error' | 'ok'): void;
}) {
  const [mode, setMode] = useState<'private' | 'link'>(project.share?.mode || 'private');
  const [emails, setEmails] = useState((project.share?.collaborators || []).join(', '));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const list = emails.split(',').map((e) => e.trim()).filter(Boolean);
      await api.share(project.id, mode, list);
      toast('Sharing updated', 'ok');
      onSaved();
    } catch (err: any) {
      toast(`Could not update sharing: ${err.message}`, 'error');
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} label={`Share ${project.name}`} testId="share-modal">
      <div>
        <h2>Share “{project.name}”</h2>
        <p className="modal__sub">Choose who can open and edit this project.</p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input type="radio" checked={mode === 'private'} onChange={() => setMode('private')} data-testid="share-private" />
          <span><strong>Invite only</strong> — you and the collaborators below</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input type="radio" checked={mode === 'link'} onChange={() => setMode('link')} data-testid="share-link" />
          <span><strong>Anyone signed in</strong> with the link can edit</span>
        </label>
        <input
          className="input"
          style={{ width: '100%' }}
          placeholder="Collaborator emails, comma-separated"
          value={emails}
          data-testid="share-emails"
          onChange={(e) => setEmails(e.target.value)}
        />
        <div className="modal__row">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={save} disabled={busy} data-testid="share-save">Save</button>
        </div>
      </div>
    </Modal>
  );
}
