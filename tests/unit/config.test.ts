import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, saveConfig } from '../../src/main/config';

const dirs = () => ({ userDataDir: mkdtempSync(join(tmpdir(), 'cvg-ud-')), repoDir: mkdtempSync(join(tmpdir(), 'cvg-repo-')) });

describe('loadConfig', () => {
  it('нет файлов — null', () => expect(loadConfig(dirs())).toBeNull());

  it('vm.config.json из папки репозитория, с значениями по умолчанию', () => {
    const d = dirs();
    writeFileSync(join(d.repoDir, 'vm.config.json'), JSON.stringify({ host: '10.0.0.5', keyPath: '~/.ssh/k' }));
    expect(loadConfig(d)).toEqual({
      host: '10.0.0.5', port: 22, username: 'root', keyPath: join(homedir(), '.ssh/k'), theme: 'system',
    });
  });

  it('config.json приоритетнее vm.config.json', () => {
    const d = dirs();
    writeFileSync(join(d.repoDir, 'vm.config.json'), JSON.stringify({ host: 'repo' }));
    writeFileSync(join(d.userDataDir, 'config.json'), JSON.stringify({ host: 'user', port: 2222, theme: 'dark' }));
    expect(loadConfig(d)).toMatchObject({ host: 'user', port: 2222, theme: 'dark' });
  });

  it('без repoDir vm.config.json не читается (собранное приложение)', () => {
    const d = dirs();
    writeFileSync(join(d.repoDir, 'vm.config.json'), JSON.stringify({ host: 'repo' }));
    expect(loadConfig({ userDataDir: d.userDataDir })).toBeNull();
  });

  it('битый JSON — null, без падения', () => {
    const d = dirs();
    writeFileSync(join(d.userDataDir, 'config.json'), '{oops');
    expect(loadConfig(d)).toBeNull();
  });
});

describe('saveConfig', () => {
  const good = { host: 'vm.example', port: 22, username: 'root', keyPath: '~/.ssh/id_ed25519', theme: 'system' as const };

  it('сохраняет и читается обратно', () => {
    const d = dirs();
    expect(saveConfig(d.userDataDir, good)).toEqual({ ok: true, data: undefined });
    expect(JSON.parse(readFileSync(join(d.userDataDir, 'config.json'), 'utf8')).host).toBe('vm.example');
    expect(loadConfig({ userDataDir: d.userDataDir })?.host).toBe('vm.example');
  });

  it.each([
    [{ port: 0 }],
    [{ port: 70000 }],
    [{ host: '' }],
    [{ host: 'a b' }],
    [{ username: 'Root;x' }],
    [{ keyPath: '' }],
    [{ theme: 'blue' }],
  ])('отклоняет %j', (patch) => {
    const r = saveConfig(dirs().userDataDir, { ...good, ...patch } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CONFIG_INVALID');
  });
});
