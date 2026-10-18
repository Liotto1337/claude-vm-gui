import type { TmuxSession } from './ipc';

export const TMUX_LS_FORMAT = '#{session_name}\t#{session_attached}\t#{pane_current_command}\t#{pane_current_path}';

/** Разбор `tmux ls -F TMUX_LS_FORMAT`. Claude Code работает как процесс claude или node. */
export function parseSessions(stdout: string): TmuxSession[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [name, attached, command, ...cwd] = line.split('\t');
      return {
        name,
        attachedClients: Number(attached) || 0,
        command: command ?? '',
        cwd: cwd.join('\t'),
        claudeRunning: /^(claude|node)$/.test(command ?? ''),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
