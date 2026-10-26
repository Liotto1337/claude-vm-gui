// Имена файлов, загруженных на ВМ: `ГГГГММДД-ЧЧММСС-xxxxxx-<исходное имя>` (старые — без исходного имени).

/** Часть пути, по которой разбор журнала узнаёт вложения */
export const UPLOAD_DIR_MARK = '/claude-vm-gui/uploads/';
/** Часть пути, по которой разбор журнала узнаёт файлы, которые Claude сделал для пользователя */
export const OUTBOX_DIR_MARK = '/.cache/claude-vm-gui/outbox/';

const isOutboxFile = (p: string) => {
  const at = p.indexOf(OUTBOX_DIR_MARK);
  return p.startsWith('/') && at >= 0 && p.length > at + OUTBOX_DIR_MARK.length && !p.endsWith('/');
};
/** Пути без пробелов: граница — пробел, кавычки, скобки; пунктуация в конце отбрасывается */
const plainPaths = (text: string) => text.split(/[\s`"'()<>[\]]+/).map((t) => t.replace(/[.,:;!?]+$/, ''));

/**
 * Пути к файлам outbox в ответе Claude. В обратных кавычках и в адресе markdown-ссылки путь берётся целиком
 * (имя может содержать пробелы, апострофы, скобки); иначе — до пробела, кавычки или скобки, без пунктуации в конце.
 * Без повторов, в порядке появления; сама папка (без имени файла) — не файл.
 */
export function outboxPaths(text: string): string[] {
  if (!text.includes(OUTBOX_DIR_MARK)) return [];
  const out: string[] = [];
  const add = (p: string) => {
    if (isOutboxFile(p) && !out.includes(p)) out.push(p);
  };
  for (const m of text.matchAll(/`([^`\n]+)`|\]\(([^)\n]+(?:\([^)\n]*\)[^)\n]*)*)\)|([^`\]]+)/g)) {
    const whole = (m[1] ?? m[2])?.trim();
    if (whole !== undefined && isOutboxFile(whole)) add(whole);
    else plainPaths(m[1] ?? m[2] ?? m[3]).forEach(add);
  }
  return out;
}

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_NAME = 80;

const pad = (n: number) => String(n).padStart(2, '0');
const rand6 = () => Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Имя файла на ВМ. В исходном имени всё, кроме букв, цифр, «.», «-», «_», заменяется на «_»:
 * без пробелов (разбор журнала режет по ним), кавычек и слешей. До 80 символов, расширение сохраняется.
 */
export function remoteName(original: string, d = new Date(), rand = rand6()): string {
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  let name = original.replace(/[^\p{L}\p{N}._-]/gu, '_');
  const chars = [...name];
  if (chars.length > MAX_NAME) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 16 ? [...name.slice(dot)] : [];
    name = [...chars.slice(0, MAX_NAME - ext.length), ...ext].join('');
  }
  return `${stamp}-${rand}-${name || 'file'}`;
}

/** Имя для показа: без даты и случайной части; старое имя (без исходного) — как есть. Принимает и полный путь. */
export function displayName(pathOrName: string): string {
  const base = pathOrName.slice(pathOrName.lastIndexOf('/') + 1);
  return /^\d{8}-\d{6}-[0-9a-f]{6}-(.+)$/.exec(base)?.[1] ?? base;
}

export const isImageName = (name: string): boolean => /\.(?:png|jpe?g|gif|webp)$/i.test(name);
