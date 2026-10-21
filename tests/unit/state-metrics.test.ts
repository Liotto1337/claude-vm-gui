import { beforeEach, describe, expect, it, vi } from 'vitest';

// Повторное подключение создаёт в main новый MetricsService в медленном режиме (раз в 10 с).
// Если панель «Сервер» открыта, renderer должен снова попросить частые замеры — подпись обещает «каждые 2 с».
const setActive = vi.fn();
vi.mock('../../src/renderer/api', () => ({
  api: {
    config: { get: async () => ({ host: 'h', port: 22, username: 'root', keyPath: 'k', theme: 'light' }), save: async () => ({ ok: true }) },
    platform: { theme: async () => 'light', onThemeChange: () => () => {} },
    connection: { onPreflight: () => () => {}, onState: () => () => {}, onHostKey: () => () => {}, connect: async () => ({ ok: true, data: undefined }) },
    tmux: { onSessions: () => () => {}, list: async () => ({ ok: true, data: [] }) },
    layout: { get: async () => ({ v: 1, items: [] }), save: async () => ({ ok: true, data: undefined }) },
    chat: { onItems: () => () => {}, onScreen: () => () => {}, onUnavailable: () => () => {} },
    metrics: { onSample: () => () => {}, info: async () => ({ ok: false }), setActive },
  },
}));

describe('панель «Сервер» и переподключение', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { documentElement: { dataset: {} } });
    vi.stubGlobal('location', { search: '' });
  });

  it('после нового подключения с открытой панелью снова включаются частые замеры', async () => {
    const state = await import('../../src/renderer/state');
    await state.init();
    await vi.waitFor(() => expect(state.getState().view).toBe('main'));
    state.setServerOpen(true);
    setActive.mockClear();
    await state.connect();
    expect(setActive).toHaveBeenLastCalledWith(true);
  });
});
