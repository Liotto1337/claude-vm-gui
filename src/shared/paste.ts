const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/**
 * Сообщение для терминала Claude Code: одной вставкой (bracketed paste), затем Enter.
 * ESC из текста вырезается, чтобы вставку нельзя было закрыть раньше времени.
 */
export function bracketedPaste(text: string, imagePaths: string[]): string {
  const clean = text.replace(/\r\n?/g, '\n').replace(/\x1b/g, '');
  const parts = [clean.trim() === '' ? null : clean, ...imagePaths].filter((p): p is string => p !== null);
  if (parts.length === 0) throw new Error('Пустое сообщение');
  return `${PASTE_START}${parts.join(' ')}${PASTE_END}\r`;
}

const ARG = /^[A-Za-z0-9._[\]-]+$/;

/** `/model <value>` или `/effort <level>` с Enter. Аргумент — только безопасные символы. */
export function slashCommand(cmd: 'model' | 'effort', arg: string): string {
  if (!ARG.test(arg)) throw new Error(`Недопустимое значение: ${arg}`);
  return `/${cmd} ${arg}\r`;
}
