import { useEffect, useState } from 'react';
import type { ChatImage } from '@shared/ipc';
import { formatBytes } from '@shared/metrics-parse';
import { isTextName, looksBinary, TEXT_PREVIEW_BYTES } from '@shared/text-file';
import { displayName, isImageName, MAX_FILE_BYTES } from '@shared/upload-name';
import { api } from '../api';
import { useAppState } from '../state';
import { FileCache } from '../file-cache';
import { IconChevron, IconChevronRight, IconFile, IconImage } from './icons';
import { Lightbox } from './Lightbox';

const cache = new FileCache((p, n) => api.upload.read(p, n));

/** Картинка по ширине пузыря; нажатие — на весь экран. */
function ImageBox({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="chat-image-btn" aria-label={`Открыть: ${alt}`} onClick={() => setOpen(true)}>
        <img className="chat-image" src={src} alt={alt} />
      </button>
      {open ? <Lightbox src={src} alt={alt} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Картинка из журнала (блок image); без данных — значок, как раньше. */
export function JournalImage({ image }: { image: ChatImage }) {
  if (!image.data)
    return (
      <span className="img-chip">
        <IconImage />
        Картинка
      </span>
    );
  return <ImageBox src={`data:${image.mediaType};base64,${image.data}`} alt="Картинка" />;
}

type Loaded = { kind: 'loading' } | { kind: 'gone' } | { kind: 'error'; message: string } | { kind: 'ok'; bytes: Uint8Array; size: number; truncated: boolean };

function useFile(path: string, maxBytes: number): Loaded {
  const [st, setSt] = useState<Loaded>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    void cache.get(path, maxBytes).then((r) => {
      if (!alive) return;
      if (r.ok) setSt({ kind: 'ok', ...r.data });
      else setSt(r.error.code === 'NOT_FOUND' ? { kind: 'gone' } : { kind: 'error', message: r.error.message });
    });
    return () => {
      alive = false;
    };
  }, [path, maxBytes]);
  return st;
}

function FileRow({ name, detail, open, onToggle }: { name: string; detail: string; open?: boolean; onToggle?: () => void }) {
  const body = (
    <>
      <IconFile />
      <span className="file-name ellipsis">{name}</span>
      <span className="caption">{detail}</span>
      {onToggle ? (open ? <IconChevron /> : <IconChevronRight />) : null}
    </>
  );
  return onToggle ? (
    <button type="button" className="tool-row file-row" aria-expanded={open} onClick={onToggle}>{body}</button>
  ) : (
    <div className="tool-row file-row">{body}</div>
  );
}

function UploadedImage({ path, name }: { path: string; name: string }) {
  const st = useFile(path, MAX_FILE_BYTES);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (st.kind !== 'ok') return;
    const u = URL.createObjectURL(new Blob([st.bytes as BlobPart]));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [st]);
  if (st.kind === 'gone') return <div className="tool file-att"><FileRow name={name} detail="файл удалён с ВМ" /></div>;
  if (st.kind === 'error') return <div className="tool file-att"><FileRow name={name} detail={st.message} /></div>;
  if (!url) return <div className="chat-image-placeholder" role="img" aria-label={`Загружается: ${name}`} />;
  return <ImageBox src={url} alt={name} />;
}

