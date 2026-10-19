# Claude VM GUI 0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Версия 0.2: отправка одним Enter, вход по паролю, панель «Сервер», лента переписки вместо терминала с карточками меню, группы и закрепление сессий со страницами.

**Architecture:** Новая логика без ввода-вывода — чистые функции в `src/shared/` (разбор экрана, журнала, метрик, раскладки сайдбара). Сервисы `src/main/` выполняют команды по SSH и шлют события в интерфейс через `IpcHub`. Renderer на React показывает ленту поверх скрытого, но живого xterm. Лента читает журнал Claude Code (`~/.claude/projects/…/<sessionId>.jsonl`), меню — с экрана tmux.

**Tech Stack:** Electron 44.9.0, electron-vite 6.0.0, React 19.3.1, TypeScript 5.9.3, ssh2 1.17.0, xterm 6.0.0, Vitest 5.0.5, Playwright 1.64.1. Новые: react-markdown 10.1.0, remark-gfm 4.0.1.

**Spec:** `docs/superpowers/specs/2026-10-19-claude-vm-gui-v0.2-design.md`. Базовая спецификация 0.1: `docs/superpowers/specs/2026-10-18-claude-vm-gui-design.md`.

## Global Constraints

- **Дизайн:** стиль не меняется. Только токены `tokens.css`, шрифты Source Serif 4 / JetBrains Mono / Segoe UI. Новые токены — только `--bubble` (светлая `#F0EEE6`, тёмная `#3a3a37`) и `--chart`.
- **Язык:** весь текст интерфейса и сообщения об ошибках на русском.
- **Адрес ВМ** не попадает в git. Хук `pre-commit` (`scripts/check-no-host.mjs`) остаётся. Фикстуры — без адреса, без путей пользователя (`/root/…` заменять на `/home/user/…` или `/tmp/…`), переписка в фикстурах синтетическая.
- **Коммиты:** автор `Liotto1337 <egorstep.0801@gmail.com>`, без строки Co-Authored-By. Сообщения коммитов на русском.
- **Карта Obsidian** (`obsidian/`) обновляется в том же коммите: «Структура кода» — новые файлы, «История разработки» — строка на задачу, «Стек и запуск» — новые зависимости и переменные окружения, «Дизайн и решения» — новые решения.
- **Тесты:**
  - трогают только tmux-сессии `cvg-test-*`;
  - не делают запросов к модели. Настоящий claude запускается только с `ANTHROPIC_BASE_URL`, указывающим на закрытый порт (`http://127.0.0.1:9`) или на `scripts/dev/fake-anthropic.mjs`.
- **Безопасность Electron без изменений:** contextIsolation, sandbox, CSP без `unsafe-eval` и `unsafe-inline` для скриптов. Новые IPC-каналы — в формате «группа:метод» и «группа:событие».
- **Зависимости** — точные версии, без `^`.
- **Сборка:** `npm run typecheck`, `npm test`, `npm run test:int`, `npm run test:e2e` зелёные в конце каждой задачи, которая их касается. E2E — под `xvfb-run -a`.
- **Переменные окружения для тестов:**
  - `CVG_CLAUDE_DIR` — каталог вместо `~/.claude` на ВМ;
  - `CVG_CLAUDE_CMD` — команда вместо `claude` в `tmux.startClaude`;
  - `CVG_FAKE_CLAUDE` — прежняя, для `cat`.

## Review Focus

1. Claude Code обновился и рисует экран иначе: `classifyScreen` должен вернуть `unknown`, а не ложное `menu`/`prompt` с мусором. Тогда показывается терминал. Тест `classifyScreen: незнакомый экран — unknown` (Task 1).
2. Ранний Enter склеен с концом вставки (сеть). Тест на фейковом claude, который теряет такой Enter (Task 2). Одна отправка — ровно один принятый Enter, без двойной отправки, если первый Enter сработал медленно. Тест `send: медленное принятие — без повтора` (Task 2).
3. Журнал на сотни мегабайт и строки длиннее буфера: читается только хвост, неполная первая строка отбрасывается. Тест `readTail отбрасывает обрезанную первую строку` (Task 6).
4. В tmux-сессии несколько панелей или в `sessions/` лежат файлы мёртвых claude с тем же `tmux`: выбирается файл по живому pid панели. Тест `pickClaudeSession: устаревший файл с тем же tmux не выбирается` (Task 6).
5. Перетаскивание закреплённого ниже незакреплённого, в том числе через страницу: инвариант держится. Тесты `move прижимает к границе зоны` и `paginate: группа, разорванная страницей, повторяет заголовок` (Task 4).

---

## Общий контракт (добавки в `src/shared/ipc.ts`)

```ts
export type ErrorCode = /* прежние */ | 'SEND_NOT_CONFIRMED' | 'NO_TRANSCRIPT';

export interface VmConfig { /* прежние поля */ hasPassword?: boolean } // только чтение, из main

export type MenuKey = 'up' | 'down' | 'left' | 'right' | 'enter' | 'esc' | 'tab' | 'shift-tab'
  | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

export interface MenuOption { n: number | null; label: string; description: string; selected: boolean }
export interface ParsedMenu { title: string; context: string[]; options: MenuOption[]; notes: string[]; hint: string | null }
export type ScreenState =
  | { kind: 'no-claude' }
  | { kind: 'prompt'; status: string | null; input: string }
  | { kind: 'menu'; menu: ParsedMenu }
  | { kind: 'unknown' };

export type ChatItem =
  | { kind: 'user'; id: string; text: string; images: number }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'thinking'; id: string }
  | { kind: 'note'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; summary: string; input: string;
      status: 'running' | 'ok' | 'error'; result: string | null; children: ChatItem[] };
export interface ChatEvent { session: string; reset: boolean; prepend: boolean; items: ChatItem[]; hasEarlier: boolean }
export interface ScreenEvent { session: string; state: ScreenState; busy: boolean }

export interface MetricsSample {
  t: number; cpu: number | null; load: [number, number, number] | null; uptimeSec: number | null;
  mem: { total: number; used: number; swapTotal: number; swapUsed: number } | null;   // байты
  disks: { mount: string; total: number; used: number }[];
  net: { iface: string; rxRate: number; txRate: number } | null;                     // байт/с
  procs: { pid: number; name: string; cpu: number; rss: number; session: string | null }[];
  error: string | null;
}
export interface SystemInfo { os: string; kernel: string; cores: number; claudeVersion: string | null }

export interface SidebarLayout { v: 1; items: LayoutItem[] }
export type LayoutItem =
  | { kind: 'session'; name: string; pinned?: boolean }
  | { kind: 'group'; id: string; name: string; pinned?: boolean; collapsed?: boolean; sessions: { name: string; pinned?: boolean }[] };

// В Api:
config: { get(): Promise<VmConfig | null>; save(c: VmConfig, password?: string | null): Promise<Result<void>> };
chat: {
  onItems(cb: (e: ChatEvent) => void): Unsubscribe;
  onScreen(cb: (e: ScreenEvent) => void): Unsubscribe;
  onUnavailable(cb: (e: { session: string; reason: string }) => void): Unsubscribe;
  loadEarlier(): Promise<Result<void>>;
  key(k: MenuKey): Promise<Result<void>>;
};
metrics: { setActive(fast: boolean): void; onSample(cb: (s: MetricsSample) => void): Unsubscribe; info(): Promise<Result<SystemInfo>> };
layout: { get(): Promise<SidebarLayout>; save(l: SidebarLayout): Promise<Result<void>> };
links: { open(url: string): void };
```

