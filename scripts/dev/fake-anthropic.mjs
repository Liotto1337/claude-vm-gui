#!/usr/bin/env node
// Фейковый Messages API для разработки: настоящий Claude Code с ANTHROPIC_BASE_URL=http://127.0.0.1:8787
// рисует запросы разрешений, AskUserQuestion и т. п. без единого запроса к модели.
// Сценарий — по последнему сообщению пользователя:
//   «bash: <команда>» — вызов Bash; «ask:» — AskUserQuestion; «edit: <путь>» — Write в этот файл;
//   «slow:» — ответ через 8 с (экран «работает»); ответ на tool_result — «готово»; всё прочее — «ок».
// Заголовки запросов (там токен) не логируются.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8787);

function lastUser(messages) {
  const m = [...(messages ?? [])].reverse().find((x) => x.role === 'user');
  if (!m) return { text: '', toolResult: false };
  if (typeof m.content === 'string') return { text: m.content, toolResult: false };
  const blocks = Array.isArray(m.content) ? m.content : [];
  return {
    text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
    toolResult: blocks.some((b) => b.type === 'tool_result'),
  };
}

function reply(body) {
  const { text, toolResult } = lastUser(body.messages);
  if (toolResult) return [{ type: 'text', text: 'готово' }];
  const bash = /bash:\s*([^\n<]+)/.exec(text);
  if (bash) return [{ type: 'tool_use', id: `toolu_${randomUUID().slice(0, 8)}`, name: 'Bash', input: { command: bash[1].trim(), description: 'тест' } }];
  if (/ask:/.test(text))
    return [{
      type: 'tool_use', id: `toolu_${randomUUID().slice(0, 8)}`, name: 'AskUserQuestion',
      input: { questions: [{ question: 'Какой цвет кнопки?', header: 'Цвет', multiSelect: false,
        options: [{ label: 'Глина', description: 'фирменный' }, { label: 'Чёрный', description: 'строгий' }, { label: 'Белый', description: 'светлый' }] }] },
    }];
  const edit = /edit:\s*(\S+)/.exec(text);
  if (edit)
    return [{ type: 'tool_use', id: `toolu_${randomUUID().slice(0, 8)}`, name: 'Write', input: { file_path: edit[1], content: 'привет\n' } }];
  return [{ type: 'text', text: 'ок' }];
}

function sse(res, content, model) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const id = `msg_${randomUUID().slice(0, 12)}`;
  send('message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  content.forEach((b, index) => {
    if (b.type === 'text') {
      send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } });
    } else {
      send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    }
    send('content_block_stop', { type: 'content_block_stop', index });
  });
  const stop = content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
  send('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } });
  send('message_stop', { type: 'message_stop' });
  res.end();
}

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const path = (req.url ?? '').split('?')[0];
    console.log(req.method, path);
    if (req.method !== 'POST' || path !== '/v1/messages') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{}');
    }
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {}
    const content = reply(body);
    const model = body.model ?? 'fake';
    const delay = /slow:/.test(lastUser(body.messages).text) ? 8000 : 0;
    if (body.stream) return void setTimeout(() => sse(res, content, model), delay);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: `msg_${randomUUID().slice(0, 12)}`, type: 'message', role: 'assistant', model, content,
      stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 } }));
  });
}).listen(PORT, '127.0.0.1', () => console.log(`fake-anthropic на 127.0.0.1:${PORT}`));
