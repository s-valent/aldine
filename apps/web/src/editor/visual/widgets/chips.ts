import { WidgetType } from '@codemirror/view';

/** A compact pill standing in for a construct; click puts the caret inside. */
class Chip extends WidgetType {
  constructor(readonly kind: string, readonly label: string, readonly pos: number) {
    super();
  }

  eq(other: Chip): boolean {
    return other.kind === this.kind && other.label === this.label;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = `cm-vis-chip cm-vis-chip--${this.kind}`;
    el.dataset.pos = String(this.pos);
    el.setAttribute('data-testid', `vis-chip-${this.kind}`);
    const tag = document.createElement('span');
    tag.className = 'cm-vis-chip__kind';
    tag.textContent = this.kind;
    el.appendChild(tag);
    if (this.label) el.appendChild(document.createTextNode(this.label));
    return el;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown';
  }
}

export function figureChip(caption: string, pos: number): Chip {
  return new Chip('figure', caption, pos);
}
export function tableChip(caption: string, pos: number): Chip {
  return new Chip('table', caption, pos);
}
export function citeChip(keys: string, pos: number): Chip {
  return new Chip('cite', keys, pos);
}
export function refChip(target: string, pos: number): Chip {
  return new Chip('ref', target, pos);
}
