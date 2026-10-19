import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Client, utils, type AnyAuthMethod, type AuthHandlerMiddleware, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import { backoffDelay } from '@shared/backoff';
import { fail, ok, type ConnectionState, type HostKeyPrompt, type PreflightEvent, type Result, type VmConfig } from '@shared/ipc';
import { checkKnownHosts, fingerprintSha256, hostKeyAlgorithms, keyTypeFromBlob, knownHostsLine, knownTypesFor } from '@shared/known-hosts';
import { checkTcp, runPreflight } from './preflight';

const HANDSHAKE_MS = 20_000;

export interface SshOptions {
  knownHostsPath: string;
  askHostKey: (p: HostKeyPrompt) => Promise<boolean>;
  onPreflight?: (e: PreflightEvent) => void;
  /** Пароль (расшифрованный, только в главном процессе). Пробуется после ключа и ssh-agent. */
  password?: string;
}

export interface ExecResult { code: number; stdout: string; stderr: string }

type HostKeyVerdict = 'ok' | 'rejected' | 'mismatch';

/**
 * Одно SSH-соединение с ВМ. События: `state` (ConnectionState), `lost` (неожиданный обрыв),
 * `reconnected` (связь восстановлена автоматически).
 */
export class SshConnection extends EventEmitter {
  private client: Client | null = null;
  private sftpCache: Promise<SFTPWrapper> | null = null;
  private closing = false;
  private pingMs: number | null = null;

  constructor(private readonly cfg: VmConfig, private readonly opts: SshOptions) {
    super();
  }

  private setState(s: ConnectionState): void {
    this.emit('state', s);
  }

  private preflight(e: PreflightEvent): void {
    this.opts.onPreflight?.(e);
  }

  /** Проверка ping/TCP, затем SSH. */
  async connect(): Promise<Result<void>> {
    this.closing = false;
    this.setState({ state: 'connecting' });
    const pre = await runPreflight(this.cfg, (e) => this.preflight(e));
    this.pingMs = pre.pingMs;
    if (!pre.ok) {
      this.setState({ state: 'failed' });
      return fail('TCP_UNREACHABLE', `Порт ${this.cfg.port} на ${this.cfg.host} недоступен`);
    }
    this.preflight({ step: 'ssh', status: 'running', detail: '' });
    const r = await this.connectOnce(true);
    if (!r.ok) {
      this.preflight({ step: 'ssh', status: 'fail', detail: r.error.message });
      this.preflight({ step: 'tmux', status: 'skipped', detail: 'Пропущено' });
      this.setState({ state: 'failed' });
      return r;
    }
    this.preflight({ step: 'ssh', status: 'ok', detail: this.authDetail });
    this.setState({ state: 'connected', pingMs: this.pingMs });
    return r;
  }

  private authDetail = '';

  private authConfig(): Pick<ConnectConfig, 'privateKey' | 'agent'> | null {
    const keyName = this.cfg.keyPath.split(/[\\/]/).pop() ?? this.cfg.keyPath;
    if (existsSync(this.cfg.keyPath)) {
      const key = readFileSync(this.cfg.keyPath);
      const parsed = utils.parseKey(key);
      if (!(parsed instanceof Error)) {
        this.authDetail = keyName;
        return { privateKey: key };
      }
    }
    // Ключ зашифрован или не найден — пробуем ssh-agent
    const agent = process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : process.env.SSH_AUTH_SOCK;
    if (!agent) return null;
    this.authDetail = `${keyName} через ssh-agent`;
    return { agent };
  }

  /**
   * Порядок входа: ключ → ssh-agent → password → keyboard-interactive. Сначала `none` — узнать,
   * какие методы сервер предлагает: методы, которых нет в списке, не пробуются.
   */
  private authHandler(auth: Pick<ConnectConfig, 'privateKey' | 'agent'> | null): { handler: AuthHandlerMiddleware; offered: () => string[] | null } {
    const username = this.cfg.username;
    const password = this.opts.password;
    const queue: { method: string; auth: AnyAuthMethod; detail: string }[] = [];
    if (auth?.privateKey) queue.push({ method: 'publickey', auth: { type: 'publickey', username, key: auth.privateKey as Buffer }, detail: this.authDetail });
    if (auth?.agent) queue.push({ method: 'publickey', auth: { type: 'agent', username, agent: auth.agent as string }, detail: this.authDetail });
    if (password) {
      queue.push({ method: 'password', auth: { type: 'password', username, password }, detail: 'пароль' });
      queue.push({
        method: 'keyboard-interactive',
        auth: {
          type: 'keyboard-interactive',
          username,
          prompt: (_n, _i, _l, prompts, finish) => finish(prompts.map((p) => (p.echo ? '' : password))),
        },
        detail: 'пароль',
      });
    }
    let offered: string[] | null = null;
    let triedNone = false;
    const handler: AuthHandlerMiddleware = (methodsLeft, _partial, next) => {
      if (methodsLeft) offered = methodsLeft;
      if (!triedNone) {
        triedNone = true;
        return next({ type: 'none', username });
      }
      for (let step = queue.shift(); step; step = queue.shift()) {
        if (offered && !offered.includes(step.method)) continue;
        this.authDetail = step.detail;
        return next(step.auth);
      }
      return (next as unknown as (a: false) => void)(false);
    };
    return { handler, offered: () => offered };
  }

