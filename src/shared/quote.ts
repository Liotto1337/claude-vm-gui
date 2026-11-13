/** Строка в одинарных кавычках для sh: ничего внутри не раскрывается. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Переходит в папку, при необходимости создавая её. «~» и «~/…» раскрываются через $HOME. */
export function cdPrefix(dir: string, { create = false } = {}): string {
  const d = dir.trim();
  if (d === '' || d === '~') return 'cd "$HOME"';
  const path = d.startsWith('~/')
    ? `"$HOME"/${shellQuote(d.slice(2))}`
    : shellQuote(create && !d.startsWith('/') ? `./${d}` : d);
  return create ? `mkdir -p -- ${path} && cd ${path}` : `cd ${path}`;
}

// Без точки: tmux молча заменяет её на «_» (my.proj → my_proj)
const SESSION_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function validateSessionName(name: string): boolean {
  return SESSION_NAME.test(name);
}
