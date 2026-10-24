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

/** Замер той же модели → он; иначе запомненное по модели; иначе null. */
export function windowFor(ctx: SessionContext): Win | null {
  if (ctx.snapshot && ctx.snapshotModel === ctx.model) return { window: ctx.snapshot.window, buffer: ctx.snapshot.buffer };
  if (!ctx.model) return null;
  const w = load()[ctx.model];
  return w && typeof w.window === 'number' && w.window > 0 ? { window: w.window, buffer: Number(w.buffer) || 0 } : null;
}
