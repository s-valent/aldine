import { useState } from 'react';
import { api } from '../api';
import { useToast } from './Toast';
import Modal from './Modal';

/** Owner-only sharing dialog: private/link mode + collaborator emails. */
export default function ShareModal({ project, onClose, onSaved }: {
  project: { id: string; name: string; share?: { mode: 'private' | 'link'; collaborators: string[] } | null };
  onClose(): void;
  onSaved(): void;
}) {
  const [mode, setMode] = useState<'private' | 'link'>(project.share?.mode || 'private');
  const [emails, setEmails] = useState((project.share?.collaborators || []).join(', '));
  const [busy, setBusy] = useState(false);
  const toast = useToast();

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
          <span><strong>Anyone signed in with the link</strong> can edit — it won’t appear in their project list</span>
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
