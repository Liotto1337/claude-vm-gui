import { homedir } from 'node:os';
import { join } from 'node:path';
import { fail, ok, type HostKeyPrompt, type MenuKey, type Result } from '@shared/ipc';
import { transcriptPath } from '@shared/claude-session';
import { plural } from '@shared/plural';
import { HintsService } from './hints';
import { MetricsService } from './metrics';
import { SessionWatcher } from './session-watch';
import { TranscriptService } from './transcript';
import type { IpcHub } from './ipc';
import { SshConnection } from './ssh';
import { TerminalService } from './terminal';
import { TmuxService } from './tmux';
import { UploadService } from './upload';

interface Services {
  conn: SshConnection;
  tmux: TmuxService;
  term: TerminalService;
  hints: HintsService;
  upload: UploadService;
  watch: SessionWatcher;
  transcript: TranscriptService;
  metrics: MetricsService;
  claudeDir: string;
  stopPolling: () => void;
}

/** Подключение к ВМ и все сервисы, доступные интерфейсу через window.api. */
export class AppController {
  private s: Services | null = null;
  private hostKeyAnswer: ((trust: boolean) => void) | null = null;
  private readonly knownHostsPath = process.env.CVG_KNOWN_HOSTS ?? join(homedir(), '.ssh', 'known_hosts');

  constructor(private readonly hub: IpcHub) {}

  register(): void {
    const h = this.hub;
    h.handle('connection:connect', () => this.connect());
    h.handle('connection:disconnect', () => this.disconnect());
    h.listen('connection:answerHostKey', (trust: boolean) => {
      this.hostKeyAnswer?.(trust);
      this.hostKeyAnswer = null;
    });

    h.handle('tmux:list', () => this.need((s) => s.tmux.list()));
    h.handle('tmux:create', (name: string, dir: string, start: boolean) => this.need((s) => s.tmux.create(name, dir, start)));
    h.handle('tmux:kill', (name: string) =>
      this.need(async (s) => {
        if (s.term.current === name) {
          s.term.close();
          this.stopChat(s);
        }
        return s.tmux.kill(name);
      }),
    );
    h.handle('tmux:startClaude', (name: string) => this.need((s) => s.tmux.startClaude(name)));

    h.handle('term:open', (name: string, cols: number, rows: number) =>
      this.need(async (s) => {
        const r = await s.term.open(name, cols, rows);
        // Устаревший open (пока открывался канал, выбрали другую сессию) тоже ok — ленту запускаем только для текущей
        if (r.ok && s.term.current === name) this.startChat(s, name);
        return r;
      }),
    );
    h.listen('term:write', (data: string) => this.s?.term.write(data));
    h.listen('term:resize', (cols: number, rows: number) => this.s?.term.resize(cols, rows));
    h.handle('term:send', (text: string, paths: string[]) => this.need((s) => s.term.send(text, paths)));
    h.handle('term:setModel', (v: string) => this.need((s) => s.term.setModel(v)));
    h.handle('term:setEffort', (v: string) => this.need((s) => s.term.setEffort(v)));

    h.listen('metrics:setActive', (fast: boolean) => this.s?.metrics.setActive(fast === true));
    h.handle('metrics:info', () => this.need((s) => s.metrics.info()));
    h.handle('chat:key', (k: MenuKey) => this.need((s) => s.term.key(k)));
    h.handle('chat:typeText', (t: string) => this.need((s) => s.term.typeText(t)));
    h.handle('chat:loadEarlier', () => this.need((s) => s.transcript.loadEarlier()));

    h.handle('hints:get', (cwd: string) => this.need((s) => s.hints.get(cwd)));
    h.handle('hints:files', (cwd: string) => this.need((s) => s.hints.files(cwd)));
    h.handle('hints:dirs', (partial: string) => this.need((s) => s.hints.dirs(partial)));
    h.handle('upload:read', (path: string, maxBytes: number) => this.need((s) => s.upload.read(path, maxBytes)));
    h.handle('upload:file', (id: string, bytes: Uint8Array, name: string) => this.need((s) => s.upload.file(id, bytes, name)));
  }

