import { useSyncExternalStore } from 'react';
import type {
  ChatItem, ConnectionState, ErrorCode, Hints, HostKeyPrompt, MetricsSample, PreflightEvent, PreflightStep, ScreenState,
  SidebarLayout, SystemInfo, TmuxSession, VmConfig,
} from '@shared/ipc';
import { claimPending, type Pending } from './chat-anim';
import { mergeItems } from './view-mode';
import { addNewToGroup, EMPTY, reconcile } from '@shared/layout';
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
  /** Порядок, закрепление и группы сессий в сайдбаре */
  layout: SidebarLayout;
  /** Лента каждой сессии: журнал, экран, занятость */
  chat: Record<string, ChatState>;
  /** Пользователь выбрал «Терминал» для открытой сессии */
  viewOverride: 'terminal' | null;
  /** Удачные замеры параметров ВМ (последние 5 минут) и время последней ошибки замера */
  metrics: MetricsSample[];
  metricsErrorAt: number | null;
  systemInfo: SystemInfo | null;
  serverOpen: boolean;
}

export interface ChatState {
  items: ChatItem[];
  /** Отправленные сообщения, которых ещё нет в журнале */
  pending: Pending[];
  /** Ответы, которые сейчас «печатаются»: id → время начала (performance.now) */
  typing: Record<string, number>;
  hasEarlier: boolean;
  screen: ScreenState | null;
  busy: boolean;
  unavailable: string | null;
}
const EMPTY_CHAT: ChatState = { items: [], pending: [], typing: {}, hasEarlier: false, screen: null, busy: false, unavailable: null };

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
  layout: EMPTY,
  chat: {},
  viewOverride: null,
  metrics: [],
  metricsErrorAt: null,
  systemInfo: null,
  serverOpen: false,
};

const METRICS_WINDOW_MS = 5 * 60_000;

function patchChat(session: string | null | undefined, patch: (c: ChatState) => Partial<ChatState>): void {
  if (!session) return;
  const prev = state.chat[session] ?? EMPTY_CHAT;
  setState({ chat: { ...state.chat, [session]: { ...prev, ...patch(prev) } } });
}

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

/** Раскладка загружена для текущего подключения: до этого список tmux её не сверяет и не сохраняет. */
let layoutLoaded = false;

export async function connect(): Promise<void> {
  layoutLoaded = false;
  setState({ view: 'connect', preflight: {}, connectError: null, hostKey: null });
  const r = await api.connection.connect();
  if (r.ok) {
    setState({ metrics: [], metricsErrorAt: null, systemInfo: null });
    void api.metrics.info().then((i) => i.ok && setState({ systemInfo: i.data }));
    const [list, saved] = await Promise.all([api.tmux.list(), api.layout.get()]);
    const sessions = list.ok ? list.data : [];
    const last = state.config?.lastSession;
    setState({ layout: saved });
    layoutLoaded = true;
    applySessions(sessions);
    setState({ view: 'main', current: sessions.some((s) => s.name === last) ? (last ?? null) : null });
  } else {
    setState({ connectError: r.error, hostKey: null });
  }
}

export function answerHostKey(trust: boolean): void {
  api.connection.answerHostKey(trust);
  setState({ hostKey: null });
}

/** password: undefined — не менять сохранённый, null — удалить, строка — новый. */
export async function saveConfig(c: VmConfig, password?: string | null): Promise<string | null> {
  const r = await api.config.save(c, password);
  if (!r.ok) return r.error.message;
  setState({ config: await api.config.get() });
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
  api.tmux.onSessions((sessions) => applySessions(sessions));
  api.chat.onItems((e) =>
    patchChat(e.session, (c) => {
      const items = mergeItems(c.items, e);
      // «Печатаются» только ответы, пришедшие сейчас; история при открытии и «Показать раньше» — сразу
      const typing = { ...c.typing };
      if (!e.reset && !e.prepend) {
        const known = new Set(c.items.map((i) => i.id));
        for (const i of e.items) if (i.kind === 'assistant' && !known.has(i.id)) typing[i.id] = performance.now();
      }
      return { items, typing, pending: claimPending(c.pending, items, Date.now(), c.busy), hasEarlier: e.hasEarlier, unavailable: null };
    }),
  );
  // Доставленные пузыри без записи журнала уходят сами
  setInterval(() => {
    for (const [session, c] of Object.entries(state.chat))
      if (c.pending.some((p) => p.state === 'sent')) {
        // Пока Claude работает, отсчёт 20 с стоит: сообщение может ждать в очереди
        const next = claimPending(c.pending, c.items, Date.now(), c.busy);
        if (next.length !== c.pending.length || c.busy) patchChat(session, () => ({ pending: next }));
      }
  }, 5000);
  api.chat.onScreen((e) => patchChat(e.session, () => ({ screen: e.state, busy: e.busy })));
  api.chat.onUnavailable((e) => patchChat(e.session, () => ({ unavailable: e.reason })));
  api.metrics.onSample((s) => {
    if (s.error) return setState({ metricsErrorAt: state.metricsErrorAt ?? s.t });
    setState({ metrics: [...state.metrics.filter((m) => s.t - m.t <= METRICS_WINDOW_MS), s], metricsErrorAt: null });
  });
  setState({ config, systemTheme, view: config ? 'connect' : 'settings' });
  if (config) void connect();
}

