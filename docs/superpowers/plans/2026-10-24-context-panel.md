# Контекст сессии и «Сжать сессию» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** значок «Контекст N %» в шапке сессии с панелью разбивки (как `/context`) и кнопкой «Сжать сессию» (`/compact [пожелания]`) — Windows 0.5.0 и Android 0.3.0.

**Architecture:** «занято» и замер `/context` вычисляются тем же разбором журнала, что строит ленту (`ParseState.context`), и едут к renderer в событии `chat:items` (поле `context`). Окно и буфер по модели запоминаются в renderer. Панель отправляет `/context` и `/compact` существующим `api.term.send`. Сначала Windows (задачи 1–5), затем перенос того же диффа в Android-форк (задача 6) — общий код (`src/shared`, renderer) там совпадает.

**Tech Stack:** TypeScript, React 19, Electron (Windows), Capacitor (Android), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-context-panel-design.md`

## Global Constraints

- Дизайн не менять: панель — из существующих классов и токенов темы (`usage-row`, `usage-head`, `Bar`, `caption`, `dialog`, `overlay`), новых цветов нет; цвета категорий — палитра терминала текущей темы.
- Числа — существующий `formatTokens` из `@shared/usage` («832,3 тыс.», «1 млн») — как в блоке «Расход».
- Тексты дословно: «Контекст», «Использовано: N %», «Токенов до автосжатия: …», «Сжать сессию», «Сжать сессию?», «История для Claude заменится краткой сводкой. Само сжатие тоже тратит токены.», «Что сохранить в сводке», «Сжать», «Отмена», «Дождитесь окончания ответа», «Разбивка на HH:MM», «Разбивка недоступна», «обновляю…».
- `/context` — не чаще раза в 10 с на сессию; ожидание замера — 15 с.
- Пороги цвета значка: ≥ 80 % — предупреждение; до автосжатия ≤ 5 % окна — ошибка.
- В релиз — только после ревьюера всей ветки; Android — pre-release до проверки на телефоне.
- Каждый коммит обновляет затронутые заметки `obsidian/` (Структура кода, История разработки) в том же коммите.

## Rulings относительно спецификации

- Effort живёт в поле ввода, а не в шапке → значок ставится в шапке перед переключателем «Лента | Терминал». Спецификация исправляется этим же коммитом.
- Формат чисел — `formatTokens` («тыс.», «млн»), а не «k/M» скрина: так требует «дизайн не менять» и так выглядит «Расход». Спецификация исправляется.
- «Сессия свободна» = `!chat.busy && screen.kind === 'prompt' && screen.status === null && screen.input.trim() === ''` — то, что renderer уже знает из снимка экрана.

## Review Focus

1. `/context`, набранный вручную во время ответа Claude (вывод придёт позже) — замер всё равно принимается, лента его не показывает.
2. Подгрузка ранней части журнала («Показать раньше») не должна подменить свежий замер и «занято» старыми.
3. Переключение сессии, пока ждём `/context`: «обновляю…» и замер не переносятся в другую сессию; `/compact` уходит в ту сессию, где нажали.
4. Вывод `/context` другого формата (новая версия Claude Code) — без исключений, «Разбивка недоступна», значок по журналу работает.
5. Модель сменили после замера — процент считается по окну новой модели (или без процента), а не по старому замеру.

---

### Task 1: Разбор `/context` и «занято» (`src/shared/context-parse.ts`)

**Files:**
- Create: `src/shared/context-parse.ts`, `tests/fixtures/context-2.1.310.txt` (содержимое `<local-command-stdout>` настоящего `/context` с ANSI), `tests/unit/context-parse.test.ts`

**Interfaces — Produces:**

```ts
export interface ContextCategory { name: string; tokens: number; pct: number; color: string | null } // color: 'ansi:<код>' | null
export interface ContextSnapshot { used: number; window: number; buffer: number; categories: ContextCategory[] }
export function parseContextOutput(stdout: string): ContextSnapshot | null;
export function usedFromAssistant(rec: Record<string, unknown>): { used: number; model: string } | null;
export function parseTokenCount(s: string): number | null; // "29.7k"→29700, "1m"→1e6, "671"→671
export interface ContextView { used: number | null; window: number | null; pct: number | null; toAutocompact: number | null; level: 'ok' | 'warn' | 'danger' }
export function contextView(used: number | null, win: { window: number; buffer: number } | null): ContextView;
```

- [ ] **Step 1: Снять фикстуру.** Запустить `claude` в `/root/claude-vm-gui` на своём сервере `tmux -L cvg-probe`, отправить `/context`, вынуть из нового журнала поле `content` записи `subtype: "local_command"` (между тегами `local-command-stdout`) в `tests/fixtures/context-2.1.310.txt`, журнал пробы удалить, сервер остановить.
- [ ] **Step 2: Тесты.**
  - `parseContextOutput(фикстура)` → `window: 1_000_000`, `used: 29_700`, `buffer: 33_000`, категории по порядку `System prompt` (2800, 0.3), `System tools` (13400, 1.3), `MCP tools` (671, 0.1), `MCP server instructions` (717, 0.1), `Memory files` (764, 0.1), `Skills` (9900, 1.0), `Messages` (1300, 0.1), `Free space` (937400, 93.7), `Autocompact buffer` (33000, 3.3); у каждой `color` не null.
  - `parseContextOutput('что-то другое')` → `null`; вывод без строк категорий, но с `29.7k/1m tokens (3%)` → снимок с пустыми категориями и `buffer: 0`.
  - `parseTokenCount`: `'29.7k'`→29700, `'1M'`→1e6, `'671'`→671, `'abc'`→null.
  - `usedFromAssistant` — `{type:'assistant', message:{model:'claude-sonnet-5-5', usage:{input_tokens:10, cache_read_input_tokens:800, cache_creation_input_tokens:190, output_tokens:5}}}` → `{used:1000, model:'claude-sonnet-5-5'}`; `isSidechain: true` → null; модель `<synthetic>` → null; без usage → null.
  - `contextView(832_300, {window:1e6, buffer:33_000})` → `pct: 83`, `toAutocompact: 134_700`, `level: 'warn'`; `contextView(950_000, …)` → `level:'danger'`, `toAutocompact:17_000`; `contextView(29_700, null)` → `pct:null`, `level:'ok'`; `contextView(null, …)` → всё null.
- [ ] **Step 3:** `npx vitest run tests/unit/context-parse.test.ts` — FAIL (модуля нет).
- [ ] **Step 4: Реализовать.** Снять ANSI (`stripAnsi` из `screen-parse`) для чисел; цвет — последний `\x1b[<n>m` с n в 30–37/90–97 перед значком категории в исходной строке. Итог — регулярка `([\d.]+[km]?)\/([\d.]+[km]?) tokens \(`; категория — `[⛀⛁⛶⛝]\s+([^:]+):\s+([\d.]+[km]?)(?: tokens)? \(([\d.]+)%\)`; буфер — категория `Autocompact buffer` (нет — 0). danger: `toAutocompact <= window * 0.05`; warn: `pct >= 80`.
- [ ] **Step 5:** тест — PASS. **Commit:** «Разбор /context и занятого контекста по журналу» (+ заметка «Структура кода»).

### Task 2: Контекст в разборе журнала и скрытие `/context` из ленты

**Files:** Modify `src/shared/transcript-parse.ts`; Test `tests/unit/transcript-parse.test.ts`

**Interfaces — Consumes:** Task 1. **Produces:**

```ts
// в ParseState
context: SessionContext;
// в src/shared/ipc.ts
export interface SessionContext { used: number | null; model: string | null; snapshot: ContextSnapshot | null; snapshotAt: number | null; snapshotModel: string | null } // snapshotAt — ms из timestamp записи; snapshotModel — model на момент замера
```

- [ ] **Step 1: Тесты** (строки журнала собираются в тесте):
  - ответ ассистента с usage → `st.context.used === 1000`, `model` задан; следующий ответ с другим usage — обновляет.
  - `{type:'user', message:{content:'<command-name>/context</command-name>\n<command-message>context</command-message>\n<command-args></command-args>'}}` + `{type:'system', subtype:'local_command', timestamp:'2026-10-24T12:32:00.000Z', content:'<local-command-stdout>'+фикстура+'</local-command-stdout>'}` → `changed` пуст, `st.items` без них, `st.context.snapshot.window === 1e6`, `snapshotAt === Date.parse(…)`.
  - вывод `/context` без предшествующей команды (набрали вручную, а пришёл позже другого сообщения) — тоже распознаётся по тексту «Context Usage» и скрывается.
  - запись с `isCompactSummary: true` → `used === null` (snapshot не трогается).
  - `parseTranscriptLines(старые строки с usage, st, true)` после живых → `st.context` не изменился (Review Focus 2).
  - `/compact` как команда — по-прежнему элемент `user` с текстом `/compact …`.
- [ ] **Step 2:** FAIL. **Step 3: Реализовать:** `newParseState` с `context: {used:null, model:null, snapshot:null, snapshotAt:null}`; в `parseTranscriptLines` при `earlier` — сохранить и восстановить `st.context`; в `special()` команда `/context` → `'skip'`; `local_command` с текстом, содержащим `Context Usage`, → замер + `'skip'`; ассистент основной ветки → `usedFromAssistant`.
- [ ] **Step 4:** весь `tests/unit/transcript-parse.test.ts` — PASS. **Commit:** «Контекст сессии в разборе журнала; /context не в ленте».

### Task 3: Доставка в renderer и окно по модели

**Files:** Modify `src/shared/ipc.ts` (`ChatEvent.context: SessionContext`), `src/main/transcript.ts`, `src/renderer/state.ts`; Create `src/renderer/context-window.ts`; Test `tests/unit/context-window.test.ts`, `tests/unit/state-context.test.ts`

**Interfaces — Produces:**

```ts
// state.ts: ChatState.context: SessionContext (EMPTY — все null)
// context-window.ts
export function rememberWindow(model: string, w: { window: number; buffer: number }): void; // localStorage 'cvg.contextWindows', try/catch
export function windowFor(ctx: SessionContext): { window: number; buffer: number } | null;   // snapshot той же модели → он; иначе запомненное по ctx.model; иначе null
```

- [ ] **Step 1: Тесты.** `windowFor` — снимок есть и модель та же → из снимка; модель сменилась (snapshot снят при `claude-opus-5-5`, `ctx.model = 'claude-sonnet-5-5'`, ничего не запомнено) → null (Review Focus 5); запомненное по модели → оно; `localStorage` бросает → null без исключения. Состояние: событие `chat:items` с `context` → `chat[session].context` обновлён; событие другой сессии не трогает текущую (Review Focus 3).
- [ ] **Step 2:** FAIL. **Step 3: Реализовать.** `snapshotModel` заполняет Task 2 из `st.context.model` на момент замера. `TranscriptService` отправляет `context: this.st.context` в каждом `items`; живой поток эмитит и когда `changed` пуст, но `context` изменился (сравнение `used`, `snapshotAt`). При получении снимка renderer вызывает `rememberWindow(snapshotModel, …)`.
- [ ] **Step 4:** PASS + `npm run typecheck`. **Commit:** «Контекст сессии в событиях ленты; окно по модели».

### Task 4: Значок, панель и «Сжать сессию»

**Files:** Create `src/renderer/components/ContextBadge.tsx` (значок + панель), `src/renderer/components/CompactDialog.tsx`; Modify `SessionHeader.tsx`, стили (`src/renderer/styles/*.css` — только раскладка из существующих токенов); `tests/fixtures/fake-claude.mjs`; Test `tests/e2e/context.spec.ts`

**Interfaces — Consumes:** `contextView`, `windowFor`, `chat[session].context`, `chat[session].busy/screen`, `api.term.send(text, [], session)`, `formatTokens`.

- [ ] **Step 1: fake-claude.** Ответы ассистента пишут `message.model: 'claude-sonnet-5-5'` и `usage` (по умолчанию `input_tokens: 1000, cache_read_input_tokens: 820000, cache_creation_input_tokens: 11300` → 832 300). Ввод `/context` → запись команды + `local_command` с фикстурой Task 1. Ввод `/compact …` → запись команды, запись `isCompactSummary`, ответ ассистента с usage 20 000; текст аргументов сохраняется в истории экрана (`› /compact <args>`).
- [ ] **Step 2: E2E-тесты** (`tests/e2e/context.spec.ts`):
  - после ответа — значок «Контекст 832,3 тыс.» (окна ещё нет); открытие панели → в журнал уходит `/context` (экран fake показывает `› /context`), значок становится «Контекст 83 %» с классом предупреждения, в панели «Использовано: 83 %», строки категорий из фикстуры, «Токенов до автосжатия: 134,7 тыс.»; лента не содержит «Context Usage».
  - повторное открытие в течение 10 с не отправляет `/context` второй раз.
  - «Сжать сессию» → диалог; ввод «сохрани план» → «Сжать» → экран fake `› /compact сохрани план`, значок падает до «Контекст 2 %».
  - во время `busy` кнопка неактивна, `title` = «Дождитесь окончания ответа», `/context` не отправляется, показана прошлая разбивка «Разбивка на HH:MM».
  - открыли панель в сессии A и сразу переключились на B → `/context` не появляется в B (Review Focus 3).
- [ ] **Step 3:** `npx playwright test tests/e2e/context.spec.ts` — FAIL.
- [ ] **Step 4: Реализовать.** `ContextBadge` — кнопка в шапке (`aria-haspopup="dialog"`), класс уровня; панель — абсолютный блок под значком, закрытие по клику вне/Esc/повторному нажатию; полоска — `Bar` по категориям (без снимка — один цвет акцента); автозапуск `/context` при открытии — если свободна (Rulings) и с прошлой отправки в эту сессию прошло ≥ 10 с; «обновляю…» до нового `snapshotAt` или 15 с. `CompactDialog` — разметка `ConfirmDialog` + `<input>`; `/compact` + (` ` + текст с `\s*\n\s*`→` `, обрезанный) если не пуст.
- [ ] **Step 5:** e2e PASS. **Commit:** «Контекст сессии в шапке и кнопка «Сжать сессию»».

### Task 5: Windows — версия, полный прогон

- [ ] `package.json` → 0.5.0; заметки `obsidian/` (Структура кода, Дизайн и решения, История разработки).
- [ ] `npm run typecheck && npm test && npm run test:int && npm run test:e2e` — всё зелёное (база: unit 388, int 82, e2e 71 + новые).
- [ ] **Commit:** «Версия 0.5.0».

### Task 6: Android-форк

**Files:** те же пути в `/root/claude-vm-gui-android` + `src/core/transcript.ts` (вместо `src/main/transcript.ts`); панель — в `BottomSheet`, значок — в Android `SessionHeader`; `tests/e2e` форка.

- [ ] Ветка `v0.3` от `main` форка; перенести дифф задач 1–4 (`git diff <база v0.5>..HEAD -- src/shared src/renderer tests/unit tests/fixtures`), разрешить расхождения вручную.
- [ ] Android: значок в шапке; нажатие открывает `BottomSheet` с той же панелью; диалог сжатия — Android `ConfirmDialog`.
- [ ] Тесты форка: unit, Kotlin не затронут (прогнать), e2e с тем же сценарием `context.spec.ts`.
- [ ] Версия 0.3.0 (`package.json`, `versionName`/`versionCode`), заметки карты форка. **Commit:** «Версия 0.3.0: контекст сессии и «Сжать сессию»».

### Task 7: Ревью и выпуск

- [ ] Ревьюер (отдельный агент, самая сильная модель) по обеим веткам с Review Focus; Critical/Important — исправить с тестом RED→GREEN, полный прогон.
- [ ] Windows: слить `v0.5` в `main`, тег `v0.5.0`, релиз. Android: тег `v0.3.0`, pre-release (`make_latest=false`), ждать проверки на телефоне.
