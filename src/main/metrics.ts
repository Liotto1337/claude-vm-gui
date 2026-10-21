import { EventEmitter } from 'node:events';
import { fail, ok, type MetricsSample, type Result, type SystemInfo } from '@shared/ipc';
import {
  cpuPercent, labelClaudeProcs, parseCpu, parseDf, parseLoad, parseMem, parseNetDev, parseOsRelease, parsePs, parseUptime, pickInterface,
} from '@shared/metrics-parse';
import { shellQuote } from '@shared/quote';
import type { SshConnection } from './ssh';

const SEP = '__cvg_sep__';
const TOP = 5;

/**
 * Параметры ВМ одной командой по SSH: раз в slowMs в фоне (чтобы графики были заполнены к открытию панели)
 * и раз в fastMs, пока панель открыта. Событие `sample` (MetricsSample).
 */
export class MetricsService extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private fast = false;
  private busy = false;
  private gen = 0;
  private prev: { cpu: number[]; net: Record<string, { rx: number; tx: number }>; t: number } | null = null;
  private readonly slowMs: number;
  private readonly fastMs: number;

  constructor(private readonly conn: SshConnection, private readonly opts: { claudeDir: string; slowMs?: number; fastMs?: number }) {
    super();
    this.slowMs = opts.slowMs ?? 10_000;
    this.fastMs = opts.fastMs ?? 2000;
  }

  start(): void {
    this.stop();
    this.gen++;
    this.schedule();
    void this.sample(this.gen);
  }

  /** Панель открыта — чаще; закрыта — реже. */
  setActive(fast: boolean): void {
    if (fast === this.fast || !this.timer) {
      this.fast = fast;
      return;
    }
    this.fast = fast;
    this.schedule();
    if (fast) void this.sample(this.gen);
  }

  stop(): void {
    this.gen++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.busy = false;
    this.prev = null;
  }

  private schedule(): void {
    if (this.timer) clearInterval(this.timer);
    const gen = this.gen;
    this.timer = setInterval(() => void this.sample(gen), this.fast ? this.fastMs : this.slowMs);
  }

  private async sample(gen: number): Promise<void> {
    if (this.busy) return;
    if (!this.conn.connected) {
      // Переподключение: замер с ошибкой, чтобы панель показала «нет данных N с», а не застывшие цифры
      this.prev = null;
      const empty = { cpu: null, load: null, uptimeSec: null, mem: null, disks: [], net: null, procs: [] };
      this.emit('sample', { t: Date.now(), ...empty, error: 'Нет подключения к ВМ' } satisfies MetricsSample);
      return;
    }
    this.busy = true;
    const cmd = [
      'head -n 1 /proc/stat',
      'cat /proc/meminfo',
      'cat /proc/loadavg /proc/uptime',
      'cat /proc/net/dev',
      'df -PB1 -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs 2>/dev/null',
      `ps -eo pid=,ppid=,pcpu=,rss=,comm=,args= --sort=-pcpu | head -n ${TOP + 3}`,
      `for f in ${shellQuote(this.opts.claudeDir)}/sessions/*.json; do [ -f "$f" ] && cat "$f"; echo; done`,
    ].join(`; echo ${SEP}; `);
    let out: string | null = null;
    let error: string | null = null;
    try {
      const r = await this.conn.exec(cmd, { timeoutMs: 5000 });
      if (r.stdout.includes(SEP)) out = r.stdout;
      else error = 'Команда не выполнилась';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      if (gen === this.gen) this.busy = false;
    }
    if (gen !== this.gen) return;
    const t = Date.now();
    if (out === null) {
      this.emit('sample', { t, cpu: null, load: null, uptimeSec: null, mem: null, disks: [], net: null, procs: [], error } satisfies MetricsSample);
      return;
    }
    const [stat = '', mem = '', loadUp = '', netdev = '', df = '', ps = '', sessions = ''] = out.split(`${SEP}\n`);
    const cpu = parseCpu(stat);
    const net = parseNetDev(netdev);
    const prev = this.prev;
    this.prev = { cpu, net, t };
    let netSample: MetricsSample['net'] = null;
    if (prev) {
      const iface = pickInterface(prev.net, net);
      const dt = (t - prev.t) / 1000;
      if (iface && prev.net[iface] && dt > 0)
        netSample = { iface, rxRate: Math.max(0, (net[iface].rx - prev.net[iface].rx) / dt), txRate: Math.max(0, (net[iface].tx - prev.net[iface].tx) / dt) };
    }
    const [load = '', up = ''] = loadUp.split('\n');
    const records = sessions.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => {
      try {
        return JSON.parse(l) as unknown;
      } catch {
        return null;
      }
    });
    // ps и head из самой команды в топ не попадают
    const procs = labelClaudeProcs(parsePs(ps), records).filter((p) => p.name !== 'ps' && p.name !== 'head').slice(0, TOP);
    this.emit('sample', {
      t, cpu: prev ? cpuPercent(prev.cpu, cpu) : null, load: parseLoad(load), uptimeSec: parseUptime(up), mem: parseMem(mem),
      disks: parseDf(df), net: netSample, procs, error: null,
    } satisfies MetricsSample);
  }

  /** ОС, ядро, число ядер, версия Claude Code — один раз после подключения. */
  async info(): Promise<Result<SystemInfo>> {
    try {
      const r = await this.conn.exec(
        `cat /etc/os-release 2>/dev/null; echo ${SEP}; uname -r; echo ${SEP}; nproc; echo ${SEP}; bash -lc 'claude --version' 2>/dev/null | head -n 1`,
        { timeoutMs: 15_000 },
      );
      const [os = '', kernel = '', cores = '', ver = ''] = r.stdout.split(`${SEP}\n`);
      const v = /^\s*(\d+\.\d+\.\d+)/.exec(ver)?.[1] ?? null;
      return ok({ os: parseOsRelease(os), kernel: kernel.trim(), cores: Number(cores.trim()) || 1, claudeVersion: v });
    } catch (e) {
      return fail('NOT_CONNECTED', (e as Error).message);
    }
  }
}
