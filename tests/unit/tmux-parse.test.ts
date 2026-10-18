import { describe, expect, it } from 'vitest';
import { parseSessions, TMUX_LS_FORMAT } from '../../src/shared/tmux-parse';

describe('parseSessions', () => {
  it('разбирает строки tmux ls', () => {
    expect(parseSessions('zeta\t0\tbash\t/root/x\nclaude\t1\tclaude\t/root\n')).toEqual([
      { name: 'claude', attachedClients: 1, command: 'claude', cwd: '/root', claudeRunning: true },
      { name: 'zeta', attachedClients: 0, command: 'bash', cwd: '/root/x', claudeRunning: false },
    ]);
  });
  it('node тоже считается claude', () => expect(parseSessions('a\t0\tnode\t/\n')[0].claudeRunning).toBe(true));
  it('пустой вывод', () => expect(parseSessions('')).toEqual([]));
  it('папка с табуляцией не ломает разбор', () =>
    expect(parseSessions('a\t2\tbash\t/root/a\tb\n')[0]).toMatchObject({ cwd: '/root/a\tb', attachedClients: 2 }));
  it('формат совпадает с разбором', () => expect(TMUX_LS_FORMAT.split('\t')).toHaveLength(4));
});
