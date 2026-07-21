export type Theme = 'light' | 'dark';

/** Dark is Aldine's default; an explicit user choice is stored and wins. */
export function getTheme(): Theme {
  return localStorage.getItem('aldine.theme') === 'light' ? 'light' : 'dark';
}

export function setTheme(t: Theme): void {
  localStorage.setItem('aldine.theme', t);
  document.documentElement.dataset.theme = t;
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}
