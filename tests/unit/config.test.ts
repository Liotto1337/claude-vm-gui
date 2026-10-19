import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, loadPassword, saveConfig, validateConfig, type SecretBox } from '../../src/main/config';

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

describe('пароль', () => {
  const cfg = { host: 'vm.example', port: 22, username: 'root', keyPath: '~/.ssh/id_ed25519', theme: 'system' as const };
  // Фейковое «шифрование»: в тесте важно, что в файл идёт результат encrypt, а не сам пароль
  const box: SecretBox = {
    available: () => true,
    encrypt: (s) => Buffer.from(`enc:${s}`),
    decrypt: (b) => b.toString().replace(/^enc:/, ''),
  };
  const raw = (dir: string) => JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));

  it('сохраняется зашифрованным и не возвращается в конфиге', () => {
    const dir = dirs().userDataDir;
    expect(saveConfig(dir, cfg, 'секрет', box).ok).toBe(true);
    expect(raw(dir).passwordEnc).toBe(Buffer.from('enc:секрет').toString('base64'));
    expect(JSON.stringify(loadConfig({ userDataDir: dir }))).not.toContain('секрет');
    expect(JSON.stringify(loadConfig({ userDataDir: dir }))).not.toContain('passwordEnc');
    expect(loadConfig({ userDataDir: dir })!.hasPassword).toBe(true);
    expect(loadPassword(dir, box)).toBe('секрет');
  });

  it('undefined не трогает пароль, null удаляет', () => {
    const dir = dirs().userDataDir;
    saveConfig(dir, cfg, 'секрет', box);
    saveConfig(dir, { ...cfg, port: 2222 }, undefined, box);
    expect(loadPassword(dir, box)).toBe('секрет');
    expect(raw(dir).port).toBe(2222);
    saveConfig(dir, cfg, null, box);
    expect(loadPassword(dir, box)).toBeNull();
    expect(loadConfig({ userDataDir: dir })!.hasPassword).toBeUndefined();
  });

  it('без шифрования пароль не сохраняется', () => {
    const dir = dirs().userDataDir;
    expect(saveConfig(dir, cfg, 'x', { ...box, available: () => false })).toMatchObject({
      ok: false, error: { code: 'CONFIG_INVALID', message: expect.stringContaining('Шифрование недоступно') },
    });
    expect(() => raw(dir)).toThrow();
  });

  it('ключ не обязателен, если есть пароль', () => expect(validateConfig({ ...cfg, keyPath: '' }, true)).toBeNull());
  it('ключ обязателен без пароля', () => expect(validateConfig({ ...cfg, keyPath: '' }, false)).not.toBeNull());
  it('пустой ключ сохраняется вместе с новым паролем', () =>
    expect(saveConfig(dirs().userDataDir, { ...cfg, keyPath: '' }, 'p', box).ok).toBe(true));

  it('hasPassword из интерфейса не записывается в файл', () => {
    const dir = dirs().userDataDir;
    saveConfig(dir, { ...cfg, hasPassword: true }, undefined, box);
    expect(raw(dir).hasPassword).toBeUndefined();
    expect(raw(dir).passwordEnc).toBeUndefined();
  });

  it('пустая строка пароля — то же, что удалить', () => {
    const dir = dirs().userDataDir;
    saveConfig(dir, cfg, 'секрет', box);
    saveConfig(dir, cfg, '', box);
    expect(loadPassword(dir, box)).toBeNull();
  });

  it('повреждённый passwordEnc — null, без падения', () => {
    const dir = dirs().userDataDir;
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ ...cfg, passwordEnc: '@@@' }));
    expect(loadPassword(dir, { ...box, decrypt: () => { throw new Error('bad'); } })).toBeNull();
  });
});