  private async need<T>(fn: (s: Services) => Promise<Result<T>>): Promise<Result<T>> {
    if (!this.s || !this.s.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    try {
      return await fn(this.s);
    } catch (e) {
      return fail('NOT_CONNECTED', (e as Error).message);
    }
  }

  /** Лента открытой сессии: экран (меню, статус) и журнал Claude Code. */
  private startChat(s: Services, name: string): void {
    s.transcript.stop();
    s.watch.start(name);
  }

  private stopChat(s: Services): void {
    s.watch.stop();
    s.transcript.stop();
  }

  private wireChat(watch: SessionWatcher, transcript: TranscriptService, claudeDir: string): void {
    watch.on('screen', (e) => this.hub.emit('chat:screen', { session: watch.current, ...e }));
    watch.on('claude', (info: { sessionId: string; cwd: string } | null, running: boolean) => {
      // claude запущен, но его сессию не найти (нет sessions/<pid>.json) — показываем терминал
      if (!info && running) {
        transcript.stop();
        this.hub.emit('chat:unavailable', { session: watch.current, reason: 'Не найдена сессия Claude Code' });
        return;
      }
      let path: string | null = null;
      try {
        path = info ? transcriptPath(claudeDir, info.cwd, info.sessionId) : null;
      } catch {
        path = null;
      }
      if (path !== transcript.following) void transcript.follow(path);
    });
    transcript.on('items', (e) => this.hub.emit('chat:items', { session: watch.current, ...e }));
    transcript.on('unavailable', (reason: string) => this.hub.emit('chat:unavailable', { session: watch.current, reason }));
  }

  private askHostKey(p: HostKeyPrompt): Promise<boolean> {
    this.hostKeyAnswer?.(false);
    return new Promise((resolve) => {
      this.hostKeyAnswer = resolve;
      this.hub.emit('connection:hostKey', p);
    });
  }

  async connect(): Promise<Result<void>> {
    this.disconnect();
    const cfg = this.hub.config();
    if (!cfg) return fail('CONFIG_INVALID', 'Укажите настройки подключения');

    const conn = new SshConnection(cfg, {
      knownHostsPath: this.knownHostsPath,
      askHostKey: (p) => this.askHostKey(p),
      onPreflight: (e) => this.hub.emit('connection:preflight', e),
      password: this.hub.password(),
    });
    // После обрыва «Подключено» показываем, только когда терминал снова в сессии — иначе ввод потеряется
    let reattaching = false;
    conn.on('lost', () => {
      reattaching = this.s?.term.current != null;
    });
    conn.on('state', (st) => {
      if (st.state === 'connected' && reattaching) {
        this.s?.term.once('reattached', () => {
          reattaching = false;
          this.hub.emit('connection:state', st);
        });
        return;
      }
      this.hub.emit('connection:state', st);
    });
    const r = await conn.connect();
    if (!r.ok) {
      conn.close();
      if (r.error.code === 'AUTH_FAILED' && cfg.passwordUnreadable)
        return fail('AUTH_FAILED', `${r.error.message}. Сохранённый пароль не удалось расшифровать (другая учётная запись Windows?) — введите его заново в настройках`);
      return r;
    }

    const tmux = new TmuxService(conn);
    this.hub.emit('connection:preflight', { step: 'tmux', status: 'running', detail: 'Загружаю список…' });
    const list = await tmux.list();
    if (!list.ok) {
      this.hub.emit('connection:preflight', { step: 'tmux', status: 'fail', detail: list.error.message });
      conn.close();
      return list;
    }
    const n = list.data.length;
    this.hub.emit('connection:preflight', { step: 'tmux', status: 'ok', detail: `${n} ${plural(n, 'сессия', 'сессии', 'сессий')}` });

    const term = new TerminalService(conn, tmux);
    term.on('data', (d: string) => this.hub.emit('term:data', d));
    term.on('exit', (reason) => {
      if (reason !== 'connection-lost' && this.s) this.stopChat(this.s);
      this.hub.emit('term:exit', reason);
    });
    // Каталог Claude Code на ВМ (журналы и sessions/*.json); CVG_CLAUDE_DIR — для тестов
    const home = (await conn.exec('printf %s "$HOME"').catch(() => ({ stdout: '/root' }))).stdout.trim() || '/root';
    const claudeDir = process.env.CVG_CLAUDE_DIR ?? `${home}/.claude`;
    const watch = new SessionWatcher(conn, { claudeDir });
    const transcript = new TranscriptService(conn);
    this.wireChat(watch, transcript, claudeDir);
    const metrics = new MetricsService(conn, { claudeDir });
    metrics.on('sample', (smp) => this.hub.emit('metrics:sample', smp));
    // После переподключения терминал снова в сессии — перезапускаем ленту
    term.on('reattached', () => {
      if (this.s && term.current) this.startChat(this.s, term.current);
    });
    const upload = new UploadService(conn);
    upload.on('progress', (p) => this.hub.emit('upload:progress', p));
    const hints = new HintsService(conn);
    const stopPolling = tmux.startPolling((sessions) => this.hub.emit('tmux:sessions', sessions));
    this.s = { conn, tmux, term, hints, upload, watch, transcript, metrics, claudeDir, stopPolling };
    metrics.start();
    void upload.cleanup();
    return ok(undefined);
  }

  /** Только для E2E (CVG_TEST_HOOKS=1): обрыв SSH, как при потере сети. */
  /** Окно приложения снова в фокусе — окно tmux под размер этого экрана (см. TerminalService.activate) */
  activate(): void {
    this.s?.term.activate();
  }

  simulateDrop(): void {
    (this.s?.conn as unknown as { client?: { end(): void } } | undefined)?.client?.end();
  }

  disconnect(): void {
    this.hostKeyAnswer?.(false);
    this.hostKeyAnswer = null;
    const s = this.s;
    this.s = null;
    if (!s) return;
    s.stopPolling();
    s.metrics.stop();
    this.stopChat(s);
    s.term.close();
    s.conn.close();
  }
}
