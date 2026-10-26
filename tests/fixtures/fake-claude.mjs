#!/usr/bin/env node
// Фейковый Claude Code для тестов: рисует поле ввода как настоящий (линии «─», «❯», серая подсказка),
// включает bracketed paste и воспроизводит баг: вставка «обрабатывается» 250 мс, всё пришедшее за это время
// (в том числе Enter) теряется. Пишет sessions/<pid>.json и журнал, если задан CVG_CLAUDE_DIR.
// Команды: «menu» — меню из трёх вариантов; «menu-multi» — множественный выбор (как Claude Code 2.1.308), «menu-multi5» — пять вариантов, второй отмечен, курсор на третьем; «menu-deaf» — меню, не слышащее клавиш; CVG_FAKE_KEYLOG — клавиши меню в файл; «busy» — 3 с «работы»; «long» — длинный ответ в журнал; «outbox» — четыре файла в outbox и ответ с путями к ним;
// «grow» — ответ, который через 300 мс дописывается той же записью (тот же uuid).
// Ответы пишут model и usage (832 300 в контексте); «/context» — вывод настоящего Claude Code 2.1.310 в журнал;
// «/compact [текст]» — только сводка сжатия (как настоящий: ответа с usage до следующего сообщения нет).
// CVG_FAKE_SLOW_ACCEPT=1 — поле очищается через 1200 мс после Enter. CVG_FAKE_SEED — начальный журнал (копируется при старте).
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PASTE_MS = 250;
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const RULE = '─'.repeat(60);
const OPTIONS = ['Да', 'Да и не спрашивать', 'Нет'];
const dir = process.env.CVG_CLAUDE_DIR;
const sessionId = randomUUID();
const cwd = process.cwd();
const slug = cwd.replace(/[^A-Za-z0-9]/g, '-');

let field = '';
let pasted = null; // полный текст длинной вставки
let images = 0;
let history = [];
let status = null;
let menu = null; // { selected }
let multi = null; // { selected (OPTIONS.length — «Submit»), checked: Set }
let busyUntil = 0;
let processingUntil = 0;
let enters = 0;
let pasteBuf = null;
const usage = { input_tokens: 1000, cache_read_input_tokens: 820000, cache_creation_input_tokens: 11250, output_tokens: 50 };
const CONTEXT_OUT = readFileSync(new URL('./context-2.1.310.txt', import.meta.url), 'utf8');
// Сколько в контексте для итога /context: как в журнале, после /compact — 20k
let contextUsed = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens;
const contextOut = () =>
  CONTEXT_OUT.replace('29.7k/1m tokens (3%)', `${Math.round(contextUsed / 100) / 10}k/1m tokens (${Math.round(contextUsed / 10_000)}%)`);

function tmuxField() {
  try {
    return execFileSync('tmux', ['display-message', '-p', '-t', process.env.TMUX_PANE ?? '', '#{session_name}:#{window_id}.#{pane_id}'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

function writeSession(st) {
  if (!dir) return;
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'sessions', `${process.pid}.json`),
    JSON.stringify({ pid: process.pid, sessionId, cwd, tmux: tmuxField(), status: st, kind: 'interactive', version: 'fake' }));
}

function record(type, content, uuid = randomUUID(), extra = {}) {
  if (!dir) return;
  const p = join(dir, 'projects', slug);
  mkdirSync(p, { recursive: true });
  const timestamp = new Date().toISOString();
  const rec = type === 'user'
    ? { type: 'user', uuid, sessionId, timestamp, message: { role: 'user', content }, ...extra }
    : type === 'system'
      ? { type: 'system', subtype: 'local_command', uuid, sessionId, timestamp, content }
      : { type: 'assistant', uuid, sessionId, timestamp, message: { role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: content }], usage } };
  appendFileSync(join(p, `${sessionId}.jsonl`), `${JSON.stringify(rec)}\n`);
}