Каналы IPC:
- **chat:** `chat:items`, `chat:screen`, `chat:unavailable` (события); `chat:loadEarlier`, `chat:key` (handle).
- **metrics:** `metrics:setActive` (listen), `metrics:sample` (событие), `metrics:info` (handle).
- **layout:** `layout:get`, `layout:save` (handle).
- **links:** `links:open` (listen).

---

### Task 1: Фикстуры экранов и разбор экрана

**Files:**
- Create: `scripts/dev/fake-anthropic.mjs`, `scripts/dev/capture-screen.sh`, `tests/fixtures/screens/*.ans`, `src/shared/screen-parse.ts`, `tests/unit/screen-parse.test.ts`
- Modify: `src/shared/ipc.ts` (типы `MenuKey`, `MenuOption`, `ParsedMenu`, `ScreenState` из контракта), `src/shared/dialog.ts` (экспорт `DIALOG_FOOTER`)

**Interfaces:**
- Produces:
  - `stripAnsi(s: string, opts?: { dropDim?: boolean }): string`
  - `inputText(screen: string): string | null`
  - `parseMenu(plain: string): ParsedMenu | null`
  - `parseStatus(plain: string): string | null`
  - `classifyScreen(screen: string): ScreenState` — никогда не возвращает `no-claude`, это решает вызывающий
  - `menuKeysFor(menu: ParsedMenu, index: number): MenuKey[]`

- [ ] **Step 1: Фейковый API для снимков.** `scripts/dev/fake-anthropic.mjs`:
  - HTTP-сервер на `127.0.0.1:${PORT ?? 8787}`;
  - `POST /v1/messages` отвечает SSE-потоком Messages API:
    - если в последнем сообщении пользователя есть `bash:` — блок `tool_use` `Bash` с `{"command": <текст после bash:>, "description": "тест"}`;
    - если `ask:` — `tool_use` `AskUserQuestion` с одним вопросом и тремя вариантами;
    - если `edit:` — `tool_use` `Write` в `/tmp/cvg-probe/a.txt`;
    - иначе — текст `ок`;
  - на `tool_result` отвечает текстом `готово`;
  - прочие пути — `404 {}`;
  - заголовки запросов не логирует.

  `scripts/dev/capture-screen.sh <имя> <ключи…>`:
  - запускает `claude` в `cvg-test-cap` (120×40, папка `/tmp/cvg-probe`) с `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`;
  - шлёт ключи (`tmux send-keys`), ждёт 2 с;
  - сохраняет `tmux capture-pane -e -p` в `tests/fixtures/screens/<имя>.ans`, заменив `/tmp/cvg-probe` на `/tmp/project`.

- [ ] **Step 2: Снять фикстуры**:

  | Файл | Что на экране |
  |---|---|
  | `trust.ans` | «доверять папке?» в новой папке, выбран `No, exit` |
  | `trust-yes.ans` | после ↓ |
  | `prompt-empty.ans` | пустое поле с серым `Try "…"` |
  | `prompt-text.ans` | набрано `привет` |
  | `image-pending.ans` | поле `[Image #1]посмотри картинку`: вставка с путём к png и Enter в том же куске, как в Task 2 |
  | `busy.ans` | строка спиннера во время ответа |
  | `permission-bash.ans` | `bash: echo hi` |
  | `permission-write.ans` | `edit:` |
  | `ask.ans` | `ask:` |
  | `model.ans` | меню `/model` |
  | `config.ans` | `/config` |

  Проверить глазами, что в файлах нет адреса ВМ и путей `/root`.

- [ ] **Step 3: Написать падающие тесты** `tests/unit/screen-parse.test.ts`:

