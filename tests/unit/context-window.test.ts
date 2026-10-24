import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionContext } from '../../src/shared/ipc';
import { rememberWindow, windowFor } from '../../src/renderer/context-window';

const snap = { used: 29_700, window: 1_000_000, buffer: 33_000, categories: [] };
const ctx = (p: Partial<SessionContext>): SessionContext => ({ used: 1000, model: 'claude-sonnet-5-5', snapshot: null, snapshotAt: null, snapshotModel: null, ...p });

describe('окно контекста по модели', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) });
  });

  it('замер той же модели — окно из него', () => {
    expect(windowFor(ctx({ snapshot: snap, snapshotModel: 'claude-sonnet-5-5' }))).toEqual({ window: 1_000_000, buffer: 33_000 });
  });
  it('модель сменилась после замера и ничего не запомнено — null', () => {
    expect(windowFor(ctx({ snapshot: snap, snapshotModel: 'claude-opus-5-5' }))).toBeNull();
  });
  it('запомненное окно модели', () => {
    rememberWindow('claude-sonnet-5-5', { window: 200_000, buffer: 45_000 });
    expect(windowFor(ctx({}))).toEqual({ window: 200_000, buffer: 45_000 });
  });
  it('модель неизвестна — null', () => {
    expect(windowFor(ctx({ model: null }))).toBeNull();
  });
  it('хранилище бросает — null, без исключения', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(() => rememberWindow('m', { window: 1, buffer: 0 })).not.toThrow();
    expect(windowFor(ctx({}))).toBeNull();
  });
});
