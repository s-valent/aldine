import { ViewPlugin } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { ySyncFacet } from 'y-codemirror.next';
import type { Awareness } from 'y-protocols/awareness';
import { setRemoteCarets } from './reveal';

/**
 * Remote-caret force-reveal: a construct containing a collaborator's caret
 * shows raw source locally, exactly like a local-cursor reveal. This keeps
 * yCollab's remote caret decorations inside visible text — a remote caret can
 * never end up inside a replaced (hidden) range.
 */
export function remoteCaretReveal(awareness: Awareness): Extension {
  return ViewPlugin.define((view) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = '';
    const push = () => {
      timer = null;
      const conf = view.state.facet(ySyncFacet);
      if (!conf) return;
      const positions: number[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const cursor = (state as { cursor?: { head?: unknown } }).cursor;
        if (!cursor?.head) return;
        try {
          positions.push(conf.fromYPos(cursor.head).pos);
        } catch {
          /* stale position from another doc epoch — ignore */
        }
      });
      positions.sort((a, b) => a - b);
      const key = positions.join(',');
      if (key === last) return;
      last = key;
      view.dispatch({ effects: setRemoteCarets.of(positions) });
    };
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(push, 60);
    };
    awareness.on('change', onChange);
    onChange();
    return {
      destroy() {
        awareness.off('change', onChange);
        if (timer) clearTimeout(timer);
      },
    };
  });
}
