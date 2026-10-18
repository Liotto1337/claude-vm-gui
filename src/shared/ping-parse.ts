export interface PingResult {
  ok: boolean;
  avgMs: number | null;
  received: number;
  sent: number;
}

/**
 * Разбор вывода системного ping (Windows на любом языке, Linux).
 * Успешный ответ — строка с «TTL=»: слова зависят от языка, а TTL есть всегда.
 */
export function parsePing(stdout: string): PingResult {
  const replies = stdout.split(/\r?\n/).filter((l) => /ttl=/i.test(l));
  const times = replies
    .map((l) => /(?:time|время)([=<])\s*([\d.]+)\s*(?:ms|мс)/i.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => (m[1] === '<' ? 0 : Number(m[2])));

  const sentMatch =
    /(?:Sent|отправлено)\s*=\s*(\d+)/i.exec(stdout) ?? /(\d+)\s+packets transmitted/i.exec(stdout);
  const received = replies.length;
  const sent = sentMatch ? Number(sentMatch[1]) : received;

  const linuxAvg = /=\s*[\d.]+\/([\d.]+)\//.exec(stdout);
  let avgMs: number | null = null;
  if (received > 0) {
    if (linuxAvg) avgMs = Math.round(Number(linuxAvg[1]));
    else if (times.length) avgMs = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  }
  return { ok: received > 0, avgMs, received, sent };
}
