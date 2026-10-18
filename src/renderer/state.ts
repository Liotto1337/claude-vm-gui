import { useSyncExternalStore } from 'react';
import type {
  ConnectionState, ErrorCode, Hints, HostKeyPrompt, PreflightEvent, PreflightStep, TmuxSession, VmConfig,
} from '@shared/ipc';
import { api } from './api';

export type View = 'loading' | 'settings' | 'connect' | 'main';

export interface AppState {
  view: View;
  config: VmConfig | null;
  connection: ConnectionState;
  preflight: Partial<Record<PreflightStep, PreflightEvent>>;
  connectError: { code: ErrorCode; message: string } | null;
  hostKey: HostKeyPrompt | null;
  sessions: TmuxSession[];
  current: string | null;
  hints: Hints | null;
  systemTheme: 'light' | 'dark';
  theme: 'light' | 'dark';
  /** Последний выбор модели и effort в каждой сессии (из этого приложения) */
  choices: Record<string, { model?: string; modelLabel?: string; effort?: string }>;
}

let state: AppState = {
  view: 'loading',
  config: null,
  connection: { state: 'idle' },
  preflight: {},
  connectError: null,
  hostKey: null,
  sessions: [],
  current: null,
  hints: null,
  systemTheme: 'light',
  theme: 'light',
  choices: {},
};

const listeners = new Set<() => void>();

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  if (patch.config !== undefined || patch.systemTheme !== undefined) {
    const pref = state.config?.theme ?? 'system';
    state = { ...state, theme: pref === 'system' ? state.systemTheme : pref };
  }
  document.documentElement.dataset.theme = state.theme;
  for (const l of listeners) l();
}

export const getState = () => state;

export function useAppState(): AppState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Предпросмотр темы в настройках до сохранения. */
export function previewTheme(pref: VmConfig['theme']): void {
  state = { ...state, theme: pref === 'system' ? state.systemTheme : pref };
  document.documentElement.dataset.theme = state.theme;
  for (const l of listeners) l();
}

export async function connect(): Promise<void> {
  setState({ view: 'connect', preflight: {}, connectError: null, hostKey: null });
  const r = await api.connection.connect();
  if (r.ok) {
    const list = await api.tmux.list();
    const sessions = list.ok ? list.data : [];
    const last = state.config?.lastSession;
    setState({ view: 'main', sessions, current: sessions.some((s) => s.name === last) ? (last ?? null) : null });
  } else {
    setState({ connectError: r.error, hostKey: null });
  }
}

export function answerHostKey(trust: boolean): void {
  api.connection.answerHostKey(trust);
  setState({ hostKey: null });
}

export async function saveConfig(c: VmConfig): Promise<string | null> {
  const r = await api.config.save(c);
  if (!r.ok) return r.error.message;
  setState({ config: c });
  return null;
}

export function openSettings(): void {
  void api.connection.disconnect();
  setState({ view: 'settings', connection: { state: 'idle' } });
}

let started = false;

export async function init(): Promise<void> {
  // StrictMode в режиме разработки вызывает эффекты дважды
  if (started) return;
  started = true;
  const [config, systemTheme] = await Promise.all([api.config.get(), api.platform.theme()]);
  api.platform.onThemeChange((t) => setState({ systemTheme: t }));
  api.connection.onPreflight((e) => setState({ preflight: { ...state.preflight, [e.step]: e } }));
  api.connection.onState((s) => setState({ connection: s }));
  api.connection.onHostKey((p) => setState({ hostKey: p }));
  api.tmux.onSessions((sessions) => setState({ sessions }));
  setState({ config, systemTheme, view: config ? 'connect' : 'settings' });
  if (config) void connect();
}

export async function refreshSessions(): Promise<void> {
  const r = await api.tmux.list();
  if (r.ok) setState({ sessions: r.data });
}

export function openSession(name: string | null): void {
  setState({ current: name });
  const cfg = state.config;
  if (cfg && name && cfg.lastSession !== name) {
    const next = { ...cfg, lastSession: name };
    void api.config.save(next).then((r) => r.ok && setState({ config: next }));
  }
}

export async function createSession(name: string, dir: string, startClaude: boolean): Promise<string | null> {
  const r = await api.tmux.create(name, dir, startClaude);
  if (!r.ok) return r.error.message;
  await refreshSessions();
  openSession(name);
  return null;
}

export async function killSession(name: string): Promise<string | null> {
  const r = await api.tmux.kill(name);
  if (state.current === name) setState({ current: null });
  await refreshSessions();
  return r.ok ? null : r.error.message;
}

/** Папка сессии для показа: домашняя папка пользователя сокращается до «~». */
export function shortPath(cwd: string): string {
  const user = state.config?.username;
  const home = user === 'root' ? '/root' : user ? `/home/${user}` : null;
  if (home && (cwd === home || cwd.startsWith(`${home}/`))) return `~${cwd.slice(home.length)}`;
  return cwd;
}

export function rememberChoice(session: string, patch: { model?: string; modelLabel?: string; effort?: string }): void {
  setState({ choices: { ...state.choices, [session]: { ...state.choices[session], ...patch } } });
}

const demoHost = new URLSearchParams(location.search).get('demoHost');

/** Адрес ВМ для показа; на демо-скриншотах подменяется. */
export function displayHost(host: string): string {
  return demoHost ?? host;
}