```ts
const fx = (n: string) => readFileSync(join(__dirname, '../fixtures/screens', `${n}.ans`), 'utf8');
it('stripAnsi убирает CSI/OSC', () => expect(stripAnsi('\x1b[31ma\x1b[0m\x1b]0;t\x07b')).toBe('ab'));
it('stripAnsi dropDim убирает тусклый текст', () => expect(stripAnsi('x\x1b[2mtip\x1b[0my', { dropDim: true })).toBe('xy'));
it('inputText: пустое поле с подсказкой', () => expect(inputText(fx('prompt-empty'))).toBe(''));
it('inputText: набранный текст', () => expect(inputText(fx('prompt-text'))).toBe('привет'));
it('inputText: картинка ждёт Enter', () => expect(inputText(fx('image-pending'))).toBe('[Image #1]посмотри картинку'));
it('inputText: меню без поля — null', () => expect(inputText(fx('trust'))).toBeNull());
it('parseMenu: доверие папке без номеров', () => expect(parseMenu(stripAnsi(fx('trust')))).toMatchObject({
  title: 'Accessing workspace:', hint: 'Enter to confirm · Esc to cancel',
  options: [{ n: null, label: 'No, exit', selected: true }, { n: null, label: 'Yes, I trust this folder', selected: false }] }));
it('parseMenu: /model — номера, описания, notes', () => {
  const m = parseMenu(stripAnsi(fx('model')))!;
  expect(m.title).toBe('Select model');
  expect(m.options.slice(0, 2).map((o) => [o.n, o.label, o.selected])).toEqual([[1, 'Default (recommended)', false], [2, 'Opus ✔', true]]);
  expect(m.options[1].description).toContain('~2× usage vs Sonnet');
  expect(m.notes.some((n) => n.includes('+2 models'))).toBe(true);
});
it('parseMenu: запрос Bash содержит команду в контексте', () =>
  expect(parseMenu(stripAnsi(fx('permission-bash')))!.context.join('\n')).toContain('echo hi'));
it('parseMenu: обычное поле — null', () => expect(parseMenu(stripAnsi(fx('prompt-text')))).toBeNull());
it('parseStatus: спиннер без esc to interrupt', () => {
  const s = parseStatus(stripAnsi(fx('busy')))!;
  expect(s).not.toMatch(/esc to interrupt/);
  expect(s.length).toBeGreaterThan(0);
});
it('classifyScreen: меню', () => expect(classifyScreen(fx('ask')).kind).toBe('menu'));
it('classifyScreen: поле ввода', () => expect(classifyScreen(fx('prompt-text'))).toMatchObject({ kind: 'prompt', input: 'привет' }));
it('classifyScreen: незнакомый экран — unknown', () => expect(classifyScreen(fx('config')).kind).toBe('unknown'));
it('classifyScreen: пустой экран — unknown', () => expect(classifyScreen('').kind).toBe('unknown'));
it('menuKeysFor: без номера — стрелки и Enter', () =>
  expect(menuKeysFor(parseMenu(stripAnsi(fx('trust')))!, 1)).toEqual(['down', 'enter']));
it('menuKeysFor: с номером — цифра', () => expect(menuKeysFor(parseMenu(stripAnsi(fx('model')))!, 0)).toEqual(['1']));
```

  Если меню `/config` распознаётся как меню с осмысленными вариантами, тест `config → unknown` заменяется на другой экран, который не разобрать (например, `/agents`) — с записью Ruling.

- [ ] **Step 4:** `npx vitest run tests/unit/screen-parse.test.ts` → FAIL (модуль не найден).
- [ ] **Step 5: Реализовать** `src/shared/screen-parse.ts` по разделу 4 спецификации («Экран»):
  - `inputText` берёт последнюю пару линий из `─` (не меньше 20 подряд), между которыми первая строка начинается с `❯`;
  - `parseMenu` работает только при совпадении `DIALOG_FOOTER` (из `dialog.ts`) в последних 12 непустых строках;
  - `classifyScreen`: сначала меню, потом поле ввода, иначе `unknown`.
- [ ] **Step 6:** тест → PASS. `npm test` → PASS.
- [ ] **Step 7: Коммит** «Разбор экрана Claude Code: поле ввода, меню, статус» (+ карта).

### Task 2: Отправка одним Enter

**Files:**
- Create: `tests/fixtures/fake-claude.mjs`, `tests/integration/send.test.ts`
- Modify: `src/main/terminal.ts`, `src/main/tmux.ts` (`CVG_CLAUDE_CMD`), `src/shared/ipc.ts` (`SEND_NOT_CONFIRMED`)

**Interfaces:**
- Consumes: `inputText` (Task 1).
- Produces:
  - `TerminalService.send(text, imagePaths): Promise<Result<void>>` — та же сигнатура, новое поведение;
  - `TerminalService` принимает `opts?: { probe?: (session: string) => Promise<string | null>; timings?: SendTimings }`;
  - `export interface SendTimings { pollMs: number; settleMaxMs: number; confirmMs: number; fallbackMs: number }` — по умолчанию `{60, 3000, 1500, 300}`.

- [ ] **Step 1: Фейковый claude** `tests/fixtures/fake-claude.mjs` (node, stdin в raw-режиме). Рисует, начиная с первой строки экрана (через `\x1b[H\x1b[2J`):
  - история строк `› <текст>` (отправленные);
  - строка `CVG_FAKE_STATUS`, если она задана (спиннер);
  - линию `─`×60;
  - `❯ <поле>` (пустое поле — `❯ ` + `\x1b[2mTry "fake"\x1b[0m`);
  - линию `─`×60;
  - строку подсказок.

  Поведение:
  - вставка `ESC[200~…ESC[201~` 250 мс «обрабатывается». Всё, что пришло в это время (в том числе `\r`), отбрасывается — так воспроизводится баг. Затем путь `*.png` превращается в `[Image #1]`, текст попадает в поле;
  - `\r` при непустом поле отправляет его;
  - при `CVG_FAKE_SLOW_ACCEPT=1` поле очищается через 1200 мс после Enter;
  - если задан `CVG_CLAUDE_DIR`, при старте пишет `<dir>/sessions/<pid>.json` (`pid`, `sessionId` случайный UUID, `cwd`, `tmux` из `TMUX_PANE`, `status`), а при отправке дописывает запись `{"type":"user","uuid":…,"message":{"role":"user","content":<текст>}}` в `<dir>/projects/<slug(cwd)>/<sessionId>.jsonl`;
  - команда `menu` рисует меню из трёх нумерованных вариантов с подсказкой `Enter to confirm · Esc to cancel` (↑↓/цифры/Enter/Esc; выбор пишет запись assistant `выбран N`);
  - `busy` на 3 с ставит статус `✻ Думаю… (3s · esc to interrupt)` и `status: "busy"` в sessions-файле.

  Процесс запускается как `node …/fake-claude.mjs`: `pane_current_command` = `node`, а в аргументах есть `claude`, поэтому `checkWritable` его пропускает.
- [ ] **Step 2:** `tmux.startClaude` использует `process.env.CVG_CLAUDE_CMD ?? 'claude'`.
- [ ] **Step 3: Падающие тесты** `tests/integration/send.test.ts` (сессия `cvg-test-send-*`, `startClaude` с `CVG_CLAUDE_CMD="node <repo>/tests/fixtures/fake-claude.mjs"`, `term.open`):

