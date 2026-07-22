import type { Extension } from '@codemirror/state';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

/** Everything the visual mode needs from the hosting CodePane. */
export interface VisualDeps {
  projectId: string;
  branch: string;
  ydoc: Y.Doc;
  awareness: Awareness;
}

/**
 * The Visual editing mode: a pure decoration layer over the shared Y.Text.
 * It never dispatches document changes — source bytes are only ever modified
 * by explicit user edits and the formatting commands in ./commands.ts.
 */
export function visualExtensions(_deps: VisualDeps): Extension {
  return []; // Phase 0 scaffolding — populated in later phases.
}
