# Claude VM GUI — дизайн

Дата: 2026-10-18. Статус: согласован в чате, ждёт ревью спецификации.

## Цель

Windows-приложение, которое заменяет ручной сценарий работы с Claude Code на ВМ:

1. открыть cmd;
2. `ssh root@<адрес ВМ>` по ключу без пароля;
3. `tmux attach -t <имя>` или `tmux new -s <имя>`;
4. в новой сессии набрать `claude`;
5. в конце — `tmux kill-session -t <имя>`.

Приложение делает всё это кнопками и оборачивает терминал в интерфейс в стиле claude.ai.

### Требования пользователя

- Дизайн как у веб-версии claude.ai.
- GUI подключается к ВМ, где стоит Claude Code, а не к серверам Anthropic.
- Перед подключением — проверка ping и TCP.
- Вставка картинок.
- Смена модели и effort (`/model`, `/effort`).
- Подсказки в поле ввода, как в консольном Claude Code.
- GUI работает на клиенте (Windows), на ВМ ничего не ставится.
- Адрес ВМ не попадает на GitHub.

### Принятые решения

| Вопрос | Решение |
|---|---|
| Как показывать Claude Code | Настоящий `claude` в tmux внутри терминала (xterm.js) + оболочка claude.ai вокруг. Сессию можно продолжать и из cmd, и из приложения. |
| Стек | Electron + React + TypeScript, сборка electron-vite, упаковка electron-builder |
| Подсказки | `/` — команды и скиллы; `@` — файлы рабочей папки сессии |
| Список сессий | Все сессии из `tmux ls`; новая сессия спрашивает имя и рабочую папку |
| Репозиторий | Публичный `github.com/Liotto1337/claude-vm-gui`, без зеркала на Codeberg; карта проекта Obsidian в `obsidian/` |

Вне рамок: структурный чат поверх stream-json, работа с несколькими ВМ одновременно, подпись кода, автообновление.

## Архитектура

```
Windows                                         ВМ (Ubuntu)
┌──────────────────────────────────────┐        ┌───────────────────────────┐
│ Renderer (React, sandbox)            │        │ sshd                      │
│  Sidebar · Header · Terminal(xterm)  │        │ tmux: сессии пользователя │
│  Composer (подсказки, картинки,      │        │   └─ claude (TUI)         │
│            модель, effort)           │        │ claude -p … initialize    │
│        │ window.api (contextBridge)  │        │   (только для подсказок)  │
│ Preload ─────────────────────────────│  SSH   │ ~/.cache/claude-vm-gui/   │
│ Main (Node)                          │◀──────▶│   uploads/ (картинки)     │
│  preflight · ssh · tmux · terminal   │        └───────────────────────────┘
│  hints · upload · config             │
└──────────────────────────────────────┘
```

### Main-процесс: модули

Каждый модуль — отдельный файл в `src/main/` с узким интерфейсом. Логика без ввода-вывода (разбор вывода, экранирование, проверки) вынесена в чистые функции в `src/shared/`, чтобы тестироваться без SSH.

- **config** — читает и пишет `%APPDATA%\Claude VM\config.json`: `host`, `port` (22), `username` (`root`), `keyPath` (`%USERPROFILE%\.ssh\id_ed25519`), `theme` (`system|light|dark`), последняя открытая сессия. В режиме разработки, если есть `vm.config.json` в корне репозитория, значения берутся оттуда. Этот файл в `.gitignore`.
- **preflight** — две проверки до SSH:
  - ping: системный `ping -n 2 -w 2000 <host>` (на Linux для тестов `ping -c 2 -W 2`). Успех — в выводе есть `TTL=` (не зависит от языка Windows); время берётся регэкспом `[=<](\d+)\s*(ms|мс)`. Неудача ping — предупреждение, подключение продолжается.
  - TCP: `net.connect(port, host)` с таймаутом 5 с. Неудача — ошибка, подключение не начинается; кнопки «Повторить» и «Настройки подключения».
  - Каждый шаг шлёт в интерфейс событие `{step, status: running|ok|warn|fail, detail}`.
- **ssh** — одно соединение `ssh2.Client`:
  - аутентификация: приватный ключ из `keyPath`; если ключ зашифрован или не читается — агент Windows `\\.\pipe\openssh-ssh-agent`;
  - проверка ключа хоста через `hostVerifier`: сверка с `%USERPROFILE%\.ssh\known_hosts` (простые и хешированные `|1|` записи, нестандартный порт как `[host]:port`). Нет записи — диалог с отпечатком SHA256 и выбором «Доверять» (запись добавляется в known_hosts) или «Отмена». Ключ не совпал — блокирующая ошибка с обоими отпечатками, без возможности продолжить;
  - keepalive 15 с; при обрыве — событие `disconnected` и переподключение с паузами 1, 2, 5, 10, 30, 30… с, каждая попытка — через preflight;
  - `exec(cmd)` → `{code, stdout, stderr}` и `shell/exec с PTY` для терминала.
