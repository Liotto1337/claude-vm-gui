import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SshConnection } from '../../src/main/ssh';
import { UploadService } from '../../src/main/upload';
import { hasTestKey, tempKnownHosts, testConfig } from './helpers';

const OUTBOX = join(homedir(), '.cache/claude-vm-gui/outbox');

describe.skipIf(!hasTestKey)('папка outbox: чтение, скачивание, очистка', () => {
  let conn: SshConnection;
  let upload: UploadService;
  const made: string[] = [];
  const local = mkdtempSync(join(tmpdir(), 'cvg-outbox-'));
  const put = (name: string, data: Buffer | string) => {
    mkdirSync(OUTBOX, { recursive: true });
    const p = join(OUTBOX, name);
    writeFileSync(p, data);
    made.push(p);
    return p;
  };
  const connect = async () => {
    const c = new SshConnection(testConfig(), { knownHostsPath: tempKnownHosts(), askHostKey: async () => true });
    expect((await c.connect()).ok).toBe(true);
    return c;
  };

  beforeAll(async () => {
    rmSync(join(OUTBOX, 'cvg-test-none'), { force: true });
    conn = await connect();
    upload = new UploadService(conn);
  });

  afterAll(() => {
    for (const f of made) rmSync(f, { force: true });
    rmSync(local, { recursive: true, force: true });
    conn.close();
  });

  it('папка outbox создаётся сама, файл читается', async () => {
    rmSync(OUTBOX, { recursive: true, force: true });
    const missing = await upload.read(join(OUTBOX, 'cvg-test-none'), 10);
    expect(missing).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(existsSync(OUTBOX)).toBe(true);
    const p = put('cvg-test-a.txt', 'привет');
    const r = await upload.read(p, 1000);
    expect(r.ok && Buffer.from(r.data.bytes).toString()).toBe('привет');
  });

  it('ссылка наружу и «..» — BAD_PATH', async () => {
    mkdirSync(OUTBOX, { recursive: true });
    const link = join(OUTBOX, 'cvg-test-link');
    rmSync(link, { force: true });
    symlinkSync(join(homedir(), '.ssh/authorized_keys'), link);
    made.push(link);
    expect(await upload.read(link, 100)).toMatchObject({ ok: false, error: { code: 'BAD_PATH' } });
    expect(await upload.download(link, join(local, 'k'), () => {})).toMatchObject({ ok: false, error: { code: 'BAD_PATH' } });
    expect(await upload.read(`${OUTBOX}/../outbox-escape`, 100)).toMatchObject({ ok: false });
    expect(existsSync(join(local, 'k'))).toBe(false);
  });

  it('скачивание потоком: файл совпадает, прогресс до конца', async () => {
    const data = randomBytes(3 * 1024 * 1024);
    const p = put('cvg-test-big.bin', data);
    const dest = join(local, 'big.bin');
    let last = { sent: 0, total: 0 };
    const r = await upload.download(p, dest, (sent, total) => (last = { sent, total }));
    expect(r.ok).toBe(true);
    expect(readFileSync(dest).equals(data)).toBe(true);
    expect(last).toEqual({ sent: data.length, total: data.length });
  });

  it('скачивать можно только из outbox; нет файла — NOT_FOUND', async () => {
    const uploads = join(homedir(), '.cache/claude-vm-gui/uploads');
    mkdirSync(uploads, { recursive: true });
    const u = join(uploads, 'cvg-test-up.txt');
    writeFileSync(u, 'x');
    made.push(u);
    expect(await upload.download(u, join(local, 'u'), () => {})).toMatchObject({ ok: false, error: { code: 'BAD_PATH' } });
    expect(await upload.download(join(OUTBOX, 'cvg-test-none'), join(local, 'n'), () => {})).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('ошибка записи и обрыв связи — недокачанного файла нет', async () => {
    const p = put('cvg-test-cut.bin', randomBytes(20 * 1024 * 1024));
    expect((await upload.download(p, join(local, 'no-such-dir/x.bin'), () => {})).ok).toBe(false);
    const c = await connect();
    const svc = new UploadService(c);
    const dest = join(local, 'cut.bin');
    let closed = false;
    const r = await svc.download(p, dest, (sent) => {
      if (!closed && sent > 1024 * 1024) {
        closed = true;
        c.close();
      }
    });
    expect(r.ok).toBe(false);
    expect(readdirSync(local).filter((f) => f.startsWith('cut.bin'))).toEqual([]);
  });

  it('очистка: старше 7 дней удаляется, свежий остаётся', async () => {
    const old = put('cvg-test-old.txt', 'old');
    const fresh = put('cvg-test-fresh.txt', 'fresh');
    execFileSync('touch', ['-d', '8 days ago', old]);
    await upload.cleanup();
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});
