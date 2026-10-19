import { EventEmitter } from 'node:events';
import type { ScreenState } from '@shared/ipc';
import { pickClaudeSession, type ClaudeSessionInfo } from '@shared/claude-session';
import { shellQuote } from '@shared/quote';
import { classifyScreen } from '@shared/screen-parse';
import type { SshConnection } from './ssh';
import { exactPane, tmuxCmd } from './tmux';

const SEP = '__cvg_sep__';
const SESSIONS_EVERY = 4; // связка с sessions/*.json — каждый 4-й опрос (раз в 2 с)

/** Считается ли процесс панели claude (как в TerminalService.checkWritable). */
function isClaude(command: string, children: string): boolean {
  if (command === 'claude' || (command === 'node' && /claude/i.test(children))) return true;
  return process.env.CVG_FAKE_CLAUDE === '1' && command === 'cat';
}

/**
 * Опрос открытой сессии раз в 500 мс: что на экране (поле ввода, меню, незнакомое, не claude)
 * и какая сессия Claude Code в панели. События: `screen` ({ state, busy }), `claude` (ClaudeSessionInfo | null);
 * шлются только при изменении.
 */
export class SessionWatcher extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private name: string | null = null;
  private tick = 0;
  private busy = false;
  private gen = 0;
  private lastScreen = '';
  private lastClaude: string | null = null;
  private info: ClaudeSessionInfo | null = null;
  private readonly intervalMs: number;

  constructor(private readonly conn: SshConnection, private readonly opts: { claudeDir: string; intervalMs?: number }) {
    super();
    this.intervalMs = opts.intervalMs ?? 500;
  }

  get current(): string | null {
    return this.name;
  }

  start(name: string): void {
    this.stop();
    this.name = name;
    this.tick = 0;
    this.lastScreen = '';
    this.lastClaude = null;
    this.info = null;
    const gen = ++this.gen;
    void this.poll(gen);
    this.timer = setInterval(() => void this.poll(gen), this.intervalMs);
  }

  stop(): void {
    this.gen++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.name = null;
    this.busy = false;
  }

  private async poll(gen: number): Promise<void> {
    const name = this.name;
    // Следующий опрос не начинается, пока не закончился предыдущий
    if (!name || this.busy || !this.conn.connected) return;
    this.busy = true;
    const withSessions = this.tick++ % SESSIONS_EVERY === 0;
    const pane = exactPane(name);
    const dir = shellQuote(this.opts.claudeDir);
    const cmd =
      `P=$(${tmuxCmd()} display-message -p -t ${pane} '#{pane_id}\t#{pane_pid}\t#{pane_current_command}') || exit 3; ` +
      `echo "$P"; echo ${SEP}; PP=$(printf '%s' "$P" | cut -f2); ps -o pid=,args= -p "$PP" --ppid "$PP"; echo ${SEP}; ` +
      `${tmuxCmd()} capture-pane -e -p -t ${pane}` +
      (withSessions ? `; echo ${SEP}; for f in ${dir}/sessions/*.json; do [ -f "$f" ] && cat "$f"; echo; done` : '');
    let out: string | null = null;
    try {
      const r = await this.conn.exec(cmd, { timeoutMs: 3000 });
      if (r.code === 0) out = r.stdout;
    } catch {
      out = null;
    } finally {
      if (gen === this.gen) this.busy = false;
    }
    if (out === null || gen !== this.gen) return;

    const [head = '', children = '', screen = '', sessions] = out.split(`${SEP}\n`);
    const [paneId = '', panePid = '', command = ''] = head.trim().split('\t');
    const claude = isClaude(command.trim(), children);
    if (withSessions) {
      const pids = [Number(panePid), ...children.split('\n').map((l) => Number(l.trim().split(/\s+/)[0]))].filter((n) => n > 0);
      const records = (sessions ?? '').split('\n').filter((l) => l.trim().startsWith('{')).map((l) => {
        try {
          return JSON.parse(l) as unknown;
        } catch {
          return null;
        }
      });
      this.info = claude ? pickClaudeSession(records, pids, paneId) : null;
      const key = JSON.stringify(this.info && { sessionId: this.info.sessionId, cwd: this.info.cwd });
      if (key !== this.lastClaude) {
        this.lastClaude = key;
        this.emit('claude', this.info);
      }
    }
    const state: ScreenState = claude ? classifyScreen(screen) : { kind: 'no-claude' };
    const busy = claude && (this.info?.status === 'busy' || (state.kind === 'prompt' && state.status !== null));
    const key = JSON.stringify([state, busy]);
    if (key !== this.lastScreen) {
      this.lastScreen = key;
      this.emit('screen', { state, busy });
    }
  }
}
