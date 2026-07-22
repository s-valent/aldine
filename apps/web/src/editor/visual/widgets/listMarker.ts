import { WidgetType } from '@codemirror/view';

/** Bullet or number replacing an `\item` token. */
export class ItemMarkerWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: ItemMarkerWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-vis-item';
    el.setAttribute('data-testid', 'vis-item');
    el.textContent = this.text;
    return el;
  }
}
