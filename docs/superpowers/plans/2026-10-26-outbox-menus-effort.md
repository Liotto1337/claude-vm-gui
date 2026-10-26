# Файлы Claude в ленте, меню с локальным выбором, effort за кнопкой — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Windows 0.6.0 и Android 0.4.0: файлы из `~/.cache/claude-vm-gui/outbox`, упомянутые в ответе Claude, — карточками в ленте (превью, «Открыть в браузере», «Сохранить»); меню Claude Code собирают выбор локально и отправляют одной пачкой; effort — кнопкой с панелью делений.

**Architecture:** Разбор журнала добавляет `files` к ответу Claude (общий shared). `UploadService` (Windows main / Android core) получает вторую разрешённую папку — outbox; скачивание идёт мимо renderer: в Windows — потоком SFTP в main, в Android — методом Kotlin-моста прямо в MediaStore/кэш. Меню: чистая функция `answerKeysFor` считает клавиши от экрана к желаемому выбору; `MenuCard` хранит выбор в состоянии. Effort: `EffortButton` = `choice-btn` + всплывающая панель с прежней логикой ползунка.

**Tech Stack:** Electron + React + TypeScript, ssh2 (Windows); Capacitor 8 + Kotlin, sshj (Android); Vitest, Playwright (`xvfb-run -a` на ВМ).

**Spec:** `docs/superpowers/specs/2026-10-26-outbox-menus-effort-design.md`

## Global Constraints

- Дизайн не менять: только существующие классы и токены (`tool file-att`, `file-row`, `btn btn-sm`, `choice-btn`, `popup choice-menu`, `menu-*`); новые классы — в `app.css` рядом с родственными.
- Папка: `~/.cache/claude-vm-gui/outbox`; метка для разбора — `/.cache/claude-vm-gui/outbox/`; очистка `-mtime +7`.
- Тексты (дословно): «Открыть в браузере», «Сохранить», «Сохранено», «Показать в папке» (Windows), «Открыть» (Android), «Повторить», «Файл удалён с ВМ», «Нет подключения к ВМ», «Ответить», «Готово», «отправляю…», «Claude Code не принял ответ — проверьте выбор», «Effort · отправит /effort», кнопка effort — уровень или «Effort».
- Чтение и скачивание — только внутри outbox или uploads после `realpath`; иначе `BAD_PATH`.
- Новые ответы IPC — через `Result` (`ok`/`fail`) из `@shared/ipc`.
- Версии: Windows `package.json` 0.6.0; Android `package.json` 0.4.0, `versionCode 7`, `versionName "0.4.0"`.
- Каждый коммит обновляет затронутые заметки `obsidian/` (Структура кода, Дизайн и решения, История разработки, хаб при новом сценарии) в том же коммите. Сообщения коммитов — по-русски, с `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Android: общие `src/shared`, `src/renderer` переносятся из Windows-коммитов (`git diff | git apply -3`), различия — только платформенные (`phone`, `BottomSheet`, `useBack`).

## Review Focus

1. Путь outbox с пробелами или кириллицей в имени, обёрнутый в обратные кавычки или markdown-ссылку — карточка всё равно появляется (тест в Task 1).
2. Символическая ссылка в outbox на `/etc/shadow` или `~/.ssh/id_ed25519` — чтение и скачивание отказывают `BAD_PATH` (тест в Task 3).
3. Курсор Claude Code не на первом варианте, а пользователь снял одну галочку и поставил другую — пачка клавиш даёт ровно нужный итог (тест в Task 2 и E2E в Task 5).
4. Пока пачка уходит, Claude Code перерисовал меню со старым состоянием — карточка не «откатывает» выбор пользователя до истечения 3 с и не шлёт вторую пачку (E2E в Task 5).
5. Обрыв SSH на середине «Сохранить» — недокачанный файл удалён, карточка показывает ошибку и «Повторить» (интеграционный тест в Task 3, Kotlin — в Task 8).

---

### Task 1: Пути outbox в ответе Claude (shared)

**Files:**
- Modify: `src/shared/upload-name.ts` (рядом с `UPLOAD_DIR_MARK`)
- Modify: `src/shared/ipc.ts:122` — `{ kind: 'assistant'; id: string; text: string; files: string[] }`
- Modify: `src/shared/transcript-parse.ts:364,370` — `files: outboxPaths(b.text)`
- Test: `tests/unit/upload-name.test.ts`, `tests/unit/transcript-parse.test.ts`

**Interfaces:**
- Produces: `OUTBOX_DIR_MARK = '/.cache/claude-vm-gui/outbox/'`; `outboxPaths(text: string): string[]`; `ChatItem` assistant с `files`.

- [ ] **Step 1: Failing tests** — `outboxPaths`:
  - `'Скриншот: /root/.cache/claude-vm-gui/outbox/a.png.'` → `['/root/.cache/claude-vm-gui/outbox/a.png']`
  - обратные кавычки, `"…"`, `(…)`, `<…>`, `[отчёт](/root/.cache/claude-vm-gui/outbox/r.html)` → путь без обрамления
  - конечные `.,:;!?` отбрасываются; повтор — один раз; порядок появления сохраняется
  - `/root/.cache/claude-vm-gui/uploads/x.png`, `/tmp/a.png`, `/root/.cache/claude-vm-gui/outbox/` (папка, без имени) → `[]`
  - кириллица: `/root/.cache/claude-vm-gui/outbox/отчёт.html` → путь
  - transcript: ответ с путём → `{ kind: 'assistant', …, files: [путь] }`, текст не изменён; без пути — `files: []`.
- [ ] **Step 2:** `npx vitest run --project unit tests/unit/upload-name.test.ts tests/unit/transcript-parse.test.ts` → FAIL (нет `outboxPaths`).
- [ ] **Step 3:** Реализовать. Токен — максимальная последовательность без пробела и `` ` "'()<>[] ``, содержащая метку и начинающаяся с `/`; хвост `.,:;!?` срезать; пустое имя после метки — пропустить. Исправить все места, создающие assistant-элементы (TS подскажет).
- [ ] **Step 4:** те же тесты + `npm test` → PASS.
- [ ] **Step 5:** Коммит «Пути outbox в ответах Claude» (+ заметка Структура кода).

