import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import type { ClientChannel } from 'ssh2';
import { fail, ok, type ExitReason, type MenuKey, type Result } from '@shared/ipc';
import { dialogOpen } from '@shared/dialog';
import { bracketedPaste, keyBytes, slashCommand } from '@shared/paste';
import { validateSessionName } from '@shared/quote';
import { inputText } from '@shared/screen-parse';
import type { SshConnection } from './ssh';
import { exactPane, exactTarget, tmuxCmd, type TmuxService } from './tmux';

const NO_CLAUDE_TEXT = 'В сессии сейчас не claude, а обычная оболочка — текст выполнился бы как команда. Запустите claude.';
const CHECK_FAILED_TEXT = 'Не удалось проверить терминал. Попробуйте ещё раз.';
const NOT_CONFIRMED_TEXT = 'Claude Code не принял Enter. Посмотрите в терминал.';
const PROMPT_OPEN_TEXT =
  'В терминале открыто меню Claude Code (например, запрос разрешения). Ответьте прямо в терминале и повторите.';

/** Паузы отправки: опрос экрана, ожидание готовности поля, подтверждение, пауза без распознанного поля. */
export interface SendTimings { pollMs: number; settleMaxMs: number; confirmMs: number; fallbackMs: number }
const DEFAULT_TIMINGS: SendTimings = { pollMs: 60, settleMaxMs: 3000, confirmMs: 1500, fallbackMs: 300 };

export interface TerminalOptions {
  /** Снимок экрана сессии с атрибутами (`capture-pane -e`); null — не удалось. */
  probe?: (session: string) => Promise<string | null>;
  timings?: SendTimings;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  private readonly probe: (session: string) => Promise<string | null>;
  private readonly timings: SendTimings;

  constructor(private readonly conn: SshConnection, private readonly tmux: TmuxService, opts: TerminalOptions = {}) {
    super();
    this.probe = opts.probe ?? ((name) => this.capture(name));
    this.timings = opts.timings ?? DEFAULT_TIMINGS;
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
   * Если проверить не удалось — не пишем. `allowMenu` — для клавиш карточки меню: им открытое меню не мешает.
   */
  private async checkWritable(allowMenu = false): Promise<Result<void>> {
    const session = this.session;
    if (!session) return fail('NO_SESSION', 'Сессия не открыта');
    const sep = '__cvg_sep__';
    const cmd =
      `${tmuxCmd()} display-message -p -t ${exactPane(session)} '#{pane_current_command}\t#{pane_pid}' && ` +
      // Процесс панели и его дети: claude бывает и самой командой панели, и потомком оболочки
      `echo ${sep} && PP=$(${tmuxCmd()} display-message -p -t ${exactPane(session)} '#{pane_pid}') && ps -o args= -p "$PP" --ppid "$PP"; ` +
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
    if (!allowMenu && dialogOpen(screen)) return fail('PROMPT_OPEN', PROMPT_OPEN_TEXT);
    return ok(undefined);
  }

  private keyQueue: Promise<unknown> = Promise.resolve();

  /**
   * Клавиша из белого списка (карточка меню, «Остановить») — только если на переднем плане claude.
   * Клавиши идут строго по очереди: иначе Enter мог бы обогнать ↓ и выбрать вариант по умолчанию.
   */
  key(k: MenuKey): Promise<Result<void>> {
    const run = this.keyQueue.then(() => this.keyNow(k));
    this.keyQueue = run.catch(() => undefined);
    return run;
  }

  private async keyNow(k: MenuKey): Promise<Result<void>> {
    let bytes: string;
    try {
      bytes = keyBytes(k);
    } catch (e) {
      return fail('BAD_NAME', (e as Error).message);
    }
    if (!this.stream) return fail('NO_SESSION', 'Сессия не открыта');
    const check = await this.checkWritable(true);
    if (!check.ok) return check;
    this.stream?.write(bytes);
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

  private async capture(name: string): Promise<string | null> {
    try {
      const r = await this.conn.exec(`${tmuxCmd()} capture-pane -e -p -t ${exactPane(name)}`, { timeoutMs: 2000 });
      return r.code === 0 ? r.stdout : null;
    } catch {
      return null;
    }
  }

  /**
   * Ждёт, пока сообщение принято: поле опустело, изменилось или пропало совсем
   * (Claude Code сразу показал меню — например, запрос разрешения).
   * 'unknown' — ни одного снимка экрана за ms: проверить нечем.
   */
  private async accepted(name: string, before: string, ms: number): Promise<'yes' | 'no' | 'unknown'> {
    let seen = false;
    for (const t = Date.now(); Date.now() - t < ms; ) {
      await sleep(this.timings.pollMs);
      const screen = await this.probe(name);
      if (screen === null) continue;
      seen = true;
      const now = inputText(screen);
      if (now === null || now === '' || now !== before) return 'yes';
    }
    return seen ? 'no' : 'unknown';
  }

  /**
   * Сообщение: вставка, затем Enter — только когда Claude Code закончил обрабатывать вставку
   * (картинку, длинный текст). Enter, склеенный с концом вставки, Claude Code теряет.
   * Если за это время открылось меню (например, запрос разрешения) — Enter не нажимается: он выбрал бы пункт.
   * Поле не изменилось — ровно один повтор Enter, потом ошибка. Снимков экрана нет — без повтора.
   */
  async send(text: string, imagePaths: string[]): Promise<Result<void>> {
    const data = bracketedPaste(text, imagePaths);
    const name = this.session;
    const r = await this.writeChecked(() => data.slice(0, -1));
    if (!r.ok || !name) return r;
    const t = this.timings;
    const menuOpen = () => fail<void>('PROMPT_OPEN', PROMPT_OPEN_TEXT);

    let prev: string | null = null;
    let ready: string | null = null;
    let recognized = false;
    for (const start = Date.now(); Date.now() - start < t.settleMaxMs; ) {
      await sleep(t.pollMs);
      const screen = await this.probe(name);
      if (screen === null) continue;
      if (dialogOpen(screen)) return menuOpen();
      const now = inputText(screen);
      if (now !== null) recognized = true;
      if (now && now === prev) {
        ready = now;
        break;
      }
      prev = now;
    }
    if (!recognized) {
      // Поле не распознано (другой вид экрана) — как раньше, но с запасом на обработку вставки
      await sleep(t.fallbackMs);
      const screen = await this.probe(name);
      if (screen !== null && dialogOpen(screen)) return menuOpen();
      this.stream?.write('\r');
      return ok(undefined);
    }
    const before = ready ?? prev ?? '';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.stream || this.session !== name) return fail('NO_SESSION', 'Сессия не открыта');
      this.stream.write('\r');
      const verdict = await this.accepted(name, before, t.confirmMs);
      // Проверить нечем — Enter, скорее всего, сработал; повтор мог бы отправить сообщение дважды
      if (verdict !== 'no') return ok(undefined);
    }
    return fail('SEND_NOT_CONFIRMED', NOT_CONFIRMED_TEXT);
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
