/** Строка в одинарных кавычках для sh: ничего внутри не раскрывается. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Команда перехода в папку. «~» и «~/…» раскрываются через $HOME, остальное экранируется. */
export function cdPrefix(dir: string): string {
  const d = dir.trim();
  if (d === '' || d === '~') return 'cd "$HOME"';
  if (d.startsWith('~/')) return `cd "$HOME"/${shellQuote(d.slice(2))}`;
  return `cd ${shellQuote(d)}`;
}

const SESSION_NAME = /^[A-Za-z0-9._-]{1,64}$/;

export function validateSessionName(name: string): boolean {
  return SESSION_NAME.test(name);
}