```ts
it('send: вставка картинки уходит одним вызовом', async () => {
  expect((await term.send('посмотри', ['/tmp/x.png'])).ok).toBe(true);
  await expect.poll(() => screenOf(name)).toContain('› [Image #1]посмотри');
});
it('send: длинный многострочный текст уходит одним вызовом', async () => {
  const text = Array.from({ length: 40 }, (_, i) => `строка ${i}`).join('\n');
  expect((await term.send(text, [])).ok).toBe(true);
  await expect.poll(() => screenOf(name)).toContain('› строка 0');
});
it('send: медленное принятие — без повтора', async () => { /* CVG_FAKE_SLOW_ACCEPT=1: ровно одна строка › */ });
it('send: Enter не принят — SEND_NOT_CONFIRMED', async () => {
  // probe, который всегда возвращает экран с непустым полем
  const t = new TerminalService(conn, tmux, { probe: async () => FIELD_WITH_TEXT, timings: FAST });
  /* … */ expect(r).toMatchObject({ ok: false, error: { code: 'SEND_NOT_CONFIRMED' } });
});
it('send: поле не распознано — старый путь с паузой', async () => { /* probe → null: ok, один \r */ });
```

  Плюс unit-проверка на старую реализацию: с `CVG_FAKE_*` первый тест падает (сообщение остаётся в поле). Это доказывает, что баг воспроизведён.
- [ ] **Step 4:** `npx vitest run --project integration tests/integration/send.test.ts` → первые два FAIL.
- [ ] **Step 5: Реализовать** `send` по разделу 1 спецификации:
  - `probe` по умолчанию: `tmux capture-pane -e -p -t <exactPane>` через `conn.exec` (таймаут 2 с; ошибка → `null`);
  - `inputText` сравнивается между опросами;
  - повтор `\r` — не больше одного.
- [ ] **Step 6:** тесты → PASS; `npm run test:int` → PASS (прежний `tmux.test.ts` тоже).
- [ ] **Step 7: Проверка с настоящим claude** (без модели): тестовая сессия `cvg-test-real` с `ANTHROPIC_BASE_URL=http://127.0.0.1:9`, PTY-клиент `tmux attach`, вызов `TerminalService.send` для картинки и текста на 40 строк. Ожидание: поле пустое, в журнале новая запись user. Результат — в журнал задачи.
- [ ] **Step 8: Коммит** «Отправка одним Enter: ждём готовности поля ввода и подтверждения» (+ карта: «Дизайн и решения» — причина бага).

### Task 3: Вход по паролю

**Files:**
- Modify: `src/main/config.ts`, `src/main/ipc.ts`, `src/main/ssh.ts`, `src/main/controller.ts`, `src/preload/index.ts`, `src/renderer/state.ts`, `src/renderer/components/SettingsDialog.tsx`, `src/shared/ipc.ts`
- Test: `tests/unit/config.test.ts`, `tests/integration/password.test.ts`, `tests/e2e/connect.spec.ts`

**Interfaces:**
- Produces:
  - `interface SecretBox { available(): boolean; encrypt(s: string): Buffer; decrypt(b: Buffer): string }` в `config.ts`; в main — обёртка над `safeStorage`;
  - `loadConfig(opts)` → `VmConfig` без `passwordEnc`, с `hasPassword`;
  - `loadPassword(userDataDir, box): string | null`;
  - `saveConfig(userDataDir, c, password: string | null | undefined, box): Result<void>`;
  - `SshOptions.password?: string`.

- [ ] **Step 1: Падающие тесты** в `config.test.ts` (box — фейк: `encrypt = s => Buffer.from('enc:' + s)`):

```ts
it('пароль сохраняется зашифрованным и не возвращается в конфиге', () => {
  saveConfig(dir, cfg, 'секрет', box);
  const raw = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  expect(raw.passwordEnc).toBe(Buffer.from('enc:секрет').toString('base64'));
  expect(JSON.stringify(loadConfig({ userDataDir: dir }))).not.toContain('секрет');
  expect(loadConfig({ userDataDir: dir })!.hasPassword).toBe(true);
  expect(loadPassword(dir, box)).toBe('секрет');
});
it('undefined не трогает пароль, null удаляет', () => { /* … */ });
it('без шифрования пароль не сохраняется', () =>
  expect(saveConfig(dir, cfg, 'x', { ...box, available: () => false })).toMatchObject({ ok: false, error: { code: 'CONFIG_INVALID' } }));
it('ключ не обязателен, если есть пароль', () => expect(validateConfig({ ...cfg, keyPath: '' }, true)).toBeNull());
it('ключ обязателен без пароля', () => expect(validateConfig({ ...cfg, keyPath: '' }, false)).not.toBeNull());
it('hasPassword из интерфейса не записывается в файл', () => { /* … */ });
```

- [ ] **Step 2:** FAIL → реализовать → PASS. `validateConfig(c, hasPassword: boolean)`.
- [ ] **Step 3: Падающие интеграционные тесты** `password.test.ts`. Сервер `ssh2.Server` на `127.0.0.1:<свободный порт>` с ключом хоста, сгенерированным `utils.generateKeyPairSync('ed25519')`; known_hosts — временный файл со строкой этого ключа (`knownHostsLine`).

```ts
it('вход по паролю', …)                       // сервер принимает только password 'p@ss' → ok
it('вход через keyboard-interactive', …)      // сервер принимает только keyboard-interactive → ok
it('неверный пароль — AUTH_FAILED «ни ключ, ни пароль»', …)
it('пароль выключен на сервере — «выключен вход по паролю»', …) // сервер предлагает только publickey
it('нечитаемый ключ при пароле — не ошибка', …)  // keyPath: '/nonexistent', пароль верный → ok
it('пароль не попадает в сообщение об ошибке', …)
```

- [ ] **Step 4:** FAIL → реализовать в `ssh.ts`: `authHandler(methodsLeft, partial, next)` с очередью `[publickey?, agent?, password?, keyboard-interactive?]`; `ConnectConfig.password` / `tryKeyboard: true` только при наличии пароля. Текст ошибки — по разделу 2 спецификации. В `controller.connect` передать `password: loadPassword(...)`. → PASS.
- [ ] **Step 5: Интерфейс.**
  - `SettingsDialog`: поле «Пароль (необязательно)» (`id="set-password"`, `type="password"`, `autoComplete="off"`);
  - при `hasPassword` — текст «Пароль сохранён» и кнопки «Изменить» / «Удалить»;
  - подпись под ключом: «Не нужен, если задан пароль»;
  - `state.saveConfig(c, password)` → `api.config.save(c, password)`.
