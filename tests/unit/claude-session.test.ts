import { describe, expect, it } from 'vitest';
import { pickClaudeSession, projectSlug, transcriptPath } from '../../src/shared/claude-session';

const ID = '11111111-2222-4333-8444-555555555555';
const OLD = '99999999-2222-4333-8444-555555555555';

describe('путь к журналу', () => {
  it('projectSlug', () => expect(projectSlug('/home/user/my.site')).toBe('-home-user-my-site'));
  it('projectSlug: кириллица и пробелы тоже заменяются', () => expect(projectSlug('/tmp/мой проект')).toBe(`-tmp-${'-'.repeat(10)}`));
  it('transcriptPath', () => expect(transcriptPath('~/.claude', '/tmp/project', ID)).toBe(`~/.claude/projects/-tmp-project/${ID}.jsonl`));
  it('transcriptPath отвергает не-UUID', () => expect(() => transcriptPath('~/.claude', '/x', '../evil')).toThrow());
});

describe('pickClaudeSession', () => {
  const rec = (pid: number, sessionId: string, tmux: string, status = 'idle') => ({ pid, sessionId, cwd: '/tmp/project', tmux, status });
  it('по pid панели', () =>
    expect(pickClaudeSession([rec(10, OLD, 'x:@1.%1'), rec(20, ID, 'site:@3.%3', 'busy')], [5, 20], '%3')).toEqual({
      sessionId: ID, cwd: '/tmp/project', status: 'busy',
    }));
  it('устаревший файл с тем же tmux не выбирается', () =>
    expect(pickClaudeSession([rec(10, OLD, 'site:@3.%3'), rec(20, ID, 'site:@3.%3')], [20], '%3')?.sessionId).toBe(ID));
  it('живой pid, но другая панель — предпочитается совпадение панели', () =>
    expect(pickClaudeSession([rec(20, OLD, 'other:@1.%1'), rec(21, ID, 'site:@3.%3')], [20, 21], '%3')?.sessionId).toBe(ID));
  it('нет подходящих — null', () => expect(pickClaudeSession([rec(10, ID, 'site:@3.%3')], [20], '%3')).toBeNull());
  it('мусор и не-UUID пропускаются', () =>
    expect(pickClaudeSession([null, 'x', { pid: 20, sessionId: '../x', cwd: '/', tmux: '' }], [20], '%3')).toBeNull());
});
