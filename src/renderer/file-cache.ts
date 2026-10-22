import type { Result } from '@shared/ipc';

type Read = { bytes: Uint8Array; size: number; truncated: boolean };

/** Вложения, прочитанные с ВМ: повторный показ — без нового чтения; всего не больше limit байт, старые вытесняются. */
export class FileCache {
  private readonly items = new Map<string, Read>();
  private total = 0;

  constructor(private readonly read: (path: string, maxBytes: number) => Promise<Result<Read>>, private readonly limit = 50 * 1024 * 1024) {}

  async get(path: string, maxBytes: number): Promise<Result<Read>> {
    const hit = this.items.get(path);
    if (hit) {
      this.items.delete(path);
      this.items.set(path, hit);
      return { ok: true, data: hit };
    }
    const r = await this.read(path, maxBytes);
    if (!r.ok) return r;
    this.items.set(path, r.data);
    this.total += r.data.bytes.byteLength;
    for (const [k, v] of this.items) {
      if (this.total <= this.limit || k === path) break;
      this.items.delete(k);
      this.total -= v.bytes.byteLength;
    }
    return r;
  }
}
