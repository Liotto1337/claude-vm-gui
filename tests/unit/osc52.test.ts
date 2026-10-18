import { describe, expect, it } from 'vitest';
import { parseOsc52 } from '../../src/shared/osc52';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('parseOsc52', () => {
  it('пустой параметр буфера, как шлёт tmux load-buffer -w', () => expect(parseOsc52(';0J/RgNC40LLQtdGC')).toBe('Привет'));
  it('буфер c', () => expect(parseOsc52(`c;${b64('hello\nworld')}`)).toBe('hello\nworld'));
  it('несколько буферов', () => expect(parseOsc52(`pc;${b64('x')}`)).toBe('x'));
  it('запрос чтения буфера не выполняется', () => expect(parseOsc52('c;?')).toBeNull());
  it('без точки с запятой', () => expect(parseOsc52(b64('x'))).toBeNull());
  it('не base64', () => expect(parseOsc52('c;не base64!')).toBeNull());
  it('пустой текст не трогает буфер', () => expect(parseOsc52('c;')).toBeNull());
  it('слишком большой текст', () => expect(parseOsc52(`c;${'A'.repeat(8 * 1024 * 1024)}`)).toBeNull());
});
