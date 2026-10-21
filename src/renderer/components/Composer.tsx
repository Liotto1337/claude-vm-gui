import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { detectTrigger, filterHints, type Trigger } from '@shared/hints';
import type { HintCommand, Hints, ImageExt, ModelInfo, ParsedMenu, TmuxSession } from '@shared/ipc';
import { api } from '../api';
import { addPending, dropPending, markPendingSent, refreshSessions, rememberChoice, useAppState } from '../state';
import { AttachmentChip, type Attachment } from './AttachmentChip';
import { ChoiceMenu } from './ChoiceMenu';
import { HintPopup, type HintItem } from './HintPopup';
import { IconArrowUp, IconClip } from './icons';
import { MenuCard } from './MenuCard';

const MIME_EXT: Record<string, ImageExt> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const MAX_BYTES = 20 * 1024 * 1024;
const FALLBACK_MODELS: ModelInfo[] = [
  { value: 'default', displayName: 'Default', description: '', efforts: [] },
  { value: 'opus', displayName: 'Opus', description: '', efforts: [] },
  { value: 'sonnet', displayName: 'Sonnet', description: '', efforts: [] },
];
const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Поле ввода. menu — открытое меню Claude Code (карточка над полем, поле неактивно);
 * working — claude работает (кнопка «Остановить»), chatMode — показана лента, а не терминал.
 */
