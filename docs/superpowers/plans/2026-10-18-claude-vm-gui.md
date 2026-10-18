# Claude VM GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Windows-приложение на Electron, которое подключается по SSH к ВМ, управляет tmux-сессиями с Claude Code и показывает их терминал в оболочке в стиле claude.ai.

**Architecture:** Main-процесс (Node) держит одно SSH-соединение (`ssh2`) и делает всю работу с ВМ: preflight, tmux, PTY-канал терминала, подсказки, загрузку картинок. Renderer (React, sandbox) общается с ним только через типизированный `window.api` из preload. Вся логика без ввода-вывода — чистые функции в `src/shared/`, покрытые Vitest.

**Tech Stack:** Electron, electron-vite, React, TypeScript, ssh2, @xterm/xterm + @xterm/addon-fit, Vitest, Playwright (`_electron`), electron-builder, GitHub Actions (windows-latest).

**Spec:** `docs/superpowers/specs/2026-10-18-claude-vm-gui-design.md` — читать вместе с планом.

## Global Constraints

- Node 22, Electron последней стабильной ветки (сейчас 44.x); версии зависимостей фиксировать точно в `package.json`, без `^`; выбирать сочетание без конфликтов peer-зависимостей (electron-vite ↔ vite, typescript ↔ eslint/vitest).
- `BrowserWindow`: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; CSP `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:`; запрет `will-navigate` и `window.open`.
- Адрес ВМ нигде в отслеживаемых файлах: только `vm.config.json` (в `.gitignore`) и `%APPDATA%\Claude VM\config.json`. В тестах и скриншотах хост — из `vm.config.json` или переменной `CVG_HOST`; на скриншотах маскируется строкой `203.0.113.10`.
- Тесты не трогают сессии tmux пользователя: только имена с префиксом `cvg-test-`; удаляются в `afterEach`/`afterAll`.
- Тесты не отправляют запросов к модели и не меняют `~/.claude/settings.json` (единственное исключение — Task 13, с бэкапом и восстановлением).
- Имя сессии: `^[A-Za-z0-9._-]{1,64}$`. Картинки: PNG/JPEG/GIF/WebP, до 20 МБ. Папка загрузок: `~/.cache/claude-vm-gui/uploads/`, чистка `-mtime +7`.
- Тексты интерфейса — на русском, как в макете https://claude.ai/artifact/6Mgr7FrxbXVK8pYh2iS8gF (скриншоты: облако, «Claude VM — макет»).
- Цвета/шрифты — из раздела «Внешний вид» спецификации; шрифты из `@fontsource/source-serif-4` и `@fontsource/jetbrains-mono`, интерфейс — `'Segoe UI', system-ui, sans-serif`.
- Коммиты — автор `Liotto1337 <egorstep.0801@gmail.com>`, без строки `Co-Authored-By`. Каждый коммит обновляет затронутые заметки `obsidian/` (новые модули → «Структура кода», зависимости и команды → «Стек и запуск», запись в «История разработки»).
- Пуш только в `origin` (GitHub, публичный `Liotto1337/claude-vm-gui`), Codeberg не нужен.

## Review Focus

1. **Русская Windows и ping.** Вывод `ping` в cp866 / на русском («Ответ от …: число байт=32 время=41мс TTL=55», «Превышен интервал ожидания»). Ожидание: успех по `TTL=`, время извлекается. → тест в Task 2 (`parsePing` с русским и английским выводом, в том числе «Заданный узел недоступен» без `TTL=` → неуспех).
2. **Многострочный текст и спецсимволы в поле ввода** (переносы, кавычки, `$()`, эмодзи, вставленный ESC). Ожидание: уходит одним сообщением, ничего не выполняется в shell, ESC из текста вырезается. → тест в Task 2 (`bracketedPaste` удаляет `\x1b`, сохраняет `\n`, оборачивает в `\x1b[200~…\x1b[201~` + `\r`).
3. **Рабочая папка с пробелами, кириллицей, `'` и `~`** при создании сессии и получении подсказок. Ожидание: команда корректна, инъекции нет. → тесты в Task 2 (`shellQuote("it's ~/my dir")`, `cdPrefix("~/Проекты/a b")` → `cd "$HOME"/'Проекты/a b'`) и интеграционный тест в Task 6 (сессия в папке `~/cvg test 'q'` создаётся, `pane_current_path` совпадает).
4. **Сессия закрыта извне, пока открыта в приложении** (kill из cmd). Ожидание: терминал показывает «Сессия завершена», список обновляется, приложение не падает и не пытается писать в закрытый канал. → интеграционный тест в Task 6 (`term.onExit` вызывается с `'killed'` после внешнего `tmux kill-session`) и E2E в Task 11.
5. **Сон ПК / обрыв сети посреди работы.** Ожидание: плашка «Связь потеряна», переподключение по графику 1,2,5,10,30 с, после успеха терминал снова привязан к той же сессии. → тест в Task 5 (`backoffDelay(n)` = 1000,2000,5000,10000,30000,30000) и интеграционный тест (принудительный `client.end()` → событие `reconnecting` → `connected`).

---

## Файловая структура