- [ ] **Step 6: E2E** в `connect.spec.ts`: «пароль сохраняется и показывается как сохранённый». Ввести пароль, сохранить, открыть настройки снова → «Пароль сохранён»; `config.json` не содержит пароль открытым текстом. В Linux-тестах `safeStorage` может быть недоступен: тест проверяет, что в этом случае видно сообщение «Шифрование недоступно» и пароля в файле нет, а `test.skip` не используется.
- [ ] **Step 7:** `npm run typecheck && npm test && npm run test:int && npm run test:e2e` → PASS. Коммит «Вход по паролю (safeStorage)» (+ карта).

### Task 4: Модель раскладки сайдбара

**Files:**
- Create: `src/shared/layout.ts`, `src/main/layout-store.ts`, `tests/unit/layout.test.ts`, `tests/unit/layout-store.test.ts`
- Modify: `src/shared/ipc.ts` (типы раскладки, `layout` в `Api`), `src/main/ipc.ts` (`layout:get/save`), `src/preload/index.ts`

**Interfaces:**
- Produces (в `layout.ts`):
  - `type Pos = { group: string | null; index: number }`
  - `reconcile(l, names): SidebarLayout`
  - `normalize(raw: unknown): SidebarLayout`
  - `move(l, item: { session: string } | { group: string }, to: Pos): SidebarLayout`
  - `togglePin(l, item): SidebarLayout`
  - `createGroup(l, name, withSession?): { layout: SidebarLayout; id: string }`
  - `renameGroup(l, id, name)`, `deleteGroup(l, id)`, `toggleCollapsed(l, id)`, `moveToGroup(l, session, id)`, `removeFromGroup(l, session)`
  - `validGroupName(s): string | null`
  - `type Row = { kind: 'section'; label: string } | { kind: 'divider' } | { kind: 'group'; id: string; continued: boolean } | { kind: 'session'; name: string; group: string | null }`
  - `rowsOf(l, names: Set<string>): Row[]`
  - `paginate(rows, heights: Record<Row['kind'], number>, available): Row[][]`
- Produces (в main): `class LayoutStore { constructor(dir: string, debounceMs = 300); get(host): SidebarLayout; save(host, l): Result<void>; flush(): void }`

- [ ] **Step 1: Падающие тесты** `layout.test.ts`:

```ts
const L = (items: LayoutItem[]): SidebarLayout => ({ v: 1, items });
it('reconcile: новая сессия первой среди незакреплённых', () =>
  expect(reconcile(L([{ kind: 'session', name: 'a', pinned: true }, { kind: 'session', name: 'b' }]), ['a', 'b', 'c']).items.map(n))
    .toEqual(['a', 'c', 'b']));
it('reconcile: исчезнувшие убраны, пустая группа осталась', …);
it('move прижимает к границе зоны: закреплённая не уходит ниже незакреплённых', () =>
  expect(move(L([pinned('a'), s('b'), s('c')]), { session: 'a' }, { group: null, index: 3 }).items.map(n)).toEqual(['a', 'b', 'c']));
it('move: незакреплённая не поднимается выше закреплённых', …);
it('move: сессия в группу и обратно', …);
it('move: группа в группу не вкладывается', …);
it('togglePin: закреплённая встаёт в конец закреплённой зоны', …);
it('togglePin в группе — наверх группы', …);
it('deleteGroup: сессии на место группы', …);
it('normalize: мусор → пустая раскладка; дубликат сессии убирается; инвариант восстанавливается', …);
it('validGroupName: обрезка, 1–40 символов', …);
it('rowsOf: свёрнутая группа — одна строка; раздел «Закреплённые» только если есть', …);
it('paginate: всё помещается — одна страница', …);
it('paginate: группа, разорванная страницей, повторяет заголовок', () => {
  const pages = paginate(rowsOf(bigLayout, names), H, 200);
  expect(pages[1][0]).toMatchObject({ kind: 'group', continued: true });
});
it('paginate: строка выше доступной высоты всё равно попадает на страницу', …);
```

  `layout-store.test.ts`: сохранение с задержкой и `flush`; отдельные раскладки для разных host; повреждённый файл → пустая раскладка.

- [ ] **Step 2:** FAIL → реализовать → PASS.
- [ ] **Step 3: IPC.** `layout:get` → `store.get(config.host)`, `layout:save` → `normalize` + `store.save`. `flush` при `app.on('before-quit')`.
- [ ] **Step 4:** `npm run typecheck && npm test` → PASS. Коммит «Раскладка сессий: порядок, закрепление, группы, страницы» (+ карта).

### Task 5: Сайдбар с группами, закреплением, перетаскиванием и страницами

**Files:**
- Create: `src/renderer/components/SessionList.tsx`, `ContextMenu.tsx`, `GroupNameDialog.tsx`, `Pager.tsx`
- Modify: `Sidebar.tsx`, `icons.tsx` (`IconPin`, `IconChevron`, `IconFolder`, `IconPulse`), `state.ts` (`layout`, `sidebarPage`, действия), `styles/app.css`, `MainView.tsx`
- Test: `tests/e2e/sidebar.spec.ts`

**Interfaces:**
- Consumes: функции `layout.ts` (Task 4), `api.layout`.
- Produces:
  - в `state.ts`: `layout: SidebarLayout` в `AppState`;
  - `updateLayout(fn: (l: SidebarLayout) => SidebarLayout): void` — применяет, сохраняет, перерисовывает;
  - `ROW_HEIGHTS` в `SessionList.tsx` (`section 28, divider 17, group 34, session 52`), совпадают с CSS.

- [ ] **Step 1: Падающие E2E** `sidebar.spec.ts` (4 сессии `cvg-test-sb-*`; размер окна задаётся через `page.setViewportSize`):

```ts
test('закрепить через ПКМ: булавка и место наверху', …)            // click({button:'right'}) → «Закрепить» → первая в списке, aria-label «Закреплена»
test('новая группа из меню, сворачивание и счётчик', …)
test('перетаскивание меняет порядок и переживает перезапуск', …)    // dragTo; перезапуск приложения с тем же CVG_USER_DATA
test('закреплённую нельзя перетащить ниже незакреплённых', …)
test('удаление группы оставляет сессии', …)
test('страницы: маленькое окно → пейджер, переход на страницу 2', …)
test('Alt+↓ переставляет сессию в фокусе', …)
test('Shift+F10 открывает меню сессии', …)
```