- **tmux** — команды через `exec`:
  - список: `tmux ls -F '#{session_name}\t#{session_attached}\t#{pane_current_command}\t#{pane_current_path}'` (нет сервера tmux → пустой список); опрос каждые 5 с;
  - создать: `tmux new-session -d -s <name> -c <dir>`, затем при галочке «Сразу запустить claude» `tmux send-keys -t <name> claude Enter`;
  - завершить: `tmux kill-session -t <name>` после подтверждения в интерфейсе;
  - имя сессии: `^[A-Za-z0-9._-]{1,64}$`; папка экранируется одинарными кавычками (`'…'` с заменой `'` на `'\''`), `~` в начале раскрывается через `$HOME`.
- **terminal** — канал `exec('tmux attach -t <name>', {pty: {term: 'xterm-256color', cols, rows}})`. Данные идут в xterm.js и обратно; изменение размера → `setWindow`. Переключение сессии закрывает канал и открывает новый. Закрытие приложения только отключается от tmux; сессия продолжает жить.
- **composer-input** — отправка сообщения в открытый терминал: текст оборачивается в bracketed paste (`ESC[200~ … ESC[201~`), затем `\r`. Пути загруженных картинок добавляются в конец текста через пробел. Модель и effort: в терминал уходит `/model <value>\r` или `/effort <level>\r`.
- **hints**:
  - команды и модели: `cd <cwd> && claude -p --input-format stream-json --output-format stream-json --verbose --no-session-persistence`, в stdin — `{"type":"control_request","request_id":"…","request":{"subtype":"initialize"}}`; из `control_response` берутся `commands[] {name, description, argumentHint}` и `models[] {value, displayName, description, supportedEffortLevels}`; процесс закрывается. Запрос к модели не делается. Кэш по `cwd` на время подключения. К списку добавляются встроенные команды, которых нет в ответе (`/resume`, `/exit`, `/help`, `/clear`, `/status`, `/cost`, `/login`, `/logout`, `/permissions`, `/memory`, `/doctor`, `/bug`). Ошибка — только встроенный список;
  - файлы: `cd <cwd> && (git ls-files 2>/dev/null || find . -maxdepth 4 -type f -not -path '*/.*' -not -path '*/node_modules/*' | sed 's|^\./||') | head -5000`; кэш по `cwd` на 60 с;
  - папки для диалога «Новая сессия»: `find <base> -maxdepth 1 -mindepth 1 -type d` по мере ввода.
- **upload** — картинка из буфера обмена, перетаскивания или кнопки 📎: PNG/JPEG/GIF/WebP до 20 МБ. SFTP в `~/.cache/claude-vm-gui/uploads/<YYYYMMDD-HHMMSS>-<6 hex>.<ext>`, прогресс в интерфейс. При подключении удаляются файлы старше 7 дней (`find … -mtime +7 -delete`).

### Preload

`contextBridge.exposeInMainWorld('api', …)` — только типизированные методы (`invoke`) и подписки (`on…`, возвращают функцию отписки). Ошибки через границу IPC передаются как `{ok: false, error: {code, message}}`.

### Renderer: компоненты

- `ConnectScreen` — шаги preflight и SSH (макет «Подключение»).
- `Sidebar` — логотип, строка подключения (`user@host`, ping), «Новая сессия», список сессий (точка: claude запущен / нет; метка «открыта в cmd», если `session_attached > 0` и это не наше подключение; рабочая папка), «Настройки подключения».
- `SessionHeader` — имя, папка, «в сессии запущен claude / bash», «Завершить сессию».
- `TerminalView` — xterm.js + fit-addon, тема из токенов. Клавиатурный ввод напрямую в PTY.
- `Composer` — textarea с автоувеличением; Enter — отправить, Shift+Enter — новая строка; при `/` в начале или `@` после пробела — `HintPopup` (↑/↓, Tab/Enter — выбрать, Esc — закрыть), фильтр по префиксу, затем по подстроке; значки картинок с превью и прогрессом; `ModelMenu`, `EffortMenu`; кнопка отправки. Если в сессии не claude — плашка «claude не запущен» и кнопка «Запустить claude».
- `NewSessionDialog`, `SettingsDialog`, `HostKeyDialog`, `Banner` (обрыв связи).

### Внешний вид

Согласованный макет: https://claude.ai/artifact/6Mgr7FrxbXVK8pYh2iS8gF (скриншоты — в облаке, папка «Claude VM — макет»).

