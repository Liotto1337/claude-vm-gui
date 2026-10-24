import { describe, expect, it } from 'vitest';
import { formatReset, formatTokens, parseUsage, usageCommand } from '../../src/shared/usage';

const LIMITS = JSON.stringify({
  five_hour: { utilization: 28.0, resets_at: '2026-10-24T16:29:59.543239+00:00' },
  seven_day: { utilization: 51.4, resets_at: '2026-10-29T03:59:59.543261+00:00' },
  seven_day_opus: null,
});

describe('parseUsage', () => {
  it('лимиты 5 ч и недели, токены за сегодня', () => {
    const out = `__cvg_limits__\n${LIMITS}\n__cvg_tokens__\n1200 3400 50000 2000000\n`;
    expect(parseUsage(out, 7)).toEqual({
      t: 7,
      limits: {
        fiveHour: { pct: 28, resetsAt: '2026-10-24T16:29:59.543239+00:00' },
        week: { pct: 51, resetsAt: '2026-10-29T03:59:59.543261+00:00' },
      },
      tokens: { input: 1200, output: 3400, cacheWrite: 50000, cacheRead: 2000000 },
      error: null,
    });
  });
  it('без подписки (нет токена, ошибка сервиса) — только токены', () => {
    expect(parseUsage('__cvg_limits__\n__cvg_nolimits__\n\n__cvg_tokens__\n0 0 0 0\n', 1).limits).toBeNull();
    expect(parseUsage('__cvg_limits__\n\n__cvg_tokens__\n0 0 0 0\n', 1).limits).toBeNull();
    expect(parseUsage('__cvg_limits__\n{"type":"error","error":{"message":"x"}}\n__cvg_tokens__\n1 2 3 4\n', 1)).toMatchObject({
      limits: null, tokens: { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 },
    });
  });
  it('сервис лимитов не ответил или команда оборвана — прежние значения остаются, а «нет подписки» — стирает', () => {
    const prev = parseUsage(`__cvg_limits__\n${LIMITS}\n__cvg_tokens__\n1 2 3 4\n`, 1);
    const failed = parseUsage('__cvg_limits__\n\n__cvg_tokens__\n5 6 7 8\n', 2, prev);
    expect(failed.limits).toEqual(prev.limits);
    expect(failed.tokens).toEqual({ input: 5, output: 6, cacheWrite: 7, cacheRead: 8 });
    const cut = parseUsage(`__cvg_limits__\n${LIMITS}\n__cvg_tokens__\n`, 3, prev);
    expect(cut.tokens).toEqual(prev.tokens);
    expect(parseUsage('__cvg_limits__\n__cvg_nolimits__\n\n__cvg_tokens__\n1 1 1 1\n', 4, prev).limits).toBeNull();
  });
  it('мусор — ошибка, а не исключение', () => expect(parseUsage('что-то', 1)).toMatchObject({ limits: null, tokens: null, error: 'нет данных' }));
});

describe('форматирование', () => {
  it('токены: тысячи и миллионы', () => {
    expect(formatTokens(850)).toBe('850');
    expect(formatTokens(12_345)).toBe('12.3k');
    expect(formatTokens(832_300)).toBe('832.3k');
    expect(formatTokens(33_000)).toBe('33k');
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(999_960)).toBe('1M');
    expect(formatTokens(2_053_400)).toBe('2.1M');
    expect(formatTokens(1_000_000_000)).toBe('1B');
  });
  it('сброс: сегодня — время, другой день — день недели и время', () => {
    const now = new Date(2026, 9, 24, 12, 0).getTime();
    expect(formatReset(new Date(2026, 9, 24, 19, 29).toISOString(), now)).toBe('в 19:29');
    expect(formatReset(new Date(2026, 9, 26, 6, 59).toISOString(), now)).toBe('пн 06:59');
    expect(formatReset(null, now)).toBe('');
  });
});

describe('usageCommand', () => {
  const cmd = usageCommand('/home/u/.claude');
  it('токен подписки не попадает в аргументы процессов: заголовок — here-doc в stdin curl, не printf', () => {
    expect(cmd).toContain('curl -s -m 10 -K -');
    expect(cmd).toContain('api.anthropic.com/api/oauth/usage');
    expect(cmd).not.toMatch(/-H\s+["']?Authorization/);
    expect(cmd).not.toMatch(/printf[^\n]*Bearer/);
    expect(cmd).toMatch(/<<\s*'?CVG_EOF'?\nheader = "Authorization: Bearer \$t"\nCVG_EOF/);
  });
  it('каталог — в кавычках', () => expect(usageCommand("/tmp/a b'c")).toContain(`'/tmp/a b'\\''c'`));
});
