import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenEvent, ScreenState } from '../../src/shared/ipc';

let onScreen: (e: ScreenEvent) => void = () => {};
vi.mock('../../src/renderer/api', () => ({
  api: {
    config: { get: async () => ({ host: 'h', port: 22, username: 'root', keyPath: 'k', theme: 'light' }), save: async () => ({ ok: true }) },
    platform: { theme: async () => 'light', onThemeChange: () => () => {} },
    connection: { onPreflight: () => () => {}, onState: () => () => {}, onHostKey: () => () => {}, connect: async () => ({ ok: true, data: undefined }) },
    tmux: { onSessions: () => () => {}, list: async () => ({ ok: true, data: [] }) },
    layout: { get: async () => ({ v: 1, items: [] }), save: async () => ({ ok: true, data: undefined }) },
    chat: { onItems: () => () => {}, onScreen: (cb: (e: ScreenEvent) => void) => ((onScreen = cb), () => {}), onUnavailable: () => () => {}, key: async () => ({ ok: true, data: undefined }) },
    metrics: { onSample: () => () => {}, info: async () => ({ ok: false }), setActive: () => {} },
    updates: { get: async () => null, onAvailable: () => () => {}, dismissed: async () => null, dismiss: async () => {} },
  },
}));

const menuState: ScreenState = {
  kind: 'menu',
  menu: { title: 'Выбор', context: [], code: [], options: [{ n: 1, label: 'Да', description: '', selected: true }], notes: [], hint: null, kind: 'single', tabs: null, axis: null },
};

describe('итоги меню в состоянии ленты', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { documentElement: { dataset: {} } });
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  });

  it('меню закрылось — итог в своей сессии; экран другой сессии чужие итоги не трогает', async () => {
    const state = await import('../../src/renderer/state');
    await state.init();
    onScreen({ session: 'A', state: menuState, busy: false });
    onScreen({ session: 'B', state: { kind: 'prompt', status: null, input: '' }, busy: false });
    expect(state.getState().chat.A.answers).toEqual([]);
    expect(state.getState().chat.B.answers).toEqual([]);
    onScreen({ session: 'A', state: { kind: 'prompt', status: null, input: '' }, busy: false });
    expect(state.getState().chat.A.answers.map((a) => a.text)).toEqual(['Выбор → выбрано: Да']);
    expect(state.getState().chat.B.answers).toEqual([]);
  });

  it('Esc или Ctrl+C, нажатые прямо в терминале приложения, — «отменено», а не вариант под курсором', async () => {
    const state = await import('../../src/renderer/state');
    await state.init();
    onScreen({ session: 'C', state: menuState, busy: false });
    state.noteTerminalInput('C', '\x1b');
    onScreen({ session: 'C', state: { kind: 'prompt', status: null, input: '' }, busy: false });
    expect(state.getState().chat.C.answers.map((a) => a.text)).toEqual(['Выбор → отменено']);
    onScreen({ session: 'D', state: menuState, busy: false });
    state.noteTerminalInput('D', '\x03');
    onScreen({ session: 'D', state: { kind: 'prompt', status: null, input: '' }, busy: false });
    expect(state.getState().chat.D.answers.map((a) => a.text)).toEqual(['Выбор → отменено']);
  });
});
