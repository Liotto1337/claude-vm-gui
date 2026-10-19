import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ok, type Result, type SidebarLayout } from '@shared/ipc';
import { normalize } from '@shared/layout';

/**
 * Раскладка сайдбара: layout.json в папке данных приложения, `{ [адрес ВМ]: SidebarLayout }`.
 * Запись — с задержкой, чтобы перетаскивание не писало файл на каждое движение.
 */
export class LayoutStore {
  private data: Record<string, SidebarLayout> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly dir: string, private readonly debounceMs = 300) {}

  private get path(): string {
    return join(this.dir, 'layout.json');
  }

  private load(): Record<string, SidebarLayout> {
    if (this.data) return this.data;
    let raw: unknown = {};
    try {
      if (existsSync(this.path)) raw = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch {
      raw = {};
    }
    this.data = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw))
      for (const [host, l] of Object.entries(raw as Record<string, unknown>)) this.data[host] = normalize(l);
    return this.data;
  }

  get(host: string): SidebarLayout {
    return this.load()[host] ?? { v: 1, items: [] };
  }

  save(host: string, l: SidebarLayout): Result<void> {
    this.load()[host] = normalize(l);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
    return ok(undefined);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.data) return;
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }
}
