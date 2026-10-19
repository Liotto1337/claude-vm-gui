import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fail, ok, type Result, type VmConfig } from '@shared/ipc';

const DEFAULTS: Omit<VmConfig, 'host'> = { port: 22, username: 'root', keyPath: '~/.ssh/id_ed25519', theme: 'system' };

/** Шифрование пароля: в приложении — Electron safeStorage (DPAPI на Windows), в тестах — подмена. */
export interface SecretBox {
  available(): boolean;
  encrypt(s: string): Buffer;
  decrypt(b: Buffer): string;
}

/** Как лежит в config.json: VmConfig без hasPassword, плюс зашифрованный пароль. */
type StoredConfig = Omit<VmConfig, 'hasPassword'> & { passwordEnc?: string };

export function expandHome(p: string): string {
  return p === '~' ? homedir() : p.startsWith('~/') || p.startsWith('~\\') ? join(homedir(), p.slice(2)) : p;
}

function readJson(path: string): Partial<StoredConfig> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredConfig>;
  } catch {
    return null;
  }
}

/**
 * Настройки подключения: config.json в папке данных приложения,
 * а при разработке (передан repoDir) — vm.config.json в корне репозитория.
 * Пароль сюда не попадает — только признак hasPassword.
 */
export function loadConfig(opts: { userDataDir: string; repoDir?: string }): VmConfig | null {
  const raw =
    readJson(join(opts.userDataDir, 'config.json')) ?? (opts.repoDir ? readJson(join(opts.repoDir, 'vm.config.json')) : null);
  if (!raw || typeof raw.host !== 'string' || raw.host.trim() === '') return null;
  const { passwordEnc, ...rest } = raw;
  const cfg: VmConfig = { ...DEFAULTS, ...rest, host: raw.host.trim() };
  delete (cfg as Partial<VmConfig>).hasPassword;
  if (typeof passwordEnc === 'string' && passwordEnc !== '') cfg.hasPassword = true;
  return { ...cfg, keyPath: expandHome(cfg.keyPath ?? '') };
}

/** Расшифрованный пароль или null (нет, не расшифровался). Только для главного процесса. */
export function loadPassword(userDataDir: string, box: SecretBox): string | null {
  const enc = readJson(join(userDataDir, 'config.json'))?.passwordEnc;
  if (typeof enc !== 'string' || enc === '') return null;
  try {
    return box.decrypt(Buffer.from(enc, 'base64'));
  } catch {
    return null;
  }
}

export function validateConfig(c: VmConfig, hasPassword = false): string | null {
  if (typeof c.host !== 'string' || c.host.trim() === '' || /\s/.test(c.host.trim())) return 'Укажите адрес ВМ без пробелов';
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) return 'Порт — число от 1 до 65535';
  if (!/^[a-z_][a-z0-9_-]*$/.test(c.username)) return 'Имя пользователя: латиница в нижнем регистре, цифры, _ и -';
  if (typeof c.keyPath !== 'string' || (c.keyPath.trim() === '' && !hasPassword)) return 'Укажите путь к SSH-ключу или пароль';
  if (!['system', 'light', 'dark'].includes(c.theme)) return 'Неизвестная тема';
  return null;
}

/**
 * Сохраняет настройки. password: undefined — не трогать сохранённый, null или '' — удалить, строка — зашифровать.
 */
export function saveConfig(userDataDir: string, c: VmConfig, password?: string | null, box?: SecretBox): Result<void> {
  const path = join(userDataDir, 'config.json');
  const prevEnc = readJson(path)?.passwordEnc;
  let passwordEnc: string | undefined;
  if (password === undefined) passwordEnc = typeof prevEnc === 'string' && prevEnc !== '' ? prevEnc : undefined;
  else if (password === null || password === '') passwordEnc = undefined;
  else {
    if (!box?.available()) return fail('CONFIG_INVALID', 'Шифрование недоступно, пароль не сохранён');
    passwordEnc = box.encrypt(password).toString('base64');
  }
  const err = validateConfig(c, passwordEnc !== undefined);
  if (err) return fail('CONFIG_INVALID', err);
  const { hasPassword: _ignored, ...rest } = c;
  const stored: StoredConfig = { ...rest, host: c.host.trim(), ...(passwordEnc ? { passwordEnc } : {}) };
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(path, JSON.stringify(stored, null, 2));
  return ok(undefined);
}
