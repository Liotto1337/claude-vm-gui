// Контракт между интерфейсом (renderer) и главным процессом. Имена — из плана, раздел «Общий контракт IPC».

export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } };

export type ErrorCode =
  | 'TCP_UNREACHABLE'
  | 'AUTH_FAILED'
  | 'HOSTKEY_MISMATCH'
  | 'HOSTKEY_REJECTED'
  | 'NO_TMUX'
  | 'BAD_NAME'
  | 'BAD_DIR'
  | 'SESSION_EXISTS'
  | 'NO_SESSION'
  | 'NOT_CONNECTED'
  | 'PROMPT_OPEN'
  | 'NO_CLAUDE'
  | 'UPLOAD_TOO_BIG'
  | 'UPLOAD_FAILED'
  | 'HINTS_FAILED'
  | 'CONFIG_INVALID'
  | 'SEND_NOT_CONFIRMED'
  | 'NO_TRANSCRIPT';

export interface VmConfig {
  host: string;
  port: number;
  username: string;
  keyPath: string;
  theme: 'system' | 'light' | 'dark';
  lastSession?: string;
  /** Только чтение: пароль сохранён (сам пароль в интерфейс не передаётся) */
  hasPassword?: boolean;
}

export type PreflightStep = 'ping' | 'tcp' | 'ssh' | 'tmux';
export interface PreflightEvent {
  step: PreflightStep;
  status: 'running' | 'ok' | 'warn' | 'fail' | 'skipped';
  detail: string;
}

export interface ConnectionState {
  state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
  attempt?: number;
  pingMs?: number | null;
}

export interface HostKeyPrompt {
  host: string;
  port: number;
  kind: 'unknown' | 'mismatch';
  fingerprint: string;
  knownFingerprint?: string;
}

export interface TmuxSession {
  name: string;
  attachedClients: number;
  command: string;
  cwd: string;
  claudeRunning: boolean;
}

export interface HintCommand {
  name: string;
  description: string;
  argumentHint: string;
  source: 'claude' | 'builtin';
}

export interface ModelInfo {
  value: string;
  displayName: string;
  description: string;
  efforts: string[];
}

export interface Hints {
  commands: HintCommand[];
  models: ModelInfo[];
}

export interface UploadProgress {
  id: string;
  sent: number;
  total: number;
}

export type ImageExt = 'png' | 'jpg' | 'gif' | 'webp';

/** Элемент ленты переписки (из журнала Claude Code). */
export type ChatItem =
  | { kind: 'user'; id: string; text: string; images: number }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'thinking'; id: string }
  | { kind: 'note'; id: string; text: string }
  | {
      kind: 'tool'; id: string; name: string; summary: string; input: string;
      status: 'running' | 'ok' | 'error'; result: string | null; children: ChatItem[];
    };
export interface ChatEvent { session: string; reset: boolean; prepend: boolean; items: ChatItem[]; hasEarlier: boolean }
export interface ScreenEvent { session: string; state: ScreenState; busy: boolean }

/** Порядок, закрепление и группы сессий в сайдбаре (хранится локально, отдельно для каждой ВМ). */
export interface SidebarLayout { v: 1; items: LayoutItem[] }
export type LayoutItem =
  | { kind: 'session'; name: string; pinned?: boolean }
  | { kind: 'group'; id: string; name: string; pinned?: boolean; collapsed?: boolean; sessions: { name: string; pinned?: boolean }[] };

/** Клавиши, которые интерфейс может отправить в claude (карточка меню, «Остановить»). */
export type MenuKey = 'up' | 'down' | 'left' | 'right' | 'enter' | 'esc' | 'tab' | 'shift-tab'
  | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

export interface MenuOption { n: number | null; label: string; description: string; selected: boolean }
/** Меню Claude Code, разобранное с экрана: запрос разрешения, AskUserQuestion, /model и т. п. */
export interface ParsedMenu { title: string; context: string[]; options: MenuOption[]; notes: string[]; hint: string | null }
export type ScreenState =
  | { kind: 'no-claude' }
  | { kind: 'prompt'; status: string | null; input: string }
  | { kind: 'menu'; menu: ParsedMenu }
  | { kind: 'unknown' };
export type ExitReason = 'detached' | 'killed' | 'connection-lost';
export type Unsubscribe = () => void;

export interface Api {
  config: { get(): Promise<VmConfig | null>; save(c: VmConfig, password?: string | null): Promise<Result<void>> };
  connection: {
    connect(): Promise<Result<void>>;
    disconnect(): Promise<void>;
    onPreflight(cb: (e: PreflightEvent) => void): Unsubscribe;
    onState(cb: (s: ConnectionState) => void): Unsubscribe;
    onHostKey(cb: (p: HostKeyPrompt) => void): Unsubscribe;
    answerHostKey(trust: boolean): void;
  };
  tmux: {
    list(): Promise<Result<TmuxSession[]>>;
    onSessions(cb: (s: TmuxSession[]) => void): Unsubscribe;
    create(name: string, dir: string, startClaude: boolean): Promise<Result<void>>;
    kill(name: string): Promise<Result<void>>;
    startClaude(name: string): Promise<Result<void>>;
  };
  term: {
    open(name: string, cols: number, rows: number): Promise<Result<void>>;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    onData(cb: (d: string) => void): Unsubscribe;
    onExit(cb: (reason: ExitReason) => void): Unsubscribe;
    send(text: string, imagePaths: string[]): Promise<Result<void>>;
    setModel(value: string): Promise<Result<void>>;
    setEffort(level: string): Promise<Result<void>>;
  };
  hints: {
    get(cwd: string): Promise<Result<Hints>>;
    files(cwd: string): Promise<Result<string[]>>;
    dirs(partial: string): Promise<Result<string[]>>;
  };
  upload: {
    image(id: string, bytes: Uint8Array, ext: ImageExt): Promise<Result<{ remotePath: string }>>;
    onProgress(cb: (p: UploadProgress) => void): Unsubscribe;
  };
  clipboard: { read(): Promise<string>; write(text: string): void };
  layout: { get(): Promise<SidebarLayout>; save(l: SidebarLayout): Promise<Result<void>> };
  links: { open(url: string): void };
  chat: {
    onItems(cb: (e: ChatEvent) => void): Unsubscribe;
    onScreen(cb: (e: ScreenEvent) => void): Unsubscribe;
    onUnavailable(cb: (e: { session: string; reason: string }) => void): Unsubscribe;
    loadEarlier(): Promise<Result<void>>;
    key(k: MenuKey): Promise<Result<void>>;
  };
  platform: {
    theme(): Promise<'light' | 'dark'>;
    onThemeChange(cb: (t: 'light' | 'dark') => void): Unsubscribe;
  };
}

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = <T = never>(code: ErrorCode, message: string): Result<T> => ({ ok: false, error: { code, message } });
