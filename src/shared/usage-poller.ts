import type { UsageSample } from './ipc';
import { parseUsage, usageCommand } from './usage';

type Exec = (cmd: string, opts?: { timeoutMs?: number }) => Promise<{ stdout: string }>;

/** Расход Claude по SSH: сразу при запуске и раз в everyMs. Ошибка — прежний замер остаётся. Без node:events — общий с Android. */
export class UsagePoller {
  latest: UsageSample | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<(s: UsageSample) => void>();

  constructor(private readonly exec: Exec, private readonly claudeDir: string, private readonly everyMs = 120_000) {}

  on(_e: 'sample', cb: (s: UsageSample) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.everyMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    try {
      const r = await this.exec(usageCommand(this.claudeDir), { timeoutMs: 20_000 });
      const s = parseUsage(r.stdout, Date.now(), this.latest);
      if (s.error) return;
      this.latest = s;
      for (const cb of this.listeners) cb(s);
    } catch {
      // нет связи — попробуем в следующий раз
    }
  }
}