function draw() {
  let out = '\x1b[H\x1b[2J';
  for (const h of history.slice(-10)) out += `${h}\r\n`;
  if (multi) {
    // Как Claude Code 2.1.308: чекбоксы, «Submit» без номера, вкладка вопроса сверху
    out += `${RULE}\r\n←  ☐ Цвета  ✔ Submit  →\r\nКакие цвета?\r\n`;
    multi.opts.forEach((o, i) => (out += `${i === multi.selected ? '❯' : ' '} ${i + 1}. [${multi.checked.has(i) ? '✔' : ' '}] ${o}\r\n`));
    out += `${multi.selected === multi.opts.length ? '❯' : ' '}    Submit\r\n${RULE}\r\nEnter to select · ↑/↓ to navigate · Esc to cancel\r\n`;
  } else if (menu) {
    out += `${RULE}\r\n Выбор\r\n Что сделать?\r\n`;
    OPTIONS.forEach((o, i) => (out += ` ${i === menu.selected ? '❯' : ' '} ${i + 1}. ${o}\r\n`));
    out += ' Enter to confirm · Esc to cancel\r\n';
  } else {
    if (status) out += `✻ ${status}\r\n`;
    out += `${RULE}\r\n`;
    out += field ? `❯ ${field}\r\n` : `❯ \x1b[2mTry "fake"\x1b[0m\r\n`;
    out += `${RULE}\r\n`;
    out += `  ? for shortcuts · enter×${enters}${status ? ' · esc to interrupt' : ''}\r\n`;
  }
  process.stdout.write(out);
}

function submit() {
  const text = pasted ?? field;
  if (!text) return;
  const shown = pasted ? `${images ? `[Image #${images}]` : ''}${text.split('\n')[0]}` : field;
  history.push(`› ${shown}`);
  const slash = /^\/(context|compact)\b\s*(.*)$/s.exec(text.trim());
  if (slash) {
    field = '';
    pasted = null;
    record('user', `<command-name>/${slash[1]}</command-name>\n<command-message>${slash[1]}</command-message>\n<command-args>${slash[2]}</command-args>`);
    if (slash[1] === 'context') record('system', `<local-command-stdout>${contextOut()}</local-command-stdout>`);
    else {
      record('user', 'This session is being continued from a previous conversation…', randomUUID(), { isCompactSummary: true });
      contextUsed = 20_000;
    }
    draw();
    return;
  }
  // Как настоящий Claude Code: путь к картинке → «[Image #N]» и блок image с данными
  record('user', images ? [{ type: 'text', text: `[Image #${images}]${text}` }, ...Array.from({ length: images }, () => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1PX } }))] : text);
  field = '';
  pasted = null;
  images = 0;
  if (text.trim() === 'long') {
    record('assistant', `Длинный ответ для проверки «печати». ${'Текст абзаца идёт дальше и дальше. '.repeat(18)}Конец ответа.`);
  } else if (text.trim() === 'grow') {
    const id = randomUUID();
    const head = `Начало растущего ответа. ${'Слова идут одно за другим. '.repeat(6)}`;
    record('assistant', head, id);
    setTimeout(() => record('assistant', `${head}Хвост растущего ответа.`, id), 300);
  } else if (text.trim() === 'outbox') {
    // Как Claude по правилу из CLAUDE.md: файлы для пользователя — в outbox, путь — в ответе
    const dir = join(homedir(), '.cache/claude-vm-gui/outbox');
    const tag = process.env.CVG_FAKE_OUTBOX_TAG ?? 'cvg-test';
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${tag}-shot.png`), Buffer.from(PNG_1PX, 'base64'));
    writeFileSync(join(dir, `${tag}-report.html`), '<!doctype html><title>Отчёт</title><h1>Отчёт</h1>');
    writeFileSync(join(dir, `${tag}-notes.txt`), 'Заметки: всё готово');
    writeFileSync(join(dir, `${tag}-bundle.zip`), randomBytes(2 * 1024 * 1024));
    record(
      'assistant',
      `Скриншот: ${dir}/${tag}-shot.png.\n\nОтчёт: [отчёт](${dir}/${tag}-report.html)\n\nЗаметки: \`${dir}/${tag}-notes.txt\`\n\nАрхив: ${dir}/${tag}-bundle.zip`,
    );
  } else if (text.trim() === 'menu-multi') {
    multi = { selected: 0, checked: new Set(), opts: OPTIONS };
    writeSession('waiting');
  } else if (text.trim() === 'menu-multi5') {
    // пять вариантов, второй уже отмечен, курсор на третьем
    multi = { selected: 2, checked: new Set([1]), opts: ['Красный', 'Зелёный', 'Синий', 'Жёлтый', 'Белый'] };
    writeSession('waiting');
  } else if (text.trim() === 'menu-deaf') {
    // меню, которое не слышит клавиш: ответ «не принят»
    menu = { selected: 0, deaf: true };
    writeSession('waiting');
  } else if (text.trim() === 'menu') {
    menu = { selected: 0 };
    writeSession('waiting');
  } else if (text.trim() === 'busy') {
    status = 'Думаю… (3s · esc to interrupt)';
    busyUntil = Date.now() + 3000;
    writeSession('busy');
    setTimeout(() => {
      status = null;
      writeSession('idle');
      draw();
    }, 3000);
  }
  draw();
}

