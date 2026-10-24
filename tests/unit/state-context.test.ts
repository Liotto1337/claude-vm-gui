import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../../src/shared/ipc';

let onItems: (e: ChatEvent) => void = () => {};
vi.mock('../../src/renderer/api', () => ({
  api: {
    config: { get: async () => ({ host: 'h', port: 22, username: 'root', keyPath: 'k', theme: 'light' }), save: async () => ({ ok: true }) },
    platform: { theme: async () => 'light', onThemeChange: () => () => {} },
    connection: { onPreflight: () => () => {}, onState: () => () => {}, onHostKey: () => () => {}, connect: async () => ({ ok: true, data: undefined }) },
    tmux: { onSessions: () => () => {}, list: async () => ({ ok: true, data: [] }) },
    layout: { get: async () => ({ v: 1, items: [] }), save: async () => ({ ok: true, data: undefined }) },
    chat: { onItems: (cb: (e: ChatEvent) => void) => ((onItems = cb), () => {}), onScreen: () => () => {}, onUnavailable: () => () => {}, key: async () => ({ ok: true, data: undefined }) },
    usage: { onSample: () => () => {}, get: async () => null },
    metrics: { onSample: () => () => {}, info: async () => ({ ok: false }), setActive: () => {} },
    updates: { get: async () => null, onAvailable: () => () => {}, dismissed: async () => null, dismiss: async () => {} },
  },
}));

describe('контекст в состоянии ленты', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal('document', { documentElement: { dataset: {} } });
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) });
  });

  it('событие ленты несёт контекст своей сессии; замер запоминает окно модели', async () => {
    const state = await import('../../src/renderer/state');
    const { windowFor } = await import('../../src/renderer/context-window');
    await state.init();
    const snapshot = { used: 29_700, window: 1_000_000, buffer: 33_000, categories: [], model: 'm1' };
    onItems({ session: 'A', reset: true, prepend: false, items: [], hasEarlier: false, context: { used: 5000, usedAt: 0, model: 'm1', snapshot, snapshotAt: 1, snapshotModel: 'm1' } });
    onItems({ session: 'B', reset: true, prepend: false, items: [], hasEarlier: false, context: { used: 7, usedAt: 0, model: 'm2', snapshot: null, snapshotAt: null, snapshotModel: null } });
    expect(state.getState().chat.A.context.used).toBe(5000);
    expect(state.getState().chat.B.context.used).toBe(7);
    expect(windowFor({ used: 1, usedAt: 0, model: 'm1', snapshot: null, snapshotAt: null, snapshotModel: null })).toEqual({ window: 1_000_000, buffer: 33_000 });
  });
});
