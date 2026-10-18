import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HintsService } from '../../src/main/hints';
import { SshConnection } from '../../src/main/ssh';
import { UploadService } from '../../src/main/upload';
import type { UploadProgress } from '../../src/shared/ipc';
import { hasTestKey, tempKnownHosts, testConfig } from './helpers';

const UPLOADS = join(homedir(), '.cache/claude-vm-gui/uploads');
// PNG 1×1
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe.skipIf(!hasTestKey)('подсказки и загрузка картинок', () => {
  let conn: SshConnection;
  let hints: HintsService;
  let upload: UploadService;
  const tmpDirs: string[] = [];
  const uploaded: string[] = [];
  const projectsDir = join(homedir(), '.claude/projects');
  let projectsBefore: string[] = [];

  beforeAll(async () => {
    conn = new SshConnection(testConfig(), { knownHostsPath: tempKnownHosts(), askHostKey: async () => true });
    expect((await conn.connect()).ok).toBe(true);
    hints = new HintsService(conn);
    upload = new UploadService(conn);
    projectsBefore = readdirSync(projectsDir);
  });

  afterAll(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    for (const f of uploaded) rmSync(f, { force: true });
    conn.close();
  });

  it('команды и модели от claude плюс встроенные команды', async () => {
    const r = await hints.get('~');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const names = r.data.commands.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['model', 'effort', 'compact', 'resume']));
    expect(r.data.commands.find((c) => c.name === 'resume')?.source).toBe('builtin');
    expect(r.data.models.find((m) => m.value === 'opus')?.efforts).toContain('high');
    // --no-session-persistence: новых папок с историей бесед не появилось
    expect(readdirSync(projectsDir).filter((d) => !projectsBefore.includes(d))).toEqual([]);
  });

  it('claude недоступен — только встроенные команды', async () => {
    const broken = new HintsService(conn, { claudeBin: '/bin/false' });
    const r = await broken.get('~');
    expect(r.ok && r.data.models).toEqual([]);
    expect(r.ok && r.data.commands.every((c) => c.source === 'builtin')).toBe(true);
  });

  it('файлы git-репозитория и обычной папки', async () => {
    const repo = mkdtempSync(join(homedir(), 'cvg-test-repo-'));
    tmpDirs.push(repo);
    writeFileSync(join(repo, 'package.json'), '{}');
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src/a.ts'), '');
    writeFileSync(join(repo, 'untracked.txt'), '');
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['add', 'package.json', 'src/a.ts'], { cwd: repo });
    const r = await hints.files(repo);
    expect(r.ok && r.data.sort()).toEqual(['package.json', 'src/a.ts']);

    const plain = mkdtempSync(join(homedir(), 'cvg-test-plain-'));
    tmpDirs.push(plain);
    mkdirSync(join(plain, 'node_modules/x'), { recursive: true });
    mkdirSync(join(plain, '.hidden'));
    writeFileSync(join(plain, 'node_modules/x/i.js'), '');
    writeFileSync(join(plain, '.hidden/s'), '');
    writeFileSync(join(plain, '.env'), '');
    writeFileSync(join(plain, 'main.py'), '');
    const p = await hints.files(plain);
    expect(p.ok && p.data).toEqual(['main.py']);
  });

  it('папки для новой сессии', async () => {
    const dir = mkdtempSync(join(homedir(), 'cvg-test-dirs-'));
    tmpDirs.push(dir);
    const base = dir.split('/').pop()!;
    const r = await hints.dirs(`~/${base.slice(0, -2)}`);
    expect(r.ok && r.data).toContain(`~/${base}`);
    mkdirSync(join(dir, 'Проект А'));
    const inner = await hints.dirs(`~/${base}/Про`);
    expect(inner.ok && inner.data).toEqual([`~/${base}/Проект А`]);
  });

  it('картинка загружается по SFTP с прогрессом', async () => {
    const progress: UploadProgress[] = [];
    upload.on('progress', (p: UploadProgress) => progress.push(p));
    const r = await upload.image('img-1', new Uint8Array(PNG), 'png');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    uploaded.push(r.data.remotePath);
    expect(r.data.remotePath).toMatch(new RegExp(`^${UPLOADS}/\\d{8}-\\d{6}-[0-9a-f]{6}\\.png$`));
    expect(statSync(r.data.remotePath).size).toBe(PNG.length);
    expect(progress.at(-1)).toEqual({ id: 'img-1', sent: PNG.length, total: PNG.length });
  });

  it('больше 20 МБ — UPLOAD_TOO_BIG без загрузки', async () => {
    const r = await upload.image('big', new Uint8Array(20 * 1024 * 1024 + 1), 'png');
    expect(r).toMatchObject({ ok: false, error: { code: 'UPLOAD_TOO_BIG' } });
  });

  it('чистка удаляет файлы старше 7 дней', async () => {
    mkdirSync(UPLOADS, { recursive: true });
    const old = join(UPLOADS, 'cvg-test-old.png');
    const fresh = join(UPLOADS, 'cvg-test-fresh.png');
    writeFileSync(old, PNG);
    writeFileSync(fresh, PNG);
    uploaded.push(old, fresh);
    execFileSync('touch', ['-d', '8 days ago', old]);
    await upload.cleanup();
    expect(() => statSync(old)).toThrow();
    expect(statSync(fresh).size).toBe(PNG.length);
  });
});
