import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import type { ClientChannel } from 'ssh2';
import { ok, type Result } from '@shared/ipc';
import { shellQuote } from '@shared/quote';
import { newParseState, parseTranscriptLines, type ParseState } from '@shared/transcript-parse';
import type { SshConnection } from './ssh';

const TAIL_BYTES = 1_572_864; // 1,5 МБ
const BAD_STREAK = 20;
const MAX_WINDOW = 64 * 1024 * 1024; // дальше гигантскую строку пропускаем
const NOT_FOUND = 'Журнал сессии не найден';
const UNREADABLE = 'Не удалось прочитать переписку';

/**
 * Кусок файла [from, from+len) целыми строками. Если from > 0, первая строка могла начаться раньше —
 * она отбрасывается, а start указывает на начало первой целой строки (в байтах).
 */
async function readRange(conn: SshConnection, q: string, from: number, len: number): Promise<{ lines: string[]; start: number }> {
  const chunk = `tail -c +${from + 1} -- ${q} | head -c ${len}`;
  const cmd = from > 0 ? `${chunk} | head -n 1 | wc -c; ${chunk}` : `echo 0; ${chunk}`;
  const r = await conn.exec(cmd, { timeoutMs: 20_000 });
  if (r.code !== 0) throw new Error(r.stderr || 'read failed');
  const nl = r.stdout.indexOf('\n');
  const drop = Number(r.stdout.slice(0, nl).trim()) || 0;
  let body = r.stdout.slice(nl + 1);
  if (from > 0) {
    const first = body.indexOf('\n');
    body = first < 0 ? '' : body.slice(first + 1);
  }
  return { lines: body.split('\n').filter((l) => l !== ''), start: from + (from > 0 ? drop : 0) };
}

/**
 * Как readRange, но если в окне нет ни одной целой строки (строка длиннее окна — например, картинка base64),
 * окно расширяется назад до MAX_WINDOW; дальше строка пропускается, а start всё равно сдвигается назад.
 */
async function readLines(conn: SshConnection, q: string, from: number, len: number): Promise<{ lines: string[]; start: number }> {
  let f = from;
  let l = len;
  for (;;) {
    const part = await readRange(conn, q, f, l);
    if (part.lines.length > 0 || f === 0) return part;
    if (l >= MAX_WINDOW) return { lines: [], start: f };
    const grow = Math.min(l, f);
    f -= grow;
    l += grow;
  }
}

/**
 * Хвост файла (не больше bytes) целыми строками, размер файла и смещение первой целой строки.
 * Файла нет — пустой хвост: у новой сессии Claude Code создаёт журнал только с первым сообщением.
 */
export async function readTail(conn: SshConnection, path: string, bytes: number): Promise<{ lines: string[]; start: number; size: number }> {
  const q = shellQuote(path);
  const r = await conn.exec(`if [ -e ${q} ]; then stat -c %s -- ${q}; else echo missing; fi`, { timeoutMs: 5000 });
  if (r.stdout.trim() === 'missing') return { lines: [], start: 0, size: 0 };
  const size = Number(r.stdout.trim());
  if (r.code !== 0 || !Number.isFinite(size)) throw new Error(NOT_FOUND);
  const from = Math.max(0, size - bytes);
  const part = await readLines(conn, q, from, size - from);
  return { ...part, size };
}

/**
 * Журнал сессии Claude Code: хвост при открытии, затем слежение (`tail -F`), подгрузка ранней части.
 * События: `items` (ChatEvent без session), `unavailable` (причина).
 */
export class TranscriptService extends EventEmitter {
  private gen = 0;
  private path: string | null = null;
  private st: ParseState = newParseState();
  private start = 0;
  private stream: ClientChannel | null = null;
  private readonly tailBytes: number;

  constructor(private readonly conn: SshConnection, opts: { tailBytes?: number } = {}) {
    super();
    this.tailBytes = opts.tailBytes ?? TAIL_BYTES;
  }

  get following(): string | null {
    return this.path;
  }

  async follow(path: string | null): Promise<void> {
    this.stop();
    if (!path) return;
    const gen = ++this.gen;
    this.path = path;
    this.st = newParseState();
    let tail: Awaited<ReturnType<typeof readTail>>;
    try {
      tail = await readTail(this.conn, path, this.tailBytes);
    } catch {
      if (gen === this.gen) this.fail(NOT_FOUND);
      return;
    }
    if (gen !== this.gen) return;
    this.start = tail.start;
    parseTranscriptLines(tail.lines, this.st);
    if (this.st.badStreak >= BAD_STREAK) return this.fail(UNREADABLE);
    this.emit('items', { reset: true, prepend: false, items: [...this.st.items.values()], hasEarlier: tail.start > 0, context: this.st.context });
    await this.watch(path, tail.size, gen);
  }

  private async watch(path: string, size: number, gen: number): Promise<void> {
    // tail живёт, пока открыт stdin канала: при закрытии cat завершается и убивает tail
    const cmd = `tail -c +${size + 1} -F -- ${shellQuote(path)} 2>/dev/null & t=$!; cat >/dev/null; kill $t 2>/dev/null`;
    let stream: ClientChannel;
    try {
      stream = await this.conn.stream(cmd);
    } catch {
      return;
    }
    if (gen !== this.gen) {
      stream.end();
      stream.close();
      return;
    }
    this.stream = stream;
    const decoder = new StringDecoder('utf8');
    let buf = '';
    stream.on('error', () => {});
    stream.on('data', (d: Buffer) => {
      if (gen !== this.gen) return;
      buf += decoder.write(d);
      const nl = buf.lastIndexOf('\n');
      if (nl < 0) return;
      const lines = buf.slice(0, nl).split('\n');
      buf = buf.slice(nl + 1);
      const context = this.st.context;
      const r = parseTranscriptLines(lines, this.st);
      if (this.st.badStreak >= BAD_STREAK) return this.fail(UNREADABLE);
      // замер /context новых элементов ленты не даёт, но событие нужно
      if (r.changed.length || this.st.context !== context)
        this.emit('items', { reset: false, prepend: false, items: r.changed, hasEarlier: this.start > 0, context: this.st.context });
    });
  }

  async loadEarlier(): Promise<Result<void>> {
    const path = this.path;
    if (!path || this.start <= 0) return ok(undefined);
    const gen = this.gen;
    const from = Math.max(0, this.start - this.tailBytes);
    let part: { lines: string[]; start: number };
    try {
      part = await readLines(this.conn, shellQuote(path), from, this.start - from);
    } catch {
      return ok(undefined);
    }
    if (gen !== this.gen) return ok(undefined);
    this.start = part.start;
    const r = parseTranscriptLines(part.lines, this.st, true);
    this.emit('items', { reset: false, prepend: true, items: r.changed, hasEarlier: this.start > 0, context: this.st.context });
    return ok(undefined);
  }

  private fail(reason: string): void {
    this.stop();
    this.emit('unavailable', reason);
  }

  stop(): void {
    this.gen++;
    this.path = null;
    const s = this.stream;
    this.stream = null;
    if (s) {
      s.end();
      s.close();
    }
  }
}
