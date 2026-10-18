import { homedir } from 'node:os';
import { join } from 'node:path';
import { fail, ok, type HostKeyPrompt, type ImageExt, type Result } from '@shared/ipc';
import { HintsService } from './hints';
import type { IpcHub } from './ipc';
import { SshConnection } from './ssh';
import { TerminalService } from './terminal';
import { TmuxService } from './tmux';
import { UploadService } from './upload';

const plural = (n: number, one: string, few: string, many: string) => {
  const n10 = n % 10;
  const n100 = n % 100;
  return n10 === 1 && n100 !== 11 ? one : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? few : many;
};

interface Services {
  conn: SshConnection;
  tmux: TmuxService;
  term: TerminalService;
  hints: HintsService;
  upload: UploadService;
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
        if (s.term.current === name) s.term.close();
        return s.tmux.kill(name);
      }),
    );
    h.handle('tmux:startClaude', (name: string) => this.need((s) => s.tmux.startClaude(name)));

    h.handle('term:open', (name: string, cols: number, rows: number) => this.need((s) => s.term.open(name, cols, rows)));
    h.listen('term:write', (data: string) => this.s?.term.write(data));
    h.listen('term:resize', (cols: number, rows: number) => this.s?.term.resize(cols, rows));
    h.handle('term:send', (text: string, paths: string[]) => this.need((s) => s.term.send(text, paths)));
    h.handle('term:setModel', (v: string) => this.need((s) => s.term.setModel(v)));
    h.handle('term:setEffort', (v: string) => this.need((s) => s.term.setEffort(v)));

    h.handle('hints:get', (cwd: string) => this.need((s) => s.hints.get(cwd)));
    h.handle('hints:files', (cwd: string) => this.need((s) => s.hints.files(cwd)));
    h.handle('hints:dirs', (partial: string) => this.need((s) => s.hints.dirs(partial)));
    h.handle('upload:image', (id: string, bytes: Uint8Array, ext: ImageExt) => this.need((s) => s.upload.image(id, bytes, ext)));
  }

  private async need<T>(fn: (s: Services) => Promise<Result<T>>): Promise<Result<T>> {
    if (!this.s || !this.s.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    try {
      return await fn(this.s);
    } catch (e) {
      return fail('NOT_CONNECTED', (e as Error).message);
    }
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
    });
    conn.on('state', (st) => this.hub.emit('connection:state', st));
    const r = await conn.connect();
    if (!r.ok) {
      conn.close();
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
    term.on('exit', (reason) => this.hub.emit('term:exit', reason));
    const upload = new UploadService(conn);
    upload.on('progress', (p) => this.hub.emit('upload:progress', p));
    const hints = new HintsService(conn);
    const stopPolling = tmux.startPolling((sessions) => this.hub.emit('tmux:sessions', sessions));
    this.s = { conn, tmux, term, hints, upload, stopPolling };
    void upload.cleanup();
    return ok(undefined);
  }

  disconnect(): void {
    this.hostKeyAnswer?.(false);
    this.hostKeyAnswer = null;
    const s = this.s;
    this.s = null;
    if (!s) return;
    s.stopPolling();
    s.term.close();
    s.conn.close();
  }
}
