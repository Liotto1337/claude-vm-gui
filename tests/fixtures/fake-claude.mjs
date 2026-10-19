#!/usr/bin/env node
// Фейковый Claude Code для тестов: рисует поле ввода как настоящий (линии «─», «❯», серая подсказка),
// включает bracketed paste и воспроизводит баг: вставка «обрабатывается» 250 мс, всё пришедшее за это время
// (в том числе Enter) теряется. Пишет sessions/<pid>.json и журнал, если задан CVG_CLAUDE_DIR.
// Команды: «menu» — меню из трёх вариантов; «busy» — 3 с «работы»; «long» — длинный ответ в журнал.
// CVG_FAKE_SLOW_ACCEPT=1 — поле очищается через 1200 мс после Enter. CVG_FAKE_SEED — начальный журнал (копируется при старте).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PASTE_MS = 250;
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
let busyUntil = 0;
let processingUntil = 0;
let enters = 0;
let pasteBuf = null;

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

function record(type, content) {
  if (!dir) return;
  const p = join(dir, 'projects', slug);
  mkdirSync(p, { recursive: true });
  const rec = type === 'user'
    ? { type: 'user', uuid: randomUUID(), sessionId, timestamp: new Date().toISOString(), message: { role: 'user', content } }
    : { type: 'assistant', uuid: randomUUID(), sessionId, timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: content }] } };
  appendFileSync(join(p, `${sessionId}.jsonl`), `${JSON.stringify(rec)}\n`);
}

function draw() {
  let out = '\x1b[H\x1b[2J';
  for (const h of history.slice(-10)) out += `${h}\r\n`;
  if (menu) {
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
  record('user', text);
  field = '';
  pasted = null;
  images = 0;
  if (text.trim() === 'long') {
    record('assistant', `Длинный ответ для проверки «печати». ${'Текст абзаца идёт дальше и дальше. '.repeat(18)}Конец ответа.`);
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
