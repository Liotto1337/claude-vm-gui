import { execFile } from 'node:child_process';
import { connect } from 'node:net';
import type { PreflightEvent, VmConfig } from '@shared/ipc';
import { parsePing } from '@shared/ping-parse';

const TEXT = {
  pingWarn: 'Нет ответа. Это не ошибка: многие серверы не отвечают на ping',
  tcpFail: 'Не удалось соединиться за 5 с. Проверьте интернет и что ВМ включена',
  skipped: 'Пропущено',
};

/** Системный ping: 2 запроса по 2 с. Вывод русской Windows приходит в cp866. */
export function runPing(host: string): Promise<{ ok: boolean; avgMs: number | null }> {
  // Адрес, начинающийся с «-», ping принял бы за ключ
  if (host.startsWith('-')) return Promise.resolve({ ok: false, avgMs: null });
  const win = process.platform === 'win32';
  const args = win ? ['-n', '2', '-w', '2000', host] : ['-c', '2', '-W', '2', host];
  return new Promise((resolve) => {
    execFile('ping', args, { windowsHide: true, encoding: 'buffer', timeout: 10_000 }, (_err, stdout) => {
      const text = new TextDecoder(win ? 'ibm866' : 'utf-8').decode(stdout ?? Buffer.alloc(0));
      const r = parsePing(text);
      resolve({ ok: r.ok, avgMs: r.avgMs });
    });
  });
}

export function checkTcp(host: string, port: number, timeoutMs = 5000): Promise<{ ok: boolean; ms: number | null; error?: string }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean, error?: string) => {
      socket.destroy();
      resolve({ ok, ms: ok ? Date.now() - started : null, error });
    };
    socket.setTimeout(timeoutMs, () => done(false, 'timeout'));
    socket.once('connect', () => done(true));
    socket.once('error', (e) => done(false, e.message));
  });
}

/** Ping (только предупреждение) и TCP (обязателен) до SSH. При неудаче TCP шаги SSH и tmux пропускаются. */
export async function runPreflight(
  cfg: VmConfig,
  emit: (e: PreflightEvent) => void,
  opts: { tcpTimeoutMs?: number } = {},
): Promise<{ ok: boolean; pingMs: number | null }> {
  emit({ step: 'ping', status: 'running', detail: '' });
  const ping = await runPing(cfg.host);
  emit(
    ping.ok
      ? { step: 'ping', status: 'ok', detail: ping.avgMs === null ? 'Ответ получен' : `2 из 2 ответов, в среднем ${ping.avgMs} мс` }
      : { step: 'ping', status: 'warn', detail: TEXT.pingWarn },
  );

  emit({ step: 'tcp', status: 'running', detail: '' });
  const tcp = await checkTcp(cfg.host, cfg.port, opts.tcpTimeoutMs);
  if (!tcp.ok) {
    emit({ step: 'tcp', status: 'fail', detail: TEXT.tcpFail });
    emit({ step: 'ssh', status: 'skipped', detail: TEXT.skipped });
    emit({ step: 'tmux', status: 'skipped', detail: TEXT.skipped });
    return { ok: false, pingMs: ping.avgMs };
  }
  emit({ step: 'tcp', status: 'ok', detail: `Порт открыт, соединение за ${tcp.ms} мс` });
  return { ok: true, pingMs: ping.avgMs };
}