- Цвета — бренд Anthropic (скилл `brand-guidelines`): светлая тема — фон `#FAF9F5`, панели `#FFFFFF`, боковая панель `#F5F4ED`, текст `#141413`, вторичный текст `#5E5D59`, границы `rgba(31,30,29,.15/.3)`, выделение `rgba(115,114,108,.12)`, акцент — глина `#D97757` (кнопка отправки `#C6613F` для контраста с белым). Тёмная — тёплые серые `#262624 / #1F1E1D / #30302E`, текст `#FAF9F5`. Тема по системе Windows с ручным переключением.
- Шрифты (вшиты в приложение, лицензия OFL): Source Serif 4 — заголовки, JetBrains Mono — терминал и код; интерфейс — системный Segoe UI. Фирменные шрифты Anthropic проприетарны и не используются.
- Логотип — собственная восьмилучевая звёздочка цвета глины, не логотип Anthropic.
- Терминал: палитра ANSI подобрана под фон темы (светлый терминал в светлой теме).
- Доступность: настоящие `button`/`input`/`label`, `aria-label` у кнопок-иконок, контраст текста ≥ 4.5:1, цели нажатия ≥ 36 px.

## Обработка ошибок

| Ситуация | Поведение |
|---|---|
| TCP недоступен | Ошибка на экране подключения, «Повторить», «Настройки» |
| Ping не отвечает | Жёлтое предупреждение, подключение продолжается |
| Ключ не принят сервером | Ошибка с путём к ключу и подсказкой про ssh-agent |
| Ключ хоста изменился | Блокирующая ошибка с двумя отпечатками |
| Обрыв SSH | Плашка «Связь потеряна», автопереподключение, терминал восстанавливается |
| Сессию закрыли извне | Сообщение «Сессия завершена», список обновлён |
| В сессии не claude | Плашка и кнопка «Запустить claude» |
| Загрузка картинки упала | Значок красный, «Повторить»; отправка ждёт загрузки |
| Подсказки не загрузились | Встроенный список команд |
| `tmux` не установлен | Ошибка «На ВМ нет tmux» с командой установки |

## Безопасность

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, CSP `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:`; запрет навигации и `window.open`.
- Команды на ВМ собираются только из проверенных значений (имя — белый список символов, пути — экранирование), есть модульные тесты на инъекции.
- Ключ читается только в main-процессе и никуда не передаётся.
- Адрес ВМ: `vm.config.json` и `.env` в `.gitignore`; git-хук `pre-commit` (`.githooks/`, `core.hooksPath`) берёт хост из `vm.config.json` и отклоняет коммит, если хост встречается в индексированных файлах (текстовых и в метаданных). В скриншотах для документации адрес маскируется (`DEMO_HOST`).

## Тестирование

- **Модульные (Vitest)**: разбор `tmux ls`; разбор вывода ping (английская и русская Windows, Linux); проверка имён и экранирование путей; bracketed paste; фильтрация подсказок; разбор `control_response`; known_hosts (простые, хешированные, порт); парсинг конфигурации.
- **Интеграционные (против этой ВМ, по SSH)**: list/new/kill только для сессий `cvg-test-*`; загрузка картинки по SFTP и её удаление; получение подсказок. Сессии пользователя не трогаются.
- **E2E (Playwright `_electron`, Linux, xvfb)**: подключение → новая сессия `cvg-test-…` → подсказки `/` и `@` → вставка картинки (файл появился на ВМ) → `/model sonnet` и `/effort low` (видно в статусе claude) → отправка текста → завершение сессии. Запросов к модели нет. Скриншоты сравниваются с макетом глазами.
- **Windows (GitHub Actions, `windows-latest`)**: модульные тесты, сборка `.exe`, запуск приложения и проверка, что открывается экран подключения. Подключение к ВМ из CI не проверяется (ключа там нет); финальная проверка — у пользователя.

## Сборка и поставка

- `npm run build:win` → `release/Claude VM Setup <версия>.exe` (NSIS) и `release/Claude VM <версия>.exe` (portable), x64. Сборка в GitHub Actions на Windows; `.exe` прикладываются к GitHub Release и копируются в облако.
- Без подписи кода: при первом запуске SmartScreen предупредит («Подробнее» → «Выполнить в любом случае»).

## Структура репозитория

```
claude-vm-gui/
  src/main/        config, preflight, ssh, tmux, terminal, hints, upload, ipc
  src/preload/     index.ts
  src/renderer/    App, components/, styles/tokens.css, fonts/
  src/shared/      типы IPC, чистые функции (parse, quote, filter)
  tests/unit/  tests/integration/  tests/e2e/
  .githooks/pre-commit   scripts/check-no-host.mjs
  .github/workflows/windows.yml
  obsidian/        карта проекта
  docs/superpowers/specs/
  vm.config.example.json   README.md
```