### Task 2: `answerKeysFor` (shared)

**Files:**
- Modify: `src/shared/screen-parse.ts` (рядом с `submitKeysFor`)
- Test: `tests/unit/screen-parse.test.ts` (фикстуры `tests/fixtures/screens/ask-multi*.ans`, `ask-type.ans` + синтетические `ParsedMenu`)

**Interfaces:**
- Consumes: `ParsedMenu`, `MenuKey`, `moveKeysFor`.
- Produces: `type MenuChoice = { cursor: number; checked: boolean[]; own: string }`; `menuChoiceFrom(menu: ParsedMenu): MenuChoice` (состояние экрана); `answerKeysFor(menu: ParsedMenu, choice: MenuChoice): { keys: MenuKey[]; ownText: string | null; after: MenuKey[] }` — `keys` до ввода своего ответа, `ownText` — текст (или `null`), `after` — клавиши после текста (без текста — `[]`).

Алгоритм `answerKeysFor` (одиночный — `kind !== 'multi'`): если у `options[cursor]` есть номер 1–9 и нет `input` → `[цифра]`; иначе `moveKeysFor(menu, cursor)` + (`input` и `own` непустой ? текст отдельно, затем `enter` : `enter`). Множественный: позиция `pos` = индекс `selected` на экране; для каждого `i` по возрастанию, где `checked[i] !== !!options[i].checked` (и вариант не `submit`), — ход стрелками от `pos` к `i` (`down`/`up` по разнице), `space`, `pos = i`; вариант с `input` и непустым `own` — ход к нему, затем текст (ввод отмечает вариант); в конце ход к `submit` и `enter`. Клавиши до текста — `keys`, после — `after`.

- [ ] **Step 1: Failing tests**:
  - радио с номерами, курсор 0, выбран 2 → `{ keys: ['3'] }`
  - радио без номеров, экран на 1, выбран 3 → `['down','down','enter']`
  - чекбоксы: экран `[✔,_,_,✔]`, курсор на 2, желаемое `[✔,✔,_,_]` → `['up','space','down','down','space', …ход к Submit…, 'enter']` (точные клавиши — по фикстуре)
  - чекбоксы без изменений → только ход к Submit и `enter`
  - свой ответ в радио: `keys` — ход, `ownText`, `after: ['enter']`
  - `menuChoiceFrom` повторяет экран.
- [ ] **Step 2:** `npx vitest run --project unit tests/unit/screen-parse.test.ts` → FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** тот же тест + `npm test` → PASS.
- [ ] **Step 5:** Коммит «answerKeysFor: клавиши от экрана к выбору» (+ Структура кода).

