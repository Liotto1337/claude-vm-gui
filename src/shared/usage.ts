// Расход Claude: лимиты подписки (как /usage) и токены за сегодня по журналам — одной командой по SSH.
import type { UsageSample, UsageWindow } from './ipc';
import { shellQuote } from './quote';

const LIMITS = '__cvg_limits__';
const TOKENS = '__cvg_tokens__';

/**
 * Токены ответа — по message.id: Claude Code пишет один ответ несколькими записями (по блоку на запись)
 * с той же usage, поздние — с выросшим output. Учитываются записи журналов с отметкой времени с начала суток ВМ.
 */
const AWK = String.raw`function num(k,  p) { p = index($0, k); return p ? substr($0, p + length(k)) + 0 : 0 }
{
  if (!match($0, /"timestamp":"[^"]*"/)) next
  if (substr($0, RSTART + 13, RLENGTH - 14) < c) next
  if (!match($0, /"id":"msg_[^"]*"/)) next
  id = substr($0, RSTART + 6, RLENGTH - 7)
  i = num("\"input_tokens\":"); o = num("\"output_tokens\":")
  w = num("\"cache_creation_input_tokens\":"); r = num("\"cache_read_input_tokens\":")
  if (!(id in O) || o > O[id]) { I[id] = i; O[id] = o; W[id] = w; R[id] = r }
}
END { for (k in O) { si += I[k]; so += O[k]; sw += W[k]; sr += R[k] }; printf "%d %d %d %d\n", si, so, sw, sr }`;

/**
 * Команда для ВМ. Лимиты — сервис Anthropic, которым пользуется /usage, с токеном подписки из .credentials.json:
 * токен остаётся на ВМ и не попадает в аргументы процессов (curl читает заголовок из stdin).
 */
export function usageCommand(claudeDir: string): string {
  const d = shellQuote(claudeDir);
  return [
    `echo ${LIMITS}`,
    `t=$(sed -n 's/.*"accessToken" *: *"\\([^"]*\\)".*/\\1/p' ${d}/.credentials.json 2>/dev/null | head -n 1)`,
    `if [ -n "$t" ]; then printf 'header = "Authorization: Bearer %s"\\n' "$t" | curl -s -m 10 -K - -H 'anthropic-beta: oauth-2025-04-20' https://api.anthropic.com/api/oauth/usage; fi`,
    'unset t',
    `echo; echo ${TOKENS}`,
    // Начало суток по часам ВМ — в UTC, как отметки времени журнала (date -u -d «дата 00:00» понял бы полночь как UTC)
    `c=$(date -u -d "@$(date -d "$(date +%F)" +%s)" +%Y-%m-%dT%H:%M:%S 2>/dev/null)`,
    `find ${d}/projects -name '*.jsonl' -newermt "$(date +%F)" -print0 2>/dev/null | xargs -0 -r grep -h '"usage"' 2>/dev/null | awk -v c="$c" ${shellQuote(AWK)}`,
  ].join('\n');
}

const usageWindow = (w: unknown): UsageWindow | null => {
  const x = w as { utilization?: unknown; resets_at?: unknown } | null;
  if (!x || typeof x.utilization !== 'number') return null;
  return { pct: Math.round(Math.min(100, Math.max(0, x.utilization))), resetsAt: typeof x.resets_at === 'string' ? x.resets_at : null };
};

/** Вывод usageCommand → замер; без подписки или при ошибке сервиса лимитов — limits: null. */
export function parseUsage(out: string, now: number): UsageSample {
  const a = out.indexOf(LIMITS);
  const b = out.indexOf(TOKENS);
  if (a < 0 || b < 0) return { t: now, limits: null, tokens: null, error: 'нет данных' };
  let limits: UsageSample['limits'] = null;
  try {
    const j = JSON.parse(out.slice(a + LIMITS.length, b).trim() || 'null') as Record<string, unknown> | null;
    const fiveHour = usageWindow(j?.five_hour);
    const week = usageWindow(j?.seven_day);
    if (fiveHour || week) limits = { fiveHour, week };
  } catch {
    // не JSON (нет сети, ошибка сервиса) — лимитов нет
  }
  const n = out.slice(b + TOKENS.length).trim().split(/\s+/).map(Number);
  const tokens = n.length === 4 && n.every((x) => Number.isFinite(x)) ? { input: n[0], output: n[1], cacheWrite: n[2], cacheRead: n[3] } : null;
  return { t: now, limits, tokens, error: limits || tokens ? null : 'нет данных' };
}

const short = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

/** 850 · 12,3 тыс. · 2,1 млн · 1 млрд */
export function formatTokens(n: number): string {
  if (n >= 1e9) return `${short(n / 1e9)} млрд`;
  if (n >= 1e6) return `${short(n / 1e6)} млн`;
  if (n >= 1e3) return `${short(n / 1e3)} тыс.`;
  return String(Math.round(n));
}

const pad = (n: number) => String(n).padStart(2, '0');
const DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** Когда сбросится лимит: сегодня — «в 19:29», другой день — «пн 06:59» (время устройства). */
export function formatReset(iso: string | null, now: number): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return new Date(now).toDateString() === d.toDateString() ? `в ${time}` : `${DAYS[d.getDay()]} ${time}`;
}