export function Composer({ session, menu = null, working = false, chatMode = false }: { session: TmuxSession; menu?: ParsedMenu | null; working?: boolean; chatMode?: boolean }) {
  const menuOpen = menu !== null;
  const { choices } = useAppState();
  const choice = choices[session.name] ?? {};
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [hints, setHints] = useState<Hints | null>(null);
  const [files, setFiles] = useState<string[] | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // Карточка меню закрылась (поле снова доступно) и фокус никому не достался — обратно в поле
  const wasMenu = useRef(menuOpen);
  useEffect(() => {
    if (wasMenu.current && !menuOpen && (!document.activeElement || document.activeElement === document.body)) box.current?.focus();
    wasMenu.current = menuOpen;
  }, [menuOpen]);
  // Отправка уже идёт — второй Enter не должен отправить то же сообщение ещё раз
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Подсказки команд и моделей — для рабочей папки сессии
  useEffect(() => {
    let alive = true;
    setHints(null);
    setFiles(null);
    void api.hints.get(session.cwd).then((r) => alive && r.ok && setHints(r.data));
    return () => {
      alive = false;
    };
  }, [session.cwd]);

  useEffect(
    () =>
      api.upload.onProgress((p) =>
        setAttachments((list) =>
          list.map((a) => (a.id === p.id && a.status === 'uploading' ? { ...a, percent: p.total ? Math.round((p.sent / p.total) * 100) : 100 } : a)),
        ),
      ),
    [],
  );

  const trigger: Trigger | null = dismissed === caret ? null : detectTrigger(text, caret);

  useEffect(() => {
    if (trigger?.kind === 'file' && files === null) {
      setFiles([]);
      void api.hints.files(session.cwd).then((r) => setFiles(r.ok ? r.data : []));
    }
  }, [trigger?.kind, files, session.cwd]);

  const commands = useMemo(
    () => [...(hints?.commands ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [hints],
  );

  const items: HintItem[] = useMemo(() => {
    if (!trigger) return [];
    if (trigger.kind === 'slash') {
      return filterHints<HintCommand>(commands, trigger.query, (c) => c.name).map((c) => ({
        key: c.name,
        label: `/${c.name}`,
        description: c.description,
      }));
    }
    return filterHints(files ?? [], trigger.query, (f) => f).map((f) => ({ key: f, label: f }));
  }, [trigger, commands, files]);

  useEffect(() => setActive(0), [trigger?.kind, trigger?.query]);

  const setTextAndCaret = (value: string, pos: number) => {
    setText(value);
    setCaret(pos);
    setDismissed(null);
    requestAnimationFrame(() => {
      box.current?.setSelectionRange(pos, pos);
    });
  };

  const pick = (i: number) => {
    const it = items[i];
    if (!it || !trigger) return;
    const insert = trigger.kind === 'slash' ? `/${it.key} ` : `@${it.key} `;
    const value = text.slice(0, trigger.start) + insert + text.slice(caret);
    setTextAndCaret(value, trigger.start + insert.length);
  };

  const uploading = attachments.some((a) => a.status === 'uploading');
  const ready = attachments.filter((a) => a.status === 'done');
  const canSend =
    session.claudeRunning && !menuOpen && !busy && !uploading && !attachments.some((a) => a.status === 'error') && (text.trim() !== '' || ready.length > 0);

  const send = async () => {
    if (!canSend || sending.current) return;
    sending.current = true;
    setBusy(true);
    // Сообщение сразу в ленте (темнее), пока идёт отправка
    const pendingId = addPending(session.name, text.trim(), ready.length);
    const r = await api.term.send(text, ready.map((a) => a.remotePath!)).finally(() => {
      sending.current = false;
      setBusy(false);
    });
    if (!r.ok) {
      dropPending(session.name, pendingId);
      setSendError(r.error.message);
      return;
    }
    markPendingSent(session.name, pendingId);
    setSendError(null);
    for (const a of attachments) URL.revokeObjectURL(a.url);
    setAttachments([]);
    setTextAndCaret('', 0);
  };

  const upload = async (a: Attachment) => {
    setAttachments((list) => list.map((x) => (x.id === a.id ? { ...x, status: 'uploading', percent: 0, error: undefined } : x)));
    const r = await api.upload.image(a.id, a.bytes, a.ext);
    setAttachments((list) =>
      list.map((x) =>
        x.id !== a.id ? x : r.ok ? { ...x, status: 'done', percent: 100, remotePath: r.data.remotePath } : { ...x, status: 'error', error: r.error.message },
      ),
    );
  };

  const addFiles = async (list: File[]) => {
    for (const f of list) {
      const ext = MIME_EXT[f.type];
      if (!ext) continue;
      const id = `img-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const bytes = new Uint8Array(await f.arrayBuffer());
      const a: Attachment = {
        id,
        name: f.name && f.name !== 'image.png' ? f.name : 'Вставленная картинка',
        url: URL.createObjectURL(f),
        bytes,
        ext,
        size: bytes.byteLength,
        status: bytes.byteLength > MAX_BYTES ? 'error' : 'uploading',
        percent: 0,
        error: bytes.byteLength > MAX_BYTES ? 'больше 20 МБ' : undefined,
      };
      setAttachments((l) => [...l, a]);
      if (a.status === 'uploading') void upload(a);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = [...e.clipboardData.items].filter((i) => i.kind === 'file' && MIME_EXT[i.type]).map((i) => i.getAsFile()).filter((f): f is File => f !== null);
    if (images.length === 0) return;
    e.preventDefault();
    void addFiles(images);
  };

  const onDrop = (e: DragEvent) => {
    const images = [...e.dataTransfer.files].filter((f) => MIME_EXT[f.type]);
    if (images.length === 0) return;
    e.preventDefault();
    void addFiles(images);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (items.length > 0) {
      if (e.key === 'ArrowDown') return e.preventDefault(), setActive((i) => (i + 1) % items.length);
      if (e.key === 'ArrowUp') return e.preventDefault(), setActive((i) => (i - 1 + items.length) % items.length);
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) return e.preventDefault(), pick(active);
      if (e.key === 'Escape') return e.preventDefault(), setDismissed(caret);
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const models = hints?.models.length ? hints.models : FALLBACK_MODELS;
  const model = models.find((m) => m.value === choice.model) ?? models.find((m) => m.value === 'default');
  const efforts = model?.efforts.length ? model.efforts : FALLBACK_EFFORTS;

  return (
    <div className="composer-wrap" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {!session.claudeRunning ? (
        <div className="notice" role="status">
          claude не запущен
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void api.tmux.startClaude(session.name).then(() => setTimeout(() => void refreshSessions(), 1500))}
          >
            Запустить claude
          </button>
        </div>
      ) : null}
      {/* Карточка всплывает над полем, не меняя раскладку: иначе терминал под лентой стал бы ниже
          и Claude Code перерисовал бы меню, обрезав его начало */}
      {menu ? (
        <div className="menu-layer">
          <MenuCard menu={menu} />
        </div>
      ) : null}
      <div className="composer-anchor">
        <HintPopup items={items} active={active} onPick={pick} />
        <div className="composer">
          {attachments.length > 0 ? (
            <div className="chips">
              {attachments.map((a) => (
                <AttachmentChip
                  key={a.id}
                  a={a}
                  onRetry={() => void upload(a)}
                  onRemove={() => {
                    URL.revokeObjectURL(a.url);
                    setAttachments((l) => l.filter((x) => x.id !== a.id));
                  }}
                />
              ))}
            </div>
          ) : null}
          <label htmlFor="composer-input" className="visually-hidden">Сообщение для Claude</label>
          <textarea
            id="composer-input"
            ref={box}
            rows={2}
            value={text}
            disabled={menuOpen}
            placeholder={menuOpen ? 'Сначала ответьте на вопрос выше' : 'Напишите сообщение…'}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart);
              setDismissed(null);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          <div className="composer-bar">
            <button type="button" className="icon-btn" aria-label="Прикрепить картинку" onClick={() => fileInput.current?.click()}>
              <IconClip />
            </button>
            <input
              ref={fileInput}
              type="file"
              hidden
              multiple
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(e) => {
                void addFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <div className="grow" />
            <ChoiceMenu
              buttonLabel={choice.modelLabel ? `Модель: ${choice.modelLabel}` : 'Модель'}
              menuLabel="Модель"
              title="Модель · отправит /model"
              choices={models.map((m) => ({ value: m.value, label: m.displayName, description: m.description }))}
              selected={choice.model}
              onSelect={(c) =>
                void api.term.setModel(c.value).then((r) => {
                  setSendError(r.ok ? null : r.error.message);
                  if (r.ok) rememberChoice(session.name, { model: c.value, modelLabel: c.label });
                })
              }
            />
            <ChoiceMenu
              buttonLabel={choice.effort ? `Effort: ${choice.effort}` : 'Effort'}
              menuLabel="Effort"
              title="Effort · отправит /effort"
              choices={efforts.map((e) => ({ value: e, label: e }))}
              selected={choice.effort}
              onSelect={(c) =>
                void api.term.setEffort(c.value).then((r) => {
                  setSendError(r.ok ? null : r.error.message);
                  if (r.ok) rememberChoice(session.name, { effort: c.value });
                })
              }
            />
            {chatMode && working && !menuOpen ? (
              <button type="button" className="btn btn-sm" onClick={() => void api.chat.key('esc')}>Остановить · Esc</button>
            ) : null}
            <button type="button" className="send-btn" aria-label="Отправить" disabled={!canSend} onClick={() => void send()}>
              <IconArrowUp />
            </button>
          </div>
        </div>
      </div>
      {sendError ? <p className="form-error" role="alert">{sendError}</p> : null}
      <div className="composer-help">Enter — отправить · Shift+Enter — новая строка · Ctrl+V или перетаскивание — картинка</div>
    </div>
  );
}