### Task 3: outbox в `UploadService` (Windows main)

**Files:**
- Modify: `src/main/upload.ts`
- Test: `tests/integration/upload.test.ts` (sshd ВМ, как существующие)

**Interfaces:**
- Produces:
  - `read(path, maxBytes)` — разрешает uploads **или** outbox;
  - `download(path: string, dest: string, onProgress: (sent: number, total: number) => void): Promise<Result<void>>` — только outbox;
  - `cleanup()` чистит обе папки;
  - outbox создаётся вместе с uploads (`private dirs(): Promise<{ uploads: string; outbox: string }>`).

- [ ] **Step 1: Failing tests**:
  - outbox создан после первого `read`/`download`
  - `read` файла в outbox → байты; `read` симлинка `outbox/k → ~/.ssh/authorized_keys` → `BAD_PATH`; `read('/root/.cache/claude-vm-gui/outbox/../vm.txt')` → `BAD_PATH`
  - `download` 3 МБ в локальный temp → файл идентичен, прогресс дошёл до total
  - `download` файла из uploads → `BAD_PATH`; несуществующего → `NOT_FOUND`
  - обрыв: `download` с `dest` в несуществующей папке → `fail`, локального файла нет; обрыв канала (закрыть `conn` во время скачивания 20 МБ) → `fail`, частичный `dest` удалён
  - `cleanup` удаляет файл outbox с `touch -d '8 days ago'`, свежий оставляет.
- [ ] **Step 2:** `npm run test:int -- tests/integration/upload.test.ts` → FAIL.
- [ ] **Step 3:** Реализовать: `sftp.realpath` + проверка префикса `${dir}/` для каждой разрешённой папки; `download` — `createReadStream` → `fs.createWriteStream(dest + '.part')`, `rename` по завершении, `unlink` при ошибке.
- [ ] **Step 4:** тест + `npm run test:int` → PASS.
- [ ] **Step 5:** Коммит «Папка outbox: чтение, скачивание, очистка» (+ Структура кода, Дизайн и решения).

### Task 4: Карточки файлов Claude в ленте (Windows)

**Files:**
- Modify: `src/shared/ipc.ts` (`Api.outbox`), `src/main/controller.ts` (обработчики), `src/preload/index.ts`
- Modify: `src/renderer/components/FileView.tsx` (`OutboxFile`), компонент, рисующий assistant-элемент (найти по `kind === 'assistant'` в `src/renderer/components/`)
- Modify: `src/renderer/styles/app.css`
- Modify: `tests/fixtures/fake-claude.mjs` — команда `outbox`: пишет в `$HOME/.cache/claude-vm-gui/outbox/` `shot.png` (PNG_1PX), `report.html`, `notes.txt`, `bundle.zip` (2 МБ случайных) и отвечает текстом с четырьмя путями (один — в обратных кавычках, один — markdown-ссылкой)
- Test: `tests/e2e/outbox.spec.ts` (новый)

**Interfaces:**
- Consumes: Task 1 `files`, Task 3 `download`, `read`.
- Produces:
  ```ts
  outbox: {
    save(path: string): Promise<Result<{ savedTo: string } | null>>; // null — диалог отменён
    openHtml(path: string): Promise<Result<void>>;
    reveal(savedTo: string): Promise<void>;
    onProgress(cb: (p: { path: string; sent: number; total: number }) => void): Unsubscribe;
  }
  ```
  IPC: `outbox:save`, `outbox:open-html`, `outbox:reveal`, событие `outbox:progress`. `save` — `dialog.showSaveDialog({ defaultPath: join(app.getPath('downloads'), basename) })`; `openHtml` — `download` в `join(app.getPath('temp'), 'claude-vm-gui', randomUUID(), basename)`, затем `shell.openPath`; папка `temp/claude-vm-gui` удаляется на `will-quit`. Для E2E: при `CVG_TEST_SAVE_DIR` диалог не показывается, `savedTo = join(CVG_TEST_SAVE_DIR, basename)`; при `CVG_TEST_OPEN_LOG` `openPath`/`showItemInFolder` не вызываются, путь дописывается строкой в этот файл (по образцу существующих тестовых подмен — найти `process.env.CVG_` в `src/main`).