function UploadedFile({ path, name }: { path: string; name: string }) {
  const text = isTextName(name);
  const st = useFile(path, text ? TEXT_PREVIEW_BYTES : 0);
  const [open, setOpen] = useState(false);
  if (st.kind === 'loading') return <div className="tool file-att"><FileRow name={name} detail="…" /></div>;
  if (st.kind === 'gone') return <div className="tool file-att"><FileRow name={name} detail="файл удалён с ВМ" /></div>;
  if (st.kind === 'error') return <div className="tool file-att"><FileRow name={name} detail={st.message} /></div>;
  const size = formatBytes(st.size);
  if (!text || looksBinary(st.bytes)) return <div className="tool file-att"><FileRow name={name} detail={size} /></div>;
  return (
    <div className="tool file-att">
      <FileRow name={name} detail={size} open={open} onToggle={() => setOpen((o) => !o)} />
      {open ? (
        <div className="tool-body">
          <pre className="tool-pre mono">{new TextDecoder().decode(st.bytes)}</pre>
          {st.truncated ? <div className="caption">показано {formatBytes(TEXT_PREVIEW_BYTES)} из {size}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Вложение сообщения из папки загрузок на ВМ: картинка целиком, текст — раскрывается, остальное — имя и размер. */
export function FileView({ path }: { path: string }) {
  const name = displayName(path);
  return isImageName(name) ? <UploadedImage path={path} name={name} /> : <UploadedFile path={path} name={name} />;
}

type SaveState = { kind: 'idle' } | { kind: 'busy'; pct: number | null } | { kind: 'saved'; to: string } | { kind: 'error'; message: string };

/** «Открыть в браузере» (HTML) и «Сохранить» у файла outbox: скачивание идёт в main, здесь — прогресс и итог. */
function OutboxActions({ path, html }: { path: string; html: boolean }) {
  const online = useAppState().connection.state === 'connected';
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  useEffect(
    () =>
      api.outbox.onProgress((p) => {
        if (p.path === path) setSave((s) => (s.kind === 'busy' ? { kind: 'busy', pct: p.total ? Math.floor((p.sent / p.total) * 100) : null } : s));
      }),
    [path],
  );
  const doSave = async () => {
    setSave({ kind: 'busy', pct: null });
    const r = await api.outbox.save(path);
    setSave(!r.ok ? { kind: 'error', message: r.error.message } : r.data ? { kind: 'saved', to: r.data.savedTo } : { kind: 'idle' });
  };
  const doOpen = async () => {
    setOpening(true);
    setOpenError(null);
    const r = await api.outbox.openHtml(path);
    setOpening(false);
    if (!r.ok) setOpenError(r.error.message);
  };
  const off = online ? undefined : 'Нет подключения к ВМ';
  return (
    <div className="outbox-actions">
      {html ? (
        <button type="button" className="btn btn-sm" disabled={!online || opening} title={off} onClick={() => void doOpen()}>
          Открыть в браузере
        </button>
      ) : null}
      {save.kind === 'saved' ? (
        <>
          <span className="caption">Сохранено</span>
          <button type="button" className="btn btn-sm" onClick={() => api.outbox.reveal(save.to)}>Показать в папке</button>
        </>
      ) : save.kind === 'busy' ? (
        <>
          <div className="bar bar-thin outbox-bar" role="progressbar" aria-label="Сохранение" aria-valuenow={save.pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <div className="bar-fill" style={{ width: `${save.pct ?? 0}%` }} />
          </div>
          <span className="caption">{save.pct ?? 0} %</span>
        </>
      ) : (
        <button type="button" className="btn btn-sm" disabled={!online} title={off} onClick={() => void doSave()}>
          {save.kind === 'error' ? 'Повторить' : 'Сохранить'}
        </button>
      )}
      {save.kind === 'error' ? <span className="form-error">{save.message}</span> : null}
      {openError ? <span className="form-error">{openError}</span> : null}
    </div>
  );
}

/**
 * Файл, который Claude положил в outbox: картинка — целиком, текст — раскрывается, остальное — имя и размер;
 * у всех — «Сохранить», у HTML — «Открыть в браузере».
 */
export function OutboxFile({ path }: { path: string }) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const html = /\.html?$/i.test(name);
  return (
    <div className="outbox-file" role="group" aria-label={name}>
      {isImageName(name) ? <UploadedImage path={path} name={name} /> : <UploadedFile path={path} name={name} />}
      <OutboxActions path={path} html={html} />
    </div>
  );
}
