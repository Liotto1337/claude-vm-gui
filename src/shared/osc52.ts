const MAX_BASE64 = 4 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Текст из OSC 52 (`ESC ] 52 ; <буферы> ; <base64>`): так tmux и Claude Code отдают скопированное
 * терминалу. Параметр — всё после `52;`. Запрос чтения (`?`) не выполняется: ВМ не должна читать буфер Windows.
 */
export function parseOsc52(data: string): string | null {
  const sep = data.indexOf(';');
  if (sep < 0) return null;
  const payload = data.slice(sep + 1);
  if (payload === '' || payload.length > MAX_BASE64 || !BASE64.test(payload)) return null;
  try {
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes) || null;
  } catch {
    return null;
  }
}