`OutboxFile({ path })`: картинка (`isImageName`, ≤ 50 МБ) — как `UploadedImage` + строка действий; текст — как `UploadedFile`; HTML — `FileRow` + «Открыть в браузере»; всё — «Сохранить». Строка действий под `FileRow`: `btn btn-sm`. Состояния «Сохранить»: обычное → прогресс (`bar bar-thin`, «12 %») → «Сохранено» + «Показать в папке» | ошибка (`form-error`) + «Повторить». Нет подключения — кнопки `disabled`, `title="Нет подключения к ВМ"`.

- [ ] **Step 1: Failing E2E** (`outbox.spec.ts`, запуск как в `context.spec.ts`, env `CVG_TEST_SAVE_DIR`, `CVG_TEST_OPEN_LOG`):
  - после «outbox» под ответом 4 карточки; `img` с `alt="shot.png"`; `notes.txt` раскрывается и показывает текст; HTML и zip — имя и размер
  - «Сохранить» у `bundle.zip` → «Сохранено», файл в `CVG_TEST_SAVE_DIR` побайтно равен исходному на ВМ
  - «Открыть в браузере» у `report.html` → в `CVG_TEST_OPEN_LOG` путь, файл по нему существует и равен исходному
  - удалить `notes.txt` на ВМ, перезапустить приложение → карточка «Файл удалён с ВМ»
  - текст ответа содержит пути без изменений.
- [ ] **Step 2:** `npm run build && xvfb-run -a npx playwright test tests/e2e/outbox.spec.ts` → FAIL (нет карточек).
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** тот же E2E + `npm run typecheck` → PASS. Скриншот ленты с карточками — сравнить с карточками вложений пользователя (дизайн).
- [ ] **Step 5:** Коммит «Файлы Claude из outbox карточками в ленте» (+ Структура кода, Дизайн и решения, хаб: шаг сценария).

### Task 5: Меню с локальным выбором (renderer)

**Files:**
- Modify: `src/renderer/components/MenuCard.tsx`
- Modify: `tests/fixtures/fake-claude.mjs` — каждая клавиша в меню дописывается в `$CVG_FAKE_KEYLOG` (если задан) с отметкой времени; меню `menu-multi4` — 5 вариантов-чекбоксов, второй отмечен изначально, курсор стартует на третьем
- Test: `tests/e2e/chat.spec.ts` (обновить тесты меню: 86, 213, 328, 449, 471)

**Interfaces:**
- Consumes: Task 2 `menuChoiceFrom`, `answerKeysFor`; `menuKey`, `api.chat.typeText`.
- Produces: —

Состояние карточки: `choice: MenuChoice` (сброс на `menuChoiceFrom(menu)`, когда меняется подпись меню: заголовок + подписи вариантов + `tabs.current`), `sending: number | null` (время начала отправки), `error`. ↑↓ / клик / цифра / пробел меняют `choice`; Enter, «Ответить» (одиночный), «Готово» (множественный) — `send()`: `sending = now`, клавиши `keys` по одной через `menuKey`, текст, `after`. ←→ Tab Esc и effort ◀ ▶ — сразу в claude, как сейчас. Пока `sending` — варианты `aria-disabled`, кнопки `disabled`, в подвале «отправляю…». Через 3 с, если подпись меню та же: `choice = menuChoiceFrom(menu)`, `error = 'Claude Code не принял ответ — проверьте выбор'`, `sending = null`. Подсказка подвала: «↑↓ — выбор · Пробел — отметить · Enter — ответить · Esc — отмена».

- [ ] **Step 1: Failing E2E** (переписать существующие под новое поведение):
  - `menu`: клик по варианту 2 → радиокнопка отмечена сразу, keylog пуст 1 с; «Ответить» → keylog одна запись `2`, лента «→ выбрано: …» как раньше
  - `menu`: ↓ ↓ ↑ в карточке → keylog пуст; Enter → keylog `2`
  - `menu-multi4`: снять 2-й, отметить 1-й и 5-й → keylog пуст; «Готово» → итог на экране фейка: отмечены 1 и 5; все клавиши keylog за < 1 с; карточка во время отправки показывает «отправляю…»
  - фейк, игнорирующий ввод (команда `menu-deaf`), → через 3 с «Claude Code не принял ответ — проверьте выбор» и отметки как на экране
  - фокус возвращается в поле ввода после ответа (тест 328 — без изменений по смыслу).
