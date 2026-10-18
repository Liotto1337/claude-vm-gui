import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ExitReason } from '@shared/ipc';
import { api } from '../api';
import { refreshSessions, useAppState } from '../state';
import { terminalTheme } from '../terminal-theme';

const EXIT_TEXT: Record<Exclude<ExitReason, 'connection-lost'>, string> = {
  killed: 'Сессия завершена',
  detached: 'Отключено от сессии',
};

/** xterm.js, привязанный к PTY-каналу `tmux attach` выбранной сессии. */
export function TerminalView({ name }: { name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const { theme } = useAppState();
  const [exit, setExit] = useState<Exclude<ExitReason, 'connection-lost'> | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    setExit(null);
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: false,
      theme: terminalTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fit.fit();

    const copySelection = () => {
      const text = term.getSelection();
      if (!text) return false;
      void navigator.clipboard.writeText(text).catch(() => undefined);
      return true;
    };
    const pasteClipboard = () => {
      void navigator.clipboard.readText().then((t) => t && term.paste(t)).catch(() => undefined);
    };
    // Ctrl+C копирует, когда есть выделение (иначе это прерывание для claude); Ctrl+Shift+C/V — всегда.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return true;
      const key = e.key.toLowerCase();
      if (key === 'c' && (e.shiftKey || term.hasSelection())) {
        copySelection();
        return false;
      }
      if (key === 'v' && e.shiftKey) {
        pasteClipboard();
        return false;
      }
      return true;
    });
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      if (!copySelection()) pasteClipboard();
    };
    el.addEventListener('contextmenu', onContext);

    const offData = api.term.onData((d) => term.write(d));
    const offExit = api.term.onExit((reason) => {
      if (reason === 'connection-lost') return;
      setExit(reason);
      void refreshSessions();
    });
    const input = term.onData((d) => api.term.write(d));
    void api.term.open(name, term.cols, term.rows).then((r) => {
      if (!r.ok) setExit('killed');
      else term.focus();
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      api.term.resize(term.cols, term.rows);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      el.removeEventListener('contextmenu', onContext);
      input.dispose();
      offData();
      offExit();
      term.dispose();
      termRef.current = null;
    };
  }, [name, attempt]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = terminalTheme(theme);
  }, [theme]);

  return (
    <section aria-label="Терминал" className="terminal-card">
      <div ref={host} className="terminal-host" />
      {exit ? (
        <div className="terminal-exit" role="status">
          <p>{EXIT_TEXT[exit]}</p>
          {exit === 'detached' ? (
            <button type="button" className="btn" onClick={() => setAttempt((a) => a + 1)}>Подключиться снова</button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
