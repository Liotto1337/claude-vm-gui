import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fail, ok, type Result, type VmConfig } from '@shared/ipc';

const DEFAULTS: Omit<VmConfig, 'host'> = { port: 22, username: 'root', keyPath: '~/.ssh/id_ed25519', theme: 'system' };

export function expandHome(p: string): string {
  return p === '~' ? homedir() : p.startsWith('~/') || p.startsWith('~\\') ? join(homedir(), p.slice(2)) : p;
}

function readJson(path: string): Partial<VmConfig> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Partial<VmConfig>;
  } catch {
    return null;
  }
}

/**
 * Настройки подключения: config.json в папке данных приложения,
 * а при разработке (передан repoDir) — vm.config.json в корне репозитория.
 */
export function loadConfig(opts: { userDataDir: string; repoDir?: string }): VmConfig | null {
  const raw =
    readJson(join(opts.userDataDir, 'config.json')) ?? (opts.repoDir ? readJson(join(opts.repoDir, 'vm.config.json')) : null);
  if (!raw || typeof raw.host !== 'string' || raw.host.trim() === '') return null;
  const cfg: VmConfig = { ...DEFAULTS, ...raw, host: raw.host.trim() };
  return { ...cfg, keyPath: expandHome(cfg.keyPath) };
}

export function validateConfig(c: VmConfig): string | null {
  if (typeof c.host !== 'string' || c.host.trim() === '' || /\s/.test(c.host.trim())) return 'Укажите адрес ВМ без пробелов';
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) return 'Порт — число от 1 до 65535';
  if (!/^[a-z_][a-z0-9_-]*$/.test(c.username)) return 'Имя пользователя: латиница в нижнем регистре, цифры, _ и -';
  if (typeof c.keyPath !== 'string' || c.keyPath.trim() === '') return 'Укажите путь к SSH-ключу';
  if (!['system', 'light', 'dark'].includes(c.theme)) return 'Неизвестная тема';
  return null;
}

export function saveConfig(userDataDir: string, c: VmConfig): Result<void> {
  const err = validateConfig(c);
  if (err) return fail('CONFIG_INVALID', err);
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(join(userDataDir, 'config.json'), JSON.stringify({ ...c, host: c.host.trim() }, null, 2));
  return ok(undefined);
}