- [ ] **Step 2:** `npm run test:e2e -- sidebar` → FAIL.
- [ ] **Step 3: Реализовать** по разделу 5 спецификации и макетам `Feed`/`SessionMenu`:
  - **перетаскивание:**
    - HTML5 `draggable`, `dataTransfer.setData('application/x-cvg', JSON)`;
    - линия вставки — элемент `.drop-line`;
    - сброс вычисляет `Pos` и вызывает `move`;
    - пейджер ловит `dragenter` с таймером 600 мс;
  - **ContextMenu:** `role="menu"`, пункты `role="menuitem"`, подменю групп, закрытие по Esc и клику мимо, фокус на первом пункте;
  - **GroupNameDialog** по образцу `NewSessionDialog`;
  - **страницы:** `ResizeObserver` на списке → `paginate`; выбранная сессия держит свою страницу видимой;
  - при изменении `sessions` вызывается `reconcile`.
- [ ] **Step 4:** E2E → PASS; прежние `sessions.spec.ts` → PASS (селекторы при необходимости обновить, ledger Ruling). `npm run typecheck`.
- [ ] **Step 5: Коммит** «Сайдбар: группы, закрепление, перетаскивание, страницы» (+ карта).

### Task 6: Журнал Claude Code → элементы ленты

**Files:**
- Create: `src/shared/transcript-parse.ts`, `src/shared/claude-session.ts`, `src/main/transcript.ts`, `tests/unit/transcript-parse.test.ts`, `tests/unit/claude-session.test.ts`, `tests/integration/transcript.test.ts`, `tests/fixtures/transcript.jsonl`
- Modify: `src/main/ssh.ts` (`stream(cmd): Promise<ClientChannel>` — exec без PTY, без сбора вывода), `src/shared/ipc.ts` (`ChatItem`, `ChatEvent`)

**Interfaces:**
- Produces (`claude-session.ts`):
  - `projectSlug(cwd: string): string` — каждый символ не из `[A-Za-z0-9]` → `-`;
  - `transcriptPath(claudeDir: string, cwd: string, sessionId: string): string`;
  - `pickClaudeSession(records: unknown[], pids: number[], paneId: string): { sessionId: string; cwd: string; status: string } | null`;
  - `UUID: RegExp`.
- Produces (`transcript-parse.ts`):
  - `interface ParseState { items: Map<string, ChatItem>; toolOwner: Map<string, string>; orphanResults: Map<string, { text: string; error: boolean }> }`;
  - `newParseState(): ParseState`;
  - `parseTranscriptLines(lines: string[], st: ParseState): { changed: ChatItem[]; bad: number }` — `changed` — изменённые элементы верхнего уровня в порядке появления.
- Produces (`transcript.ts`):
  - `class TranscriptService extends EventEmitter` — события `items` (`Omit<ChatEvent,'session'>`), `unavailable` (`reason: string`);
  - `follow(path: string | null): Promise<void>` — `null` останавливает;
  - `loadEarlier(): Promise<Result<void>>`;
  - `stop(): void`;
  - `export async function readTail(conn, path, bytes): Promise<{ lines: string[]; start: number; size: number }>`.

- [ ] **Step 1: Фикстура.** `tests/fixtures/transcript.jsonl` — синтетический журнал в форме настоящего: строки взяты по структуре из журнала, созданного в Task 1 через fake-anthropic, а тексты заменены. В нём есть:
  - user-строка и user с путём к картинке из uploads;
  - user с `<command-name>/model</command-name><command-args>sonnet</command-args>`;
  - `isMeta: true`;
  - assistant `thinking`, `text`, `tool_use` (Bash, Read, Task);
  - user `tool_result` (обычный и `is_error`);
  - две записи `isSidechain: true`;
  - записи `attachment`, `api-request`, `ai-title`, `mode`;
  - одна битая строка;
  - `[Request interrupted by user]`.
- [ ] **Step 2: Падающие тесты:**

```ts
it('user: текст и картинки чипами', () => expect(first('user')).toMatchObject({ text: 'посмотри', images: 1 }));
it('slash-команда как user «/model sonnet»', …);
it('isMeta и служебные записи пропускаются', …);
it('tool_use + tool_result → ok с результатом', () => expect(tool('Bash')).toMatchObject({ status: 'ok', summary: 'ls -la', result: expect.stringContaining('total') }));
it('is_error → status error', …);
it('результат раньше вызова (подгрузка ранней части) — склеивается', …);
it('sidechain вложен в Task', () => expect(tool('Task').children.length).toBe(2));
it('битая строка считается в bad и не роняет разбор', …);
it('прерывание → note', …);
it('длинный результат обрезан до 200 строк с пометкой', …);
it('projectSlug', () => expect(projectSlug('/home/user/my.site')).toBe('-home-user-my-site'));
it('transcriptPath отвергает не-UUID', () => expect(() => transcriptPath('~/.claude', '/x', '../evil')).toThrow());
it('pickClaudeSession: по pid панели', …);
it('pickClaudeSession: устаревший файл с тем же tmux не выбирается', …);
```

  Интеграция `transcript.test.ts` (localhost, временный каталог):
  - `follow` отдаёт хвост;
  - дописанная строка приходит событием;
  - `readTail` отбрасывает обрезанную первую строку (файл 3 МБ, хвост 1,5 МБ);
  - `loadEarlier` даёт `prepend: true`;
  - отсутствующий файл → `unavailable`;
  - 20 битых строк подряд → `unavailable`.
- [ ] **Step 3:** FAIL → реализовать по таблице раздела 4 спецификации:
  - хвост читается через `tail -c <bytes> -- <quoted>` и `stat -c %s`;
  - слежение — `tail -c +<size+1> -F -- <quoted>` через `conn.stream`, с буфером неполной строки;
  - `loadEarlier` использует `dd if=<path> bs=1 skip=<start-n> count=<n>` (или `tail -c +… | head -c …`).

  → PASS.
- [ ] **Step 4:** `npm test && npm run test:int` → PASS. Коммит «Журнал Claude Code: разбор и слежение» (+ карта).

### Task 7: Наблюдение за сессией и IPC ленты

