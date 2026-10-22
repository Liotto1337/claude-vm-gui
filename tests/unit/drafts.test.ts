import { describe, expect, it } from 'vitest';
import type { Attachment } from '../../src/renderer/attachments';
import { getDraft, restoreFailed, setDraft } from '../../src/renderer/drafts';

const att = (id: string): Attachment => ({ id, name: `${id}.png`, url: `blob:${id}`, bytes: new Uint8Array(1), image: true, status: 'done', percent: 100, size: 1 });

describe('restoreFailed', () => {
  it('пустой черновик — неотправленное возвращается целиком', () => {
    setDraft('s1', { text: '', attachments: [] });
    restoreFailed('s1', { text: 'старое', attachments: [att('a')] });
    expect(getDraft('s1')).toEqual({ text: 'старое', attachments: [att('a')] });
  });
  it('уже набрано новое — старое встаёт перед ним через пустую строку', () => {
    setDraft('s2', { text: 'новое', attachments: [att('b')] });
    restoreFailed('s2', { text: 'старое', attachments: [att('a')] });
    expect(getDraft('s2')).toEqual({ text: 'старое\n\nновое', attachments: [att('a'), att('b')] });
  });
  it('вложение с тем же id не дублируется', () => {
    setDraft('s3', { text: '', attachments: [att('a')] });
    restoreFailed('s3', { text: 'x', attachments: [att('a')] });
    expect(getDraft('s3').attachments).toHaveLength(1);
  });
  it('черновики разных сессий не смешиваются; нет черновика — пустой', () => {
    setDraft('s4', { text: 'четыре', attachments: [] });
    expect(getDraft('s5')).toEqual({ text: '', attachments: [] });
    expect(getDraft('s4').text).toBe('четыре');
  });
});
