import { BUILTIN_COMMANDS, parseInitialize } from '@shared/hints';
import { fail, ok, type Hints, type Result } from '@shared/ipc';
import { cdPrefix, shellQuote } from '@shared/quote';
import type { SshConnection } from './ssh';

const FILES_TTL_MS = 60_000;

/**
 * Подсказки для поля ввода. Команды и модели — из служебного запроса initialize
 * к Claude Code на ВМ (без обращения к модели), файлы — git ls-files или find.
 */
export class HintsService {
  private commandsCache = new Map<string, Hints>();
  private filesCache = new Map<string, { at: number; files: string[] }>();
  private readonly claudeBin: string;

  constructor(private readonly conn: SshConnection, opts: { claudeBin?: string } = {}) {
    this.claudeBin = opts.claudeBin ?? process.env.CVG_CLAUDE_BIN ?? 'claude';
    // После переподключения список мог измениться (новые скиллы, обновление claude)
    conn.on('reconnected', () => this.commandsCache.clear());
  }

  async get(cwd: string): Promise<Result<Hints>> {
    const cached = this.commandsCache.get(cwd);
    if (cached) return ok(cached);
    if (!this.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    // Только настройки пользователя и без MCP проекта: папка может быть чужой, а её хуки выполнились бы
    const claude = `${shellQuote(this.claudeBin)} -p --input-format stream-json --output-format stream-json --verbose --no-session-persistence --setting-sources user --strict-mcp-config`;
    // Login-оболочка: так на большинстве ВМ в PATH есть ~/.local/bin, куда ставится claude
    const cmd = `${cdPrefix(cwd)} && bash -lc ${shellQuote(claude)}`;
    const request = JSON.stringify({ type: 'control_request', request_id: 'cvg-init', request: { subtype: 'initialize' } });
    let hints: Hints = { commands: BUILTIN_COMMANDS, models: [] };
    try {
      const r = await this.conn.exec(cmd, { stdin: `${request}\n`, timeoutMs: 20_000 });
      for (const line of r.stdout.split('\n')) {
        if (!line.includes('"control_response"')) continue;
        try {
          hints = parseInitialize(JSON.parse(line));
        } catch {
          // Строка не JSON — пропускаем
        }
      }
    } catch {
      // Связь пропала — отдаём встроенный список
    }
    if (hints.models.length > 0) this.commandsCache.set(cwd, hints);
    return ok(hints);
  }

  async files(cwd: string): Promise<Result<string[]>> {
    const cached = this.filesCache.get(cwd);
    if (cached && Date.now() - cached.at < FILES_TTL_MS) return ok(cached.files);
    if (!this.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    const find = `find . -maxdepth 4 -type f -not -path '*/.*' -not -path '*/node_modules/*' | sed 's|^\\./||'`;
    const r = await this.conn.exec(`${cdPrefix(cwd)} && { git -c core.quotePath=false ls-files 2>/dev/null || ${find}; } | head -5000`);
    if (r.code !== 0 && r.stdout === '') return fail('HINTS_FAILED', r.stderr.trim() || 'Не удалось получить список файлов');
    const files = r.stdout.split('\n').filter(Boolean);
    this.filesCache.set(cwd, { at: Date.now(), files });
    return ok(files);
  }

  /** Подсказки папок по мере ввода: «~/pro» → [«~/projects», …]. */
  async dirs(partial: string): Promise<Result<string[]>> {
    if (!this.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    const p = partial === '~' ? '~/' : partial;
    const slash = p.lastIndexOf('/');
    const base = slash === -1 ? '' : p.slice(0, slash + 1);
    const prefix = (slash === -1 ? p : p.slice(slash + 1)).toLowerCase();
    const hidden = prefix.startsWith('.') ? '' : `-not -name '.*'`;
    const r = await this.conn.exec(
      `${cdPrefix(base)} 2>/dev/null && find . -mindepth 1 -maxdepth 1 -type d ${hidden} | sed 's|^\\./||' | sort | head -500`,
    );
    if (r.code !== 0) return ok([]);
    const dirs = r.stdout
      .split('\n')
      .filter((name) => name !== '' && name.toLowerCase().startsWith(prefix))
      .slice(0, 50)
      .map((name) => `${base}${name}`);
    return ok(dirs);
  }
}