function choose(i) {
  menu = null;
  history.push(`● выбран ${i + 1}`);
  record('assistant', `выбран ${i + 1}`);
  writeSession('idle');
  draw();
}

function finishPaste(text) {
  processingUntil = Date.now() + PASTE_MS;
  setTimeout(() => {
    const paths = text.match(/\S+\.(?:png|jpg|gif|webp)/g) ?? [];
    let rest = text;
    for (const p of paths) rest = rest.replace(p, '');
    images += paths.length;
    rest = rest.replace(/\s+/g, ' ').trim();
    const lines = text.split('\n').length;
    if (lines > 10) {
      pasted = text;
      field = `[Pasted text #1 +${lines} lines]`;
    } else {
      pasted = images ? rest : null;
      field = `${images ? `[Image #${images}]` : ''}${rest}`;
    }
    draw();
  }, PASTE_MS);
}

function onKey(k) {
  if (Date.now() < processingUntil) return; // вставка ещё обрабатывается — ввод теряется
  if ((multi || menu) && process.env.CVG_FAKE_KEYLOG) appendFileSync(process.env.CVG_FAKE_KEYLOG, `${JSON.stringify({ k, t: Date.now() })}\n`);
  if (menu?.deaf) return;
  if (multi) {
    if (k === '\x1b[A') multi.selected = Math.max(0, multi.selected - 1);
    else if (k === '\x1b[B') multi.selected = Math.min(multi.opts.length, multi.selected + 1);
    else if ((k === ' ' || k === '\r') && multi.selected < multi.opts.length) {
      if (multi.checked.has(multi.selected)) multi.checked.delete(multi.selected);
      else multi.checked.add(multi.selected);
    } else if (k === '\r') {
      const picked = [...multi.checked].sort().map((i) => multi.opts[i]).join(', ');
      multi = null;
      history.push(`● выбраны: ${picked}`);
      record('assistant', `выбраны: ${picked}`);
      writeSession('idle');
    } else if (k === '\x1b') {
      multi = null;
      writeSession('idle');
    }
    return draw();
  }
  if (menu) {
    if (k === '\x1b[A') menu.selected = Math.max(0, menu.selected - 1);
    else if (k === '\x1b[B') menu.selected = Math.min(OPTIONS.length - 1, menu.selected + 1);
    else if (k === '\r') return choose(menu.selected);
    else if (/^[1-3]$/.test(k)) return choose(Number(k) - 1);
    else if (k === '\x1b') {
      menu = null;
      writeSession('idle');
    }
    return draw();
  }
  if (k === '\r') {
    enters++;
    if (!field) return draw();
    if (process.env.CVG_FAKE_SLOW_ACCEPT === '1') setTimeout(submit, 1200);
    else submit();
    return draw();
  }
  if (k === '\x7f') field = field.slice(0, -1);
  else if (k === '\x1b' && status) {
    status = null;
    history.push('  ⎿  Interrupted');
  } else if (!k.startsWith('\x1b') && k >= ' ') field += k;
  draw();
}

function onData(chunk) {
  let s = chunk;
  while (s.length) {
    if (pasteBuf !== null) {
      const end = s.indexOf('\x1b[201~');
      if (end < 0) {
        pasteBuf += s;
        return;
      }
      const text = pasteBuf + s.slice(0, end);
      pasteBuf = null;
      s = s.slice(end + 6);
      finishPaste(text);
      continue; // остаток куска (например, Enter) придёт во время обработки и потеряется
    }
    const start = s.indexOf('\x1b[200~');
    if (start === 0) {
      pasteBuf = '';
      s = s.slice(6);
      continue;
    }
    const head = start < 0 ? s : s.slice(0, start);
    s = start < 0 ? '' : s.slice(start);
    for (const k of head.match(/\x1b\[[A-Z]|\x1b|[\s\S]/gu) ?? []) onKey(k);
  }
}

process.stdin.setRawMode?.(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', onData);
process.stdout.write('\x1b[?2004h');
if (dir && process.env.CVG_FAKE_SEED) {
  mkdirSync(join(dir, 'projects', slug), { recursive: true });
  writeFileSync(join(dir, 'projects', slug, `${sessionId}.jsonl`), readFileSync(process.env.CVG_FAKE_SEED));
}
writeSession('idle');
const cleanup = () => {
  if (dir) rmSync(join(dir, 'sessions', `${process.pid}.json`), { force: true });
  process.stdout.write('\x1b[?2004l');
  process.exit(0);
};
process.on('SIGTERM', cleanup);
process.on('SIGHUP', cleanup);
process.on('SIGINT', cleanup);
draw();