```
src/shared/ipc.ts            типы IPC и Result<T>
src/shared/quote.ts          shellQuote, cdPrefix, validateSessionName
src/shared/tmux-parse.ts     parseSessions, TMUX_LS_FORMAT
src/shared/ping-parse.ts     parsePing
src/shared/paste.ts          bracketedPaste, slashCommand
src/shared/hints.ts          detectTrigger, filterHints, BUILTIN_COMMANDS, parseInitialize
src/shared/known-hosts.ts    fingerprintSha256, checkKnownHosts, knownHostsLine
src/shared/backoff.ts        backoffDelay
src/main/index.ts            окно, безопасность, регистрация IPC
src/main/config.ts           loadConfig, saveConfig
src/main/preflight.ts        runPing, checkTcp, runPreflight
src/main/ssh.ts              SshConnection (connect, exec, openPty, sftp, reconnect)
src/main/tmux.ts             TmuxService
src/main/terminal.ts         TerminalService (attach, write, resize, send)
src/main/hints.ts            HintsService
src/main/upload.ts           UploadService
src/main/ipc.ts              связка window.api ↔ сервисы
src/preload/index.ts         contextBridge
src/renderer/…               App, components/, styles/tokens.css
tests/unit/ tests/integration/ tests/e2e/
scripts/check-no-host.mjs  .githooks/pre-commit
electron-builder.yml  .github/workflows/windows.yml
```

## Общий контракт IPC (используется задачами 3–12)

`src/shared/ipc.ts` (Task 3) определяет — остальные задачи используют эти имена дословно:

```ts
export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
export interface VmConfig { host: string; port: number; username: string; keyPath: string;
  theme: 'system' | 'light' | 'dark'; lastSession?: string }
export type PreflightStep = 'ping' | 'tcp' | 'ssh' | 'tmux';
export interface PreflightEvent { step: PreflightStep; status: 'running' | 'ok' | 'warn' | 'fail' | 'skipped'; detail: string }
export interface ConnectionState { state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'; attempt?: number; pingMs?: number }
export interface HostKeyPrompt { host: string; port: number; kind: 'unknown' | 'mismatch'; fingerprint: string; knownFingerprint?: string }
export interface TmuxSession { name: string; attachedClients: number; command: string; cwd: string; claudeRunning: boolean }
export interface HintCommand { name: string; description: string; argumentHint: string; source: 'claude' | 'builtin' }
export interface ModelInfo { value: string; displayName: string; description: string; efforts: string[] }
export interface Hints { commands: HintCommand[]; models: ModelInfo[] }
export interface UploadProgress { id: string; sent: number; total: number }
export interface Api {
  config: { get(): Promise<VmConfig | null>; save(c: VmConfig): Promise<Result<void>> };
  connection: { connect(): Promise<Result<void>>; disconnect(): Promise<void>;
    onPreflight(cb: (e: PreflightEvent) => void): () => void;
    onState(cb: (s: ConnectionState) => void): () => void;
    onHostKey(cb: (p: HostKeyPrompt) => void): () => void; answerHostKey(trust: boolean): void };
  tmux: { list(): Promise<Result<TmuxSession[]>>; onSessions(cb: (s: TmuxSession[]) => void): () => void;
    create(name: string, dir: string, startClaude: boolean): Promise<Result<void>>;
    kill(name: string): Promise<Result<void>>; startClaude(name: string): Promise<Result<void>> };
  term: { open(name: string, cols: number, rows: number): Promise<Result<void>>; write(data: string): void;
    resize(cols: number, rows: number): void; onData(cb: (d: string) => void): () => void;
    onExit(cb: (reason: 'detached' | 'killed' | 'connection-lost') => void): () => void;
    send(text: string, imagePaths: string[]): Promise<Result<void>>;
    setModel(value: string): Promise<Result<void>>; setEffort(level: string): Promise<Result<void>> };
  hints: { get(cwd: string): Promise<Result<Hints>>; files(cwd: string): Promise<Result<string[]>>;
    dirs(partial: string): Promise<Result<string[]>> };
  upload: { image(id: string, bytes: Uint8Array, ext: 'png' | 'jpg' | 'gif' | 'webp'): Promise<Result<{ remotePath: string }>>;
    onProgress(cb: (p: UploadProgress) => void): () => void };
  platform: { theme(): Promise<'light' | 'dark'>; onThemeChange(cb: (t: 'light' | 'dark') => void): () => void };
}
```

Коды ошибок (`error.code`): `TCP_UNREACHABLE`, `AUTH_FAILED`, `HOSTKEY_MISMATCH`, `HOSTKEY_REJECTED`, `NO_TMUX`, `BAD_NAME`, `SESSION_EXISTS`, `NO_SESSION`, `NOT_CONNECTED`, `UPLOAD_TOO_BIG`, `UPLOAD_FAILED`, `HINTS_FAILED`, `CONFIG_INVALID`.

---

