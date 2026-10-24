import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidebarLayout, TmuxSession } from '../../src/shared/ipc';

// Гонка при запуске: первый опрос tmux (событие tmux:sessions) приходит раньше, чем загружена раскладка.
// Раньше renderer сверял пустую раскладку и сохранял плоский список поверх сохранённой.
const saved: SidebarLayout = {
  v: 1,
  items: [{ kind: 'session', name: 'b', pinned: true }, { kind: 'group', id: 'g1', name: 'Работа', sessions: [{ name: 'a' }] }],
};
const sessions: TmuxSession[] = ['a', 'b'].map((name) => ({ name, attachedClients: 0, command: 'bash', cwd: '/', claudeRunning: false }));
let onSessions: (s: TmuxSession[]) => void = () => {};
const save = vi.fn(async () => ({ ok: true as const, data: undefined }));

vi.mock('../../src/renderer/api', () => ({
  api: {
    config: { get: async () => ({ host: 'h', port: 22, username: 'root', keyPath: 'k', theme: 'light' }), save: async () => ({ ok: true }) },
    platform: { theme: async () => 'light', onThemeChange: () => () => {} },
    connection: {
      onPreflight: () => () => {}, onState: () => () => {}, onHostKey: () => () => {},
      // Опрос tmux в main шлёт список ещё до того, как connect вернулся
      connect: async () => {
        onSessions(sessions);
        return { ok: true, data: undefined };
      },
    },
    tmux: { onSessions: (cb: (s: TmuxSession[]) => void) => ((onSessions = cb), () => {}), list: async () => ({ ok: true, data: sessions }) },
    layout: { get: async () => saved, save },
    chat: { onItems: () => () => {}, onScreen: () => () => {}, onUnavailable: () => () => {} },
    usage: { onSample: () => () => {}, get: async () => null },
    metrics: { onSample: () => () => {}, info: async () => ({ ok: false }), setActive: () => {} },
  },
}));

describe('раскладка при запуске', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { documentElement: { dataset: {} } });
    vi.stubGlobal('location', { search: '' });
  });

  it('сохранённая раскладка не затирается плоским списком', async () => {
    const state = await import('../../src/renderer/state');
    await state.init();
    await vi.waitFor(() => expect(state.getState().view).toBe('main'));
    expect(state.getState().layout).toEqual(saved);
    for (const call of save.mock.calls as unknown as [SidebarLayout][]) expect(call[0]).toEqual(saved);
  });
});
