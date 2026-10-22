// Версии релизов на GitHub: сравнение с версией приложения и разбор ответа releases/latest.

const parse = (v: string): number[] | null => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? m.slice(1).map(Number) : null;
};

/** latest новее current (три числа; пререлизы и прочее неразборчивое — нет). */
export function newerVersion(latest: string, current: string): boolean {
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export interface UpdateInfo { version: string; url: string }

const RELEASES = 'https://github.com/Liotto1337/';

/** Ответ GitHub releases/latest → версия без «v» и страница релиза (только https://github.com/Liotto1337/…). */
export function parseRelease(json: unknown): UpdateInfo | null {
  if (!json || typeof json !== 'object') return null;
  const { tag_name: tag, html_url: url } = json as { tag_name?: unknown; html_url?: unknown };
  if (typeof tag !== 'string' || typeof url !== 'string' || !url.startsWith(RELEASES) || !parse(tag)) return null;
  return { version: tag.trim().replace(/^v/, ''), url };
}