### Task 1: Каркас, безопасность окна, защита адреса ВМ

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json` (+ `tsconfig.node.json`, `tsconfig.web.json`), `vitest.config.ts`, `src/main/index.ts`, `src/preload/index.ts` (пустой мост), `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx` (заглушка «Claude VM»), `src/renderer/styles/tokens.css`, `scripts/check-no-host.mjs`, `.githooks/pre-commit`, `vm.config.example.json`, `README.md`, `obsidian/Стек и запуск.md`, `obsidian/Структура кода.md`
- Modify: `obsidian/Claude VM GUI.md` (ссылки на новые заметки), `obsidian/История разработки.md`
- Test: `tests/unit/check-no-host.test.ts`, `tests/e2e/launch.spec.ts`, `playwright.config.ts`

**Interfaces:**
- Produces: скрипты `npm run dev | build | test | test:int | test:e2e | build:win`; `findHostLeaks(host: string, files: {path: string; content: Buffer}[]): string[]` в `scripts/check-no-host.mjs` (экспорт + CLI-режим по индексу git); токены CSS `--bg, --panel, --sidebar, --text, --text-2, --border, --border-strong, --hover, --accent, --accent-strong, --font-ui, --font-serif, --font-mono` для `[data-theme=light|dark]`.

- [ ] **Step 1: Тест `findHostLeaks`**: `findHostLeaks('10.1.2.3', [{path:'a.md', content: Buffer.from('ssh root@10.1.2.3')}, {path:'b.md', content: Buffer.from('ok')}])` → `['a.md']`; пустой host → `[]`; бинарный файл с подстрокой хоста тоже находится.
- [ ] **Step 2:** `npx vitest run tests/unit/check-no-host.test.ts` → FAIL (модуля нет).
- [ ] **Step 3:** Каркас electron-vite + React + TS; `findHostLeaks`; CLI: читает `host` из `vm.config.json` (нет файла → exit 0), берёт `git diff --cached --name-only --diff-filter=ACM`, содержимое через `git show :path`, при находке печатает файлы и `exit 1`. `.githooks/pre-commit` вызывает `node scripts/check-no-host.mjs`; `package.json` `"prepare": "git config core.hooksPath .githooks"`. `vm.config.example.json`: `{"host":"203.0.113.10","port":22,"username":"root","keyPath":"~/.ssh/id_ed25519"}`. `index.ts`: окно 1280×800 (min 900×600), `title: 'Claude VM'`, все настройки безопасности и CSP из Global Constraints. `tokens.css` — значения из спецификации для обеих тем, `@fontsource` импорты.
- [ ] **Step 4:** `npx vitest run` → PASS; `npm run build` → без ошибок.
- [ ] **Step 5: E2E-смоук** `launch.spec.ts`: `_electron.launch({args:['out/main/index.js']})`, заголовок окна `Claude VM`, `webPreferences` проверяются через `electronApp.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences())` → `contextIsolation true, sandbox true, nodeIntegration false`. Запуск: `xvfb-run -a npx playwright test tests/e2e/launch.spec.ts` → PASS.
- [ ] **Step 6: Проверка хука вручную:** создать `vm.config.json` с реальным хостом ВМ, `echo "<хост>" > leak.txt && git add leak.txt && git commit -m t` → коммит отклонён; `git rm --cached leak.txt && rm leak.txt`.
- [ ] **Step 7:** Заметки Obsidian («Стек и запуск»: команды, версии; «Структура кода»: папки) + коммит `Каркас Electron-приложения и защита адреса ВМ`.

### Task 2: Чистые функции: экранирование, tmux, ping, вставка, подсказки

**Files:**
- Create: `src/shared/quote.ts`, `src/shared/tmux-parse.ts`, `src/shared/ping-parse.ts`, `src/shared/paste.ts`, `src/shared/hints.ts`, `src/shared/backoff.ts`
- Test: `tests/unit/quote.test.ts`, `tmux-parse.test.ts`, `ping-parse.test.ts`, `paste.test.ts`, `hints.test.ts`, `backoff.test.ts`

**Interfaces:**
- Produces:
  - `shellQuote(s: string): string` — `'…'` с `'` → `'\''`.
  - `cdPrefix(dir: string): string` — `~`/`~/x` → `cd "$HOME"/'x'`, иначе `cd 'dir'`; пусто → `cd "$HOME"`.
  - `validateSessionName(name: string): boolean` — `^[A-Za-z0-9._-]{1,64}$`.
  - `TMUX_LS_FORMAT = '#{session_name}\t#{session_attached}\t#{pane_current_command}\t#{pane_current_path}'`; `parseSessions(stdout: string): TmuxSession[]` — `claudeRunning = /^(claude|node)$/.test(command)`, сортировка по имени.
  - `parsePing(stdout: string): { ok: boolean; avgMs: number | null; received: number; sent: number }`.
  - `bracketedPaste(text: string, imagePaths: string[]): string`; `slashCommand(cmd: 'model' | 'effort', arg: string): string` → `'/model sonnet\r'` (arg проверяется `^[A-Za-z0-9._\[\]-]+$`, иначе throw).
  - `detectTrigger(text: string, caret: number): { kind: 'slash' | 'file'; query: string; start: number } | null` — `slash` только если `/` в позиции 0 и до каретки нет пробела; `file` — `@` в начале или после пробела/переноса.
  - `filterHints<T>(items: T[], query: string, key: (t: T) => string, limit = 8): T[]` — сначала по префиксу, потом по подстроке, без учёта регистра.
  - `BUILTIN_COMMANDS: HintCommand[]` — список из спецификации с русскими описаниями; `parseInitialize(json: unknown): Hints` — из `response.response.commands/models` (`supportedEffortLevels` → `efforts`); дубликаты имён с builtin убираются (приоритет у ответа claude).
  - `backoffDelay(attempt: number): number` — 1000, 2000, 5000, 10000, затем 30000.

- [ ] **Step 1: Тесты** (ключевые значения):
  - `cdPrefix("~/Проекты/a b")` → `cd "$HOME"/'Проекты/a b'`; `shellQuote("it's")` → `'it'\''s'`; `validateSessionName("a;rm")` → false, `"claude-game"` → true, 65 символов → false.
  - `parseSessions("claude\t1\tclaude\t/root\nbox\t0\tbash\t/root/x\n")` → 2 сессии, `claudeRunning` true/false; пустая строка → `[]`.
  - `parsePing` — английский Windows (`Reply from …: bytes=32 time=41ms TTL=55` ×2 + `Average = 41ms`) → ok, 41; русский (`Ответ от …: число байт=32 время=40мс TTL=55`, `время<1мс`) → ok; `Заданный узел недоступен.` / `Request timed out.` → ok false; Linux (`64 bytes … time=0.05 ms`, `rtt min/avg/max/mdev = 0.04/0.05/…`) → ok, 0 (округление).
  - `bracketedPaste("a\nb\x1b[31m", ["/root/.cache/claude-vm-gui/uploads/1.png"])` → `'\x1b[200~a\nb[31m /root/.cache/claude-vm-gui/uploads/1.png\x1b[201~\r'`; пустой текст без картинок → throw.
  - `slashCommand('model','sonnet')` → `'/model sonnet\r'`; `slashCommand('effort','x; rm')` → throw.
  - `detectTrigger("/mo",3)` → slash "mo"; `detectTrigger("смотри @sr",10)` → file "sr", start 7; `detectTrigger("a/b",3)` → null; `detectTrigger("email@x",7)` → null.
  - `filterHints` по «m» ставит `/model` раньше `/compact`; `parseInitialize` на фикстуре (сохранить реальный ответ `initialize` с ВМ в `tests/fixtures/initialize.json`, предварительно убрав поля `account`).
  - `backoffDelay(1..6)` → 1000,2000,5000,10000,30000,30000.
