import { newerVersion, parseRelease, type UpdateInfo } from './version';

/**
 * Проверка релизов на GitHub: первая — через first мс после start, дальше раз в every.
 * Ошибки сети и разбора молча пропускаются. Событие available — один раз на каждую новую версию.
 */
export class UpdateChecker {
  latest: UpdateInfo | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(u: UpdateInfo) => void>();

  constructor(
    private readonly repo: string,
    private readonly current: string,
    private readonly fetchJson: (url: string) => Promise<unknown>,
    private readonly timers = { first: 5000, every: 6 * 3600_000 },
  ) {}

  on(_e: 'available', cb: (u: UpdateInfo) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => void this.tick(), this.timers.first);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    try {
      const u = parseRelease(await this.fetchJson(`https://api.github.com/repos/${this.repo}/releases/latest`));
      if (u && newerVersion(u.version, this.current) && u.version !== this.latest?.version) {
        this.latest = u;
        for (const cb of this.listeners) cb(u);
      }
    } catch {
      // нет сети, лимит GitHub, неверный ответ — попробуем в следующий раз
    }
    if (this.timer) this.timer = setTimeout(() => void this.tick(), this.timers.every);
  }
}