**Files:**
- Create: `src/main/session-watch.ts`, `tests/integration/session-watch.test.ts`
- Modify: `src/main/controller.ts`, `src/main/terminal.ts` (событие `opened` с именем сессии), `src/preload/index.ts`, `src/shared/ipc.ts` (`Api.chat`, `NO_TRANSCRIPT`), `src/shared/paste.ts` (`keyBytes(k: MenuKey): string`)
- Test: `tests/unit/paste.test.ts`

**Interfaces:**
- Consumes: `classifyScreen` (Task 1), `pickClaudeSession`/`transcriptPath` (Task 6), `TranscriptService` (Task 6).
- Produces:
  - `class SessionWatcher extends EventEmitter` — события `screen` (`ScreenEvent` без `session`), `claude` (`{ sessionId, cwd, status } | null`);
  - `start(name: string): void`, `stop(): void`;
  - опрос 500 мс, связка с `sessions/*.json` — каждый 4-й опрос;
  - `keyBytes`;
  - `TerminalService.key(k: MenuKey): Promise<Result<void>>` — проверка `isClaude` (как `checkWritable`, но без проверки меню).

- [ ] **Step 1: Падающие тесты:**
  - `paste.test.ts`: `keyBytes('up') === '\x1b[A'`, `'shift-tab'` → `'\x1b[Z'`, `'7'` → `'7'`, неизвестная клавиша → throw;
  - `session-watch.test.ts` (фейковый claude, `CVG_CLAUDE_DIR` во временной папке):
    - `screen` с `kind: 'prompt'`;
    - после `menu` — `kind: 'menu'` с тремя вариантами;
    - `busy` → `busy: true`;
    - в сессии `bash` → `no-claude`;
    - событие `claude` с sessionId из `sessions/<pid>.json`;
    - после `stop` событий нет.
- [ ] **Step 2:** FAIL → реализовать:
  - одна команда на опрос: `display-message` (`pane_id`, `pane_pid`, `pane_current_command`), `ps --ppid`, `capture-pane -e -p`, на каждом 4-м — `for f in <dir>/sessions/*.json; do cat "$f"; echo; done`;
  - `CVG_CLAUDE_DIR` (иначе `$HOME/.claude`);
  - вызов в процессе не перекрывается следующим: если предыдущий exec не завершился, тик пропускается.

  → PASS.