- [ ] **Step 2:** `npm run build && xvfb-run -a npx playwright test tests/e2e/chat.spec.ts` → FAIL на новых ожиданиях.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** тот же E2E + `npm test` → PASS.
- [ ] **Step 5:** Проверка на настоящем Claude Code 2.1.310: временная tmux-сессия в пустой папке (`/tmp/cvg-probe`, доверенная), `claude` с запросом «Задай мне вопрос через AskUserQuestion с multiSelect и 5 вариантами»; GUI (собранный `npm run build`, запуск через `xvfb-run` скриптом Playwright) или прямой вызов: `tmux send-keys` той же пачки, что даёт `answerKeysFor` по `capture-pane -e`, без пауз; итог на экране — нужные отметки. Если пачка теряется — пауза между клавишами в `sendKeys` (начать с 15 мс, не больше 50 мс), записать `Ruling:`. Сессию и папку удалить.
- [ ] **Step 6:** Коммит «Меню: выбор собирается локально, ответ — одной пачкой» (+ Структура кода, Дизайн и решения).

### Task 6: Effort за кнопкой (renderer)

**Files:**
- Create: `src/renderer/components/EffortButton.tsx` (кнопка + панель, внутри — логика `EffortSlider`)
- Delete: `src/renderer/components/EffortSlider.tsx` (логика переезжает в `EffortButton`)
- Modify: `src/renderer/components/Composer.tsx:295`, `src/renderer/styles/app.css`
- Test: `tests/e2e/composer.spec.ts` (тесты 56 и 194)

**Interfaces:**
- Produces: `EffortButton({ levels, value, onCommit, phone? }: { levels: string[]; value?: string; onCommit: (level: string) => void; phone?: boolean })`.

Кнопка `choice-btn`, текст — уровень или «Effort», `aria-label` «Effort: high» / «Effort», `aria-expanded`, `title` «Effort · отправит /effort». Панель — `popup choice-menu effort-panel`, `role="dialog" aria-label="Effort"`, открыта вверх, как меню «Модель»: строка подписей (`button` на каждый уровень, текущий — `is-on`), под ней `input[type=range]` с `list` делений (`datalist`) или отрисованными делениями `effort-ticks` — подписи стоят ровно над делениями (позиция `i/(n-1)` ширины дорожки). Клик по подписи — `onCommit(level)` сразу (если уровень другой). Закрытие: повторное нажатие кнопки, Esc, `mousedown` вне корня.

- [ ] **Step 1: Failing E2E**:
  - кнопка «Effort» (уровень неизвестен); нажатие → панель с пятью подписями `low medium high xhigh max`; клик «high» → в терминал фейка ушёл `/effort high`, кнопка «high», панель открыта
  - повторное нажатие кнопки → панель скрыта; Esc и клик вне — тоже
  - ползунок: стрелки → одна команда после паузы (бывший тест 194 — внутри панели)
  - подпись «max» по горизонтали над своим делением: `|центр подписи − позиция деления| ≤ 4 px` (через `boundingBox`).
- [ ] **Step 2:** `npm run build && xvfb-run -a npx playwright test tests/e2e/composer.spec.ts` → FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** E2E + `npm run typecheck` → PASS; скриншот панели (светлая и тёмная тема) — в стиле «Модели».
- [ ] **Step 5:** Коммит «Effort: кнопка с уровнем и панель с делениями» (+ Структура кода).

### Task 7: Договорённость с Claude, версия Windows 0.6.0

**Files:**
- Modify: `/root/.claude/CLAUDE.md` (вне репозитория; не коммитится)
- Modify: `package.json`, `package-lock.json` (0.6.0), `obsidian/История разработки.md`, `obsidian/Claude VM GUI.md`

- [ ] **Step 1:** Дописать в `/root/.claude/CLAUDE.md` раздел:
  ```markdown
  ## Файлы для пользователя
  - Файлы для меня (скриншоты, отчёты, HTML-страницы, архивы, сборки) не публикуй на claude.ai (Artifact) и не отдавай ссылкой: сохраняй в `~/.cache/claude-vm-gui/outbox/` (можно во вложенную папку) и пиши в ответе полный путь `/root/.cache/claude-vm-gui/outbox/…` — GUI покажет карточку файла.
  - HTML — одним файлом: стили, скрипты и картинки внутри.
  - Папка чистится от файлов старше 7 дней.
  ```
