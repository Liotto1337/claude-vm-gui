import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidebarLayout } from '../../src/shared/ipc';

// tmux ls при подключении не удался — это не «сессий нет»: раскладка (закрепления, группы) не должна стираться
const saved: SidebarLayout = { v: 1, items: [{ kind: 'session', name: 'b', pinned: true }, { kind: 'session', name: 'a' }] };
const save = vi.fn(async () => ({ ok: true as const, data: undefined }));

vi.mock('../../src/renderer/api', () => ({
  api: {
    config: { get: async () => ({ host: 'h', port: 22, username: 'root', keyPath: 'k', theme: 'light' }), save: async () => ({ ok: true }) },
    platform: { theme: async () => 'light', onThemeChange: () => () => {} },
    connection: { onPreflight: () => () => {}, onState: () => () => {}, onHostKey: () => () => {}, connect: async () => ({ ok: true, data: undefined }) },
    tmux: { onSessions: () => () => {}, list: async () => ({ ok: false, error: { code: 'NO_TMUX', message: 'сбой' } }) },
    layout: { get: async () => saved, save },
    chat: { onItems: () => () => {}, onScreen: () => () => {}, onUnavailable: () => () => {} },
    usage: { onSample: () => () => {}, get: async () => null },
    metrics: { onSample: () => () => {}, info: async () => ({ ok: false }), setActive: () => {} },
  },
}));

describe('сбой tmux ls при подключении', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { documentElement: { dataset: {} } });
    vi.stubGlobal('location', { search: '' });
  });

  it('сохранённая раскладка остаётся, пустой поверх не пишется', async () => {
    const state = await import('../../src/renderer/state');
    await state.init();
    await vi.waitFor(() => expect(state.getState().view).toBe('main'));
    expect(state.getState().layout).toEqual(saved);
    for (const call of save.mock.calls as unknown as [SidebarLayout][]) expect(call[0].items).toHaveLength(2);
  });
});