export async function refreshSessions(): Promise<void> {
  const r = await api.tmux.list();
  if (r.ok) applySessions(r.data);
}

/** Новый список tmux: раскладка сайдбара сверяется (новые сессии — первыми среди незакреплённых). */
function applySessions(sessions: TmuxSession[]): void {
  // Первый опрос tmux приходит раньше раскладки — сверять пустую раскладку значит затереть сохранённую
  if (!layoutLoaded) return setState({ sessions });
  const layout = reconcile(state.layout, sessions.map((s) => s.name));
  const changed = JSON.stringify(layout) !== JSON.stringify(state.layout);
  setState({ sessions, layout });
  if (changed) void api.layout.save(layout);
}

/** Изменить раскладку сайдбара и сохранить её. */
export function updateLayout(fn: (l: SidebarLayout) => SidebarLayout): void {
  const layout = fn(state.layout);
  if (layout === state.layout) return;
  setState({ layout });
  void api.layout.save(layout);
}

export function openSession(name: string | null): void {
  if (name !== state.current) setState({ current: name, viewOverride: null });
  patchChat(name, () => ({ screen: null }));
  const cfg = state.config;
  if (cfg && name && cfg.lastSession !== name) {
    const next = { ...cfg, lastSession: name };
    void api.config.save(next).then((r) => r.ok && setState({ config: next }));
  }
}

/** group — сразу в эту группу: раскладка меняется до обновления списка, так сессия попадёт в группу и при его сбое. */
export async function createSession(name: string, dir: string, startClaude: boolean, group?: string): Promise<string | null> {
  const r = await api.tmux.create(name, dir, startClaude);
  if (!r.ok) return r.error.message;
  if (group) updateLayout((l) => addNewToGroup(l, name, group));
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

export function setViewOverride(v: 'terminal' | null): void {
  setState({ viewOverride: v });
}

/** Панель «Сервер»: открыта — замеры раз в 2 с, закрыта — раз в 10 с. */
export function setServerOpen(open: boolean): void {
  setState({ serverOpen: open });
  api.metrics.setActive(open);
}

let pendingSeq = 0;

/** Сообщение показано в ленте сразу, до отправки (темнее обычного). */
export function addPending(session: string, text: string, images: number): string {
  const id = `pending-${++pendingSeq}`;
  patchChat(session, (c) => ({
    pending: [...c.pending, { id, text, images, state: 'sending', seen: new Set(c.items.map((i) => i.id)), at: 0 }],
  }));
  return id;
}

/** Claude Code принял сообщение — пузырь обычного цвета, пока не появится запись журнала. */
export function markPendingSent(session: string, id: string): void {
  patchChat(session, (c) => ({
    pending: claimPending(c.pending.map((p) => (p.id === id ? { ...p, state: 'sent' as const, at: Date.now() } : p)), c.items, Date.now(), c.busy),
  }));
}

export function dropPending(session: string, id: string): void {
  patchChat(session, (c) => ({ pending: c.pending.filter((p) => p.id !== id) }));
}

/** «Печать» ответа закончилась — дальше обычная отрисовка. */
export function typingDone(session: string, id: string): void {
  const c = state.chat[session];
  if (!c || !(id in c.typing)) return;
  const typing = { ...c.typing };
  delete typing[id];
  patchChat(session, () => ({ typing }));
}
