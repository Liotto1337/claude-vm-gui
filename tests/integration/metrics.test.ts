import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MetricsService } from '../../src/main/metrics';
import { SshConnection } from '../../src/main/ssh';
import type { MetricsSample } from '../../src/shared/ipc';
import { hasTestKey, tempKnownHosts, testConfig } from './helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasTestKey)('метрики ВМ', () => {
  let conn: SshConnection;
  const claudeDir = mkdtempSync(join(tmpdir(), 'cvg-cd-'));
  beforeAll(async () => {
    conn = new SshConnection(testConfig(), { knownHostsPath: tempKnownHosts(), askHostKey: async () => true });
    expect((await conn.connect()).ok).toBe(true);
  });
  afterAll(() => conn.close());

  it('два замера: CPU 0–100, есть диск /, память, процессы', async () => {
    const m = new MetricsService(conn, { claudeDir, slowMs: 5000, fastMs: 300 });
    const samples: MetricsSample[] = [];
    m.on('sample', (s) => samples.push(s));
    m.start();
    m.setActive(true);
    await expect.poll(() => samples.length, { timeout: 8000 }).toBeGreaterThanOrEqual(2);
    m.stop();
    const s = samples[samples.length - 1];
    expect(s.error).toBeNull();
    expect(s.cpu).toBeGreaterThanOrEqual(0);
    expect(s.cpu).toBeLessThanOrEqual(100);
    expect(s.disks.some((d) => d.mount === '/')).toBe(true);
    expect(s.mem!.total).toBeGreaterThan(0);
    expect(s.procs.length).toBeGreaterThan(0);
    expect(s.procs.length).toBeLessThanOrEqual(5);
    expect(s.net?.iface).toBeTruthy();
  });

  it('первый замер без CPU (не с чем сравнить)', async () => {
    const m = new MetricsService(conn, { claudeDir, slowMs: 5000, fastMs: 300 });
    const samples: MetricsSample[] = [];
    m.on('sample', (s) => samples.push(s));
    m.start();
    await expect.poll(() => samples.length, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
    m.stop();
    expect(samples[0].cpu).toBeNull();
  });

  it('после stop замеров нет', async () => {
    const m = new MetricsService(conn, { claudeDir, slowMs: 200, fastMs: 200 });
    const samples: MetricsSample[] = [];
    m.on('sample', (s) => samples.push(s));
    m.start();
    await expect.poll(() => samples.length, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
    m.stop();
    const n = samples.length;
    await sleep(700);
    expect(samples.length).toBe(n);
  });

  it('сведения о системе', async () => {
    const r = await new MetricsService(conn, { claudeDir }).info();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.os).toMatch(/\w/);
    expect(r.data.kernel).toMatch(/^\d+\./);
    expect(r.data.cores).toBeGreaterThanOrEqual(1);
  });
});
