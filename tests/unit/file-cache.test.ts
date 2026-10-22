import { describe, expect, it, vi } from 'vitest';
import { FileCache } from '../../src/renderer/file-cache';

const res = (n: number) => ({ ok: true as const, data: { bytes: new Uint8Array(n), size: n, truncated: false } });

describe('FileCache', () => {
  it('повторный запрос того же пути — без второго чтения с ВМ', async () => {
    const read = vi.fn().mockResolvedValue(res(10));
    const c = new FileCache(read, 100);
    await c.get('/a', 50);
    await c.get('/a', 50);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('сверх предела — вытесняются самые старые', async () => {
    const read = vi.fn((p: string) => Promise.resolve(res(p === '/c' ? 60 : 40)));
    const c = new FileCache(read, 100);
    await c.get('/a', 100);
    await c.get('/b', 100);
    await c.get('/c', 100);
    await c.get('/a', 100);
    expect(read.mock.calls.map((x) => x[0])).toEqual(['/a', '/b', '/c', '/a']);
  });
  it('ошибка не кэшируется', async () => {
    const read = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'NOT_CONNECTED', message: 'x' } }).mockResolvedValueOnce(res(1));
    const c = new FileCache(read, 100);
    expect((await c.get('/a', 10)).ok).toBe(false);
    expect((await c.get('/a', 10)).ok).toBe(true);
  });
});
