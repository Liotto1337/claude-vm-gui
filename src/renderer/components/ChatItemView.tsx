import { memo, useState } from 'react';
import type { ChatItem } from '@shared/ipc';
import { FileView, JournalImage, OutboxFile } from './FileView';
import { IconChevron, IconChevronRight } from './icons';
import { Markdown } from './Markdown';
import { TypedMarkdown } from './TypedMarkdown';

type Tool = Extract<ChatItem, { kind: 'tool' }>;
const PREVIEW_LINES = 20;

function ToolStatus({ status }: { status: Tool['status'] }) {
  if (status === 'running') return <span className="tool-icon spin-dot" role="img" aria-label="Выполняется" />;
  return status === 'ok' ? (
    <svg className="tool-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.4" strokeLinecap="round" role="img" aria-label="Готово">
      <path d="M5 12l5 5 9-10" />
    </svg>
  ) : (
    <svg className="tool-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.4" strokeLinecap="round" role="img" aria-label="Ошибка">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

function ToolView({ tool }: { tool: Tool }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const lines = tool.result?.split('\n') ?? [];
  const shown = all || lines.length <= PREVIEW_LINES ? tool.result : lines.slice(0, PREVIEW_LINES).join('\n');
  return (
    <div className="tool">
      <button type="button" className="tool-row" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ToolStatus status={tool.status} />
        <span className="tool-name">{tool.name}</span>
        <span className="tool-summary mono ellipsis">{tool.summary}</span>
        {open ? <IconChevron /> : <IconChevronRight />}
      </button>
      {open ? (
        <div className="tool-body">
          {tool.children.length ? (
            <div className="tool-children">
              {tool.children.map((c) => (
                <ChatItemView key={c.id} item={c} />
              ))}
            </div>
          ) : null}
          <pre className="tool-pre mono">{tool.input}</pre>
          {tool.result !== null ? (
            <>
              <pre className={tool.status === 'error' ? 'tool-pre mono tool-error' : 'tool-pre mono'}>{shown}</pre>
              {!all && lines.length > PREVIEW_LINES ? (
                <button type="button" className="btn btn-sm" onClick={() => setAll(true)}>Показать всё · {lines.length} строк</button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Один элемент ленты. typingSince — ответ только что пришёл и «печатается»; onTyped — «печать» закончилась.
 */
export const ChatItemView = memo(function ChatItemView({ item, typingSince, onTyped }: { item: ChatItem; typingSince?: number; onTyped?: () => void }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="bubble">
          {item.images.map((im, i) => (
            <JournalImage key={i} image={im} />
          ))}
          {item.files.map((f) => (
            <FileView key={f} path={f} />
          ))}
          {item.text ? <span className="bubble-text">{item.text}</span> : null}
        </div>
      );
    case 'assistant': {
      const text = typingSince !== undefined && onTyped ? <TypedMarkdown text={item.text} since={typingSince} onDone={onTyped} /> : <Markdown text={item.text} />;
      if (!item.files?.length) return text;
      return (
        <>
          {text}
          <div className="outbox-files">
            {item.files.map((f) => (
              <OutboxFile key={f} path={f} />
            ))}
          </div>
        </>
      );
    }
    case 'thinking':
      return <div className="thinking caption">Размышления</div>;
    case 'note':
      return <div className="note caption">{item.text}</div>;
    case 'tool':
      return <ToolView tool={item} />;
  }
});
