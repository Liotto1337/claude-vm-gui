import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Отпечаток как у OpenSSH: SHA256:<base64 без «=»>. key — открытый ключ в формате SSH (blob). */
export function fingerprintSha256(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

/** Тип ключа — первая строка внутри blob (uint32 длина + текст). */
export function keyTypeFromBlob(key: Buffer): string {
  const len = key.readUInt32BE(0);
  return key.subarray(4, 4 + len).toString('ascii');
}

const hostPattern = (host: string, port: number) => (port === 22 ? host : `[${host}]:${port}`);

function hostMatches(field: string, host: string, port: number): boolean {
  const target = hostPattern(host, port);
  if (field.startsWith('|1|')) {
    const [, , salt, hash] = field.split('|');
    if (!salt || !hash) return false;
    const mac = createHmac('sha1', Buffer.from(salt, 'base64')).update(target).digest();
    const expected = Buffer.from(hash, 'base64');
    return expected.length === mac.length && timingSafeEqual(mac, expected);
  }
  return field.split(',').includes(target);
}

/**
 * Сверка ключа сервера с known_hosts.
 * mismatch — у хоста записан другой ключ того же типа (возможна подмена сервера).
 */
export function checkKnownHosts(text: string, host: string, port: number, keyType: string, key: Buffer): 'match' | 'unknown' | 'mismatch' {
  let mismatch = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('@')) continue;
    const [hosts, type, b64] = line.split(/\s+/);
    if (!hosts || !type || !b64 || type !== keyType || !hostMatches(hosts, host, port)) continue;
    if (Buffer.from(b64, 'base64').equals(key)) return 'match';
    mismatch = true;
  }
  return mismatch ? 'mismatch' : 'unknown';
}

export function knownHostsLine(host: string, port: number, keyType: string, key: Buffer): string {
  return `${hostPattern(host, port)} ${keyType} ${key.toString('base64')}`;
}
