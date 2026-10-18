import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import type { ClientChannel } from 'ssh2';
import { fail, ok, type ExitReason, type Result } from '@shared/ipc';
import { dialogOpen } from '@shared/dialog';
import { bracketedPaste, slashCommand } from '@shared/paste';
import { validateSessionName } from '@shared/quote';
import type { SshConnection } from './ssh';
import { exactPane, exactTarget, tmuxCmd, type TmuxService } from './tmux';

const NO_CLAUDE_TEXT = 'В сессии сейчас не claude, а обычная оболочка — текст выполнился бы как команда. Запустите claude.';
const CHECK_FAILED_TEXT = 'Не удалось проверить терминал. Попробуйте ещё раз.';
const PROMPT_OPEN_TEXT =
  'В терминале открыто меню Claude Code (например, запрос разрешения). Ответьте прямо в терминале и повторите.';

/**
 * Терминал открытой tmux-сессии: канал `tmux attach` с PTY.
 * События: `data` (строка для xterm.js), `exit` (ExitReason).
 */
export class TerminalService extends EventEmitter {
  private stream: ClientChannel | null = null;
  private session: string | null = null;
  private size = { cols: 80, rows: 24 };
  /** Номер последнего open: ответ более раннего open, пришедший позже, закрывается */
  private generation = 0;

  constructor(private readonly conn: SshConnection, private readonly tmux: TmuxService) {
    super();
    // После автопереподключения возвращаемся в ту же сессию
    // Событие `reattached` — терминал снова подключён (или подключать было нечего)
    conn.on('reconnected', () => {
      if (!this.session) return void this.emit('reattached');
      void this.open(this.session, this.size.cols, this.size.rows).finally(() => this.emit('reattached'));
    });
  }

  get current(): string | null {
    return this.session;
  }

  async open(name: string, cols: number, rows: number): Promise<Result<void>> {
    if (!validateSessionName(name)) return fail('BAD_NAME', 'Недопустимое имя сессии');
    if (!this.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    this.detachStream();
    this.size = { cols, rows };
    const gen = ++this.generation;
    let stream: ClientChannel;
    try {
      stream = await this.conn.openPty(`${tmuxCmd()} attach-session -t ${exactTarget(name)}`, cols, rows);
    } catch (e) {
      return fail('NOT_CONNECTED', (e as Error).message);
    }
    if (gen !== this.generation) {
      // Пока канал открывался, пользователь уже выбрал другую сессию
      stream.close();
      return ok(undefined);
    }
    this.stream = stream;
    this.session = name;
    const decoder = new StringDecoder('utf8');
    stream.on('error', () => {});
    stream.on('data', (d: Buffer) => this.emit('data', decoder.write(d)));
    stream.stderr.on('data', (d: Buffer) => this.emit('data', d.toString('utf8')));
    stream.on('close', () => {
      if (this.stream !== stream) return;
      this.stream = null;
      void this.exitReason(name).then((reason) => {
        if (reason !== 'connection-lost') this.session = null;
        this.emit('exit', reason);
      });
    });
    return ok(undefined);
  }

  private async exitReason(name: string): Promise<ExitReason> {
    if (!this.conn.connected) return 'connection-lost';
    try {
      const r = await this.tmux.list();
      if (!r.ok) return this.conn.connected ? 'detached' : 'connection-lost';
      return r.data.some((s) => s.name === name) ? 'detached' : 'killed';
    } catch {
      return 'connection-lost';
    }
  }

  write(data: string): void {
    this.stream?.write(data);
  }

  resize(cols: number, rows: number): void {
    this.size = { cols, rows };
    this.stream?.setWindow(rows, cols, 0, 0);
  }

  /**
   * Можно ли писать в терминал: на переднем плане claude (а не оболочка, где текст выполнился бы)
   * и не открыто меню Claude Code (там Enter выбрал бы пункт по умолчанию, например «разрешить»).
   * Если проверить не удалось — не пишем.
   */
  private async checkWritable(): Promise<Result<void>> {
    const session = this.session;
    if (!session) return fail('NO_SESSION', 'Сессия не открыта');
    const sep = '__cvg_sep__';
    const cmd =
      `${tmuxCmd()} display-message -p -t ${exactPane(session)} '#{pane_current_command}\t#{pane_pid}' && ` +
      `echo ${sep} && ps -o args= --ppid "$(${tmuxCmd()} display-message -p -t ${exactPane(session)} '#{pane_pid}')"; ` +
      `echo ${sep}; ${tmuxCmd()} capture-pane -p -t ${exactPane(session)}`;
    let out: string;
    try {
      const r = await this.conn.exec(cmd, { timeoutMs: 3000 });
      if (r.code !== 0) return fail('NOT_CONNECTED', CHECK_FAILED_TEXT);
      out = r.stdout;
    } catch {
      return fail('NOT_CONNECTED', CHECK_FAILED_TEXT);
    }
    const [head = '', children = '', screen = ''] = out.split(`${sep}\n`);
    const command = head.split('\t')[0].trim();
    const fake = process.env.CVG_FAKE_CLAUDE === '1' && command === 'cat';
    // Claude Code, поставленный через npm, виден как node — смотрим на аргументы процесса
    const isClaude = command === 'claude' || (command === 'node' && /claude/i.test(children));
    if (!isClaude && !fake) return fail('NO_CLAUDE', NO_CLAUDE_TEXT);
    if (dialogOpen(screen)) return fail('PROMPT_OPEN', PROMPT_OPEN_TEXT);
    return ok(undefined);
  }

  private async writeChecked(data: () => string): Promise<Result<void>> {
    if (!this.stream) return fail('NO_SESSION', 'Сессия не открыта');
    const check = await this.checkWritable();
    if (!check.ok) return check;
    if (!this.stream) return fail('NO_SESSION', 'Сессия не открыта');
    try {
      this.stream.write(data());
      return ok(undefined);
    } catch (e) {
      return fail('BAD_NAME', (e as Error).message);
    }
  }

  async send(text: string, imagePaths: string[]): Promise<Result<void>> {
    // Enter отдельной записью: в одном куске с концом вставки TUI мог бы принять его за часть текста
    const data = bracketedPaste(text, imagePaths);
    const r = await this.writeChecked(() => data.slice(0, -1));
    if (r.ok) setTimeout(() => this.stream?.write('\r'), 30);
    return r;
  }

  async setModel(value: string): Promise<Result<void>> {
    return this.writeChecked(() => slashCommand('model', value));
  }

  async setEffort(level: string): Promise<Result<void>> {
    return this.writeChecked(() => slashCommand('effort', level));
  }

  private detachStream(): void {
    const s = this.stream;
    this.stream = null;
    s?.close();
  }

  /** Отключиться от сессии; сама сессия в tmux продолжает работать. */
  close(): void {
    this.detachStream();
    this.session = null;
  }
}