- [ ] **Step 2:** `npx vitest run tests/unit` → FAIL.
- [ ] **Step 3:** Реализация по сигнатурам выше.
- [ ] **Step 4:** `npx vitest run tests/unit` → PASS.
- [ ] **Step 5:** «Структура кода» + коммит `Чистые функции: экранирование, разбор tmux и ping, подсказки`.

### Task 3: Контракт IPC, конфигурация, preload

**Files:**
- Create: `src/shared/ipc.ts` (контракт выше), `src/main/config.ts`, `src/main/ipc.ts` (каркас: регистрирует `config.*`, `platform.*`; остальное — заглушки `NOT_CONNECTED`), `src/preload/index.ts`, `src/renderer/api.ts` (`export const api = window.api as Api`)
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(opts: { userDataDir: string; repoDir?: string }): VmConfig | null` — сначала `userDataDir/config.json`, при отсутствии — `repoDir/vm.config.json` (только когда `!app.isPackaged`); `keyPath` с `~` раскрывается в домашнюю папку; `saveConfig(userDataDir, c): Result<void>` — валидирует (`host` непустой, без пробелов; `port` 1–65535; `username` `^[a-z_][a-z0-9_-]*$`), иначе `CONFIG_INVALID`. Значения по умолчанию: `port 22`, `username 'root'`, `keyPath '~/.ssh/id_ed25519'`, `theme 'system'`. Каналы IPC называются `<группа>:<метод>` (`tmux:create`), события — `<группа>:<событие>` (`term:data`).

- [ ] **Step 1: Тесты:** нет файлов → `null`; только `vm.config.json` → читается; оба → приоритет у `config.json`; `saveConfig` с `port: 0` → `CONFIG_INVALID`; `~/.ssh/k` раскрывается.
- [ ] **Step 2:** FAIL. **Step 3:** реализация. **Step 4:** PASS + `npm run build`.
- [ ] **Step 5:** коммит `Контракт IPC и конфигурация`.

### Task 4: Preflight — ping и TCP

**Files:**
- Create: `src/main/preflight.ts`
- Test: `tests/integration/preflight.test.ts`

**Interfaces:**
- Consumes: `parsePing` (Task 2).
- Produces: `runPing(host: string): Promise<{ ok: boolean; avgMs: number | null }>` (Windows: `ping -n 2 -w 2000`; иначе `ping -c 2 -W 2`; `windowsHide: true`; вывод декодировать как cp866 при `process.platform === 'win32'`, через `TextDecoder('ibm866')`); `checkTcp(host: string, port: number, timeoutMs = 5000): Promise<{ ok: boolean; ms: number | null; error?: string }>`; `runPreflight(cfg: VmConfig, emit: (e: PreflightEvent) => void): Promise<{ ok: boolean; pingMs: number | null }>` — ping fail → `warn` с текстом «Нет ответа. Это не ошибка: многие серверы не отвечают на ping»; tcp fail → `fail` «Не удалось соединиться за 5 с. Проверьте интернет и что ВМ включена», `ssh` и `tmux` → `skipped`.

- [ ] **Step 1: Тесты** (`vitest.config` проект `integration`, запуск `npm run test:int`): `checkTcp('127.0.0.1', 22)` → ok; `checkTcp('127.0.0.1', 1)` → ok false; `checkTcp('203.0.113.10', 22, 1000)` → ok false за ≤ 1.5 с; `runPing('127.0.0.1')` → ok; `runPreflight` с портом 1 → события `ping running→ok`, `tcp running→fail`, `ssh skipped`, `tmux skipped`.
- [ ] **Step 2:** FAIL. **Step 3:** реализация. **Step 4:** PASS.
- [ ] **Step 5:** коммит `Проверка ping и TCP перед подключением`.

### Task 5: SSH-соединение, known_hosts, переподключение

**Предусловие (требует согласия пользователя, спросить до начала задачи):** для тестов создать ключ `~/.ssh/cvg_test_ed25519` и добавить его публичную часть в `~/.ssh/authorized_keys` с ограничением `from="127.0.0.1,::1"`; в `~/.ssh/known_hosts` тестов — отдельный временный файл. Без согласия — интеграционные тесты задач 5–7 и E2E пропускаются (`describe.skipIf(!process.env.CVG_TEST_KEY)`), а проверка переносится на ПК пользователя.

**Files:**
- Create: `src/shared/known-hosts.ts`, `src/main/ssh.ts`
- Test: `tests/unit/known-hosts.test.ts`, `tests/integration/ssh.test.ts`

**Interfaces:**
- Consumes: `runPreflight`, `backoffDelay`, `VmConfig`, `HostKeyPrompt`.
- Produces:
  - `fingerprintSha256(key: Buffer): string` → `SHA256:<base64 без =>` (как у OpenSSH); `checkKnownHosts(text: string, host: string, port: number, keyType: string, key: Buffer): 'match' | 'unknown' | 'mismatch'` (простые записи, списки через запятую, `[host]:port`, хешированные `|1|salt|hmac` — HMAC-SHA1); `knownHostsLine(host, port, keyType, key): string`.
  - `class SshConnection extends EventEmitter` — `constructor(cfg: VmConfig, opts: { knownHostsPath: string; askHostKey: (p: HostKeyPrompt) => Promise<boolean> })`; `connect(): Promise<Result<void>>`; `exec(cmd: string, opts?: { stdin?: string; timeoutMs?: number }): Promise<{ code: number; stdout: string; stderr: string }>`; `openPty(cmd: string, cols: number, rows: number): Promise<ClientChannel>`; `sftp(): Promise<SFTPWrapper>`; `close(): void`; события `state` (`ConnectionState`), `lost`. Аутентификация: ключ из файла; ошибка разбора/зашифрован → `agent: '\\\\.\\pipe\\openssh-ssh-agent'` на Windows, `SSH_AUTH_SOCK` на Linux. `keepaliveInterval: 15000, keepaliveCountMax: 3`. При неожиданном `close` — `reconnecting` с `attempt`, паузы `backoffDelay`, каждая попытка через `runPreflight`; явный `close()` переподключение отменяет.

- [ ] **Step 1: Модульные тесты known_hosts:** фикстуры — реальная строка `ssh-keyscan` для localhost (простая и хешированная `ssh-keygen -H`), запись `[127.0.0.1]:2222`; совпадение, `unknown` для другого хоста, `mismatch` для другого ключа того же хоста; `fingerprintSha256` совпадает с выводом `ssh-keygen -lf`.
- [ ] **Step 2: Интеграционные тесты** (`CVG_TEST_KEY`): подключение к `127.0.0.1` с неизвестным ключом → `askHostKey` вызван с `kind: 'unknown'`, ответ `true` → строка добавлена во временный known_hosts, `exec('echo hi')` → `hi`; подмена записи в known_hosts на чужой ключ → `connect()` → `HOSTKEY_MISMATCH`, `askHostKey` не вызывается; неверный ключ → `AUTH_FAILED`; `conn['client'].end()` извне → события `reconnecting` (attempt 1) → `connected`.
- [ ] **Step 3:** FAIL. **Step 4:** реализация. **Step 5:** PASS (`npm test && npm run test:int`).
- [ ] **Step 6:** коммит `SSH-соединение, проверка ключа хоста, переподключение`.

### Task 6: tmux, терминал, отправка сообщений

**Files:**
- Create: `src/main/tmux.ts`, `src/main/terminal.ts`
- Modify: `src/main/ipc.ts` (группы `connection`, `tmux`, `term`)
- Test: `tests/integration/tmux.test.ts`

**Interfaces:**
- Consumes: `SshConnection.exec/openPty`, `parseSessions`, `TMUX_LS_FORMAT`, `cdPrefix`, `shellQuote`, `validateSessionName`, `bracketedPaste`, `slashCommand`.
- Produces: `class TmuxService { list(): Promise<Result<TmuxSession[]>>; create(name, dir, startClaude): Promise<Result<void>>; kill(name): Promise<Result<void>>; startClaude(name): Promise<Result<void>>; startPolling(cb: (s: TmuxSession[]) => void, ms = 5000): () => void }` — «no server running» → `[]`; `tmux` не найден (`code 127`) → `NO_TMUX`; дубликат → `SESSION_EXISTS`. `class TerminalService extends EventEmitter { open(name, cols, rows); write(data); resize(cols, rows); send(text, imagePaths); setModel(v); setEffort(l); close() }`, события `data`, `exit` (`'killed'` если после закрытия канала сессии нет в `tmux ls`, `'connection-lost'` при обрыве SSH, иначе `'detached'`). PTY: `TERM=xterm-256color`. После переподключения SSH `TerminalService` сам открывает канал к той же сессии.

- [ ] **Step 1: Тесты** (только сессии `cvg-test-<random>`): `create` в `~/cvg test 'q'` (папку создать заранее) → `list()` содержит сессию с этим `cwd`; повторный `create` → `SESSION_EXISTS`; `create('bad;name')` → `BAD_NAME` без вызова ssh; `open` + `write('echo cvg-ok\r')` → в `data` приходит `cvg-ok`; `send('строка 1\nстрока 2', [])` в сессии с `cat` → `tmux capture-pane -p` содержит обе строки; `setModel('sonnet')` в сессии с `cat` → в pane видно `/model sonnet`; внешний `tmux kill-session` → `exit('killed')`; `kill` → сессии нет в списке.
- [ ] **Step 2:** FAIL. **Step 3:** реализация. **Step 4:** PASS; после тестов `tmux ls` не содержит `cvg-test-` и все сессии пользователя на месте.
- [ ] **Step 5:** коммит `Сессии tmux, терминал и отправка сообщений`.

### Task 7: Подсказки и загрузка картинок

**Files:**
- Create: `src/main/hints.ts`, `src/main/upload.ts`
- Modify: `src/main/ipc.ts` (группы `hints`, `upload`)
- Test: `tests/integration/hints-upload.test.ts`

**Interfaces:**
- Consumes: `SshConnection.exec/sftp`, `parseInitialize`, `BUILTIN_COMMANDS`, `cdPrefix`.
- Produces: `class HintsService { get(cwd): Promise<Result<Hints>>; files(cwd): Promise<Result<string[]>>; dirs(partial): Promise<Result<string[]>> }` — команды из спецификации дословно (`claude -p … --no-session-persistence`, stdin — `control_request initialize`, `timeoutMs 20000`, процесс убивается после ответа); кэш `get` на время соединения, `files` — 60 с; ошибка `get` → `ok: true` с `BUILTIN_COMMANDS` и `models: []` (плюс лог). `class UploadService extends EventEmitter { image(id, bytes, ext): Promise<Result<{remotePath}>>; cleanup(): Promise<void> }` — `> 20 МБ` → `UPLOAD_TOO_BIG` без сети; `mkdir -p`; имя `<YYYYMMDD-HHMMSS>-<6 hex>.<ext>`; события `progress` каждые ≥ 64 КБ; `cleanup` — `find ~/.cache/claude-vm-gui/uploads -type f -mtime +7 -delete`, вызывается после `connected`.

- [ ] **Step 1: Тесты:** `get('~')` → `commands` содержит `model`, `effort`, `compact` и хотя бы один builtin (`resume`), `models` непустой, у `opus` есть `high`; `get` с подменённой командой `claude` (переменная `CVG_CLAUDE_BIN=/bin/false`) → ok, только builtin; `files` в временном git-репо → список файлов, в не-git папке → `find`-вариант без скрытых и `node_modules`; `dirs('~/cvg')` → содержит созданную тестом папку; `image` PNG 1×1 → файл существует на ВМ, размер совпадает, путь начинается с `/root/.cache/claude-vm-gui/uploads/`; 21 МБ → `UPLOAD_TOO_BIG`; `cleanup` удаляет файл с `touch -d '8 days ago'` и оставляет свежий.
- [ ] **Step 2:** FAIL. **Step 3:** реализация. **Step 4:** PASS; убедиться, что после тестов не осталось новых файлов в `~/.claude/projects/` от `initialize` (флаг `--no-session-persistence`).
- [ ] **Step 5:** коммит `Подсказки команд и файлов, загрузка картинок`.

### Task 8: Экран подключения и диалоги

**Files:**
- Create: `src/renderer/state.ts` (хранилище на `useSyncExternalStore`), `src/renderer/components/ConnectScreen.tsx`, `SettingsDialog.tsx`, `HostKeyDialog.tsx`, `Logo.tsx`, `src/renderer/styles/app.css`
- Modify: `src/renderer/App.tsx`
- Test: `tests/e2e/connect.spec.ts`

**Interfaces:**
- Consumes: `api.config.*`, `api.connection.*`, `api.platform.*`.
- Produces: `useAppState(): { config; connection: ConnectionState; preflight: Record<PreflightStep, PreflightEvent>; sessions: TmuxSession[]; current: string | null; hints: Hints | null; theme: 'light' | 'dark' }` и действия `connect()`, `openSession(name)`, `setTheme(t)`. Тема — атрибут `data-theme` на `<html>`.

- [ ] **Step 1: E2E** (Electron с `CVG_USER_DATA` во временную папку): без конфига открывается «Настройки подключения»; с конфигом на порт 1 — экран «Подключение к ВМ», шаг TCP с текстом ошибки из спецификации и кнопки «Повторить», «Настройки подключения»; с тестовым ключом и неизвестным хостом — `HostKeyDialog` с отпечатком `SHA256:`; «Доверять» → переход к главному окну.
- [ ] **Step 2:** FAIL. **Step 3:** компоненты по макету «Подключение» (иконки — inline SVG, тексты — дословно из макета). `SettingsDialog`: хост, порт, пользователь, путь к ключу, тема («Как в Windows» / «Светлая» / «Тёмная») — сохранение через `api.config.save`, ошибки валидации под полями. **Step 4:** PASS (плюс: смена темы в настройках меняет `data-theme` сразу).
- [ ] **Step 5:** коммит `Экран подключения, настройки, проверка ключа хоста`.

### Task 9: Главное окно: сессии, шапка, терминал

**Files:**
- Create: `src/renderer/components/Sidebar.tsx`, `SessionHeader.tsx`, `TerminalView.tsx`, `NewSessionDialog.tsx`, `ConfirmDialog.tsx`, `Banner.tsx`, `src/renderer/terminal-theme.ts`
- Test: `tests/e2e/sessions.spec.ts`

**Interfaces:**
- Consumes: `api.tmux.*`, `api.term.open/write/resize/onData/onExit`, `api.hints.dirs`, `useAppState`.
- Produces: `terminalTheme(t: 'light' | 'dark'): ITheme` (фон = `--panel`/`#1F1E1D`, 16 цветов ANSI подобраны под фон: зелёный `#558A42`/`#7FAF6A`, красный `#B53333`/`#E07A6B`, оранжевый `#D97757`); `TerminalView` — xterm.js + fit-addon, `fontFamily` JetBrains Mono 13 px, `ResizeObserver` → `api.term.resize`. Метка «открыта в cmd»: `attachedClients - (current === name ? 1 : 0) > 0`.

