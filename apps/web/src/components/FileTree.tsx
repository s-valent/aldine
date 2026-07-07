import { useRef, useState } from 'react';
import { TreeEntry, api } from '../api';
import { fileIcon } from './Icons';

interface Props {
  files: TreeEntry[];
  active: string | null;
  rootFile: string;
  projectId: string;
  branch: string;
  onOpen(path: string): void;
  onCreate(path: string): void;
  onUploaded(paths: string[]): void;
  onDelete(path: string): void;
  onRename(from: string, to: string): void;
  onSetRoot(path: string): void;
}

const MAX_UPLOAD = 10 * 1024 * 1024;

export default function FileTree({ files, active, rootFile, projectId, branch, onOpen, onCreate, onUploaded, onDelete, onRename, onSetRoot }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const submit = () => {
    const n = name.trim();
    setAdding(false);
    setName('');
    if (n) onCreate(n);
  };

  const uploadFiles = async (list: FileList | File[]) => {
    const done: string[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX_UPLOAD) {
        alert(`${f.name} is larger than 10 MB`);
        continue;
      }
      const buf = await f.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      await api.writeFile(projectId, branch, f.name, btoa(binary), 'base64');
      done.push(f.name);
    }
    if (done.length) onUploaded(done);
  };

  return (
    <div
      className={`panel-list filetree ${dragOver ? 'filetree--drag' : ''}`}
      data-testid="file-tree"
      onClick={() => setMenu(null)}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) await uploadFiles(e.dataTransfer.files);
      }}
    >
      {files.filter((f) => f.type === 'file').map((f) => (
        <button
          key={f.path}
          className={`tree__item ${active === f.path ? 'tree__item--active' : ''}`}
          data-testid={`file-${f.path}`}
          onClick={() => !f.binary && onOpen(f.path)}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ path: f.path, x: e.clientX, y: e.clientY }); }}
          title={f.path}
        >
          <span className="tree__icon">{fileIcon(f.path, f.path === rootFile, f.binary)}</span>
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
          <button className="btn btn--ghost btn--small" onClick={() => fileInput.current?.click()} data-testid="upload-file">↑ Upload</button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            data-testid="upload-input"
            onChange={async (e) => {
              if (e.target.files?.length) await uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      )}
      <p className="filetree__hint">Drop files here to upload</p>

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
