import { fail, ok, type Result, type TmuxSession } from '@shared/ipc';
import { cdPrefix, shellQuote, validateSessionName } from '@shared/quote';
import { parseSessions, TMUX_LS_FORMAT } from '@shared/tmux-parse';
import type { SshConnection } from './ssh';

const BAD_NAME = 'Имя сессии: латиница, цифры, точка, дефис и подчёркивание, до 64 символов';
const NO_TMUX = 'На ВМ нет tmux. Установите его: sudo apt install tmux';

/**
 * Команда tmux. CVG_TMUX_SOCKET — отдельный сервер tmux (tmux -L): для демо-скриншотов,
 * чтобы в них не попали настоящие сессии.
 */
export function tmuxCmd(): string {
  const sock = process.env.CVG_TMUX_SOCKET;
  return sock && /^[A-Za-z0-9_-]+$/.test(sock) ? `tmux -L ${sock}` : 'tmux';
}

/** «=имя» — точное совпадение: без него tmux выбрал бы сессию по началу имени. */
export const exactTarget = (name: string) => shellQuote(`=${name}`);
export const exactPane = (name: string) => shellQuote(`=${name}:`);

export class TmuxService {
  constructor(private readonly conn: SshConnection) {}

  async list(): Promise<Result<TmuxSession[]>> {
    if (!this.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    const r = await this.conn.exec(`${tmuxCmd()} ls -F ${shellQuote(TMUX_LS_FORMAT)}`);
    if (r.code === 0) {
      const sessions = parseSessions(r.stdout);
      // Для E2E: процесс cat изображает claude, чтобы не запускать настоящий
      if (process.env.CVG_FAKE_CLAUDE === '1') for (const s of sessions) if (s.command === 'cat') s.claudeRunning = true;
      return ok(sessions);
    }
    if (r.code === 127) return fail('NO_TMUX', NO_TMUX);
    // Нет ни одной сессии — сервер tmux не запущен
    if (/no server running|error connecting|no sessions/i.test(r.stderr)) return ok([]);
    return fail('NO_SESSION', r.stderr.trim() || 'tmux ls завершился с ошибкой');
  }

  async create(name: string, dir: string, startClaude: boolean): Promise<Result<void>> {
    if (!validateSessionName(name)) return fail('BAD_NAME', BAD_NAME);
    const existing = await this.list();
    if (!existing.ok) return existing;
    if (existing.data.some((s) => s.name === name)) return fail('SESSION_EXISTS', `Сессия ${name} уже есть`);
    const r = await this.conn.exec(`${cdPrefix(dir)} || exit 90; ${tmuxCmd()} new-session -d -s ${shellQuote(name)} -c "$PWD"`);
    if (r.code === 90) return fail('BAD_DIR', `Папки ${dir} на ВМ нет`);
    if (r.code === 127) return fail('NO_TMUX', NO_TMUX);
    if (r.code !== 0) return fail('NO_SESSION', r.stderr.trim());
    return startClaude ? this.startClaude(name) : ok(undefined);
  }

  async kill(name: string): Promise<Result<void>> {
    if (!validateSessionName(name)) return fail('BAD_NAME', BAD_NAME);
    const r = await this.conn.exec(`${tmuxCmd()} kill-session -t ${exactTarget(name)}`);
    return r.code === 0 ? ok(undefined) : fail('NO_SESSION', `Сессии ${name} нет`);
  }

  async startClaude(name: string): Promise<Result<void>> {
    if (!validateSessionName(name)) return fail('BAD_NAME', BAD_NAME);
    const r = await this.conn.exec(`${tmuxCmd()} send-keys -t ${exactPane(name)} claude Enter`);
    return r.code === 0 ? ok(undefined) : fail('NO_SESSION', `Сессии ${name} нет`);
  }

  /** Опрашивает tmux ls и сообщает, когда список изменился. */
  startPolling(cb: (s: TmuxSession[]) => void, ms = 5000): () => void {
    let last = '';
    let busy = false;
    const tick = async () => {
      if (busy || !this.conn.connected) return;
      busy = true;
      try {
        const r = await this.list();
        if (r.ok) {
          const key = JSON.stringify(r.data);
          if (key !== last) {
            last = key;
            cb(r.data);
          }
        }
      } catch {
        // Обрыв связи во время опроса — следующий тик повторит
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), ms);
    return () => clearInterval(timer);
  }
}
