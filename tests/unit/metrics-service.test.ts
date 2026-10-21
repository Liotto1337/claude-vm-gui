import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { MetricsService } from '../../src/main/metrics';
import type { SshConnection } from '../../src/main/ssh';
import type { MetricsSample } from '../../src/shared/ipc';

describe('MetricsService без подключения', () => {
  it('пока идёт переподключение, замер — с ошибкой (панель покажет «нет данных»), а не тишина', async () => {
    const conn = Object.assign(new EventEmitter(), { connected: false, exec: async () => ({ code: 0, stdout: '', stderr: '' }) });
    const m = new MetricsService(conn as unknown as SshConnection, { claudeDir: '/x', slowMs: 20, fastMs: 20 });
    const samples: MetricsSample[] = [];
    m.on('sample', (s) => samples.push(s));
    m.start();
    await new Promise((r) => setTimeout(r, 70));
    m.stop();
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((s) => s.error && s.cpu === null)).toBe(true);
  });
});
