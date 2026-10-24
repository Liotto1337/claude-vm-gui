import { useEffect, useRef, useState } from 'react';
import { formatBytes, formatRate, formatUptime } from '@shared/metrics-parse';
import { plural } from '@shared/plural';
import { setServerOpen, useAppState } from '../state';
import { IconClose } from './icons';
import { Bar, level, pct } from './Bar';
import { Sparkline } from './Sparkline';

const num = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });


/** Панель «Сервер» справа: CPU, память, диски, сеть, процессы, сведения о системе. */
export function ServerPanel() {
  const { metrics, metricsErrorAt, systemInfo } = useAppState();
  const close = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(Date.now());
  const last = metrics[metrics.length - 1];

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      if (prev?.isConnected) prev.focus();
    };
  }, []);

  const cpu = metrics.map((m) => m.cpu).filter((v): v is number => v !== null);
  const rx = metrics.map((m) => m.net?.rxRate ?? 0);
  const tx = metrics.map((m) => m.net?.txRate ?? 0);
  const stale = metricsErrorAt ? Math.max(1, Math.round((now - metricsErrorAt) / 1000)) : null;

  return (
    <div className="server-layer" onKeyDown={(e) => e.key === 'Escape' && setServerOpen(false)}>
      <div className="server-overlay" onClick={() => setServerOpen(false)} />
      <aside role="dialog" aria-modal="true" aria-label="Сервер" className="server-panel">
        <div className="server-head">
          <div className="server-title">
            <h2>Сервер</h2>
            <span className="caption">
              {systemInfo?.os ?? 'Linux'} · {stale ? <span className="text-warn">нет данных {stale} с</span> : 'обновляется каждые 2 с'}
            </span>
          </div>
          <button ref={close} type="button" className="pager-btn" aria-label="Закрыть" onClick={() => setServerOpen(false)}>
            <IconClose size={16} />
          </button>
        </div>

        <dl className="server-facts">
          <dt>Ядро</dt>
          <dd>{systemInfo?.kernel ?? '—'}</dd>
          <dt>Работает</dt>
          <dd>{last?.uptimeSec != null ? formatUptime(last.uptimeSec) : '—'}</dd>
          <dt>CPU</dt>
          <dd>{systemInfo ? `${systemInfo.cores} ${plural(systemInfo.cores, 'ядро', 'ядра', 'ядер')}` : '—'}</dd>
          <dt>Claude Code</dt>
          <dd>{systemInfo?.claudeVersion ?? '—'}</dd>
        </dl>

        <section className="server-section" aria-labelledby="srv-cpu">
          <div className="server-row">
            <h3 id="srv-cpu">Процессор</h3>
            <span className="server-big">{cpu.length ? `${Math.round(cpu[cpu.length - 1])}%` : '—'}</span>
          </div>
          <Sparkline series={[cpu]} max={100} label={`Загрузка процессора за 5 минут${cpu.length ? `, сейчас ${Math.round(cpu[cpu.length - 1])}%` : ''}`} />
          <span className="caption">Load average: {last?.load ? last.load.map(num).join(' · ') : '—'}</span>
        </section>

        <section className="server-section" aria-labelledby="srv-mem">
          <div className="server-row">
            <h3 id="srv-mem">Память</h3>
            <span className="caption">{last?.mem ? `${formatBytes(last.mem.used)} из ${formatBytes(last.mem.total)}` : '—'}</span>
          </div>
          {last?.mem ? <Bar label="ОЗУ" used={last.mem.used} total={last.mem.total} /> : null}
          <div className="server-row caption">
            <span className="swap-label">Swap</span>
            {last?.mem && last.mem.swapTotal > 0 ? (
              <>
                <Bar label="Swap" used={last.mem.swapUsed} total={last.mem.swapTotal} thin />
                <span>{formatBytes(last.mem.swapUsed)} из {formatBytes(last.mem.swapTotal)}</span>
              </>
            ) : (
              <span>нет</span>
            )}
          </div>
        </section>

        <section className="server-section" aria-labelledby="srv-disk">
          <h3 id="srv-disk">Диски</h3>
          {(last?.disks ?? []).map((d) => {
            const p = pct(d.used, d.total);
            return (
              <div key={d.mount} className="disk">
                <div className="server-row">
                  <span className="mono">{d.mount}</span>
                  <span className={`caption ${level(p)}-text`}>{formatBytes(d.used)} из {formatBytes(d.total)} · {p}%</span>
                </div>
                <Bar label={`Диск ${d.mount}`} used={d.used} total={d.total} />
              </div>
            );
          })}
        </section>

        <section className="server-section" aria-labelledby="srv-net">
          <div className="server-row">
            <h3 id="srv-net">Сеть</h3>
            <span className="caption">{last?.net?.iface ?? ''}</span>
            <span className="grow" />
            <span>↓ {last?.net ? formatRate(last.net.rxRate) : '—'}</span>
            <span className="caption">↑ {last?.net ? formatRate(last.net.txRate) : '—'}</span>
          </div>
          <Sparkline series={[rx, tx]} label="Входящий и исходящий трафик за 5 минут" height={40} />
        </section>

        <section className="server-section" aria-labelledby="srv-ps">
          <h3 id="srv-ps">Процессы</h3>
          <table className="procs">
            <thead>
              <tr>
                <th scope="col">Процесс</th>
                <th scope="col">CPU</th>
                <th scope="col">Память</th>
              </tr>
            </thead>
            <tbody>
              {(last?.procs ?? []).map((p) => (
                <tr key={p.pid}>
                  <td>
                    {p.name}
                    {p.session ? <span className="caption"> · {p.session}</span> : null}
                  </td>
                  <td>{num(p.cpu)}%</td>
                  <td>{formatBytes(p.rss)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </aside>
    </div>
  );
}