- [ ] **Step 1: E2E:** «Новая сессия» → имя `cvg-test-ui`, папка `~` (подсказки папок появляются при вводе `~/cv`), галочка снята → сессия появилась в списке и открыта, в шапке «bash»; ввод в терминал `echo hi` + Enter → в терминале `hi`; имя `bad name` → кнопка «Создать» неактивна, подсказка видна; «Завершить сессию» → подтверждение → сессии нет в списке; внешний `tmux kill-session` открытой сессии → сообщение «Сессия завершена»; метка «открыта в cmd» видна у сессии, к которой подключён второй клиент (`tmux attach` в фоне из теста).
- [ ] **Step 2:** FAIL. **Step 3:** компоненты по макету «Главное окно» / «Новая сессия». **Step 4:** PASS.
- [ ] **Step 5:** коммит `Список сессий, терминал, создание и завершение сессий`.

### Task 10: Поле ввода: подсказки, картинки, модель и effort

**Files:**
- Create: `src/renderer/components/Composer.tsx`, `HintPopup.tsx`, `AttachmentChip.tsx`, `ModelMenu.tsx`, `EffortMenu.tsx`
- Test: `tests/e2e/composer.spec.ts`

**Interfaces:**
- Consumes: `detectTrigger`, `filterHints`, `api.hints.get/files`, `api.upload.image/onProgress`, `api.term.send/setModel/setEffort`, `api.tmux.startClaude`.
- Produces: —

