import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateChecker } from '../../src/shared/update-checker';

const rel = (tag: string) => ({ tag_name: tag, html_url: `https://github.com/Liotto1337/claude-vm-gui/releases/tag/${tag}` });

describe('UpdateChecker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('первая проверка через first, потом раз в every; событие — только о новой версии', async () => {
    const fetchJson = vi.fn().mockResolvedValueOnce(rel('v0.3.0')).mockResolvedValueOnce(rel('v0.3.1'));
    const c = new UpdateChecker('Liotto1337/claude-vm-gui', '0.3.0', fetchJson, { first: 5000, every: 60_000 });
    const seen: unknown[] = [];
    c.on('available', (u) => seen.push(u));
    c.start();
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchJson).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchJson).toHaveBeenCalledWith('https://api.github.com/repos/Liotto1337/claude-vm-gui/releases/latest');
    expect(seen).toEqual([]);
    expect(c.latest).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(seen).toEqual([{ version: '0.3.1', url: rel('v0.3.1').html_url }]);
    expect(c.latest).toEqual({ version: '0.3.1', url: rel('v0.3.1').html_url });
    c.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('ошибка сети — без события и без исключения, следующая попытка по расписанию', async () => {
    const fetchJson = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(rel('v9.0.0'));
    const c = new UpdateChecker('Liotto1337/claude-vm-gui', '0.3.0', fetchJson, { first: 10, every: 100 });
    const seen: unknown[] = [];
    c.on('available', (u) => seen.push(u));
    c.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toHaveLength(1);
    c.stop();
  });

  it('та же новая версия повторно — одно событие', async () => {
    const fetchJson = vi.fn().mockResolvedValue(rel('v0.4.0'));
    const c = new UpdateChecker('Liotto1337/claude-vm-gui', '0.3.0', fetchJson, { first: 10, every: 100 });
    const seen: unknown[] = [];
    c.on('available', (u) => seen.push(u));
    c.start();
    await vi.advanceTimersByTimeAsync(310);
    expect(seen).toHaveLength(1);
    c.stop();
  });
});
