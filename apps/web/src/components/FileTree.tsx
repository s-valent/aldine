import { useState } from 'react';
import { TreeEntry } from '../api';

interface Props {
  files: TreeEntry[];
  active: string | null;
  rootFile: string;
  onOpen(path: string): void;
  onCreate(path: string): void;
  onDelete(path: string): void;
  onRename(from: string, to: string): void;
  onSetRoot(path: string): void;
}

function icon(e: TreeEntry, rootFile: string): string {
  if (e.type === 'dir') return '▸';
  if (e.path === rootFile) return '★';
  if (e.path.endsWith('.tex')) return '𝑻';
  if (e.path.endsWith('.bib')) return '❞';
  if (e.binary) return '◆';
  return '·';
}

export default function FileTree({ files, active, rootFile, onOpen, onCreate, onDelete, onRename, onSetRoot }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);

  const submit = () => {
    const n = name.trim();
    setAdding(false);
    setName('');
    if (n) onCreate(n);
  };

  return (
    <div className="panel-list" onClick={() => setMenu(null)}>
      {files.filter((f) => f.type === 'file').map((f) => (
        <button
          key={f.path}
          className={`tree__item ${active === f.path ? 'tree__item--active' : ''}`}
          data-testid={`file-${f.path}`}
          onClick={() => !f.binary && onOpen(f.path)}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ path: f.path, x: e.clientX, y: e.clientY }); }}
          title={f.path}
        >
          <span className="tree__icon">{icon(f, rootFile)}</span>
          {f.path}
        </button>
      ))}

      {adding ? (
        <input
          autoFocus
          className="input"
          style={{ margin: '4px 0' }}
          placeholder="chapter.tex"
          value={name}
          data-testid="new-file-name"
          onChange={(e) => setName(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setAdding(false); setName(''); } }}
        />
      ) : (
        <div className="tree__actions">
          <button className="btn btn--ghost btn--small" onClick={() => setAdding(true)} data-testid="new-file">+ New file</button>
        </div>
      )}

      {menu && (
        <div className="menu" style={{ left: menu.x, top: menu.y, position: 'fixed' }} onClick={(e) => e.stopPropagation()}>
          <button className="menu__item" onClick={() => { onSetRoot(menu.path); setMenu(null); }}>Set as typeset root</button>
          <button className="menu__item" onClick={() => {
            const to = window.prompt('Rename to', menu.path);
            if (to && to !== menu.path) onRename(menu.path, to);
            setMenu(null);
          }}>Rename…</button>
          <div className="menu__sep" />
          <button className="menu__item" onClick={() => {
            if (window.confirm(`Delete ${menu.path}?`)) onDelete(menu.path);
            setMenu(null);
          }}>Delete</button>
        </div>
      )}
    </div>
  );
}
