// Контракт между интерфейсом (renderer) и главным процессом. Имена — из плана, раздел «Общий контракт IPC».

export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } };

export type ErrorCode =
  | 'DOWNLOAD_FAILED'
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
  | 'NO_TRANSCRIPT'
  | 'NOT_FOUND'
  | 'BAD_PATH';

export interface VmConfig {
  host: string;
  port: number;
  username: string;
  keyPath: string;
  theme: 'system' | 'light' | 'dark';
  lastSession?: string;
  /** Только чтение: пароль сохранён (сам пароль в интерфейс не передаётся) */
  hasPassword?: boolean;
  /** Только чтение: пароль сохранён, но не расшифровывается (другая учётная запись Windows) — нужно ввести заново */
  passwordUnreadable?: boolean;
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

/** Замер параметров ВМ (панель «Сервер»). Байты и байт/с; null — нет данных. */
export interface MetricsSample {
  t: number;
  cpu: number | null;
  load: [number, number, number] | null;
  uptimeSec: number | null;
  mem: { total: number; used: number; swapTotal: number; swapUsed: number } | null;
  disks: { mount: string; total: number; used: number }[];
  net: { iface: string; rxRate: number; txRate: number } | null;
  procs: { pid: number; name: string; cpu: number; rss: number; session: string | null }[];
  error: string | null;
}
export interface SystemInfo { os: string; kernel: string; cores: number; claudeVersion: string | null }

/** Окно лимита подписки Claude: заполнено на pct %, сброс в resetsAt (ISO). */
export interface UsageWindow { pct: number; resetsAt: string | null }
/** Расход Claude: лимиты 5 ч и недели (null — нет подписки или сервис недоступен) и токены за сегодня по журналам. */
export interface UsageSample {
  t: number;
  limits: { fiveHour: UsageWindow | null; week: UsageWindow | null } | null;
  tokens: { input: number; output: number; cacheWrite: number; cacheRead: number } | null;
  error: string | null;
}
/** Картинка сообщения из журнала (блок image): base64; без данных — пустые строки. */
export interface ChatImage { mediaType: string; data: string }
/** Элемент ленты переписки (из журнала Claude Code). files — пути вложений из папки загрузок на ВМ. */
export type ChatItem =
  | { kind: 'user'; id: string; text: string; images: ChatImage[]; files: string[] }
  | { kind: 'assistant'; id: string; text: string; files: string[] }
  | { kind: 'thinking'; id: string }
  | { kind: 'note'; id: string; text: string }
  | {
      kind: 'tool'; id: string; name: string; summary: string; input: string;
      status: 'running' | 'ok' | 'error'; result: string | null; children: ChatItem[];
    };
/**
 * Контекст сессии: «занято» по последнему ответу (usedAt — его время или время сжатия, после которого used = null),
 * разбивка — последний замер /context; времена — ms по timestamp записей.
 */
export interface SessionContext {
  used: number | null;
  usedAt: number | null;
  model: string | null;
  snapshot: ContextSnapshot | null;
  snapshotAt: number | null;
  snapshotModel: string | null;
}
import type { ContextSnapshot } from './context-parse';
export type { ContextSnapshot, ContextCategory } from './context-parse';

export interface ChatEvent { session: string; reset: boolean; prepend: boolean; items: ChatItem[]; hasEarlier: boolean; context: SessionContext }
export interface ScreenEvent { session: string; state: ScreenState; busy: boolean }

/** Порядок, закрепление и группы сессий в сайдбаре (хранится локально, отдельно для каждой ВМ). */
export interface SidebarLayout { v: 1; items: LayoutItem[] }
export type LayoutItem =
  | { kind: 'session'; name: string; pinned?: boolean }
  | { kind: 'group'; id: string; name: string; pinned?: boolean; collapsed?: boolean; sessions: { name: string; pinned?: boolean }[] };

/** Клавиши, которые интерфейс может отправить в claude (карточка меню, «Остановить»). */
export type MenuKey = 'up' | 'down' | 'left' | 'right' | 'enter' | 'esc' | 'tab' | 'shift-tab' | 'space'
  | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

/** Прогресс скачивания файла outbox: path — путь на ВМ */
export interface OutboxProgress {
  path: string;
  sent: number;
  total: number;
}

export interface MenuOption {
  n: number | null; label: string; description: string; selected: boolean;
  /** множественный выбор: отмечен ли вариант («[✔]») */
  checked?: boolean;
  /** «Type something.» — свой ответ: набранный текст встаёт на место подписи */
  input?: boolean;
  /** «Submit» под вариантами множественного выбора */
  submit?: boolean;
}
/** Меню Claude Code, разобранное с экрана: запрос разрешения, AskUserQuestion, /model и т. п. */
export interface ParsedMenu {
  title: string;
  context: string[];
  /** code[i] — строка context[i] стояла между пунктирами «╌» (команда, путь, содержимое файла) */
  code: boolean[];
  options: MenuOption[];
  notes: string[];
  hint: string | null;
  /** multi — чекбоксы (AskUserQuestion с multiSelect) */
  kind: 'single' | 'multi';
  /** Вкладки вопросов AskUserQuestion («←  ☐ Цвет  ☐ Размер  ✔ Submit  →»): вопросы без Submit, текущий */
  tabs: { labels: string[]; current: number } | null;
  /** Дополнительная ось, меняется ←/→ (effort в /model) */
  axis: { label: string; value: string } | null;
}
export type ScreenState =
  | { kind: 'no-claude' }
  | { kind: 'prompt'; status: string | null; input: string }
  | { kind: 'menu'; menu: ParsedMenu }
  | { kind: 'unknown' };
export type { UpdateInfo } from './version';
import type { UpdateInfo } from './version';

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
    /** session — откуда отправили: если тем временем открыли другую сессию, ничего не пишется (NO_SESSION) */
    send(text: string, filePaths: string[], session?: string): Promise<Result<void>>;
    setModel(value: string, session?: string): Promise<Result<void>>;
    setEffort(level: string, session?: string): Promise<Result<void>>;
  };
  hints: {
    get(cwd: string): Promise<Result<Hints>>;
    files(cwd: string): Promise<Result<string[]>>;
    dirs(partial: string): Promise<Result<string[]>>;
  };
  upload: {
    /** Любой файл до 50 МБ в папку загрузок на ВМ; name — исходное имя (войдёт в имя на ВМ) */
    file(id: string, bytes: Uint8Array, name: string): Promise<Result<{ remotePath: string }>>;
    onProgress(cb: (p: UploadProgress) => void): Unsubscribe;
    /** Начало файла из папки загрузок (не больше maxBytes) и его полный размер; NOT_FOUND — удалён, BAD_PATH — путь вне папки */
    read(path: string, maxBytes: number): Promise<Result<{ bytes: Uint8Array; size: number; truncated: boolean }>>;
  };
  /** Файлы, которые Claude положил в outbox (`~/.cache/claude-vm-gui/outbox`) */
  outbox: {
    /** Скачать в выбранное место (диалог «Сохранить как»); null — диалог отменили */
    save(path: string): Promise<Result<{ savedTo: string } | null>>;
    /** Скачать во временную папку и открыть браузером по умолчанию */
    openHtml(path: string): Promise<Result<void>>;
    /** Показать сохранённый файл: в папке (Windows), открыть (Android) */
    reveal(savedTo: string): void;
    onProgress(cb: (p: OutboxProgress) => void): Unsubscribe;
  };
  clipboard: { read(): Promise<string>; write(text: string): void };
  layout: { get(): Promise<SidebarLayout>; save(l: SidebarLayout): Promise<Result<void>> };
  links: { open(url: string): void };
  metrics: {
    setActive(fast: boolean): void;
    onSample(cb: (s: MetricsSample) => void): Unsubscribe;
    info(): Promise<Result<SystemInfo>>;
  };
  chat: {
    onItems(cb: (e: ChatEvent) => void): Unsubscribe;
    onScreen(cb: (e: ScreenEvent) => void): Unsubscribe;
    onUnavailable(cb: (e: { session: string; reason: string }) => void): Unsubscribe;
    loadEarlier(): Promise<Result<void>>;
    key(k: MenuKey, session?: string): Promise<Result<void>>;
    /** Текст в поле своего ответа меню (без Enter) */
    typeText(text: string, session?: string): Promise<Result<void>>;
  };
  /** Расход Claude: лимиты подписки и токены за сегодня; get — последний замер */
  usage: { get(): Promise<UsageSample | null>; onSample(cb: (s: UsageSample) => void): Unsubscribe };
  /** Новая версия на GitHub: get — последняя найденная (событие могло прийти раньше подписки) */
  updates: {
    get(): Promise<UpdateInfo | null>;
    onAvailable(cb: (u: UpdateInfo) => void): Unsubscribe;
    dismissed(): Promise<string | null>;
    dismiss(version: string): Promise<void>;
  };
  platform: {
    theme(): Promise<'light' | 'dark'>;
    onThemeChange(cb: (t: 'light' | 'dark') => void): Unsubscribe;
  };
}

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = <T = never>(code: ErrorCode, message: string): Result<T> => ({ ok: false, error: { code, message } });