- [ ] **Step 2:** Версия 0.6.0, История разработки (0.6: три части), хаб.
- [ ] **Step 3:** Полный прогон: `npm run typecheck && npm test && npm run test:int && xvfb-run -a npm run test:e2e` → всё PASS (вывод в файл, читать хвост).
- [ ] **Step 4:** Коммит «Версия 0.6.0».

### Task 8: Android 0.4.0

**Files (репозиторий `/root/claude-vm-gui-android`, ветка `v0.4`):**
- Перенос: изменения `src/shared`, `src/renderer`, `tests/unit`, `tests/fixtures` из Task 1, 2, 4 (renderer), 5, 6 (`git apply -3`); `EffortButton` с `phone` — панель по ширине поля ввода, подписи и деления — 48 px по высоте касания
- Modify: `src/core/upload.ts` — outbox (как Task 3, через `exec realpath`), `download` не здесь
- Modify: `src/platform/android.ts`, `src/platform/bridge-protocol.ts`, `src/platform/dev.ts`, `src/platform/devbridge.ts` — `downloadFile`
- Modify: `android/app/src/main/java/io/github/liotto1337/claudevm/VmBridgePlugin.kt`, `bridge/SshHub.kt`, `ssh/SshSession.kt` — `readFile` потоком; новый `files/Downloads.kt`
- Modify: `android/app/src/main/AndroidManifest.xml` (`WRITE_EXTERNAL_STORAGE` с `maxSdkVersion="28"`), `res/xml/file_paths.xml` (кэш `outbox/`)
- Test: `tests/e2e/outbox.spec.ts`, `tests/e2e/phone-chat.spec.ts`, Kotlin `android/app/src/test/.../DownloadsTest.kt`

**Interfaces:**
- Produces:
  - мост: `downloadFile({ path: string; name: string; target: 'downloads' | 'view-html'; id: string }) → { uri: string }` с событием прогресса `{ id, sent, total }`; `openUri({ uri: string; mime: string })`
  - `Downloads.kt`: `fun save(ctx, name, mime, total, write: (OutputStream) -> Unit): Uri` (API 29+ — `MediaStore.Downloads` с `IS_PENDING`, по ошибке — `delete`; 26–28 — `Environment.DIRECTORY_DOWNLOADS`, уникальное имя «name (1).ext», по ошибке — удалить файл); `fun cacheForView(ctx, name, write): Uri` (`cacheDir/outbox/<uuid>/<name>`, `FileProvider`)
  - `Api.outbox` тот же, что в Task 4; `reveal` на Android — `openUri`.
  - Проверка пути outbox — в core до вызова моста.

- [ ] **Step 1: Failing tests**: перенесённые unit; Kotlin `DownloadsTest` (Robolectric): `save` пишет байты и возвращает URI, ошибка в `write` — записи нет, имя-дубль получает «(1)»; E2E `outbox.spec.ts` (Chromium, мост разработки пишет в temp и логирует `openUri`); `phone-chat.spec.ts`: меню на телефоне собирает выбор, effort-панель по ширине поля.
- [ ] **Step 2:** `npm test`, `npm run test:android`, `npx vite build && npx playwright test tests/e2e/outbox.spec.ts tests/e2e/phone-chat.spec.ts` → FAIL.
- [ ] **Step 3:** Реализовать; разрешение на Android 8–9 — запрос при первом «Сохранить» (`requestPermissions` Capacitor), отказ → `fail('PERMISSION', 'Нет разрешения на запись в «Загрузки»')`.
- [ ] **Step 4:** Полный прогон: `npm run typecheck && npm test && npm run test:int && npm run test:e2e && npm run test:android` → PASS.
- [ ] **Step 5:** Версия 0.4.0 / `versionCode 7`, заметки `obsidian/`, коммит «Android 0.4.0: файлы Claude, меню, effort».

### Task 9: Ревью и выпуск

- [ ] **Step 1:** Ревьюер (отдельный агент, самая сильная модель) на обе ветки: пакет `review-package`, спецификация, этот план, Review Focus, строки `Ruling:` из журнала.
- [ ] **Step 2:** Critical/Important — исправления RED→GREEN, полный прогон; Minor — в итоговое сообщение.
- [ ] **Step 3:** Спросить пользователя о выпуске. После «да»: Windows — `main` ← `v0.6`, тег `v0.6.0` (push через `refs/tags/…`: ветка и тег не должны совпадать по имени), релиз создаёт CI; Android — тег `v0.4.0`, после CI — pre-release (`prerelease=true`, `make_latest=false`, последней оставить `v0.3.1`).
