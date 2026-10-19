import { describe, expect, it } from 'vitest';
import type { ChatEvent, ChatItem, ScreenState } from '../../src/shared/ipc';
import { mergeItems, viewMode } from '../../src/renderer/view-mode';

const prompt: ScreenState = { kind: 'prompt', status: null, input: '' };
const menu: ScreenState = { kind: 'menu', menu: { title: 'x', context: [], code: [], options: [], notes: [], hint: null } };
const base = { claudeRunning: true, screen: prompt as ScreenState | null, unavailable: false, override: null as 'terminal' | null };

describe('viewMode', () => {
  it('claude не запущен → terminal', () => expect(viewMode({ ...base, claudeRunning: false })).toBe('terminal'));
  it('unknown → terminal', () => expect(viewMode({ ...base, screen: { kind: 'unknown' } })).toBe('terminal'));
  it('no-claude → terminal', () => expect(viewMode({ ...base, screen: { kind: 'no-claude' } })).toBe('terminal'));
  it('prompt → chat', () => expect(viewMode(base)).toBe('chat'));
  it('menu → chat', () => expect(viewMode({ ...base, screen: menu })).toBe('chat'));
  it('журнал недоступен → terminal', () => expect(viewMode({ ...base, unavailable: true })).toBe('terminal'));
  it('override terminal → terminal', () => expect(viewMode({ ...base, override: 'terminal' })).toBe('terminal'));
  it('screen ещё нет → chat', () => expect(viewMode({ ...base, screen: null })).toBe('chat'));
});

describe('mergeItems', () => {
  const u = (id: string, text = id): ChatItem => ({ kind: 'user', id, text, images: 0 });
  const ev = (items: ChatItem[], patch: Partial<ChatEvent> = {}): ChatEvent => ({ session: 's', reset: false, prepend: false, items, hasEarlier: false, ...patch });
  it('upsert по id: обновление на месте, новые в конец', () =>
    expect(mergeItems([u('a'), u('b')], ev([u('a', 'A'), u('c')]))).toEqual([u('a', 'A'), u('b'), u('c')]));
  it('prepend: новые в начало, существующие обновляются на месте', () =>
    expect(mergeItems([u('b'), u('c')], ev([u('a'), u('b', 'B')], { prepend: true }))).toEqual([u('a'), u('b', 'B'), u('c')]));
  it('reset: только новые', () => expect(mergeItems([u('a')], ev([u('z')], { reset: true }))).toEqual([u('z')]));
});
