// Связь tmux-панели с сессией Claude Code: ~/.claude/sessions/<pid>.json → sessionId → журнал
// ~/.claude/projects/<cwd, где всё кроме [A-Za-z0-9] заменено на «-»>/<sessionId>.jsonl

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const projectSlug = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-');

/** Путь к журналу; sessionId — только UUID, чтобы путь нельзя было увести в сторону. */
export function transcriptPath(claudeDir: string, cwd: string, sessionId: string): string {
  if (!UUID.test(sessionId)) throw new Error(`Недопустимый id сессии: ${sessionId}`);
  return `${claudeDir}/projects/${projectSlug(cwd)}/${sessionId}.jsonl`;
}

export interface ClaudeSessionInfo { sessionId: string; cwd: string; status: string }

/**
 * Сессия Claude Code в панели: файл sessions/*.json, чей pid — процесс панели или его потомок.
 * Файлы мёртвых процессов (pid не среди живых) не подходят, даже если tmux совпадает.
 */
export function pickClaudeSession(records: unknown[], pids: number[], paneId: string): ClaudeSessionInfo | null {
  const alive = new Set(pids);
  const ok = records.filter((r): r is { pid: number; sessionId: string; cwd: string; tmux?: unknown; status?: unknown } => {
    const x = r as Record<string, unknown> | null;
    return !!x && typeof x === 'object' && typeof x.pid === 'number' && alive.has(x.pid) && typeof x.sessionId === 'string'
      && UUID.test(x.sessionId) && typeof x.cwd === 'string';
  });
  const pane = ok.find((r) => typeof r.tmux === 'string' && r.tmux.endsWith(`.${paneId}`));
  const best = pane ?? ok[0];
  return best ? { sessionId: best.sessionId, cwd: best.cwd, status: typeof best.status === 'string' ? best.status : 'idle' } : null;
}
