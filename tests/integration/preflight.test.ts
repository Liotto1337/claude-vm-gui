import { describe, expect, it } from 'vitest';
import type { PreflightEvent, VmConfig } from '../../src/shared/ipc';
import { checkTcp, runPing, runPreflight } from '../../src/main/preflight';

const cfg = (port: number): VmConfig => ({ host: '127.0.0.1', port, username: 'root', keyPath: '', theme: 'system' });

describe('checkTcp', () => {
  it('открытый порт 22', async () => expect((await checkTcp('127.0.0.1', 22)).ok).toBe(true));
  it('закрытый порт', async () => expect((await checkTcp('127.0.0.1', 1)).ok).toBe(false));
  it('недоступный адрес — по таймауту', async () => {
    const t = Date.now();
    const r = await checkTcp('203.0.113.10', 22, 1000);
    expect(r.ok).toBe(false);
    expect(Date.now() - t).toBeLessThan(1500);
  });
});

describe('runPing', () => {
  it('localhost отвечает', async () => expect(await runPing('127.0.0.1')).toMatchObject({ ok: true }));
  it('документационный адрес не отвечает', async () => expect((await runPing('203.0.113.10')).ok).toBe(false));
});

describe('runPreflight', () => {
  it('TCP не прошёл — SSH и tmux пропущены', async () => {
    const events: PreflightEvent[] = [];
    const r = await runPreflight(cfg(1), (e) => events.push(e));
    expect(r.ok).toBe(false);
    expect(events.map((e) => `${e.step}:${e.status}`)).toEqual([
      'ping:running', 'ping:ok', 'tcp:running', 'tcp:fail', 'ssh:skipped', 'tmux:skipped',
    ]);
    expect(events[3].detail).toBe('Не удалось соединиться за 5 с. Проверьте интернет и что ВМ включена');
  });

  it('ping не прошёл — только предупреждение', async () => {
    const events: PreflightEvent[] = [];
    const r = await runPreflight({ ...cfg(22), host: '203.0.113.10' }, (e) => events.push(e), { tcpTimeoutMs: 500 });
    expect(events.find((e) => e.step === 'ping' && e.status !== 'running')).toEqual({
      step: 'ping', status: 'warn', detail: 'Нет ответа. Это не ошибка: многие серверы не отвечают на ping',
    });
    expect(r.ok).toBe(false);
  });

  it('всё доступно', async () => {
    const r = await runPreflight(cfg(22), () => {});
    expect(r.ok).toBe(true);
    expect(r.pingMs).not.toBeNull();
  });
});
