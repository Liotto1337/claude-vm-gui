import type { SessionContext } from '@shared/ipc';

// Размер окна и буфер автосжатия по модели — из последнего /context с этой моделью.
// Хранилище может быть недоступно — тогда просто без процента.

const KEY = 'cvg.contextWindows';
type Win = { window: number; buffer: number };

function load(): Record<string, Win> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, Win>) : {};
  } catch {
    return {};
  }
}

export function rememberWindow(model: string, w: Win): void {
  try {
    const all = load();
    if (all[model]?.window === w.window && all[model]?.buffer === w.buffer) return;
    localStorage.setItem(KEY, JSON.stringify({ ...all, [model]: { window: w.window, buffer: w.buffer } }));
  } catch {
    // нет хранилища — окно узнаем при следующем /context
  }
}

/** Замер не старше последнего ответа (или сжатия) — он сейчас вернее журнала */
const snapshotIsLatest = (ctx: SessionContext) =>
  ctx.snapshot !== null && ctx.snapshotAt !== null && (ctx.usedAt === null || ctx.snapshotAt >= ctx.usedAt);

/** Замер новее ответа или той же модели → он; иначе запомненное по модели; иначе null. */
export function windowFor(ctx: SessionContext): Win | null {
  if (ctx.snapshot && (snapshotIsLatest(ctx) || ctx.snapshotModel === ctx.model)) return { window: ctx.snapshot.window, buffer: ctx.snapshot.buffer };
  if (!ctx.model) return null;
  const w = load()[ctx.model];
  return w && typeof w.window === 'number' && w.window > 0 ? { window: w.window, buffer: Number(w.buffer) || 0 } : null;
}

/** Расхождение замера и журнала, при котором разбивка ещё считается текущей (доля окна) */
const SAME_SHARE = 0.01;

/**
 * Сколько занято сейчас и годится ли разбивка замера для полоски. Замер новее ответа (после /compact, в новой
 * сессии, после /model) — число из него; иначе из журнала, а категории — только если замер почти совпадает.
 */
export function contextNow(ctx: SessionContext): { used: number | null; fresh: boolean } {
  const snap = ctx.snapshot;
  if (snap && snapshotIsLatest(ctx)) return { used: snap.used, fresh: true };
  const fresh = !!snap && ctx.used !== null && Math.abs(snap.used - ctx.used) <= snap.window * SAME_SHARE;
  return { used: ctx.used, fresh };
}
