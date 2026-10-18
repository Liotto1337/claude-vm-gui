import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import type { ClientChannel } from 'ssh2';
import { fail, ok, type ExitReason, type Result } from '@shared/ipc';
import { bracketedPaste, slashCommand } from '@shared/paste';
import { validateSessionName } from '@shared/quote';
import type { SshConnection } from './ssh';
import { exactPane, exactTarget, tmuxCmd, type TmuxService } from './tmux';

const DIALOG_FOOTER = /Enter to confirm|Esc to cancel/i;
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
    let stream: ClientChannel;
    try {
      stream = await this.conn.openPty(`${tmuxCmd()} attach-session -t ${exactTarget(name)}`, cols, rows);
    } catch (e) {
      return fail('NOT_CONNECTED', (e as Error).message);
    }
    this.stream = stream;
    this.session = name;
    const decoder = new StringDecoder('utf8');
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
   * Открыто ли в терминале меню Claude Code (запрос разрешения, «доверять папке?»).
   * В таком меню Enter выбрал бы пункт по умолчанию — например, разрешил бы инструмент.
   */
  private async promptOpen(): Promise<boolean> {
    if (!this.session) return false;
    try {
      const r = await this.conn.exec(`${tmuxCmd()} capture-pane -p -t ${exactPane(this.session)}`);
      const tail = r.stdout.split('\n').filter((l) => l.trim() !== '').slice(-12).join('\n');
      return DIALOG_FOOTER.test(tail);
    } catch {
      return false;
    }
  }

  private async writeChecked(data: () => string): Promise<Result<void>> {
    if (!this.stream) return fail('NO_SESSION', 'Сессия не открыта');
    if (await this.promptOpen()) return fail('PROMPT_OPEN', PROMPT_OPEN_TEXT);
    if (!this.stream) return fail('NO_SESSION', 'Сессия не открыта');
    try {
      this.stream.write(data());
      return ok(undefined);
    } catch (e) {
      return fail('BAD_NAME', (e as Error).message);
    }
  }

  async send(text: string, imagePaths: string[]): Promise<Result<void>> {
    return this.writeChecked(() => bracketedPaste(text, imagePaths));
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