Поведение (из спецификации и макета): Enter — отправить, Shift+Enter — перенос; ↑/↓, Tab/Enter — выбор подсказки, Esc — закрыть; выбор `/команды` заменяет запрос на `/<name> `, файла — на `@<path> `; картинки: Ctrl+V, перетаскивание, кнопка 📎 (`<input type=file accept="image/png,image/jpeg,image/gif,image/webp">`), значок с превью (`URL.createObjectURL`), прогрессом, ошибкой и «Повторить»; отправка недоступна, пока есть незагруженные картинки; после отправки поле и картинки очищаются. Меню модели — из `hints.models` (пусто → `default`, `opus`, `sonnet`), effort — из `efforts` выбранной модели; подписи кнопок показывают последний выбор в этой сессии (до выбора — `—`). Если `claudeRunning === false` — плашка «claude не запущен» и кнопка «Запустить claude».

- [ ] **Step 1: E2E** (сессия `cvg-test-…` с `cat`, `claudeRunning` эмулируется переменной `CVG_FAKE_CLAUDE=1`, при которой main считает `cat` claude-процессом): ввод `/m` → попап с `/model` первым; Tab → поле `/model `; ввод `@pa` в git-папке с `package.json` → попап, Enter → `@package.json `; вставка PNG из буфера (`clipboard.writeImage` в main через `electronApp.evaluate`) → значок «загружено», файл есть на ВМ; отправка «привет\nмир» → `capture-pane` содержит «привет», «мир» и путь картинки; выбор Sonnet в меню модели → в pane `/model sonnet`; effort low → `/effort low`; без `CVG_FAKE_CLAUDE` → плашка «claude не запущен», кнопка отправляет `claude` в pane.
- [ ] **Step 2:** FAIL. **Step 3:** компоненты по макетам «Главное окно», «Тёмная тема», «Модель и effort». **Step 4:** PASS.
- [ ] **Step 5:** коммит `Поле ввода: подсказки, картинки, модель и effort`.

