import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ProjectSummary, TemplateInfo } from '../api';
import { useToast } from '../components/Toast';
import { IconDoc, IconLink, IconX } from '../components/Icons';
import { friendlyDate } from '../util/dates';

export default function Home() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [template, setTemplate] = useState('article');
  const navigate = useNavigate();
  const toast = useToast();

  const load = () => api.listProjects().then(setProjects).catch(() => setProjects([]));
  useEffect(() => { load(); }, []);
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

  const remove = async (e: React.MouseEvent, p: ProjectSummary) => {
    e.stopPropagation();
    if (!window.confirm(`Delete “${p.name}”? This removes the project and its history.`)) return;
    await api.deleteProject(p.id);
    toast(`Deleted ${p.name}`, 'ok');
    load();
  };

  return (
    <div className="home">
      <div className="home__inner">
        <div className="home__bar">
          <div>
            <h1 className="home__brand">papyr<em>.</em></h1>
            <p className="home__tag">Write LaTeX together. Fast, versioned, yours.</p>
          </div>
          <button className="btn btn--primary" onClick={() => setCreating(true)} data-testid="new-project">
            New project
          </button>
        </div>

        {projects === null ? (
          <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>
        ) : projects.length === 0 ? (
          <div className="empty">
            <p style={{ margin: '0 0 12px' }}>No projects yet. Create your first paper to get started.</p>
            <button className="btn btn--primary" onClick={() => setCreating(true)}>New project</button>
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
                  {p.zotero && <span title="Zotero linked" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><IconLink /> Zotero</span>}
                  <button className="project-card__del" title="Delete project" aria-label={`Delete ${p.name}`} onClick={(e) => remove(e, p)}><IconX /></button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {creating && (
        <div className="modal-backdrop" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
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
        </div>
      )}
    </div>
  );
}
