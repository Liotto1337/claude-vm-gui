import { stripAnsi } from './screen-parse';

// Контекст сессии Claude Code: «занято» — по usage последнего ответа в журнале,
// разбивка — из вывода /context (Claude Code пишет его в журнал целиком, с ANSI-цветами).

export interface ContextCategory {
  name: string;
  tokens: number;
  pct: number;
  /** Цвет значка категории в выводе Claude Code: 'ansi:<код 30–37 | 90–97>' */
  color: string | null;
  /** Значок приглушён (Free space) */
  dim: boolean;
}
export interface ContextSnapshot { used: number; window: number; buffer: number; categories: ContextCategory[] }
export interface ContextView { used: number | null; window: number | null; pct: number | null; toAutocompact: number | null; level: 'ok' | 'warn' | 'danger' }

const WARN_PCT = 80;
const DANGER_SHARE = 0.05;
const NUM = '[\\d.]+[kKmM]?';
const TOTAL = new RegExp(`(${NUM})\\/(${NUM}) tokens \\(`);
const CATEGORY = new RegExp(`[⛀⛁⛶⛝] ([A-Za-z][^:⛀⛁⛶⛝]*): (${NUM})(?: tokens)? \\(([\\d.]+)%\\)`);
const GLYPHS = /[⛀⛁⛶⛝]/g;

/** «29.7k» → 29700, «1m» → 1e6, «671» → 671; не число — null. */
export function parseTokenCount(s: string): number | null {
  const m = /^([\d.]+)([kKmM]?)$/.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = m[2] === '' ? 1 : m[2].toLowerCase() === 'k' ? 1e3 : 1e6;
  return Math.round(n * mult);
}

/** Цвет и приглушённость значка категории: последний цветовой код перед последним значком до имени. */
function glyphStyle(raw: string, name: string): { color: string | null; dim: boolean } {
  const head = raw.slice(0, raw.indexOf(` ${name}:`));
  let glyph = -1;
  for (const m of head.matchAll(GLYPHS)) glyph = m.index;
  if (glyph < 0) return { color: null, dim: false };
  const before = head.slice(0, glyph);
  let color: string | null = null;
  let colorAt = -1;
  for (const m of before.matchAll(/\x1b\[(\d+)m/g)) {
    const code = Number(m[1]);
    if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      color = `ansi:${code}`;
      colorAt = m.index;
    }
  }
  const dimAt = before.lastIndexOf('\x1b[2m');
  return { color, dim: dimAt > colorAt && dimAt >= 0 };
}

/** Вывод /context → замер; другой формат — null. */
export function parseContextOutput(stdout: string): ContextSnapshot | null {
  let snap: ContextSnapshot | null = null;
  for (const raw of stdout.split('\n')) {
    const line = stripAnsi(raw);
    if (!snap) {
      const t = TOTAL.exec(line);
      if (t) {
        const used = parseTokenCount(t[1]);
        const window = parseTokenCount(t[2]);
        if (used === null || !window) return null;
        snap = { used, window, buffer: 0, categories: [] };
      }
      continue;
    }
    const c = CATEGORY.exec(line);
    if (!c) continue;
    const tokens = parseTokenCount(c[2]);
    if (tokens === null) continue;
    const name = c[1].trim();
    snap.categories.push({ name, tokens, pct: Number(c[3]), ...glyphStyle(raw, name) });
    if (name === 'Autocompact buffer') snap.buffer = tokens;
  }
  return snap;
}

/** Ответ основной ветки с usage → сколько сейчас в контексте и модель; иначе null. */
export function usedFromAssistant(rec: Record<string, unknown>): { used: number; model: string } | null {
  if (rec.type !== 'assistant' || rec.isSidechain === true) return null;
  const msg = rec.message as { model?: unknown; usage?: Record<string, unknown> } | undefined;
  const u = msg?.usage;
  if (!u || typeof msg?.model !== 'string' || msg.model === '<synthetic>') return null;
  const n = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : 0);
  return { used: n('input_tokens') + n('cache_read_input_tokens') + n('cache_creation_input_tokens'), model: msg.model };
}

/** Производные величины для значка и панели. */
export function contextView(used: number | null, win: { window: number; buffer: number } | null): ContextView {
  if (used === null) return { used: null, window: null, pct: null, toAutocompact: null, level: 'ok' };
  if (!win) return { used, window: null, pct: null, toAutocompact: null, level: 'ok' };
  const pct = Math.round((used / win.window) * 100);
  const toAutocompact = Math.max(0, win.window - win.buffer - used);
  const level = toAutocompact <= win.window * DANGER_SHARE ? 'danger' : pct >= WARN_PCT ? 'warn' : 'ok';
  return { used, window: win.window, pct, toAutocompact, level };
}
