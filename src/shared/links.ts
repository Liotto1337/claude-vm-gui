/** Ссылка, которую можно открыть в браузере: только http(s), без логина и пароля в адресе; иначе null. */
export function externalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^https?:\/\//i.test(raw)) return null;
  try {
    const u = new URL(raw);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname || u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}
