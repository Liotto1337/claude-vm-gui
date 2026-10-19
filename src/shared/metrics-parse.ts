import type { MetricsSample } from './ipc';

// Разбор /proc, df и ps с ВМ для панели «Сервер». Ошибки разбора — пустые/null значения, без исключений.

/** Счётчики первой строки «cpu» из /proc/stat. */
export function parseCpu(stat: string): number[] {
  const line = stat.split('\n').find((l) => /^cpu\s/.test(l));
  return line ? line.trim().split(/\s+/).slice(1).map(Number).filter((n) => Number.isFinite(n)) : [];
}

/** Загрузка CPU в % между двумя замерами: доля не-простоя (idle + iowait — простой). */
export function cpuPercent(prev: number[], next: number[]): number {
  if (prev.length < 5 || next.length < 5) return 0;
  const total = (v: number[]) => v.slice(0, 8).reduce((a, b) => a + b, 0);
  const idle = (v: number[]) => v[3] + v[4];
  const dt = total(next) - total(prev);
  if (dt <= 0) return 0;
  return Math.min(100, Math.max(0, 100 * (1 - (idle(next) - idle(prev)) / dt)));
}

export function parseMem(meminfo: string): MetricsSample['mem'] {
  const kb: Record<string, number> = {};
  for (const l of meminfo.split('\n')) {
    const m = /^(\w+):\s+(\d+)/.exec(l);
    if (m) kb[m[1]] = Number(m[2]) * 1024;
  }
  if (!kb.MemTotal) return null;
  const avail = kb.MemAvailable ?? kb.MemFree ?? 0;
  return { total: kb.MemTotal, used: kb.MemTotal - avail, swapTotal: kb.SwapTotal ?? 0, swapUsed: (kb.SwapTotal ?? 0) - (kb.SwapFree ?? 0) };
}

export function parseLoad(s: string): [number, number, number] | null {
  const v = s.trim().split(/\s+/).slice(0, 3).map(Number);
  return v.length === 3 && v.every(Number.isFinite) ? [v[0], v[1], v[2]] : null;
}

export function parseUptime(s: string): number | null {
  const v = Number(s.trim().split(/\s+/)[0]);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

/** df -PB1: только локальные устройства (источник — путь), без сетевых и облачных маунтов. */
export function parseDf(s: string): MetricsSample['disks'] {
  const out: MetricsSample['disks'] = [];
  for (const l of s.split('\n').slice(1)) {
    const f = l.trim().split(/\s+/);
    if (f.length < 6 || !f[0].startsWith('/')) continue;
    const total = Number(f[1]);
    const used = Number(f[2]);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used)) continue;
    out.push({ mount: f.slice(5).join(' '), total, used });
  }
  return out;
}

export function parseNetDev(s: string): Record<string, { rx: number; tx: number }> {
  const out: Record<string, { rx: number; tx: number }> = {};
  for (const l of s.split('\n').slice(2)) {
    const i = l.indexOf(':');
    if (i < 0) continue;
    const f = l.slice(i + 1).trim().split(/\s+/).map(Number);
    if (f.length >= 9 && Number.isFinite(f[0]) && Number.isFinite(f[8])) out[l.slice(0, i).trim()] = { rx: f[0], tx: f[8] };
  }
  return out;
}

/** Основной интерфейс: больше всего трафика между замерами (без lo); если трафика нет — первый не lo. */
export function pickInterface(prev: Record<string, { rx: number; tx: number }>, next: Record<string, { rx: number; tx: number }>): string | null {
  const names = Object.keys(next).filter((n) => n !== 'lo');
  if (names.length === 0) return null;
  const delta = (n: string) => (prev[n] ? next[n].rx - prev[n].rx + next[n].tx - prev[n].tx : 0);
  return names.reduce((best, n) => (delta(n) > delta(best) ? n : best), names[0]);
}

/** ps -eo pid=,ppid=,pcpu=,rss=,comm=,args= */
export function parsePs(s: string): MetricsSample['procs'] {
  const out: MetricsSample['procs'] = [];
  for (const l of s.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)/.exec(l);
    if (m) out.push({ pid: Number(m[1]), name: m[5], cpu: Number(m[3]), rss: Number(m[4]) * 1024, session: null });
  }
  return out;
}

/** У процессов claude — имя tmux-сессии из ~/.claude/sessions/<pid>.json (поле tmux «имя:@окно.%панель»). */
export function labelClaudeProcs(procs: MetricsSample['procs'], records: unknown[]): MetricsSample['procs'] {
  const byPid = new Map<number, string>();
  for (const r of records) {
    const x = r as { pid?: unknown; tmux?: unknown } | null;
    if (x && typeof x.pid === 'number' && typeof x.tmux === 'string' && x.tmux.includes(':')) byPid.set(x.pid, x.tmux.slice(0, x.tmux.lastIndexOf(':')));
  }
  return procs.map((p) => ({ ...p, session: byPid.get(p.pid) ?? null }));
}

export function parseOsRelease(s: string): string {
  const pretty = /^PRETTY_NAME="?([^"\n]*)"?/m.exec(s)?.[1];
  return pretty ?? /^NAME="?([^"\n]*)"?/m.exec(s)?.[1] ?? 'Linux';
}

const UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];

/** «5,1 ГБ», «412 МБ»: до 10 — с одним знаком после запятой. */
export function formatBytes(n: number): string {
  let v = Math.max(0, n);
  let u = 0;
  while (v >= 1024 && u < UNITS.length - 1) {
    v /= 1024;
    u++;
  }
  const num = v < 10 && u > 0 ? v.toFixed(1).replace(/\.0$/, '').replace('.', ',') : String(Math.round(v));
  return `${num} ${UNITS[u]}`;
}

export const formatRate = (n: number): string => `${formatBytes(n)}/с`;

export function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${m} мин`;
  return `${Math.max(1, m)} мин`;
}
