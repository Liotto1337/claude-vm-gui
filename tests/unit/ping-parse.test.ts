import { describe, expect, it } from 'vitest';
import { parsePing } from '../../src/shared/ping-parse';

const winEn = `
Pinging 203.0.113.10 with 32 bytes of data:
Reply from 203.0.113.10: bytes=32 time=40ms TTL=55
Reply from 203.0.113.10: bytes=32 time=42ms TTL=55

Ping statistics for 203.0.113.10:
    Packets: Sent = 2, Received = 2, Lost = 0 (0% loss),
Approximate round trip times in milli-seconds:
    Minimum = 40ms, Maximum = 42ms, Average = 41ms
`;
const winRu = `
Обмен пакетами с 203.0.113.10 по с 32 байтами данных:
Ответ от 203.0.113.10: число байт=32 время=40мс TTL=55
Ответ от 203.0.113.10: число байт=32 время<1мс TTL=55

Статистика Ping для 203.0.113.10:
    Пакетов: отправлено = 2, получено = 2, потеряно = 0
`;
const winUnreachable = `
Ответ от 192.168.1.1: Заданный узел недоступен.
Ответ от 192.168.1.1: Заданный узел недоступен.
    Пакетов: отправлено = 2, получено = 2, потеряно = 0
`;
const winTimeout = `
Request timed out.
Request timed out.
    Packets: Sent = 2, Received = 0, Lost = 2 (100% loss),
`;
const linux = `
PING 127.0.0.1 (127.0.0.1) 56(84) bytes of data.
64 bytes from 127.0.0.1: icmp_seq=1 ttl=64 time=0.041 ms
64 bytes from 127.0.0.1: icmp_seq=2 ttl=64 time=0.058 ms

--- 127.0.0.1 ping statistics ---
2 packets transmitted, 2 received, 0% packet loss, time 1001ms
rtt min/avg/max/mdev = 0.041/0.049/0.058/0.008 ms
`;

describe('parsePing', () => {
  it('английская Windows', () => expect(parsePing(winEn)).toEqual({ ok: true, avgMs: 41, received: 2, sent: 2 }));
  it('русская Windows, в том числе время<1мс', () =>
    expect(parsePing(winRu)).toEqual({ ok: true, avgMs: 20, received: 2, sent: 2 }));
  it('«узел недоступен» без TTL — неуспех', () => expect(parsePing(winUnreachable).ok).toBe(false));
  it('таймаут — неуспех', () => expect(parsePing(winTimeout)).toEqual({ ok: false, avgMs: null, received: 0, sent: 2 }));
  it('Linux', () => expect(parsePing(linux)).toEqual({ ok: true, avgMs: 0, received: 2, sent: 2 }));
  it('пустой вывод', () => expect(parsePing('')).toEqual({ ok: false, avgMs: null, received: 0, sent: 0 }));
});