  private authFailedText(offered: string[] | null): string {
    if (!this.opts.password) return `Сервер не принял ключ ${this.cfg.keyPath}. Проверьте путь к ключу или ssh-agent`;
    if (offered && !offered.includes('password') && !offered.includes('keyboard-interactive'))
      return 'На сервере выключен вход по паролю. Используйте SSH-ключ';
    return 'Сервер не принял ни ключ, ни пароль';
  }

  private connectOnce(interactive: boolean): Promise<Result<void>> {
    const auth = this.authConfig();
    if (!auth && !this.opts.password) {
      return Promise.resolve(fail('AUTH_FAILED', `Не удалось прочитать ключ ${this.cfg.keyPath}, и ssh-agent недоступен`));
    }
    const { handler, offered } = this.authHandler(auth);
    const knownText = existsSync(this.opts.knownHostsPath) ? readFileSync(this.opts.knownHostsPath, 'utf8') : '';
    const knownTypes = knownTypesFor(knownText, this.cfg.host, this.cfg.port);
    return new Promise((resolve) => {
      const client = new Client();
      let verdict: HostKeyVerdict = 'ok';
      let mismatchText = '';
      let settled = false;
      // Свой таймер вместо readyTimeout ssh2: он замирает, пока человек сверяет отпечаток
      let deadline: ReturnType<typeof setTimeout> | null = null;
      const disarm = () => {
        if (deadline) clearTimeout(deadline);
        deadline = null;
      };
      const arm = () => {
        disarm();
        deadline = setTimeout(() => {
          settle(fail('TCP_UNREACHABLE', 'Сервер не ответил за 20 с'));
          client.end();
        }, HANDSHAKE_MS);
      };
      const settle = (r: Result<void>) => {
        disarm();
        if (settled) return;
        settled = true;
        resolve(r);
      };
      arm();

      client.on('ready', () => {
        this.client = client;
        this.sftpCache = null;
        client.on('close', () => this.onClosed(client));
        settle(ok(undefined));
      });
      client.on('error', (err) => {
        if (verdict === 'mismatch') settle(fail('HOSTKEY_MISMATCH', mismatchText));
        else if (verdict === 'rejected') settle(fail('HOSTKEY_REJECTED', 'Ключ сервера не принят'));
        else if (knownTypes.length > 0 && /host key|no matching/i.test(err.message))
          settle(
            fail('HOSTKEY_MISMATCH', `Сервер не предложил ключ известного типа (${knownTypes.join(', ')}). Возможна подмена сервера`),
          );
        else if (/authentication methods failed/i.test(err.message))
          settle(fail('AUTH_FAILED', this.authFailedText(offered())));
        else settle(fail('TCP_UNREACHABLE', err.message));
      });
      client.on('close', () => settle(fail('TCP_UNREACHABLE', 'Соединение закрыто')));

      client.connect({
        host: this.cfg.host,
        port: this.cfg.port,
        username: this.cfg.username,
        authHandler: handler,
        readyTimeout: 0,
        // Сон ПК или пропавшая сеть замечаются примерно за 15 с
        keepaliveInterval: 5_000,
        keepaliveCountMax: 3,
        ...(knownTypes.length > 0 ? { algorithms: { serverHostKey: hostKeyAlgorithms(knownTypes) as never } } : {}),
        hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
          this.verifyHost(key, interactive, { pause: disarm, resume: arm })
            .then((v) => {
              verdict = v.verdict;
              mismatchText = v.message;
              verify(v.verdict === 'ok');
            })
            .catch(() => {
              verdict = 'rejected';
              verify(false);
            });
        },
      });
    });
  }

  private async verifyHost(
    key: Buffer,
    interactive: boolean,
    timer: { pause: () => void; resume: () => void },
  ): Promise<{ verdict: HostKeyVerdict; message: string }> {
    const { host, port } = this.cfg;
    const type = keyTypeFromBlob(key);
    const fingerprint = fingerprintSha256(key);
    const text = existsSync(this.opts.knownHostsPath) ? readFileSync(this.opts.knownHostsPath, 'utf8') : '';
    const check = checkKnownHosts(text, host, port, type, key);
    if (check === 'match') return { verdict: 'ok', message: '' };
    if (check === 'mismatch') {
      const known = text
        .split(/\r?\n/)
        .map((l) => l.trim().split(/\s+/))
        .find(([h, t, b]) => t === type && b && checkKnownHosts(`${h} ${t} ${b}`, host, port, type, Buffer.from(b, 'base64')) === 'match');
      const knownFp = known ? fingerprintSha256(Buffer.from(known[2], 'base64')) : 'неизвестен';
      const message = `Ключ сервера изменился. В known_hosts: ${knownFp}, сервер прислал: ${fingerprint}`;
      return { verdict: 'mismatch', message };
    }
    if (!interactive) return { verdict: 'rejected', message: '' };
    timer.pause();
    const trust = await this.opts.askHostKey({ host, port, kind: 'unknown', fingerprint });
    timer.resume();
    if (!trust) return { verdict: 'rejected', message: '' };
    try {
      mkdirSync(dirname(this.opts.knownHostsPath), { recursive: true });
      const prefix = text === '' || text.endsWith('\n') ? '' : '\n';
      appendFileSync(this.opts.knownHostsPath, `${prefix}${knownHostsLine(host, port, type, key)}\n`);
    } catch {
      // known_hosts не записать (папка только для чтения, OneDrive) — доверяем ключу на эту сессию
    }
    return { verdict: 'ok', message: '' };
  }

  private onClosed(client: Client): void {
    if (client !== this.client) return;
    this.client = null;
    this.sftpCache = null;
    if (this.closing) return;
    this.emit('lost');
    void this.reconnectLoop();
  }

  private async reconnectLoop(): Promise<void> {
    for (let attempt = 1; !this.closing; attempt++) {
      this.setState({ state: 'reconnecting', attempt });
      await new Promise((r) => setTimeout(r, backoffDelay(attempt)));
      if (this.closing) return;
      // При переподключении достаточно TCP: ping мог бы тормозить каждую попытку на секунды
      const tcp = await checkTcp(this.cfg.host, this.cfg.port);
      if (!tcp.ok) continue;
      // Новый неизвестный ключ при переподключении не принимаем без человека
      const r = await this.connectOnce(false);
      if (this.closing) {
        this.client?.end();
        return;
      }
      if (r.ok) {
        this.setState({ state: 'connected', pingMs: this.pingMs });
        this.emit('reconnected');
        return;
      }
      if (r.error.code === 'HOSTKEY_MISMATCH' || r.error.code === 'HOSTKEY_REJECTED') {
        this.setState({ state: 'failed' });
        return;
      }
    }
  }

  get connected(): boolean {
    return this.client !== null;
  }

  exec(cmd: string, opts: { stdin?: string; timeoutMs?: number } = {}): Promise<ExecResult> {
    const client = this.client;
    if (!client) return Promise.reject(new Error('NOT_CONNECTED'));
    return new Promise((resolve, reject) => {
      client.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        const out: Buffer[] = [];
        const errOut: Buffer[] = [];
        let code = -1;
        const timer = opts.timeoutMs ? setTimeout(() => stream.close(), opts.timeoutMs) : null;
        stream.on('data', (d: Buffer) => out.push(d));
        stream.stderr.on('data', (d: Buffer) => errOut.push(d));
        stream.on('exit', (c: number | null) => {
          code = c ?? -1;
        });
        stream.on('close', () => {
          if (timer) clearTimeout(timer);
          resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(errOut).toString('utf8') });
        });
        if (opts.stdin !== undefined) stream.end(opts.stdin);
      });
    });
  }

  openPty(cmd: string, cols: number, rows: number): Promise<ClientChannel> {
    const client = this.client;
    if (!client) return Promise.reject(new Error('NOT_CONNECTED'));
    return new Promise((resolve, reject) => {
      client.exec(cmd, { pty: { term: 'xterm-256color', cols, rows } }, (err, stream) => (err ? reject(err) : resolve(stream)));
    });
  }

  sftp(): Promise<SFTPWrapper> {
    const client = this.client;
    if (!client) return Promise.reject(new Error('NOT_CONNECTED'));
    this.sftpCache ??= new Promise((resolve, reject) => client.sftp((err, s) => (err ? reject(err) : resolve(s))));
    return this.sftpCache;
  }

  close(): void {
    this.closing = true;
    const c = this.client;
    this.client = null;
    this.sftpCache = null;
    c?.end();
    this.setState({ state: 'idle' });
  }
}