- [ ] **Step 3: Связка в `AppController`.**
  - После успешного `term:open` — `watch.start(name)`.
  - `watch.on('claude', info => transcript.follow(info ? transcriptPath(dir, info.cwd, info.sessionId) : null))` — только если путь изменился.
  - События уходят в `chat:items` / `chat:screen` / `chat:unavailable` с `session`.
  - `tmux:kill`, `disconnect` и смена сессии останавливают оба.
  - После `reattached` — перезапуск.
  - `chat:key` → `term.key`, `chat:loadEarlier` → `transcript.loadEarlier`.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run test:int` → PASS. Коммит «Наблюдение за сессией: экран, журнал, клавиши меню» (+ карта).

### Task 8: Лента, карточка меню, переключатель вида

**Files:**
- Create: `src/renderer/components/ChatView.tsx`, `ChatItemView.tsx`, `Markdown.tsx`, `MenuCard.tsx`
- Modify: `MainView.tsx`, `SessionHeader.tsx` (переключатель «Лента | Терминал»), `TerminalView.tsx` (проп `hidden`, повторный fit при показе), `Composer.tsx` (неактивно при `menu`, кнопка «Остановить · Esc»), `Banner.tsx` («Не удалось прочитать переписку — показан терминал»), `state.ts` (`chat: Record<session, { items: ChatItem[]; hasEarlier: boolean; screen: ScreenState | null; busy: boolean; unavailable: string | null }>`, `viewOverride: 'terminal' | null`), `src/main/index.ts` (`links:open` → `shell.openExternal` только `http(s):`), `styles/tokens.css` (`--bubble`, `--chart`), `styles/app.css`, `package.json` (react-markdown 10.1.0, remark-gfm 4.0.1)
- Create: `src/renderer/view-mode.ts`, `tests/unit/view-mode.test.ts`
- Test: `tests/e2e/chat.spec.ts`

**Interfaces:**
- Consumes: `api.chat` (Task 7), `menuKeysFor` (Task 1), `ChatItem`.
- Produces: `viewMode(input: { claudeRunning: boolean; screen: ScreenState | null; unavailable: boolean; override: 'terminal' | null }): 'chat' | 'terminal'` в `src/renderer/view-mode.ts` (чистая, unit-тест); `mergeItems(prev: ChatItem[], e: ChatEvent): ChatItem[]` там же.

- [ ] **Step 1: Падающие unit-тесты** `view-mode.test.ts`:

```ts
it('claude не запущен → terminal', …); it('unknown → terminal', …); it('menu → chat', …);
it('журнал недоступен → terminal', …); it('override terminal → terminal', …); it('screen ещё нет → chat', …);
it('mergeItems: upsert по id', …); it('mergeItems: prepend', …); it('mergeItems: reset', …);
```

- [ ] **Step 2: Падающие E2E** `chat.spec.ts` (фейковый claude через `CVG_CLAUDE_CMD`, `CVG_CLAUDE_DIR` — временная папка, заранее положен `tests/fixtures/transcript.jsonl` под нужным sessionId):

```ts
test('при claude показывается лента, терминал скрыт', …)              // role=region «Переписка», текст из фикстуры
test('инструмент раскрывается по клику', …)
test('отправка из поля ввода появляется в ленте', …)
test('меню: карточка, стрелка вниз и Enter выбирают вариант', …)      // «menu» → карточка → ↓ Enter → в ленте «выбран 2»
test('меню: клик по варианту', …)
test('переключатель «Терминал» показывает xterm', …)
test('без claude — терминал и нет переключателя', …)
test('ссылка из ответа открывается через links.open, а не в окне', …)  // CVG_TEST_HOOKS: подмена shell.openExternal
```

- [ ] **Step 3:** FAIL → реализовать по разделу 4 спецификации и макету `Feed`:
  - **Markdown:** `react-markdown` + `remark-gfm`, `components.a` вызывает `api.links.open`, без `rehype-raw`;
  - **автопрокрутка:** только если пользователь был внизу, иначе кнопка «↓ Новые сообщения»;
  - **MenuCard:**
    - фокус при появлении;
    - `onKeyDown` переводит клавиши в `MenuKey` → `api.chat.key`;
    - клик по варианту → `menuKeysFor` → по очереди `api.chat.key`;
  - **TerminalView** остаётся смонтированным, скрывается через `hidden`;
  - **Composer:** при `menu` — `disabled` и placeholder «Сначала ответьте на вопрос выше»; при `busy` и `prompt` — кнопка «Остановить · Esc».
- [ ] **Step 4:** unit и E2E → PASS; все прежние E2E → PASS. `npm run typecheck`.
- [ ] **Step 5: Коммит** «Лента переписки и карточки меню вместо терминала» (+ карта).

### Task 9: Панель «Сервер»

**Files:**
- Create: `src/shared/metrics-parse.ts`, `src/main/metrics.ts`, `src/renderer/components/ServerPanel.tsx`, `Sparkline.tsx`, `tests/unit/metrics-parse.test.ts`, `tests/integration/metrics.test.ts`, `tests/fixtures/metrics/*.txt`
- Modify: `src/shared/ipc.ts` (`MetricsSample`, `SystemInfo`, `Api.metrics`), `src/main/controller.ts`, `src/preload/index.ts`, `Sidebar.tsx` (кнопка «Сервер»), `state.ts` (`metrics: MetricsSample[]` — последние 150, `serverOpen`), `styles/app.css`
- Test: `tests/e2e/server.spec.ts`

**Interfaces:**
- Produces:
  - `parseCpu(s): number[]`, `cpuPercent(prev, next): number`;
  - `parseMem(s)`, `parseLoad(s)`, `parseUptime(s)`;
  - `parseNetDev(s): Record<string, { rx: number; tx: number }>`, `pickInterface(prev, next): string | null`;
  - `parseDf(s)`, `parsePs(s)`, `parseOsRelease(s): string`;
  - `labelClaudeProcs(procs, sessionRecords: unknown[])`;
  - `formatBytes(n): string` («5,1 ГБ»), `formatRate(n): string` («1,2 МБ/с»);
  - `class MetricsService extends EventEmitter` — событие `sample`; `start()`, `setActive(fast)`, `stop()`, `info(): Promise<Result<SystemInfo>>`.

- [ ] **Step 1: Фикстуры:** реальный вывод команды сбора с этой ВМ (`/proc/*`, `df`, `ps`) в `tests/fixtures/metrics/`. Имена хостов и пути пользователя заменены.
- [ ] **Step 2: Падающие тесты:**

```ts
it('cpuPercent по двум замерам', () => expect(cpuPercent(parseCpu(A), parseCpu(B))).toBeCloseTo(23.5, 0));
it('parseMem: used = MemTotal − MemAvailable', …); it('parseDf пропускает заголовок, байты', …);
it('pickInterface: самый нагруженный, не lo', …); it('parsePs: pid, cpu, rss, имя', …);
it('labelClaudeProcs: имя сессии из tmux «site:@3.%3» → «site»', …);
it('formatBytes по-русски', () => expect(formatBytes(5.1 * 2 ** 30)).toBe('5,1 ГБ'));
```

  Интеграция `metrics.test.ts` (localhost): два замера с паузой дают `cpu` в 0–100, хотя бы один диск `/`, `info().os` непустой.
- [ ] **Step 3:** FAIL → реализовать:
  - команда сбора из раздела 3 спецификации плюс `cat <claudeDir>/sessions/*.json`;
  - интервалы 10 с и 2 с;
  - тик не перекрывается следующим;
  - ошибка тика → `sample` с `error` и прежними значениями `null`.

  → PASS.
- [ ] **Step 4: UI.**
  - **ServerPanel** по макету `VmPanel`: `role="dialog"`, `aria-label="Сервер"`, затемнение, закрытие по Esc/×/затемнению, возврат фокуса;
  - **цвета дисков:** от 80 % — `--accent-strong`, от 90 % — `--danger`;
  - **Sparkline** (`values: number[]`, `max?: number`, `label: string`) — SVG `role="img"`;
  - **сбор:** `metrics.setActive(true/false)` при открытии и закрытии; `MetricsService.start()` после подключения, `stop()` при отключении;
  - **ошибка замера:** если последний `sample.error` не пуст, показываются прежние значения и подпись «нет данных N с».
- [ ] **Step 5: E2E** `server.spec.ts`:
  - кнопка «Сервер» открывает панель;
  - видны «Процессор», «Память», «Диски», прогрессбар `/`;
  - через 5 с график содержит хотя бы 2 точки;
  - Esc закрывает, фокус на кнопке.
- [ ] **Step 6:** все тесты → PASS. Коммит «Панель „Сервер“: CPU, память, диски, сеть, процессы» (+ карта).

### Task 10: Проверка с настоящим claude, документация, версия

**Files:**
- Modify: `README.md`, `package.json` (`version: 0.2.0`), `scripts/screenshots.mjs` (новые экраны: лента, меню, сервер, группы), `docs/screenshots/*`, `obsidian/*`

- [ ] **Step 1: Настоящий claude + fake-anthropic** (`CVG_CLAUDE_CMD="env ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude"`), сессия `cvg-test-real`, собранное приложение под xvfb. Сценарий:
  1. картинка + текст одним Enter;
  2. `bash: echo hi` → карточка разрешения → вариант 1 → в ленте строка Bash с результатом `hi`;
  3. `ask:` → карточка AskUserQuestion → выбор стрелками;
  4. `/model` → карточка → Esc;
  5. «доверять папке?» в новой папке → карточка → «Yes».

  Расхождения разбора с настоящим экраном чинятся по TDD: новая фикстура → падающий тест → правка. Каждое расхождение — запись в ledger.
- [ ] **Step 2:** Скриншоты (`npm run screenshots`, демо-адрес), README: разделы «Лента», «Сервер», «Сессии и группы», «Вход по паролю»; таблица переменных окружения для тестов.
- [ ] **Step 3:** версия 0.2.0; полный прогон `npm run typecheck && npm test && npm run test:int && npm run test:e2e` → PASS.
- [ ] **Step 4: Коммит** «Версия 0.2.0: документация и скриншоты» (+ карта: «История разработки», «Стек и запуск»).
