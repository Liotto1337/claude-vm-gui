import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkKnownHosts, fingerprintSha256, hostKeyAlgorithms, keyTypeFromBlob, knownHostsLine, knownTypesFor } from '../../src/shared/known-hosts';

const fx = (name: string) => readFileSync(`tests/fixtures/${name}`, 'utf8');
const plain = fx('kh_plain').trim();
const [, type, b64] = plain.split(' ');
const key = Buffer.from(b64, 'base64');
const otherKey = Buffer.from(fx('kh_rsa').trim().split(' ')[2], 'base64');
const forged = Buffer.from(key);
forged[forged.length - 1] ^= 0xff;

describe('fingerprintSha256', () => {
  it('совпадает с ssh-keygen -lf', () => expect(fingerprintSha256(key)).toBe(fx('kh_fingerprint').trim()));
});

describe('keyTypeFromBlob', () => {
  it('ed25519', () => expect(keyTypeFromBlob(key)).toBe('ssh-ed25519'));
  it('rsa', () => expect(keyTypeFromBlob(otherKey)).toBe('ssh-rsa'));
});

describe('checkKnownHosts', () => {
  it('простая запись', () => expect(checkKnownHosts(plain, '127.0.0.1', 22, type, key)).toBe('match'));
  it('хешированная запись', () => expect(checkKnownHosts(fx('kh_hashed'), '127.0.0.1', 22, type, key)).toBe('match'));
  it('запись с портом', () => {
    expect(checkKnownHosts(fx('kh_port'), '127.0.0.1', 2222, type, key)).toBe('match');
    expect(checkKnownHosts(fx('kh_port'), '127.0.0.1', 22, type, key)).toBe('unknown');
  });
  it('список хостов через запятую', () =>
    expect(checkKnownHosts(`vm,127.0.0.1 ${type} ${b64}`, '127.0.0.1', 22, type, key)).toBe('match'));
  it('другой хост — unknown', () => expect(checkKnownHosts(plain, '10.9.9.9', 22, type, key)).toBe('unknown'));
  it('подменённый ключ — mismatch (и для хешированной записи)', () => {
    expect(checkKnownHosts(plain, '127.0.0.1', 22, type, forged)).toBe('mismatch');
    expect(checkKnownHosts(fx('kh_hashed'), '127.0.0.1', 22, type, forged)).toBe('mismatch');
  });
  it('ключ другого типа — unknown', () =>
    expect(checkKnownHosts(plain, '127.0.0.1', 22, 'ssh-rsa', otherKey)).toBe('unknown'));
  it('комментарии и пустые строки', () =>
    expect(checkKnownHosts(`# c\n\n${plain}\n`, '127.0.0.1', 22, type, key)).toBe('match'));
});

describe('knownHostsLine', () => {
  it('порт 22 — просто адрес', () => expect(knownHostsLine('127.0.0.1', 22, type, key)).toBe(plain));
  it('другой порт — [адрес]:порт', () => expect(knownHostsLine('h', 2222, type, key)).toBe(`[h]:2222 ${type} ${b64}`));
});

describe('ограничение типов ключа сервера по known_hosts', () => {
  it('известные типы хоста', () => {
    expect(knownTypesFor(plain, '127.0.0.1', 22)).toEqual(['ssh-ed25519']);
    expect(knownTypesFor(fx('kh_hashed'), '127.0.0.1', 22)).toEqual(['ssh-ed25519']);
    expect(knownTypesFor(`${plain}\n${fx('kh_rsa')}`, '127.0.0.1', 22).sort()).toEqual(['ssh-ed25519', 'ssh-rsa']);
    expect(knownTypesFor(plain, '10.9.9.9', 22)).toEqual([]);
  });
  it('алгоритмы для ssh2: rsa включает rsa-sha2-*', () => {
    expect(hostKeyAlgorithms(['ssh-rsa'])).toEqual(['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa']);
    expect(hostKeyAlgorithms(['ssh-ed25519'])).toEqual(['ssh-ed25519']);
  });
});
