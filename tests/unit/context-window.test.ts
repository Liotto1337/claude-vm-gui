import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionContext } from '../../src/shared/ipc';
import { contextNow, rememberWindow, windowFor } from '../../src/renderer/context-window';

const snap = { used: 29_700, window: 1_000_000, buffer: 33_000, categories: [], model: 'claude-sonnet-5-5' };
const ctx = (p: Partial<SessionContext>): SessionContext => ({ used: 1000, usedAt: 100, model: 'claude-sonnet-5-5', snapshot: null, snapshotAt: null, snapshotModel: null, ...p });

describe('окно контекста по модели', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) });
  });

  it('замер той же модели — окно из него', () => {
    expect(windowFor(ctx({ snapshot: snap, snapshotModel: 'claude-sonnet-5-5' }))).toEqual({ window: 1_000_000, buffer: 33_000 });
  });
  it('модель сменилась после замера (ответ новее замера) и ничего не запомнено — null', () => {
    expect(windowFor(ctx({ snapshot: snap, snapshotAt: 50, snapshotModel: 'claude-opus-5-5' }))).toBeNull();
  });
  it('замер новее последнего ответа — его окно, даже если модель ответа другая (/model без ответа)', () => {
    expect(windowFor(ctx({ snapshot: { ...snap, window: 200_000 }, snapshotAt: 200, snapshotModel: 'claude-opus-5-5' }))).toEqual({ window: 200_000, buffer: 33_000 });
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

describe('contextNow: что показывать', () => {
  it('замер новее ответа — «занято» из замера, категории свежие', () => {
    expect(contextNow(ctx({ snapshot: snap, snapshotAt: 200 }))).toEqual({ used: 29_700, fresh: true });
  });
  it('после сжатия ответа ещё нет, замер после сжатия — из замера', () => {
    expect(contextNow(ctx({ used: null, usedAt: 300, snapshot: snap, snapshotAt: 400 }))).toEqual({ used: 29_700, fresh: true });
  });
  it('после сжатия ответа нет, замер до сжатия — неизвестно', () => {
    expect(contextNow(ctx({ used: null, usedAt: 300, snapshot: snap, snapshotAt: 200 }))).toEqual({ used: null, fresh: false });
  });
  it('новая сессия без ответа, но с замером — из замера', () => {
    expect(contextNow(ctx({ used: null, usedAt: null, snapshot: snap, snapshotAt: 5 }))).toEqual({ used: 29_700, fresh: true });
  });
  it('ответ новее замера: число из журнала; категории свежие, только если почти совпадает', () => {
    expect(contextNow(ctx({ used: 30_000, snapshot: snap, snapshotAt: 50 }))).toEqual({ used: 30_000, fresh: true });
    expect(contextNow(ctx({ used: 832_300, snapshot: snap, snapshotAt: 50 }))).toEqual({ used: 832_300, fresh: false });
  });
});