### Task 11: Сквозной сценарий, обрыв связи и скриншоты

**Files:**
- Create: `tests/e2e/flow.spec.ts`, `scripts/screenshots.mjs`
- Modify: при необходимости компоненты (исправления, найденные сценарием)

**Interfaces:**
- Consumes: всё приложение.

- [ ] **Step 1: Сценарий:** запуск → подключение → новая сессия `cvg-test-flow` → подсказки → картинка → отправка → `/model`, `/effort` (через `cat`) → обрыв: в main `electronApp.evaluate` закрывает сокет SSH → баннер «Связь потеряна» → через ≤ 3 с «Подключено», терминал снова отвечает на `echo` → «Завершить сессию».
- [ ] **Step 2:** `xvfb-run -a npx playwright test` → все E2E PASS.
- [ ] **Step 3:** `scripts/screenshots.mjs` — запуск с `CVG_DEMO_HOST=203.0.113.10` (подменяет отображаемый хост), снимки 1280×800 светлой и тёмной темы, экрана подключения, диалогов; сравнить глазами с макетом, расхождения исправить.
- [ ] **Step 4:** коммит `Сквозной E2E-сценарий и скриншоты` (скриншоты — в `docs/screenshots/`, проверить хуком, что хоста в них нет).

### Task 12: Сборка под Windows, CI, публикация

