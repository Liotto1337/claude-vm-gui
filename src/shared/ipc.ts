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
  | 'UPLOAD_TOO_BIG'
  | 'UPLOAD_FAILED'
  | 'HINTS_FAILED'
  | 'CONFIG_INVALID';

export interface VmConfig {
  host: string;
  port: number;
  username: string;
  keyPath: string;
  theme: 'system' | 'light' | 'dark';
  lastSession?: string;
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
export type ExitReason = 'detached' | 'killed' | 'connection-lost';
export type Unsubscribe = () => void;

export interface Api {
  config: { get(): Promise<VmConfig | null>; save(c: VmConfig): Promise<Result<void>> };
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
  platform: {
    theme(): Promise<'light' | 'dark'>;
    onThemeChange(cb: (t: 'light' | 'dark') => void): Unsubscribe;
  };
}

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = <T = never>(code: ErrorCode, message: string): Result<T> => ({ ok: false, error: { code, message } });
