import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cpuPercent, formatBytes, formatRate, formatUptime, labelClaudeProcs, parseCpu, parseDf, parseLoad, parseMem, parseNetDev,
  parseOsRelease, parsePs, parseUptime, pickInterface,
} from '../../src/shared/metrics-parse';

// Вывод /proc, df с этой ВМ (Ubuntu 22.04); ps и sessions — синтетические в том же формате
const fx = (n: string) => readFileSync(join(__dirname, '../fixtures/metrics', n), 'utf8');

describe('метрики', () => {
  it('cpuPercent по двум замерам', () => expect(cpuPercent(parseCpu(fx('stat1.txt')), parseCpu(fx('stat2.txt')))).toBeCloseTo(13.79, 1));
  it('cpuPercent: без изменений — 0, без деления на ноль', () => expect(cpuPercent(parseCpu(fx('stat1.txt')), parseCpu(fx('stat1.txt')))).toBe(0));
  it('parseMem: used = MemTotal − MemAvailable, байты', () =>
    expect(parseMem(fx('meminfo.txt'))).toEqual({ total: 4093943808, used: 2133602304, swapTotal: 0, swapUsed: 0 }));
  it('parseLoad и parseUptime', () => {
    const [load, up] = fx('load-uptime.txt').split('\n');
    expect(parseLoad(load)).toEqual([2.09, 2.45, 2.1]);
    expect(parseUptime(up)).toBe(796963);
  });
  it('parseDf: заголовок и сетевые маунты пропущены, байты', () =>
    expect(parseDf(fx('df.txt'))).toEqual([
      { mount: '/', total: 62238789632, used: 21332631552 },
      { mount: '/boot', total: 990052352, used: 269127680 },
    ]));
  it('pickInterface: самый нагруженный, не lo', () =>
    expect(pickInterface(parseNetDev(fx('netdev1.txt')), parseNetDev(fx('netdev2.txt')))).toBe('enp1s0'));
  it('parseNetDev: rx и tx', () => expect(parseNetDev(fx('netdev1.txt')).enp1s0).toEqual({ rx: 9094548178, tx: 1676794084 }));
  it('pickInterface: трафика нет — первый не lo', () =>
    expect(pickInterface(parseNetDev(fx('netdev1.txt')), parseNetDev(fx('netdev1.txt')))).toBe('enp1s0'));
  it('parsePs: pid, cpu, rss в байтах, имя', () =>
    expect(parsePs(fx('ps.txt'))[0]).toEqual({ pid: 1201, name: 'claude', cpu: 14.2, rss: 421888 * 1024, session: null }));
  it('labelClaudeProcs: имя сессии из tmux «claude-site:@3.%3»', () => {
    const recs = fx('sessions.txt').split('\n').filter(Boolean).map((l) => JSON.parse(l) as unknown);
    const procs = labelClaudeProcs(parsePs(fx('ps.txt')), recs);
    expect(procs.map((p) => p.session)).toEqual(['claude-site', null, 'claude-finder', null, null]);
  });
  it('parseOsRelease', () => expect(parseOsRelease(fx('os-release.txt'))).toBe('Ubuntu 22.04.5 LTS'));
  it('мусор не роняет разбор', () => {
    expect(parseDf('')).toEqual([]);
    expect(parsePs('garbage')).toEqual([]);
    expect(parseMem('')).toBeNull();
    expect(parseLoad('x')).toBeNull();
    expect(parseCpu('')).toEqual([]);
  });
});

describe('форматирование', () => {
  it('formatBytes по-русски', () => {
    expect(formatBytes(5.1 * 2 ** 30)).toBe('5,1 ГБ');
    expect(formatBytes(412 * 2 ** 20)).toBe('412 МБ');
    expect(formatBytes(512)).toBe('512 Б');
    expect(formatBytes(2.5 * 2 ** 40)).toBe('2,5 ТБ');
  });
  it('formatRate', () => {
    expect(formatRate(1.2 * 2 ** 20)).toBe('1,2 МБ/с');
    expect(formatRate(140 * 2 ** 10)).toBe('140 КБ/с');
  });
  it('formatUptime', () => {
    expect(formatUptime(12 * 86400 + 4 * 3600 + 60)).toBe('12 д 4 ч');
    expect(formatUptime(3 * 3600 + 25 * 60)).toBe('3 ч 25 мин');
    expect(formatUptime(90)).toBe('1 мин');
  });
});