**Files:**
- Create: `electron-builder.yml`, `.github/workflows/windows.yml`, `build/icon.ico` (+ `icon.png` 512×512 со звёздочкой из `Logo.tsx`), `tests/e2e/smoke-win.spec.ts`
- Modify: `README.md` (установка, SmartScreen, настройки, разработка, тесты), заметки Obsidian

**Interfaces:**
- Produces: `npm run build:win` → `release/Claude VM Setup <версия>.exe` (nsis, x64, выбор папки установки) и `release/Claude VM <версия>.exe` (portable); `productName: Claude VM`, `appId: io.github.liotto1337.claudevm`.

- [ ] **Step 1:** `smoke-win.spec.ts`: приложение запускается, без конфига показывает «Настройки подключения»; ping-проверка на `127.0.0.1` из окна настроек (`runPing`) на Windows возвращает ok — проверка русской/английской локали на живом `ping.exe`.
- [ ] **Step 2:** Workflow `windows.yml` (push в `main`, тег `v*`, ручной запуск): `windows-latest`, Node 22, `npm ci`, `npm test`, `npm run build:win`, `npx playwright test tests/e2e/smoke-win.spec.ts`, артефакт `release/*.exe`; на теге — GitHub Release с `.exe`.
- [ ] **Step 3:** `gh repo create Liotto1337/claude-vm-gui --public --source . --remote origin --push` (только после зелёного `npm test` локально; перед пушем `git grep` хоста по всей истории — пусто).
- [ ] **Step 4:** Дождаться workflow (`gh run watch`) → зелёный; при падении — чинить и пушить заново.
- [ ] **Step 5:** Тег `v0.1.0`, Release с двумя `.exe`; скачать (`gh release download`) и скопировать в облако `/home/claude/google_drive/Claude VM/`, сверить `cmp`.
- [ ] **Step 6:** коммит(ы) `Сборка под Windows и CI`.

### Task 13: Проверка с настоящим claude

- [ ] **Step 1:** Бэкап `~/.claude/settings.json` → `~/.claude/settings.json.cvg-bak`.
- [ ] **Step 2:** Собранное приложение (Linux, xvfb): новая сессия `cvg-test-real` с галочкой «Сразу запустить claude» → в терминале интерфейс Claude Code; подсказка `/` показывает скиллы пользователя; `/model sonnet` и `/effort low` через меню → строка статуса Claude Code показывает Sonnet и low; вставка картинки → в поле Claude Code появляется путь/`[Image #1]` (сообщение **не** отправлять). Скриншоты.
- [ ] **Step 3:** Завершить сессию, восстановить `settings.json` из бэкапа, `cmp` с бэкапом, удалить бэкап.
- [ ] **Step 4:** Обновить «История разработки» и хаб-заметку, финальный коммит и пуш; отчёт пользователю: что проверено здесь, что проверено в CI на Windows, что остаётся проверить ему (подключение с его ПК, ключ из `%USERPROFILE%\.ssh`, ssh-agent, SmartScreen).
