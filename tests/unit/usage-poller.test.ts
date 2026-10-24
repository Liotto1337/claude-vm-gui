import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UsagePoller } from '../../src/shared/usage-poller';

const OUT = '__cvg_limits__\n{"five_hour":{"utilization":10,"resets_at":null}}\n__cvg_tokens__\n1 2 3 4\n';

describe('UsagePoller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('сразу при запуске и раз в every; stop — опрос встаёт', async () => {
    const exec = vi.fn().mockResolvedValue({ code: 0, stdout: OUT, stderr: '' });
    const p = new UsagePoller(exec, '/home/u/.claude', 60_000);
    const got: unknown[] = [];
    p.on('sample', (s) => got.push(s));
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toContain("'/home/u/.claude'");
    expect(p.latest?.tokens).toEqual({ input: 1, output: 2, cacheWrite: 3, cacheRead: 4 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(exec).toHaveBeenCalledTimes(2);
    p.stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(got).toHaveLength(2);
  });

  it('ошибка команды — прежний замер остаётся, исключения нет', async () => {
    const exec = vi.fn().mockResolvedValueOnce({ code: 0, stdout: OUT, stderr: '' }).mockRejectedValueOnce(new Error('обрыв'));
    const p = new UsagePoller(exec, '/c', 1000);
    p.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.latest?.tokens?.output).toBe(2);
    p.stop();
  });
});
