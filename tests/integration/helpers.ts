import { existsSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VmConfig } from '../../src/shared/ipc';

/** Тестовый ключ: вход только с localhost (from="127.0.0.1,::1" в authorized_keys). */
export const TEST_KEY = join(homedir(), '.ssh', 'cvg_test_ed25519');
export const hasTestKey = existsSync(TEST_KEY);

export const testConfig = (patch: Partial<VmConfig> = {}): VmConfig => ({
  host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'system', ...patch,
});

export const tempKnownHosts = () => join(mkdtempSync(join(tmpdir(), 'cvg-kh-')), 'known_hosts');

export const testSessionName = (tag: string) => `cvg-test-${tag}-${Math.random().toString(16).slice(2, 8)}`;
